import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Settings2, Zap } from "lucide-react";
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
  const [presetOpen, setPresetOpen] = useState(false);
  const [customDims, setCustomDims] = useState({ width_m: 2.28, height_m: 1.13, wattage_w: 550 });
  const [capacityId, setCapacityId] = useState("auto");
  const [customKwp, setCustomKwp] = useState(3);
  const [setbackM, setSetbackM] = useState(0.5);
  const [manualOverride, setManualOverride] = useState(false);
  const [orientationOpen, setOrientationOpen] = useState(false);
  const [tiltDeg, setTiltDeg] = useState<number | null>(null);
  const [azimuthDeg, setAzimuthDeg] = useState<number | null>(null);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: PanelLayoutResult }
  >({ kind: "idle" });
  const [justDone, setJustDone] = useState(false);
  const doneTimer = useRef<number | null>(null);

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
    setJustDone(false);
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
        setJustDone(true);
        onResult(
          { type: "FeatureCollection", features: result.footprints },
          result.orientation ? { tilt_deg: result.orientation.tilt_deg, azimuth_deg: result.orientation.azimuth_deg } : null,
        );
      })
      .catch((err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Layout failed" }));
  };

  useEffect(() => {
    setState({ kind: "idle" });
    setJustDone(false);
    onResult(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices]);

  useEffect(() => {
    if (!justDone) return;
    doneTimer.current = window.setTimeout(() => setJustDone(false), 1800);
    return () => {
      if (doneTimer.current !== null) window.clearTimeout(doneTimer.current);
    };
  }, [justDone]);

  useEffect(() => {
    return () => {
      if (doneTimer.current !== null) window.clearTimeout(doneTimer.current);
    };
  }, []);

  const orientation = state.kind === "ok" ? state.result.orientation : null;
  const compass = orientation ? (orientation.compass_direction ?? compassDirection(orientation.azimuth_deg)) : null;

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 3 of 5</p>
      <h2 className="stage-card__title">Solar design</h2>
      <p className="stage-card__body">Configure the solar panel layout for your selected area.</p>

      <div className="field">
        <span className="field-label" id="panel-preset-label">Panel type</span>
        <div className="preset-select">
          <button
            type="button"
            className="preset-select__button"
            aria-haspopup="listbox"
            aria-expanded={presetOpen}
            aria-labelledby="panel-preset-label"
            onClick={() => setPresetOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPresetOpen(false);
            }}
          >
            <ModuleGlyph />
            <span className="preset-select__text">
              <span className="preset-select__name">{activePreset.name} — {activePreset.wattage_w} W</span>
              <span className="preset-select__dims">{activePreset.width_m} × {activePreset.height_m} m per module</span>
            </span>
            <ChevronDown size={15} strokeWidth={2} aria-hidden="true" className={`preset-select__chevron${presetOpen ? " is-open" : ""}`} />
          </button>
          {presetOpen && (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="preset-select__backdrop"
                onMouseDown={() => setPresetOpen(false)}
              />
              <div className="preset-select__menu" role="listbox" aria-label="Panel type options">
              {PANEL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={preset === p.id}
                  className={`preset-select__option${preset === p.id ? " is-active" : ""}`}
                  onClick={() => {
                    setPreset(p.id);
                    setPresetOpen(false);
                  }}
                >
                  <ModuleGlyph />
                  <span className="preset-select__text">
                    <span className="preset-select__name">{p.name} — {p.wattage_w} W</span>
                    <span className="preset-select__dims">{p.note}</span>
                  </span>
                  {preset === p.id && <Check size={14} strokeWidth={2.5} aria-hidden="true" className="preset-select__check" />}
                </button>
              ))}
              </div>
            </>
          )}
        </div>
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
        <div className="setback-row">
          <input id="setback" type="number" step="0.1" min={0} value={setbackM} onChange={(e) => setSetbackM(Number(e.target.value))} />
          <SetbackDiagram value={setbackM} />
        </div>
      </div>

      <Accordion
        title="Advanced orientation (optional)"
        icon={<Settings2 size={14} strokeWidth={1.75} aria-hidden="true" />}
        open={orientationOpen}
        onToggle={() => setOrientationOpen((v) => !v)}
      >
        <div className="field">
          <label className="switch">
            <span className="switch__label">Manual orientation override</span>
            <button
              type="button"
              role="switch"
              aria-checked={manualOverride}
              aria-label="Manual orientation override"
              className={`switch__track${manualOverride ? " is-on" : ""}`}
              onClick={() => setManualOverride((v) => !v)}
            >
              <span className="switch__thumb" aria-hidden="true" />
            </button>
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
            <div className="field" style={{ alignSelf: "end" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTiltDeg(null);
                  setAzimuthDeg(null);
                  setManualOverride(false);
                }}
              >
                Reset to optimized
              </button>
            </div>
          </div>
        )}
      </Accordion>

      {state.kind === "loading" && (
        <div className="stage-loading" aria-live="polite">
          <p className="stage-loading__title"><span className="spinner" aria-hidden="true" /> Computing solar layout</p>
          <div className="progress-indeterminate" aria-hidden="true"><span /></div>
          <p className="stage-loading__body">Analyzing roof geometry…</p>
        </div>
      )}

      <div className="stage-card__actions actions-duo">
        <button type="button" className="btn btn--primary" onClick={run} disabled={state.kind === "loading"}>
          {state.kind === "loading" ? (
            <><span className="spinner spinner--on-dark" aria-hidden="true" /> Computing layout…</>
          ) : justDone && state.kind === "ok" ? (
            <><Check size={15} strokeWidth={2.5} aria-hidden="true" /> Layout computed</>
          ) : (
            "✦ Compute layout"
          )}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={state.kind !== "ok"}
          onClick={() => state.kind === "ok" && onContinue(state.result.capacity_kwp)}
          title={state.kind === "ok" ? "Continue to solar analysis" : "Compute a layout first"}
        >
          <Zap size={15} strokeWidth={2} aria-hidden="true" />
          Analyse solar yield
        </button>
      </div>

      {state.kind === "error" && <p className="stage-card__warning" role="alert">{state.message}</p>}

      {state.kind === "ok" && (
        <>
          <section className="estimate-card" aria-label="Estimated layout">
            <h3 className="section-heading">Estimated layout</h3>
            <div className="estimate-grid">
              <div className="estimate-cell">
                <span key={state.result.panel_count} className="estimate-value count-anim">{state.result.panel_count}</span>
                <span className="estimate-unit">Panels</span>
              </div>
              <div className="estimate-cell">
                <span key={state.result.capacity_kwp} className="estimate-value count-anim">{state.result.capacity_kwp.toFixed(2)}</span>
                <span className="estimate-unit">kWp</span>
              </div>
              <div className="estimate-cell">
                <span className="estimate-value estimate-value--sm">{dims.wattage_w} W</span>
                <span className="estimate-unit">Module</span>
              </div>
            </div>
            <p className="result-note">
              {dims.width_m} × {dims.height_m} m modules · {state.result.usable_area_m2} m² usable roof
            </p>
          </section>

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
        </>
      )}
    </div>
  );
}

