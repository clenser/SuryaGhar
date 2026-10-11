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

import { RefreshCw, AlertTriangle, Grid3x3, Plus, Copy, Trash2, Wand2 } from "lucide-react";
import {
  MOUNTING_TYPES,
  PANEL_MIN_SIDE_M,
  PANEL_MAX_SIDE_M,
  PANEL_TYPES,
  formatCapacity,
  panelTypeDefinition,
  type MountingType,
  type PanelLayoutConfig,
  type PanelTypeId,
} from "../../lib/3d/panels";
import type { PanelSet } from "../../lib/3d/panelSets";
import type { EnergySimulation } from "../../lib/3d/panelEnergy";

interface SolarPanelSectionProps {
  /** Every panel set on this roof. */
  sets?: PanelSet[];
  /** The set the inspector is currently editing. */
  activeSetId?: string;
  onSelectSet?: (id: string) => void;
  onAddSet?: () => void;
  onDuplicateSet?: () => void;
  onDeleteSet?: () => void;
  onRenameSet?: (id: string, name: string) => void;
  /** Configuration of the active set. */
  config: PanelLayoutConfig;
  onConfigChange: (patch: Partial<PanelLayoutConfig>) => void;
  onRecalculate?: () => void;
  /** Auto-place just the active set. */
  onAutoPlace?: () => void;
  /** Auto-place every set. */
  onAutoPlaceAll?: () => void;
  /** Undo the most recent manual placement on the active set. */
  onUndoLast?: () => void;
  /** Whether manual placement mode is currently capturing roof clicks. */
  manualPlaceActive?: boolean;
  onToggleManualPlace?: () => void;
  /** How many panels the active set currently has (manual count readout). */
  manualPlacedCount?: number;
  /** Clear the active set's panels. */
  onClearManual?: () => void;
  panelCount: number;
  capacityKw: number;
  /** Zero-panel explanation, or an invalid-configuration error. */
  warning: string | null;
  /** Hourly simulation result for the active set, or null when not computable. */
  energy?: EnergySimulation | null;
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
  sets,
  activeSetId,
  onSelectSet,
  onAddSet,
  onDuplicateSet,
  onDeleteSet,
  onRenameSet,
  config,
  onConfigChange,
  onRecalculate,
  onAutoPlace,
  onAutoPlaceAll,
  onUndoLast,
  manualPlaceActive = false,
  onToggleManualPlace,
  manualPlacedCount = 0,
  onClearManual,
  panelCount,
  capacityKw,
  warning,
  energy,
}: SolarPanelSectionProps) {
  const selected = panelTypeDefinition(config.panelTypeId);
  const tiltLabel = config.mounting === "tilted" ? "Roof slope" : "Tilt";
  // Optional props default to their empty/absent values so a caller that does
  // not use panel sets still renders correctly.
  const setsList = sets ?? [];
  const activeId = activeSetId ?? setsList[0]?.id ?? "";
  const activeSet = setsList.find((s) => s.id === activeId) ?? setsList[0] ?? null;

  return (
    <div className="obstacle-section">
      {/* Panel sets. Each set is an independently configurable array; the roof
          can hold several with different tilt, height and orientation. */}
      {setsList.length > 0 && (
        <div className="panel-group">
          <span className="panel-group__label">Panel sets</span>
        <div className="panel-set-list">
          {setsList.map((set) => (
            <button
              key={set.id}
              type="button"
              className={`segmented__btn${set.id === activeId ? " is-active" : ""}`}
              aria-pressed={set.id === activeId}
              onClick={() => onSelectSet?.(set.id)}
              title={`${set.panels.length} panels · ${formatCapacity(
                set.panels.length * panelTypeDefinition(set.config.panelTypeId).watts / 1000,
              )}`}
            >
              {set.name}
              <span className="segmented__meta">
                {set.panels.length} panel{set.panels.length === 1 ? "" : "s"}
                {set.userModified ? " · edited" : ""}
              </span>
            </button>
          ))}
        </div>
        <div className="panel-set-actions">
          <button type="button" className="btn btn--secondary" onClick={onAddSet} title="Add a second array with its own settings">
            <Plus size={14} strokeWidth={2} aria-hidden="true" /> Add set
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onDuplicateSet}
            disabled={!activeSet}
            title="Duplicate the active set as a new, separate, unplaced set"
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" /> Duplicate
          </button>
          <button
            type="button"
            className="btn btn--subtle-danger"
            onClick={onDeleteSet}
            disabled={setsList.length <= 1}
            title="Delete the active set"
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Delete
          </button>
        </div>
        <div className="field" style={{ marginTop: "var(--space-2)" }}>
          <label htmlFor="panel-set-name">Set name</label>
          <input
            id="panel-set-name"
            type="text"
            value={activeSet?.name ?? ""}
            onChange={(e) => activeSet && onRenameSet?.(activeSet.id, e.target.value)}
            disabled={!activeSet}
          />
        </div>
      </div>
      )}

      <div className="obstacle-toolbar">
        <div className="obstacle-toolbar__labels">
          <h3 className="obstacle-section__title">
            <Grid3x3 size={15} strokeWidth={1.75} aria-hidden="true" /> Solar panels
          </h3>
          <p className="obstacle-count">
            {panelCount === 0
              ? "No panels placed yet"
              : `${panelCount} panel${panelCount === 1 ? "" : "s"} · ${capacityKw.toFixed(2)} kWp · ${formatCapacity(capacityKw)}`}
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

      {/* Placement: auto per set, auto for all, and undo for manual edits. */}
      <div className="panel-set-actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onAutoPlace}
          title="Automatically arrange this set inside the usable roof"
        >
          <Wand2 size={14} strokeWidth={2} aria-hidden="true" /> Auto-place set
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onAutoPlaceAll}
          disabled={setsList.length < 2}
          title="Auto-place every set (sets may then overlap if the roof is crowded)"
        >
          <Wand2 size={14} strokeWidth={2} aria-hidden="true" /> Auto-place all
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onUndoLast}
          disabled={!activeSet || activeSet.panels.length === 0}
          title="Undo the most recent manual placement"
        >
          Undo last panel
        </button>
      </div>

      {/* Manual placement mode. While on, a roof click places a panel at the
          set's configured azimuth and is validated by the SAME rules the
          auto-placement lattice uses. */}
      <div className="panel-set-actions">
        <button
          type="button"
          className={`btn${manualPlaceActive ? " btn--primary" : " btn--secondary"}`}
          onClick={onToggleManualPlace}
          aria-pressed={manualPlaceActive}
          title="Click the roof to place panels one by one"
        >
          {manualPlaceActive ? "Manual placement: on" : "Manual placement"}
        </button>
        {manualPlaceActive && (
          <span className="panel-group__hint">
            Click the roof to add a panel · {manualPlacedCount} placed
          </span>
        )}
        {manualPlacedCount > 0 && (
          <button
            type="button"
            className="btn btn--subtle-danger"
            onClick={onClearManual}
            title="Remove every panel from this set"
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Clear panels
          </button>
        )}
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
      <div className="panel-group">
        <span className="panel-group__label">Module orientation</span>
        <div className="segmented" role="group" aria-label="Module orientation">
          {(["portrait", "landscape"] as const).map((orientation) => (
            <button
              key={orientation}
              type="button"
              className={`segmented__btn${config.orientation === orientation ? " is-active" : ""}`}
              aria-pressed={config.orientation === orientation}
              onClick={() => onConfigChange({ orientation })}
            >
              {orientation === "portrait" ? "Portrait" : "Landscape"}
              <span className="segmented__meta">
                {orientation === "portrait" ? "short side across" : "long side across"}
              </span>
            </button>
          ))}
        </div>
      </div>

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
        <NumberField
          id="panel-custom-width"
          label="Custom width (optional)"
          value={config.customWidthM ?? selected.widthM}
          min={PANEL_MIN_SIDE_M}
          max={PANEL_MAX_SIDE_M}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ customWidthM: value })}
        />
        <NumberField
          id="panel-custom-length"
          label="Custom length (optional)"
          value={config.customLengthM ?? selected.lengthM}
          min={PANEL_MIN_SIDE_M}
          max={PANEL_MAX_SIDE_M}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ customLengthM: value })}
        />
      </div>
      <p className="panel-group__hint">
        Leave the custom dimensions on the catalogue values to keep using the selected module. Clearing them
        restores the catalogue size.
      </p>

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

      {/* Hourly production + shading. The bar chart compares shaded vs
          unshaded output so the visual loss is directly comparable, and the
          weather source is disclosed so a fallback is never mistaken for
          measured data. */}
      {energy && (
        <div className="panel-energy" role="region" aria-label="Hourly production estimate">
          <div className="panel-energy__summary">
            <div>
              <span className="panel-energy__label">Day energy (shaded)</span>
              <strong>{energy.dayEnergyKwh.toFixed(2)} kWh</strong>
            </div>
            <div>
              <span className="panel-energy__label">Unshaded</span>
              <strong>{energy.dayEnergyUnshadedKwh.toFixed(2)} kWh</strong>
            </div>
            <div>
              <span className="panel-energy__label">Shading loss</span>
              <strong>{energy.dayShadeLossPercent.toFixed(1)}%</strong>
            </div>
          </div>

          {/* Shaded vs unshaded bar chart, one pair per hour. */}
          <div className="panel-energy__chart">
            {energy.rows
              .filter((row) => !row.night)
              .map((row) => {
                const peak = Math.max(...energy.rows.map((r) => r.unshadedW), 1);
                return (
                  <div className="panel-energy__bar" key={row.hour} title={`${row.timeLabel} · unshaded ${row.unshadedW.toFixed(0)} W · shaded ${row.shadedW.toFixed(0)} W`}>
                    <div className="panel-energy__track">
                      <span
                        className="panel-energy__fill panel-energy__fill--unshaded"
                        style={{ height: `${Math.min(100, (row.unshadedW / peak) * 100)}%` }}
                      />
                      <span
                        className="panel-energy__fill panel-energy__fill--shaded"
                        style={{ height: `${Math.min(100, (row.shadedW / peak) * 100)}%` }}
                      />
                    </div>
                    <span className="panel-energy__tick">{row.hour}</span>
                  </div>
                );
              })}
          </div>

          <p className="panel-group__hint">
            {energy.fullyMeasured ? (
              <>Based on PVGIS weather data for the selected date.</>
            ) : (
              <>
                <strong>Clear-sky fallback:</strong> no PVGIS rows were available for this date, so output is an
                upper-bound clear-sky estimate, not measured weather.
              </>
            )}
          </p>
        </div>
      )}

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
