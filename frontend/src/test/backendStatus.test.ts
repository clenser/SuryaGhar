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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/ready");
    resolveFetch(jsonResponse(200, { status: "ok" }));
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
    expect(getBackendStatus()).toBe("online");
  });

  it("starts a fresh request after the previous one settles", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: "ok" }));
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
      return calls === 1 ? jsonResponse(503, { error: "backend_starting" }, "0") : jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: BackendStatus[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));

    await ensureBackendAwake();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls.every((u) => u === "/api/ready")).toBe(true);
    expect(seen).toContain("starting");
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
    const response = await requestBackend("/api/ready", undefined, { maxWakeWaitMs: 8000 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getBackendStatus()).toBe("online");
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
