import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  ensureBackendAwake,
  getBackendStatus,
  parseRetryAfterMs,
  requestBackend,
  resetBackendStatusForTests,
  subscribeBackendStatus,
  type BackendStatus,
} from "../services/backendStatus";

function jsonResponse(status: number, body: unknown, retryAfter?: string): Response {
  const headers = retryAfter == null ? undefined : { "Retry-After": retryAfter };
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  resetBackendStatusForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRetryAfterMs", () => {
  it("falls back when absent or invalid", () => {
    expect(parseRetryAfterMs(null)).toBe(3000);
    expect(parseRetryAfterMs("abc")).toBe(3000);
    expect(parseRetryAfterMs("-2")).toBe(3000);
    expect(parseRetryAfterMs("3")).toBe(3000);
  });

  it("caps very large values", () => {
    expect(parseRetryAfterMs("120")).toBe(30000);
  });
});

describe("ensureBackendAwake single-flight", () => {
  it("shares one in-flight wake request between concurrent callers", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = ensureBackendAwake();
    const second = ensureBackendAwake();
    const third = ensureBackendAwake();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/ready");
    resolveFetch(jsonResponse(200, { status: "ready" }));
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
    await expect(third).resolves.toBeDefined();
    expect(getBackendStatus()).toBe("online");
  });

  it("starts a fresh request after the previous one settles", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await ensureBackendAwake();
    await ensureBackendAwake();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wake polls /api/ready through backend_starting 503s until online", async () => {
    let calls = 0;
    const urls: unknown[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      calls += 1;
      urls.push(input);
      return calls <= 3 ? jsonResponse(503, { error: "backend_starting" }, "0") : jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: BackendStatus[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));

    await ensureBackendAwake();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(urls.every((u) => u === "/api/ready")).toBe(true);
    expect(seen).toContain("starting");
    expect(seen).not.toContain("error");
    expect(getBackendStatus()).toBe("online");
  });

  it("treats a direct-backend 503 starting probe as starting, not error", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      // Local dev hits the backend directly (no gateway): /ready answers
      // 503 {"status": "starting"} without an `error` field or Retry-After.
      return calls === 1 ? jsonResponse(503, { status: "starting" }) : jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await requestBackend("/api/ready", undefined, { maxWakeWaitMs: 8000, defaultRetryMs: 10 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getBackendStatus()).toBe("online");
  });

  it("an aborted attempt then success stays STARTING and ends ONLINE", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      // E.g. a cold-start gateway reset surfacing as an abort mid-flight.
      if (calls === 1) throw new DOMException("Aborted", "AbortError");
      return jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: BackendStatus[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));

    await ensureBackendAwake({ defaultRetryMs: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toContain("starting");
    expect(seen).not.toContain("error");
    expect(getBackendStatus()).toBe("online");
  });

  it("a transient network failure during startup stays STARTING and recovers", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: BackendStatus[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));

    await ensureBackendAwake({ defaultRetryMs: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toContain("starting");
    expect(seen).not.toContain("error");
    expect(getBackendStatus()).toBe("online");
  });

  it("persistent failure inside the window eventually reports OFFLINE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(ensureBackendAwake({ maxWakeWaitMs: 60, defaultRetryMs: 5 })).rejects.toThrow("fetch failed");
    expect(getBackendStatus()).toBe("error");
  });

  it("a stale failure arriving after a newer success never overwrites ONLINE", async () => {
    let rejectFirst!: (err: unknown) => void;
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
      return jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const older = requestBackend("http://t/old");
    const newer = await requestBackend("http://t/new");
    expect(newer.status).toBe(200);
    expect(getBackendStatus()).toBe("online");
    rejectFirst(new TypeError("stale connection reset"));
    await expect(older).rejects.toThrow("stale connection reset");
    expect(getBackendStatus()).toBe("online");
  });

  it("aborting the wake leaves shared state untouched and allows a fresh cycle", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = ensureBackendAwake({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrowError();
    // Aborted before any verdict: starting (set at loop entry), never error.
    expect(getBackendStatus()).toBe("starting");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready" })));
    await ensureBackendAwake();
    expect(getBackendStatus()).toBe("online");
  });

  it("resumes startup detection from a clean slate like a reload", async () => {
    vi.resetModules();
    const fresh = await import("../services/backendStatus");
    expect(fresh.getBackendStatus()).toBe("unknown");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready" })));
    await fresh.ensureBackendAwake();
    expect(fresh.getBackendStatus()).toBe("online");
  });
});

describe("requestBackend status and wake retries", () => {
  it("successful request marks ONLINE and returns the body untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true })));
    const response = await requestBackend("http://t/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(getBackendStatus()).toBe("online");
  });

  it("backend_starting marks STARTING, retries, then marks ONLINE", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(503, { error: "backend_starting" }, "0") : jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: BackendStatus[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));

    const response = await requestBackend("http://t/health", undefined, {
      maxWakeWaitMs: 2000,
      defaultRetryMs: 10,
    });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toContain("starting");
    expect(getBackendStatus()).toBe("online");
  });

  it("waits roughly the Retry-After delay before retrying", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(503, { error: "backend_starting" }, "1") : jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const started = Date.now();
    await requestBackend("http://t/health", undefined, { maxWakeWaitMs: 5000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry normal 4xx errors", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(422, { error: "invalid_request" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await requestBackend("http://t/validate");
    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A definitive answer proves the server is up, clearing the transient state.
    expect(getBackendStatus()).toBe("online");
  });

  it("does not retry other 5xx errors, and marks ERROR", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: "internal_error" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await requestBackend("http://t/validate");
    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getBackendStatus()).toBe("error");
  });

  it("tolerates isolated failures while ONLINE, surfaces persistent outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready" })));
    await requestBackend("http://t/ready");
    expect(getBackendStatus()).toBe("online");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { error: "slow" })));
    await requestBackend("http://t/a");
    expect(getBackendStatus()).toBe("online");
    await requestBackend("http://t/b");
    expect(getBackendStatus()).toBe("online");
    await requestBackend("http://t/c");
    expect(getBackendStatus()).toBe("error");
  });

  it("does not treat a non-starting 503 as a wake signal", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { error: "busy" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await requestBackend("http://t/x", undefined, { maxWakeWaitMs: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });

  it("marks ERROR after the retry limit and returns the last response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { error: "backend_starting" }, "0"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await requestBackend("http://t/health", undefined, {
      maxWakeWaitMs: 60,
      defaultRetryMs: 10,
    });
    expect(response.status).toBe(503);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(getBackendStatus()).toBe("error");
  });

  it("marks ERROR on network failure and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(requestBackend("http://t/health")).rejects.toThrow("fetch failed");
    expect(getBackendStatus()).toBe("error");
  });
});