/** Small PV module glyph used in the panel-type selector. Purely decorative. */
function ModuleGlyph() {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" className="module-glyph">
      <rect x="1" y="1" width="32" height="20" rx="2" fill="#0b1f33" stroke="#8fa3bd" strokeWidth="1.5" />
      <line x1="12" y1="1" x2="12" y2="21" stroke="#8fa3bd" strokeWidth="0.75" opacity="0.8" />
      <line x1="23" y1="1" x2="23" y2="21" stroke="#8fa3bd" strokeWidth="0.75" opacity="0.8" />
      <line x1="1" y1="11" x2="33" y2="11" stroke="#8fa3bd" strokeWidth="0.75" opacity="0.8" />
    </svg>
  );
}

/** Roof/setback diagram: dashed roof outline, inset usable area, edge arrows. */
function SetbackDiagram({ value }: { value: number }) {
  const inset = 4 + (Math.min(Math.max(value, 0), 2) / 2) * 13;
  const label = `${Number.isFinite(value) ? value : 0} m`;
  return (
    <svg
      width="132"
      height="92"
      viewBox="0 0 132 92"
      role="img"
      aria-label={`Usable area inside a ${label} roof setback`}
      className="setback-diagram"
    >
      <rect x="6" y="6" width="120" height="80" fill="none" stroke="var(--color-border-strong)" strokeWidth="1.25" strokeDasharray="5 4" rx="3" />
      <rect
        x={6 + inset}
        y={6 + inset}
        width={120 - inset * 2}
        height={80 - inset * 2}
        fill="var(--color-primary-soft)"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
        rx="2"
      />
      {/* setback arrows */}
      <line x1="66" y1="6" x2="66" y2={6 + inset} stroke="var(--color-primary)" strokeWidth="1.25" />
      <line x1="6" y1="46" x2={6 + inset} y2="46" stroke="var(--color-primary)" strokeWidth="1.25" />
      <text x="66" y={86} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-text-muted)">{label}</text>
    </svg>
  );
}

function Accordion({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="accordion">
      <button
        type="button"
        className="accordion__header"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="accordion__icon" aria-hidden="true">{icon}</span>
        <span className="accordion__title">{title}</span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden="true" className={`accordion__chevron${open ? " is-open" : ""}`} />
      </button>
      <div className="accordion__panel" data-open={open} role="region">
        <div className="accordion__inner">{children}</div>
      </div>
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
