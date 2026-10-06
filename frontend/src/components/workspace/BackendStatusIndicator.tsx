import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { API_BASE_URL } from "../../services/apiBase";
import {
  getBackendStatus,
  requestBackend,
  subscribeBackendStatus,
} from "../../services/backendStatus";

/**
 * Backend connection pill for the top header: dark rounded badge with a
 * state dot and always-visible text driven entirely by the shared
 * backendStatus store (no second status system).
 *
 * - starting: amber pulsing dot + "Starting analysis server…"
 * - online:   green dot + "API Online" (never faded, never dot-only)
 * - error:    red dot + "API Offline" + retry action
 * - unknown:  gray dot only (before any request)
 */
export function BackendStatusIndicator() {
  const backendStatus = useSyncExternalStore(subscribeBackendStatus, getBackendStatus);
  const retryBackend = () => {
    // Retry against the readiness probe too: only a ready backend may flip
    // the pill back to "API Online" (/health alone must never do that).
    void requestBackend(`${API_BASE_URL}/ready`).catch(() => {});
  };

  return (
    <span
      className={`backend-status backend-status--${backendStatus}`}
      role="status"
      aria-live="polite"
      aria-label={
        backendStatus === "starting"
          ? "Server is starting"
          : backendStatus === "error"
            ? "Server unavailable"
            : backendStatus === "online"
              ? "API online"
              : "Server status unknown"
      }
    >
      <span className={`backend-status__dot backend-status__dot--${backendStatus}`} aria-hidden="true" />
      {backendStatus === "starting" && (
        <>
          <span className="backend-status__full">Starting analysis server…</span>
          <span className="backend-status__short">Starting…</span>
        </>
      )}
      {backendStatus === "online" && (
        <>
          <span className="backend-status__full">API Online</span>
          <span className="backend-status__short">Online</span>
        </>
      )}
      {backendStatus === "error" && (
        <>
          <span className="backend-status__full">API Offline</span>
          <button
            type="button"
            className="backend-status__retry"
            onClick={retryBackend}
            aria-label="Retry connection"
            title="Retry connection"
          >
            <RotateCcw size={13} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </>
      )}
    </span>
  );
}
