/**
 * Central backend connection state + wake retry for the on-demand backend.
 *
 * The EC2 backend stops when idle and is woken through the request gateway,
 * which answers HTTP 503 {"error": "backend_starting"} (with a Retry-After
 * header) while it is still starting. Every API call goes through
 * requestBackend(), which surfaces a shared BackendStatus for status UI.
 *
 * BackendStatus state machine (single shared instance in this module):
 *
 *   unknown   → initial page load, before any request settles.
 *   starting  → the backend is reasonably expected to become ready: the wake
 *               request is in flight, /ready answered 503/starting, the
 *               gateway answered backend_starting, or a transient failure
 *               (timeout, reset, 502/504, ...) happened inside the wake
 *               window. Map browsing, search, selection and measurements stay
 *               usable; backend-dependent actions stay locked.
 *   online    → ONLY when GET /ready answered HTTP 200 with
 *               {"status": "ready"}. Never inferred from /health, EC2 state,
 *               page load, or a bare gateway connection. Locks lift.
 *   error     → genuine failure evidence only: the wake window expired, a
 *               definitive non-retryable answer arrived (e.g. 4xx on the
 *               readiness probe), or a failure happened with no wake cycle
 *               covering startup and no newer success on record.
 *
 * Two request kinds are distinguished:
 * - Wake requests (ensureBackendAwake → GET /api/ready) own the startup
 *   window: every transient is retried with server-directed pacing
 *   (Retry-After) or a small jittered fallback until the window expires.
 *   Each attempt is abort-capped so one hung request can never by itself
 *   declare OFFLINE.
 * - Normal requests (search, analysis, ...) keep their existing contract,
 *   except transient failures observed while a wake cycle is active (or a
 *   newer success already landed) no longer flip shared state to OFFLINE.
 *
 * Stale-write protection: `onlineEpoch` bumps on every transition to online.
 * Requests capture it at start; a failure that arrives after a newer success
 * is ignored instead of overwriting ONLINE with OFFLINE.
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
/** Per-attempt ceiling for a single wake fetch. Beyond the ~30 s gateway
 * cap, so gateway verdicts (e.g. 504) arrive before we give up locally; a
 * hung connection becomes a retryable transient, never instant OFFLINE. */
export const WAKE_ATTEMPT_TIMEOUT_MS = 35_000;
/** Jitter added to fallback waits so cold-starting clients don't retry in
 * lockstep and hammer the gateway. */
export const WAKE_RETRY_JITTER_MS = 1000;

type Listener = () => void;

const listeners = new Set<Listener>();
let status: BackendStatus = "unknown";

/** Bumped on every transition to online; requests capture it at start so a
 * failure that arrives after a newer success is provably stale. */
let onlineEpoch = 0;

/** Consecutive fresh failures observed while ONLINE. A single failed request
 * is a blip, not an outage (principle: OFFLINE means startup/recovery has
 * genuinely failed, not merely that one request timed out); only a
 * persistent outage flips shared state. Reset on every success. */
let onlineFailureStreak = 0;
/** Failed requests in a row while ONLINE before reporting OFFLINE. */
export const ONLINE_FAILURE_LIMIT = 3;

/** True while a wake cycle owns the startup window. Normal requests consult
 * it so transient failures during startup read as STARTING, never OFFLINE. */
let wakeActive = false;

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

function setOnline(): void {
  onlineFailureStreak = 0;
  setStatus("online");
  onlineEpoch += 1;
}

