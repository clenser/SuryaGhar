import { useEffect, useState } from "react";
import { computePanelLayout, type PanelLayoutResult } from "../../services/analysis";
import type { LngLat } from "../../lib/geo";

interface DesignPanelProps {
  vertices: LngLat[];
  onResult: (footprints: GeoJSON.FeatureCollection | null) => void;
  onContinue: (capacityKwp: number) => void;
}

/** Stage 3: deterministic panel layout. */
export function DesignPanel({ vertices, onResult, onContinue }: DesignPanelProps) {
  const [spec, setSpec] = useState({
    panel_width_m: 2.0,
    panel_height_m: 1.1,
    wattage_w: 430,
    row_spacing_m: 0.6,
    setback_m: 0.5,
    tilt_deg: 18,
    azimuth_deg: 180,
  });
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: PanelLayoutResult }
  >({ kind: "idle" });

  const run = () => {
    setState({ kind: "loading" });
    computePanelLayout(vertices, spec)
      .then((result) => {
        setState({ kind: "ok", result });
        onResult({ type: "FeatureCollection", features: result.footprints });
      })
      .catch((err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Layout failed" }));
  };

  useEffect(() => {
    setState({ kind: "idle" });
    onResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices]);

  const set = (key: keyof typeof spec) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setSpec((prev) => ({ ...prev, [key]: Number(event.target.value) }));

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 3 of 5</p>
      <h2 className="stage-card__title">Panel layout</h2>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="pw">Panel width (m)</label>
          <input id="pw" type="number" step="0.1" value={spec.panel_width_m} onChange={set("panel_width_m")} />
        </div>
        <div className="field">
          <label htmlFor="ph">Panel height (m)</label>
          <input id="ph" type="number" step="0.1" value={spec.panel_height_m} onChange={set("panel_height_m")} />
        </div>
        <div className="field">
          <label htmlFor="wattage">Wattage (W)</label>
          <input id="wattage" type="number" step="5" value={spec.wattage_w} onChange={set("wattage_w")} />
        </div>
        <div className="field">
          <label htmlFor="rowgap">Row spacing (m)</label>
          <input id="rowgap" type="number" step="0.1" value={spec.row_spacing_m} onChange={set("row_spacing_m")} />
        </div>
        <div className="field">
          <label htmlFor="setback">Edge setback (m)</label>
          <input id="setback" type="number" step="0.1" value={spec.setback_m} onChange={set("setback_m")} />
        </div>
        <div className="field">
          <label htmlFor="tilt">Tilt (°)</label>
          <input id="tilt" type="number" step="1" value={spec.tilt_deg} onChange={set("tilt_deg")} />
        </div>
        <div className="field">
          <label htmlFor="az">Azimuth (°)</label>
          <input id="az" type="number" step="5" value={spec.azimuth_deg} onChange={set("azimuth_deg")} />
        </div>
      </div>

      <div className="stage-card__actions">
        <button type="button" className="btn btn--primary" onClick={run} disabled={state.kind === "loading"}>
          {state.kind === "loading" ? "Computing…" : "Compute layout"}
        </button>
      </div>

      {state.kind === "error" && <p className="stage-card__warning" role="alert">{state.message}</p>}

      {state.kind === "ok" && (
        <>
          <div className="result-hero" style={{ marginTop: 12 }}>
            <span className="result-hero__value">{state.result.panel_count} panels</span>
            <span className="result-hero__label">
              {state.result.capacity_kwp} kWp · {state.result.usable_area_m2} m² of {state.result.total_area_m2} m² usable
            </span>
          </div>
          {state.result.warnings.map((w) => (
            <p className="result-note" key={w}>{w}</p>
          ))}
          <p className="result-note">
            {spec.wattage_w} W modules · tilt {spec.tilt_deg}° · azimuth {spec.azimuth_deg}° · {spec.setback_m} m setback. Panel outlines are
            drawn on the map.
          </p>
          <div className="stage-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => onContinue(state.result.capacity_kwp)}>
              Analyse solar yield
            </button>
          </div>
        </>
      )}
    </div>
  );
}
