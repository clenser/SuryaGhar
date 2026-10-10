/**
 * Map-provider state machine (single authoritative store, mirrors the
 * backendStatus pattern but is deliberately SEPARATE from backend API health).
 *
 *   google-loading      → MapView mounted; Google Maps init begins. A 5 s
 *                         readiness watch is armed (map instance + imagery idle).
 *   google-ready        → Google map reached `idle` before the timeout; the
 *                         fallback is cancelled. Terminal for normal operation.
 *   fallback-countdown  → Google failed (definitive error, or no idle within
 *                         5 s). A 1 s ticker counts 5…1, then maplibre-loading.
 *   maplibre-loading    → previous MapLibre implementation mounting. An 8 s
 *                         readiness watch covers a hung style/network load.
 *   maplibre-ready      → MapLibre fired `load` (style + first render).
 *   map-error           → both providers failed; header shows a retry action.
 *
 * Timers live here (module level), so StrictMode double-mount, remounts and
 * HMR can never double-arm a watch: every entry point is idempotent and every
 * transition clears the timers it owns.
 */
import { useSyncExternalStore } from "react";

export type MapProviderState =
  | "google-loading"
  | "google-ready"
  | "fallback-countdown"
  | "maplibre-loading"
  | "maplibre-ready"
  | "map-error";

/** Google Maps must show imagery (fire `idle`) within this window. */
export const GOOGLE_READY_TIMEOUT_MS = 5_000;
/** Visible countdown ticks before the backup map mounts. */
export const FALLBACK_COUNTDOWN_S = 5;
/** Backup map must reach `load` within this window, else map-error. */
export const MAPLIBRE_READY_TIMEOUT_MS = 8_000;

let state: MapProviderState = "google-loading";
let countdown = 0;
let errorReason: string | null = null;
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let backupTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function clearTimers(): void {
  if (watchTimer) clearTimeout(watchTimer);
  if (tickTimer) clearInterval(tickTimer);
  if (backupTimer) clearTimeout(backupTimer);
  watchTimer = null;
  tickTimer = null;
  backupTimer = null;
}

function set(next: MapProviderState, reason: string | null = null): void {
  state = next;
  errorReason = reason;
  emit();
}

function armGoogleWatch(): void {
  if (watchTimer) return; // idempotent — one watch at a time
  watchTimer = setTimeout(() => {
    watchTimer = null;
    if (state !== "google-loading") return;
    startCountdown("Google Maps did not become ready in time.");
  }, GOOGLE_READY_TIMEOUT_MS);
}

function startCountdown(reason: string): void {
  if (state === "fallback-countdown" || state === "maplibre-loading" || state === "maplibre-ready") return;
  clearTimers();
  countdown = FALLBACK_COUNTDOWN_S;
  set("fallback-countdown", reason);
  tickTimer = setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      countdown = 0;
      state = "maplibre-loading";
      emit();
      armBackupWatch();
      return;
    }
    emit();
  }, 1_000);
}

function armBackupWatch(): void {
  if (backupTimer) return;
  backupTimer = setTimeout(() => {
    backupTimer = null;
    if (state !== "maplibre-loading") return;
    failMapProvider("Backup map did not load in time.");
  }, MAPLIBRE_READY_TIMEOUT_MS);
}

/** Called when MapView mounts / a retry begins: arm the 5 s Google watch. */
export function beginGoogleWatch(): void {
  if (state === "google-loading" && watchTimer) return; // already watching
  clearTimers();
  countdown = 0;
  set("google-loading");
  armGoogleWatch();
}

/**
 * Soft mount entry (e.g. returning from the 3D design workspace, which
 * unmounts the map): terminal provider states are PRESERVED — the remounted
 * map resumes its working provider instead of restarting a wake cycle.
 * Only a non-terminal state without a live watch arms a fresh one.
 */
export function ensureProviderWatch(): void {
  if (state === "google-ready" || state === "maplibre-ready" || state === "map-error") return;
  if (state === "fallback-countdown" && tickTimer) return;
  if (state === "maplibre-loading" && backupTimer) return;
  beginGoogleWatch();
}

/** Google map fired `idle` (instance + imagery rendered): cancel fallback. */
export function markGoogleReady(): void {
  if (state !== "google-loading") return;
  clearTimers();
  countdown = 0;
  set("google-ready");
}

/** Definitive Google failure (loader rejection, auth error): countdown NOW,
 * without waiting out the full readiness window. */
export function failGoogleWatch(reason: string): void {
  if (state !== "google-loading" && state !== "google-ready") return;
  startCountdown(reason);
}

/** Backup map style loaded: terminal good state. */
export function markMapLibreReady(): void {
  if (state !== "maplibre-loading") return;
  clearTimers();
  set("maplibre-ready");
}

/** Backup map construction failed or its readiness watch expired. */
export function failMapProvider(reason: string): void {
  if (state === "map-error") return;
  clearTimers();
  countdown = 0;
  set("map-error", reason);
}

/** Header retry on map-error: full fresh attempt starting with Google. */
export function retryMapProvider(): void {
  if (state !== "map-error") return;
  clearTimers();
  beginGoogleWatch();
}

export function getMapProviderState(): MapProviderState {
  return state;
}
export function getMapProviderCountdown(): number {
  return countdown;
}
export function getMapProviderError(): string | null {
  return errorReason;
}
export function subscribeMapProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the shared provider state (one authority, no duplicates). */
export function useMapProvider(): MapProviderState {
  return useSyncExternalStore(subscribeMapProvider, getMapProviderState);
}
export function useMapProviderCountdown(): number {
  return useSyncExternalStore(subscribeMapProvider, getMapProviderCountdown);
}
export function useMapProviderError(): string | null {
  return useSyncExternalStore(subscribeMapProvider, getMapProviderError);
}

/** Reset for tests: clears every timer and listener-visible state. */
export function resetMapProviderForTests(): void {
  clearTimers();
  state = "google-loading";
  countdown = 0;
  errorReason = null;
  emit();
}
