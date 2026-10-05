import { useEffect, useState, useSyncExternalStore } from "react";
import { API_BASE_URL } from "../../services/apiBase";
import {
  getBackendStatus,
  requestBackend,
  subscribeBackendStatus,
} from "../../services/backendStatus";

/**
 * Backend connection indicator: amber "Starting server… Please wait" while
 * waking, green "Server online" (briefly, then dot-only), red
 * "Server unavailable" + Retry on genuine failure. Driven entirely by the
 * shared backendStatus store; rendered wherever the layout needs it.
 */
export function BackendStatusIndicator() {
  const backendStatus = useSyncExternalStore(subscribeBackendStatus, getBackendStatus);
  // "Server online" stays briefly, then fades to just the green dot.
  const [onlineVisible, setOnlineVisible] = useState(false);
  useEffect(() => {
    if (backendStatus !== "online") {
      setOnlineVisible(false);
      return;
    }
    setOnlineVisible(true);
    const timer = window.setTimeout(() => setOnlineVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, [backendStatus]);
  const retryBackend = () => {
    void requestBackend(`${API_BASE_URL}/health`).catch(() => {});
  };

  return (
    <span
      className={`status-bar__backend status-bar__backend--${backendStatus}`}
      role="status"
      aria-live="polite"
      aria-label={
        backendStatus === "starting"
          ? "Server is starting"
          : backendStatus === "error"
            ? "Server unavailable"
            : backendStatus === "online"
              ? "Server online"
              : "Server status unknown"
      }
    >
      <span className={`status-bar__dot status-bar__dot--${backendStatus}`} aria-hidden="true" />
      {backendStatus === "starting" && (
        <span className="status-bar__backend-text">Starting server… Please wait</span>
      )}
      {backendStatus === "error" && (
        <>
          <span className="status-bar__backend-text">Server unavailable</span>
          <button type="button" className="status-bar__retry" onClick={retryBackend}>
            Retry
          </button>
        </>
      )}
      {backendStatus === "online" && onlineVisible && (
        <span className="status-bar__muted status-bar__backend-text">Server online</span>
      )}
    </span>
  );
}
