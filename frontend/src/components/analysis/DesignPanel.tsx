import { useEffect, useState } from "react";
import {
  CAPACITY_PRESETS,
  PANEL_PRESETS,
  compassDirection,
  computePanelLayout,
  type PanelLayoutResult,
  type PanelPresetId,
} from "../../services/analysis";
import type { LngLat } from "../../lib/geo";

interface DesignPanelProps {
  vertices: LngLat[];
  onResult: (footprints: GeoJSON.FeatureCollection | null, orientation?: { tilt_deg: number; azimuth_deg: number } | null) => void;
  onContinue: (capacityKwp: number) => void;
}

/** Stage 3: domestic panel presets + auto orientation + realistic layout summary. */
export function DesignPanel({ vertices, onResult, onContinue }: DesignPanelProps) {
  const [preset, setPreset] = useState<PanelPresetId>("standard");
  const [customDims, setCustomDims] = useState({ width_m: 2.28, height_m: 1.13, wattage_w: 550 });
  const [capacityId, setCapacityId] = useState("auto");
  const [customKwp, setCustomKwp] = useState(3);
  const [setbackM, setSetbackM] = useState(0.5);
  const [manualOverride, setManualOverride] = useState(false);
  const [tiltDeg, setTiltDeg] = useState<number | null>(null);
  const [azimuthDeg, setAzimuthDeg] = useState<number | null>(null);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: PanelLayoutResult }
  >({ kind: "idle" });

  const activePreset = PANEL_PRESETS.find((p) => p.id === preset) ?? PANEL_PRESETS[0];
  const dims =
    preset === "custom"
      ? customDims
      : { width_m: activePreset.width_m, height_m: activePreset.height_m, wattage_w: activePreset.wattage_w };

  const targetKwp =
    capacityId === "auto"
      ? null
      : capacityId === "custom"
        ? customKwp
        : (CAPACITY_PRESETS.find((c) => c.id === capacityId)?.kwp ?? null);

  const run = () => {
    setState({ kind: "loading" });
    computePanelLayout(vertices, {
      panel_width_m: dims.width_m,
      panel_height_m: dims.height_m,
      wattage_w: dims.wattage_w,
      row_spacing_m: null, // AUTO: derived from tilt + panel geometry on the backend
      setback_m: setbackM,
      tilt_deg: manualOverride ? tiltDeg : null, // AUTO: solar-engine optimised
      azimuth_deg: manualOverride ? azimuthDeg : null,
      target_capacity_kwp: targetKwp,
    })
      .then((result) => {
        setState({ kind: "ok", result });
        onResult(
          { type: "FeatureCollection", features: result.footprints },
          result.orientation ? { tilt_deg: result.orientation.tilt_deg, azimuth_deg: result.orientation.azimuth_deg } : null,
        );
      })
      .catch((err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Layout failed" }));
  };

  useEffect(() => {
    setState({ kind: "idle" });
    onResult(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices]);

  const orientation = state.kind === "ok" ? state.result.orientation : null;
  const compass = orientation ? (orientation.compass_direction ?? compassDirection(orientation.azimuth_deg)) : null;

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 3 of 5</p>
      <h2 className="stage-card__title">Solar design</h2>

      <div className="field">
        <label htmlFor="panel-preset">Panel type</label>
        <select id="panel-preset" value={preset} onChange={(e) => setPreset(e.target.value as PanelPresetId)}>
          {PANEL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.note}
            </option>
          ))}
        </select>
        <p className="result-note" style={{ marginTop: 4 }}>
          Planning defaults for Indian homes. Default: Standard residential, 550 W · ~2.28 × 1.13 m.
        </p>
      </div>

      {preset === "custom" && (
        <div className="field-grid" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="cw">Width (m)</label>
            <input id="cw" type="number" step="0.01" value={customDims.width_m} onChange={(e) => setCustomDims((d) => ({ ...d, width_m: Number(e.target.value) }))} />
          </div>
          <div className="field">
            <label htmlFor="ch">Height (m)</label>
            <input id="ch" type="number" step="0.01" value={customDims.height_m} onChange={(e) => setCustomDims((d) => ({ ...d, height_m: Number(e.target.value) }))} />
          </div>
          <div className="field">
            <label htmlFor="cwat">Wattage (W)</label>
            <input id="cwat" type="number" step="5" value={customDims.wattage_w} onChange={(e) => setCustomDims((d) => ({ ...d, wattage_w: Number(e.target.value) }))} />
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="capacity-preset">Target system size</label>
        <select id="capacity-preset" value={capacityId} onChange={(e) => setCapacityId(e.target.value)}>
          {CAPACITY_PRESETS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {capacityId === "custom" && (
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="custom-kwp">Custom target (kW)</label>
            <input id="custom-kwp" type="number" step="0.5" min={0.5} value={customKwp} onChange={(e) => setCustomKwp(Number(e.target.value))} />
          </div>
        )}
        <p className="result-note" style={{ marginTop: 4 }}>
          Planning target only — the roof geometry decides how many panels actually fit.
        </p>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="setback">Edge setback (m)</label>
        <input id="setback" type="number" step="0.1" min={0} value={setbackM} onChange={(e) => setSetbackM(Number(e.target.value))} />
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <label>
          <input type="checkbox" checked={manualOverride} onChange={(e) => setManualOverride(e.target.checked)} /> Manual
          orientation override (advanced)
        </label>
        {!manualOverride && <p className="result-note">AUTO / Optimized — tilt and direction come from the solar engine.</p>}
      </div>

      {manualOverride && (
        <div className="field-grid" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="tilt">Tilt (°)</label>
            <input id="tilt" type="number" step="1" placeholder="Auto" value={tiltDeg ?? ""} onChange={(e) => setTiltDeg(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="az">Azimuth (°)</label>
            <input id="az" type="number" step="5" placeholder="Auto" value={azimuthDeg ?? ""} onChange={(e) => setAzimuthDeg(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
      )}

      <div className="stage-card__actions">
        <button type="button" className="btn btn--primary" onClick={run} disabled={state.kind === "loading"}>
          {state.kind === "loading" ? "Computing…" : "Compute layout"}
        </button>
      </div>

      {state.kind === "error" && <p className="stage-card__warning" role="alert">{state.message}</p>}

      {state.kind === "ok" && (
        <>
          <div className="result-hero" style={{ marginTop: 12 }}>
            <span className="result-hero__value">
              {state.result.panel_count} panels · {state.result.capacity_kwp.toFixed(2)} kWp
            </span>
            <span className="result-hero__label">
              {dims.wattage_w} W · {dims.width_m} × {dims.height_m} m modules
            </span>
          </div>

          {orientation && (
            <dl className="metric-list" aria-label="Solar design summary">
              <div>
                <dt>Orientation</dt>
                <dd>
                  {compass} · {Math.round(orientation.azimuth_deg)}°
                </dd>
              </div>
              <div>
                <dt>Tilt</dt>
                <dd>{Math.round(orientation.tilt_deg)}°</dd>
              </div>
              <div>
                <dt>Available roof</dt>
                <dd>{state.result.usable_area_m2} m²</dd>
              </div>
              <div>
                <dt>Utilized</dt>
                <dd>{state.result.occupied_area_m2 ?? "—"} m²</dd>
              </div>
            </dl>
          )}

          {orientation && <CompassRose azimuth={orientation.azimuth_deg} />}

          {state.result.solar?.annual_generation_kwh != null && (
            <p className="result-note">
              Estimated annual generation ≈ {Math.round(state.result.solar.annual_generation_kwh).toLocaleString()} kWh/year
              {" "}({state.result.solar.confidence} confidence · {state.result.solar.resource_provider}).
            </p>
          )}

          {state.result.warnings.map((w) => (
            <p className="result-note" key={w}>{w}</p>
          ))}

          <details>
            <summary className="result-note" style={{ cursor: "pointer" }}>Technical details</summary>
            <p className="result-note">
              Row spacing {String(state.result.assumptions.row_spacing_m)} m
              {state.result.optimization_metadata?.row_spacing_auto ? " (auto-derived)" : ""} · setback{" "}
              {String(state.result.assumptions.setback_m)} m · orientation{" "}
              {String(state.result.assumptions.orientation ?? "")} · method{" "}
              {String(state.result.optimization_metadata?.optimization_method ?? state.result.solar?.optimization_method ?? "geometry")}
              .
            </p>
          </details>

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

function CompassRose({ azimuth }: { azimuth: number }) {
  const rad = ((azimuth - 90) * Math.PI) / 180;
  const x = 20 + 12 * Math.cos(rad);
  const y = 20 + 12 * Math.sin(rad);
  return (
    <div className="compass" role="img" aria-label={`Recommended direction ${compassDirection(azimuth)}, azimuth ${Math.round(azimuth)} degrees`}>
      <svg width="48" height="48" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-border-strong)" strokeWidth="1" />
        <text x="20" y="7" textAnchor="middle" fontSize="7" fill="var(--color-text-muted)">N</text>
        <line x1="20" y1="20" x2={x} y2={y} stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" />
        <circle cx={x} cy={y} r="2.4" fill="var(--color-primary)" />
      </svg>
      <span className="result-note">
        {compassDirection(azimuth)} · {Math.round(azimuth)}°
      </span>
    </div>
  );
}
