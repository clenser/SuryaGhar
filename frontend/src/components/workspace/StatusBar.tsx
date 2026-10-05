import { useEffect, useState, useSyncExternalStore } from "react";
import type { MapViewState } from "../../types";
import { activeImageryProvider } from "../../providers/imagery";
import { API_BASE_URL } from "../../services/apiBase";
import {
  getBackendStatus,
  requestBackend,
  subscribeBackendStatus,
} from "../../services/backendStatus";

interface StatusBarProps {
  view: MapViewState | null;
  selectedName: string | null;
}

const METERS_PER_PIXEL_Z0 = 156543.03392;

/** Scale bar length in metres, derived from the latitude and zoom so it stays accurate. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export function formatScale(lat: number, zoom: number): { width: number; label: string } {
  const mpp = metersPerPixel(lat, zoom);
  const targetPx = 96;
  const rawMeters = mpp * targetPx;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
  const meters = steps.find((s) => s >= rawMeters) ?? steps[steps.length - 1];
  const width = meters / mpp;
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return { width: Math.round(width), label };
}

export function StatusBar({ view, selectedName }: StatusBarProps) {
  const scale = view ? formatScale(view.center.lat, view.zoom) : null;
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
    <footer className="status-bar" aria-label="Map status">
      <div className="status-bar__segment status-bar__segment--primary">
        <span className="status-bar__dot" aria-hidden="true" />
        <span className="status-bar__text">{activeImageryProvider.getDisplayName()}</span>
        {selectedName && <span className="status-bar__muted">· {selectedName}</span>}
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
          <span
            className={`status-bar__dot status-bar__dot--${backendStatus}`}
            aria-hidden="true"
          />
          {backendStatus === "starting" && <span>Starting server… Please wait</span>}
          {backendStatus === "error" && (
            <>
              <span>Server unavailable</span>
              <button type="button" className="status-bar__retry" onClick={retryBackend}>
                Retry
              </button>
            </>
          )}
          {backendStatus === "online" && onlineVisible && (
            <span className="status-bar__muted">Server online</span>
          )}
        </span>
      </div>
      <div className="status-bar__segment status-bar__segment--center">
        {view && (
          <span className="mono" aria-label="Map centre coordinates">
            {view.center.lat.toFixed(5)}°N&nbsp;&nbsp;{view.center.lng.toFixed(5)}°E
          </span>
        )}
      </div>
      <div className="status-bar__segment status-bar__segment--end">
        {scale && (
          <span className="scale" aria-label={`Scale ${scale.label}`}>
            <span className="scale__bar" style={{ width: scale.width }} aria-hidden="true" />
            <span className="mono">{scale.label}</span>
          </span>
        )}
        {view && <span className="mono status-bar__zoom">z {view.zoom.toFixed(1)}</span>}
      </div>
    </footer>
  );
}
