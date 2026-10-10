import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import {
  getMapProviderCountdown,
  getMapProviderError,
  getMapProviderState,
  retryMapProvider,
  subscribeMapProvider,
} from "../../services/mapProvider";

/**
 * Map-provider pill for the top header, sitting beside (never merged with)
 * the backend API status. One authoritative store drives it:
 *
 * - google-loading      → "Loading Google Maps…"
 * - google-ready        → nothing (primary provider working, header stays calm)
 * - fallback-countdown  → "Google Maps unavailable — switching to backup map in 5…4…3…2…1"
 * - maplibre-loading    → "Loading backup map…"
 * - maplibre-ready      → "Backup map active"
 * - map-error           → "Map unavailable" + retry action
 *
 * Deliberately aria-live only (no role="status"): the API pill owns that role
 * in the header, and map status must never be confused with backend health.
 */
export function MapProviderIndicator() {
  const state = useSyncExternalStore(subscribeMapProvider, getMapProviderState);
  const countdown = useSyncExternalStore(subscribeMapProvider, getMapProviderCountdown);
  const error = useSyncExternalStore(subscribeMapProvider, getMapProviderError);

  if (state === "google-ready") return null;

  const text =
    state === "google-loading"
      ? "Loading Google Maps…"
      : state === "fallback-countdown"
        ? `Google Maps unavailable — switching to backup map in ${countdown}…`
        : state === "maplibre-loading"
          ? "Loading backup map…"
          : state === "maplibre-ready"
            ? "Backup map active"
            : "Map unavailable";

  const short =
    state === "google-loading"
      ? "Map…"
      : state === "fallback-countdown"
        ? `${countdown}s…`
        : state === "maplibre-loading"
          ? "Backup…"
          : state === "maplibre-ready"
            ? "Backup"
            : "No map";

  return (
    <span
      className={`map-status map-status--${state}`}
      aria-live="polite"
      title={error ?? text}
    >
      <span className={`map-status__dot map-status__dot--${state}`} aria-hidden="true" />
      <span className="map-status__full">{text}</span>
      <span className="map-status__short">{short}</span>
      {state === "map-error" && (
        <button
          type="button"
          className="map-status__retry"
          onClick={() => retryMapProvider()}
          aria-label="Retry map"
          title="Retry map"
        >
          <RotateCcw size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