/** Test-only reset so suites start from a clean state. */
export function resetBackendStatusForTests(): void {
  status = "unknown";
  onlineEpoch = 0;
  onlineFailureStreak = 0;
  wakeActive = false;
  wakeInflight = null;
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

/** True when the response is an authoritative ready answer: HTTP 200 with a
 * ready status body. This — and only this — may flip shared state ONLINE. */
async function isReadyAnswer(response: Response): Promise<boolean> {
  if (response.status !== 200) return false;
  try {
    const data = (await response.clone().json()) as { status?: unknown } | null;
    return (data as { status?: unknown } | null)?.status === "ready";
  } catch {
    return false;
  }
}

/** One wake fetch with its own abort cap. Owner abort (unmount) rejects with
 * AbortError while the owner's signal reads aborted; an attempt timeout
 * rejects with AbortError while the owner's signal is still live, so the
 * wake loop can tell "stop quietly" apart from "transient, retry". */
function fetchWithWakeTimeout(url: string, outerSignal?: AbortSignal | null): Promise<Response> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  };
  if (outerSignal?.aborted) {
    controller.abort();
    return fetch(url, { signal: controller.signal }).finally(cleanup);
  }
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  timer = setTimeout(() => controller.abort(), WAKE_ATTEMPT_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(cleanup);
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
 * promise, so exactly one wake workflow is active at a time. The promise
 * clears on settle so a later visit after another stop can wake again;
 * afterwards everything flows through the regular requestBackend() path.
 *
 * Readiness (GET /ready), not liveness (GET /health), drives the online
 * state: "API Online" is shown only after the backend reports it finished
 * initialization and can accept analysis requests.
 *
 * The optional signal lets an owner (e.g. an unmounting component) cancel
 * its wake: the loop exits quietly WITHOUT touching shared state, so a dead
 * owner can never flip a live UI to OFFLINE.
 */
let wakeInflight: Promise<Response> | null = null;

export function ensureBackendAwake(
  opts?: WakeRetryOptions & { signal?: AbortSignal },
): Promise<Response> {
  if (!wakeInflight) {
    wakeActive = true;
    const pending = wakeLoop(`${API_BASE_URL}/ready`, opts);
    wakeInflight = pending;
    // Settle bookkeeping only; callers observe the returned promise itself,
    // so this extra chain must never produce an unhandled rejection.
    pending
      .finally(() => {
        wakeActive = false;
        if (wakeInflight === pending) wakeInflight = null;
      })
      .catch(() => {});
  }
  return wakeInflight;
}

/**
 * The wake workflow: poll GET /ready until an authoritative ready answer,
 * the window expires, or the owner aborts. Every transient — starting
 * probes, gateway/proxy 5xx (notably gateway timeouts near its budget),
 * 429s, timeouts, resets — keeps STARTING and retries inside the window.
 * OFFLINE is set only on genuine failure evidence (window exhausted with no
 * success, a definitive non-retryable answer) and never over a newer ONLINE.
 */
async function wakeLoop(url: string, opts?: WakeRetryOptions & { signal?: AbortSignal }): Promise<Response> {
  const maxWakeWaitMs = opts?.maxWakeWaitMs ?? MAX_WAKE_WAIT_MS;
  const defaultRetryMs = opts?.defaultRetryMs ?? DEFAULT_RETRY_AFTER_MS;
  const signal = opts?.signal ?? null;
  const epoch = onlineEpoch;
  if (getBackendStatus() !== "online") setStatus("starting");
  const deadline = Date.now() + maxWakeWaitMs;
  let lastError: unknown = new Error("Backend wake timed out before any response arrived.");

  /** Fallback pause when the server sent no Retry-After: matches the
   * gateway's own 3 s cadence so retries stay polite without backoff
   * spirals delaying recovery. */
  const fallbackWaitMs = () => defaultRetryMs + Math.random() * WAKE_RETRY_JITTER_MS;

  /** Window exhausted (or definitive failure): report OFFLINE unless a newer
   * success already landed, then hand the caller the last evidence. */
  const giveUp = (response?: Response): Response | never => {
    if (onlineEpoch === epoch) setStatus("error");
    if (response) return response;
    throw lastError;
  };

  /** Wait out a transient, or give up when the window cannot hold the wait. */
  const waitOrGiveUp = async (waitMs: number, response?: Response): Promise<Response | null> => {
    if (Date.now() + waitMs > deadline) return giveUp(response);
    // Owner abort rejects here and propagates untouched: quiet by design.
    // eslint-disable-next-line no-await-in-loop
    await sleep(waitMs, signal);
    return null;
  };

  const markStarting = () => {
    // Never downgrade a newer ONLINE set by a fresher request.
    if (onlineEpoch === epoch && getBackendStatus() !== "online") setStatus("starting");
  };

  for (;;) {
    let response: Response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetchWithWakeTimeout(url, signal);
    } catch (err) {
      // Owner abort: exit quietly without touching shared state.
      if (err instanceof DOMException && err.name === "AbortError" && signal?.aborted) throw err;
      // Anything else (attempt timeout, reset, DNS, ...): transient.
      lastError = err;
      markStarting();
      const done = await waitOrGiveUp(fallbackWaitMs()); // eslint-disable-line no-await-in-loop
      if (done) return done;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await isBackendStarting(response)) {
      markStarting();
      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After"), defaultRetryMs);
      const done = await waitOrGiveUp(waitMs, response); // eslint-disable-line no-await-in-loop
      if (done) return done;
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      // Gateway/proxy verdicts (502/504/...) while starting are transient:
      // the gateway answers these on the backend's behalf near its budget.
      markStarting();
      const done = await waitOrGiveUp(fallbackWaitMs(), response); // eslint-disable-line no-await-in-loop
      if (done) return done;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await isReadyAnswer(response)) {
      setOnline();
      return response;
    }

    // Definitive non-ready answer (notably 4xx, or 200 without a ready
    // body): waiting cannot fix it, so report without retrying.
    if (onlineEpoch === epoch) setStatus("error");
    return response;
  }
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
  const epoch = onlineEpoch;
  if (getBackendStatus() !== "online") setStatus("starting");
  const deadline = Date.now() + maxWakeWaitMs;

  for (;;) {
    let response: Response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetch(input, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Transient transport failure. OFFLINE only when no wake cycle covers
      // startup and no newer success landed; otherwise stay STARTING. A
      // failure carries no signal, so it must never overwrite ONLINE — while
      // ONLINE, isolated blips are tolerated and only a persistent outage
      // (consecutive failures) flips to OFFLINE.
      if (onlineEpoch === epoch) {
        if (getBackendStatus() !== "online") {
          setStatus(wakeActive ? "starting" : "error");
        } else if (!wakeActive) {
          onlineFailureStreak += 1;
          if (onlineFailureStreak >= ONLINE_FAILURE_LIMIT) {
            onlineFailureStreak = 0;
            setStatus("error");
          }
        }
      }
      throw err;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await isBackendStarting(response)) {
      setStatus("starting");
      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After"), defaultRetryMs);
      if (Date.now() + waitMs > deadline) {
        if (onlineEpoch === epoch) setStatus("error");
        return response;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitMs, init?.signal ?? undefined);
      continue;
    }

    if (response.status >= 500) {
      // Same stale-guard as transport failures: without fresh evidence of
      // failure, a covered startup stays STARTING and ONLINE is never
      // downgraded by a response that arrived after a newer success. Fresh
      // failures while ONLINE feed the outage streak instead of flipping
      // immediately, so one slow/timeout response is not an outage.
      if (onlineEpoch === epoch) {
        if (getBackendStatus() !== "online") {
          setStatus(wakeActive ? "starting" : "error");
        } else if (!wakeActive) {
          onlineFailureStreak += 1;
          if (onlineFailureStreak >= ONLINE_FAILURE_LIMIT) {
            onlineFailureStreak = 0;
            setStatus("error");
          }
        }
      }
      return response;
    }

    // Any definitive answer other than backend_starting resolves the transient
    // state: the server demonstrably answered (even a 4xx proves it is up).
    // A success is always the newest evidence, so it always applies.
    setOnline();
    return response;
  }
}
