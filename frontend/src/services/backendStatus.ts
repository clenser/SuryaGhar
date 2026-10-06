/**
 * Central backend connection state + wake retry for the on-demand backend.
 *
 * The EC2 backend stops when idle and is woken through the request gateway,
 * which answers HTTP 503 {"error": "backend_starting"} (with a Retry-After
 * header) while it is still starting. Every API call goes through
 * requestBackend(), which:
 * - surfaces a shared BackendStatus for status UI,
 * - automatically retries backend_starting responses until they succeed or a
 *   maximum wake window elapses,
 * - leaves all other responses (including 4xx and normal 5xx) untouched so
 *   existing parsing/error handling is preserved.
 *
 * No infrastructure terminology (Lambda, EC2, API Gateway, ...) leaks into
 * user-facing copy; that lives in the components.
 */

import { API_BASE_URL } from "./apiBase";

export type BackendStatus = "unknown" | "starting" | "online" | "error";

export const BACKEND_STARTING_CODE = "backend_starting";
export const DEFAULT_RETRY_AFTER_MS = 3000;
export const MAX_RETRY_AFTER_MS = 30000;
/** Upper bound for one wake-and-retry cycle before surfacing failure. */
export const MAX_WAKE_WAIT_MS = 120_000;

type Listener = () => void;

const listeners = new Set<Listener>();
let status: BackendStatus = "unknown";

export function getBackendStatus(): BackendStatus {
  return status;
}

export function subscribeBackendStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(next: BackendStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn());
}

/** Test-only reset so suites start from a clean state. */
export function resetBackendStatusForTests(): void {
  status = "unknown";
  listeners.clear();
}

/** Parse a Retry-After (delta-seconds) value; fall back when absent/invalid. */
export function parseRetryAfterMs(value: string | null, fallbackMs = DEFAULT_RETRY_AFTER_MS): number {
  if (value == null) return fallbackMs;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** True when the response is the explicit "backend is starting" signal. */
async function isBackendStarting(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const data = (await response.clone().json()) as { error?: unknown; status?: unknown } | null;
    // Gateway form ("backend_starting") and direct-backend form ("starting",
    // from GET /ready without the gateway in local dev) both mean "not ready".
    return data?.error === BACKEND_STARTING_CODE || data?.status === "starting";
  } catch {
    return false;
  }
}

export interface WakeRetryOptions {
  maxWakeWaitMs?: number;
  defaultRetryMs?: number;
}

/**
 * Single-flight initial wake request. The first page load must hit the
 * backend readiness probe (through the normal wake path) without waiting for
 * any user action; concurrent callers — including React StrictMode's
 * double-invoked mount effects and rerenders — share the same in-flight
 * promise, so exactly one wake request exists at a time. The promise clears
 * on settle so a later visit after another stop can wake again; afterwards
 * everything flows through the regular requestBackend() path.
 *
 * Readiness (GET /ready), not liveness (GET /health), drives the online
 * state: "API Online" is shown only after the backend reports it finished
 * initialization and can accept analysis requests.
 */
let wakeInflight: Promise<Response> | null = null;

export function ensureBackendAwake(): Promise<Response> {
  if (!wakeInflight) {
    wakeInflight = requestBackend(`${API_BASE_URL}/ready`).finally(() => {
      wakeInflight = null;
    });
  }
  return wakeInflight;
}

/**
 * Fetch wrapper with shared status + automatic wake retries.
 *
 * Returns the final Response untouched for the caller to parse; throws only
 * on network failure or abort (exactly like a plain fetch).
 */
export async function requestBackend(
  input: string,
  init?: RequestInit,
  opts?: WakeRetryOptions,
): Promise<Response> {
  const maxWakeWaitMs = opts?.maxWakeWaitMs ?? MAX_WAKE_WAIT_MS;
  const defaultRetryMs = opts?.defaultRetryMs ?? DEFAULT_RETRY_AFTER_MS;
  if (getBackendStatus() !== "online") setStatus("starting");
  const deadline = Date.now() + maxWakeWaitMs;

  for (;;) {
    let response: Response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetch(input, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      setStatus("error");
      throw err;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await isBackendStarting(response)) {
      setStatus("starting");
      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After"), defaultRetryMs);
      if (Date.now() + waitMs > deadline) {
        setStatus("error");
        return response;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitMs, init?.signal ?? undefined);
      continue;
    }

    // Any definitive answer other than backend_starting resolves the transient
    // state: the server demonstrably answered (even a 4xx proves it is up).
    if (response.status >= 500) setStatus("error");
    else setStatus("online");
    return response;
  }
}

