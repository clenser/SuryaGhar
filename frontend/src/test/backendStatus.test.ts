import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
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
