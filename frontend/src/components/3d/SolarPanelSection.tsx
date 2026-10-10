/**
 * SolarPanelSection - panel configuration UI (Phase 5)
 *
 * Compact configuration block for the panel library: rating, mounting type,
 * tilt / azimuth, spacing, edge setback, a recalculate action and the
 * resulting count / capacity. Reuses the existing field, toolbar and button
 * tokens — no new layout system (AGENTS.md §48).
 *
 * React owns the configuration; placement is recomputed from it and the
 * viewport only renders the result (AGENTS.md §40, §72).
 */

import { RefreshCw, AlertTriangle, Grid3x3 } from "lucide-react";
import {
  MOUNTING_TYPES,
  PANEL_TYPES,
  formatCapacity,
  panelTypeDefinition,
  type MountingType,
  type PanelLayoutConfig,
  type PanelTypeId,
} from "../../lib/3d/panels";

interface SolarPanelSectionProps {
  config: PanelLayoutConfig;
  onConfigChange: (patch: Partial<PanelLayoutConfig>) => void;
  onRecalculate: () => void;
  panelCount: number;
  capacityKw: number;
  /** Zero-panel explanation, or an invalid-configuration error. */
  warning: string | null;
}

/** Small labelled number input in the existing `.field` style. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="height-input-row">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="height-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  );
}

export function SolarPanelSection({
  config,
  onConfigChange,
  onRecalculate,
  panelCount,
  capacityKw,
  warning,
}: SolarPanelSectionProps) {
  const selected = panelTypeDefinition(config.panelTypeId);
  const tiltLabel = config.mounting === "tilted" ? "Roof slope" : "Tilt";

  return (
    <div className="obstacle-section">
      <div className="obstacle-toolbar">
        <div className="obstacle-toolbar__labels">
          <h3 className="obstacle-section__title">
            <Grid3x3 size={15} strokeWidth={1.75} aria-hidden="true" /> Solar panels
          </h3>
          <p className="obstacle-count">
            {panelCount === 0
              ? "No panels placed yet"
              : `${panelCount} panel${panelCount === 1 ? "" : "s"} · ${selected.label} each · ${formatCapacity(capacityKw)}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onRecalculate}
          title="Recalculate panel placement from the current settings"
        >
          <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
          Recalculate
        </button>
      </div>

      {/* Panel rating — representative module sizes, configurable */}
      <div className="panel-group">
        <span className="panel-group__label" id="panel-rating-label">
          Panel rating
        </span>
        <div className="segmented" role="group" aria-labelledby="panel-rating-label">
          {PANEL_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className={`segmented__btn${config.panelTypeId === type.id ? " is-active" : ""}`}
              aria-pressed={config.panelTypeId === type.id}
              onClick={() => onConfigChange({ panelTypeId: type.id as PanelTypeId })}
            >
              {type.label}
              <span className="segmented__meta">
                {type.widthM.toFixed(2)} × {type.lengthM.toFixed(2)} m
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Mounting type — Flat Roof only for now. The engine keeps the other
          types internally for later milestones; the UI offers no switch. */}
      <div className="panel-group">
        <span className="panel-group__label" id="panel-mounting-label">
          Mounting type
        </span>
        <div className="segmented" role="group" aria-labelledby="panel-mounting-label">
          {MOUNTING_TYPES.filter((mounting) => mounting.type === "flat").map((mounting) => (
            <button
              key={mounting.type}
              type="button"
              className={`segmented__btn${config.mounting === mounting.type ? " is-active" : ""}`}
              aria-pressed={config.mounting === mounting.type}
              onClick={() => onConfigChange({ mounting: mounting.type as MountingType })}
            >
              {mounting.label}
            </button>
          ))}
        </div>
        <p className="panel-group__hint">
          Panels on supports above the flat roof — tilt and facing are adjustable.
        </p>
      </div>

      {/* Geometry controls */}
      <div className="field-grid">
        <NumberField
          id="panel-tilt"
          label={tiltLabel}
          value={config.tiltDeg}
          min={0}
          max={60}
          step={1}
          unit="°"
          onChange={(value) => onConfigChange({ tiltDeg: value })}
        />
        <NumberField
          id="panel-azimuth"
          label="Azimuth (from N)"
          value={config.azimuthDeg}
          min={0}
          max={360}
          step={5}
          unit="°"
          onChange={(value) => onConfigChange({ azimuthDeg: value })}
        />
        <NumberField
          id="panel-spacing"
          label="Panel spacing"
          value={config.spacingM}
          min={0}
          max={3}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ spacingM: value })}
        />
        <NumberField
          id="panel-setback"
          label="Edge setback"
          value={config.setbackM}
          min={0}
          max={5}
          step={0.1}
          unit="m"
          onChange={(value) => onConfigChange({ setbackM: value })}
        />
      </div>

      {/* Mounting height — support stand-off above the roof plane. Applied to
          both the panel lift and the support/leg geometry, so the rendered
          array rises and its supports grow with the value. */}
      <div className="field-grid">
        <NumberField
          id="panel-mount-height"
          label="Panel mounting height"
          value={config.mountHeightM}
          min={0.02}
          max={2}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ mountHeightM: value })}
        />
      </div>

      {/* Result */}
      <p className="sun-readout" role="output">
        <strong>
          {panelCount} × {selected.label}
        </strong>{" "}
        · {panelCount > 0 ? formatCapacity(capacityKw) : "0.00 kWp"}
        {panelCount > 0 && (
          <span className="sun-meta__note"> · {selected.widthM.toFixed(2)} × {selected.lengthM.toFixed(2)} m each</span>
        )}
      </p>

      {warning && (
        <p className="obstacle-warning" role="alert">
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{warning}</span>
        </p>
      )}
    </div>
  );
}

export default SolarPanelSection;
