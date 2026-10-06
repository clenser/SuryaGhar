import { useState } from "react";
import { ChevronUp } from "lucide-react";
import type { MapViewState } from "../../types";
import { activeImageryProvider } from "../../providers/imagery";

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
  // Phone only: the three-segment GIS footer collapses into a single floating
  // chip that expands on tap. Desktop keeps the full row (CSS hides the chip).
  const [open, setOpen] = useState(false);
  return (
    <footer className="status-bar" aria-label="Map status" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="status-bar__summary"
        aria-expanded={open}
        aria-controls="status-details"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="status-bar__dot" aria-hidden="true" />
        <span className="status-bar__summary-text">
          {activeImageryProvider.getDisplayName()}
          {selectedName ? ` · ${selectedName}` : ""}
        </span>
        {view && <span className="mono status-bar__summary-zoom">z {view.zoom.toFixed(1)}</span>}
        <ChevronUp size={14} strokeWidth={2} aria-hidden="true" className={`status-bar__chevron${open ? " is-open" : ""}`} />
      </button>
      <div className="status-bar__row" id="status-details">
      <div className="status-bar__segment status-bar__segment--primary">
        <span className="status-bar__dot" aria-hidden="true" />
        <span className="status-bar__text">{activeImageryProvider.getDisplayName()}</span>
        {selectedName && <span className="status-bar__muted">· {selectedName}</span>}
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
      </div>
    </footer>
  );
}
