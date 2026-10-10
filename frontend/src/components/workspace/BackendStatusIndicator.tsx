import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import {
  ensureBackendAwake,
  getBackendStatus,
  subscribeBackendStatus,
} from "../../services/backendStatus";

/**
 * Backend connection pill for the top header: dark rounded badge with a
 * state dot and always-visible text driven entirely by the shared
 * backendStatus store (no second status system).
 *
 * - checking: blue-gray dot + "Checking local server…" (bounded initial
 *             health check; never lingers — resolves to online/starting/offline)
 * - starting: amber pulsing dot + "Starting analysis server…"
 *             (only when the server itself reports backend_starting)
 * - online:   green dot + "API Online" (never faded, never dot-only)
 * - error:    red dot + "API Offline" + retry action
 * - unknown:  gray dot only (before any request)
 */
export function BackendStatusIndicator() {
  const backendStatus = useSyncExternalStore(subscribeBackendStatus, getBackendStatus);
  const retryBackend = () => {
    // Fresh wake cycle (not a single probe): only a ready backend flips the
    // pill back to "API Online" (/health alone must never do that, and a
    // lone failed probe must not declare OFFLINE mid-startup either).
    void ensureBackendAwake().catch(() => {});
  };

  return (
    <span
      className={`backend-status backend-status--${backendStatus}`}
      role="status"
      aria-live="polite"
      aria-label={
        backendStatus === "checking"
          ? "Checking local server"
          : backendStatus === "starting"
            ? "Server is starting"
            : backendStatus === "error"
              ? "Server unavailable"
              : backendStatus === "online"
                ? "API online"
                : "Server status unknown"
      }
    >
      <span className={`backend-status__dot backend-status__dot--${backendStatus}`} aria-hidden="true" />
      {backendStatus === "checking" && (
        <>
          <span className="backend-status__full">Checking local server…</span>
          <span className="backend-status__short">Checking…</span>
        </>
      )}
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
