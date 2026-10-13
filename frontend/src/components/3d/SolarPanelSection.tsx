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

import { useState, useEffect, useRef } from "react";
import { RefreshCw, AlertTriangle, Grid3x3, Plus, Copy, Trash2, Wand2, RotateCw, Zap, Loader2 } from "lucide-react";
import {
  GROUND_MOUNTING_TYPES,
  MOUNTING_TYPES,
  PANEL_LEGS_MAX,
  PANEL_LEGS_MIN,
  PANEL_MIN_SIDE_M,
  PANEL_MAX_SIDE_M,
  PANEL_SET_COLS_MAX,
  PANEL_SET_COLS_MIN,
  PANEL_SET_ROWS_MAX,
  PANEL_SET_ROWS_MIN,
  PANEL_SPACING_MIN_M,
  PANEL_SPACING_MAX_M,
  PANEL_TYPES,
  calculateSolarRowSpacing,
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
  /**
   * Manual-placement granularity: "single" places one panel per click (the
   * original workflow), "set" places the whole configured rows-by-columns
   * group per click. Independent of whether the mode is armed.
   */
  manualPlaceMode?: "single" | "set";
  onManualPlaceModeChange?: (mode: "single" | "set") => void;
  /** How many panels the active set currently has (manual count readout). */
  manualPlacedCount?: number;
  /** Clear the active set's panels. */
  onClearManual?: () => void;
  /** Last manual-placement refusal, shown next to the placement controls. */
  manualStatus?: string | null;
  /** Live "no longer fits" report for the active set (never auto-moved). */
  setWarning?: string | null;
  /**
   * Roof-derived upper bounds for the set rows/columns. Null when the usable
   * roof cannot be measured; 0 means this axis cannot hold a single panel.
   * They clamp the input rather than silently rejecting a typed value, so the
   * tooltip states the reason and the hint shows the ceiling.
   */
  maxSetRows?: number | null;
  maxSetCols?: number | null;
  /** Rotation (degrees CCW) of the set group being placed. */
  setRotationDeg?: number;
  /** Rotate the group by a quarter turn (+/- 90 degrees). */
  onRotateSet?: (deltaDeg: number) => void;
  /** Undo the most recently committed whole set. */
  onUndoLastSet?: () => void;
  canUndoLastSet?: boolean;
  panelCount: number;
  capacityKw: number;
  /** Zero-panel explanation, or an invalid-configuration error. */
  warning: string | null;
  /** Hourly simulation result for the active set, or null when not computable. */
  energy?: EnergySimulation | null;
  /** Display mode: "all" (default), "sets", or "config". */
  displayMode?: "all" | "sets" | "config";
  /** Whether the animated 3D electricity flow visualization is enabled. */
  electricityFlowActive?: boolean;
  /** Toggle the animated 3D electricity flow visualization. */
  onToggleElectricityFlow?: () => void;
  /** Target capacity status / message from placement engine */
  targetStatus?: string | null;
  /** Site-optimal orientation recommended by solar resource engine */
  optimalOrientation?: { tiltDeg: number; azimuthDeg: number } | null;
  onApplyOptimalOrientation?: () => void;
  /** True while automatic placement computation is actively running. */
  isPlacing?: boolean;
}

/**
 * Paired slider + number input in the existing `.field` style.
 *
 * The slider and the numeric field write the SAME value through one onChange,
 * so they can never desynchronise. The slider always emits a finite in-range
 * value; free text may be out of range or non-numeric, which the domain
 * validator (`validatePanelConfig`) then reports instead of corrupting the
 * layout — placement refuses with a message rather than placing garbage.
 */
function SliderNumberField({
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
  const [localVal, setLocalVal] = useState<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handleInput = (val: number) => {
    setLocalVal(val);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    onChange(val);
  };

  const handleCommit = (val: number) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLocalVal(val);
    onChange(val);
  };

  // Clamp only for the slider thumb position: the number field keeps showing
  // the true value so an out-of-range entry stays visible (and invalid) rather
  // than silently snapping.
  const thumb = Number.isFinite(localVal) ? Math.min(max, Math.max(min, localVal)) : min;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="height-input-row">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={localVal}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleCommit(Number(e.target.value))}
        />
        <span className="height-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        className="field-slider"
        value={thumb}
        min={min}
        max={max}
        step={step}
        onInput={(e) => handleInput(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => handleCommit(Number(e.target.value))}
      />
    </div>
  );
}

/**
 * Compact integer stepper for whole-number frame parameters (set grid, leg
 * grid). Native number spinners plus an explicit integer commit: fractional
 * or empty input becomes NaN, which `validatePanelConfig` reports instead of
 * silently rounding into the layout.
 */
function IntStepperField({
  id,
  label,
  title,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint?: string | null;
}) {
  return (
    <div className="field">
      <label htmlFor={id} title={title}>
        {label}
      </label>
      <div className="height-input-row">
        <input
          id={id}
          title={title}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw.trim() === "" ? Number.NaN : Math.floor(Number(raw)));
          }}
        />
      </div>
      {hint && <span className="panel-group__hint">{hint}</span>}
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
  manualPlaceMode = "single",
  onManualPlaceModeChange,
  manualPlacedCount = 0,
  onClearManual,
  manualStatus = null,
  setWarning = null,
  maxSetRows = null,
  maxSetCols = null,
  setRotationDeg = 0,
  onRotateSet,
  onUndoLastSet,
  canUndoLastSet = false,
  panelCount,
  capacityKw,
  warning,
  energy,
  displayMode = "all",
  electricityFlowActive = false,
  onToggleElectricityFlow,
  targetStatus = null,
  optimalOrientation = null,
  onApplyOptimalOrientation,
  isPlacing = false,
}: SolarPanelSectionProps) {
  const [confirmReplace, setConfirmReplace] = useState<"set" | "all" | null>(null);
  const selected = panelTypeDefinition(config.panelTypeId);
  const tiltLabel = config.mounting === "tilted" ? "Roof slope" : "Tilt";
  // Optional props default to their empty/absent values so a caller that does
  // not use panel sets still renders correctly.
  const setsList = sets ?? [];
  const activeId = activeSetId ?? setsList[0]?.id ?? "";
  const activeSet = setsList.find((s) => s.id === activeId) ?? setsList[0] ?? null;

  const handleRequestAutoPlace = () => {
    if (activeSet && activeSet.panels.length > 0) {
      setConfirmReplace("set");
    } else {
      onAutoPlace?.();
    }
  };

  const handleRequestAutoPlaceAll = () => {
    if (setsList.some((s) => s.panels.length > 0)) {
      setConfirmReplace("all");
    } else {
      onAutoPlaceAll?.();
    }
  };

  // Set size, guarded for display: a cleared or fractional entry shows 0 until
  // the domain validator reports it, never a bogus total.
  const setRowsValue = Number.isInteger(config.setRows) && config.setRows > 0 ? config.setRows : 0;
  const setColsValue = Number.isInteger(config.setCols) && config.setCols > 0 ? config.setCols : 0;
  const setTotal = setRowsValue * setColsValue;

  const showSets = displayMode === "all" || displayMode === "sets";
  const showConfig = displayMode === "all" || displayMode === "config";

  return (
    <div className="obstacle-section">
      {showSets && setsList.length > 0 && (
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

      {showConfig && displayMode === "config" && (
        <div className="obstacle-toolbar" style={{ marginBottom: "var(--space-2)" }}>
          <div className="obstacle-toolbar__labels">
            <h3 className="obstacle-section__title">
              <Grid3x3 size={15} strokeWidth={1.75} aria-hidden="true" /> {activeSet?.name ?? "Module"} settings
            </h3>
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onRecalculate}
            disabled={isPlacing}
            title="Recalculate panel placement from the current settings"
          >
            {isPlacing ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
            )}
            {isPlacing ? "Recalculating…" : "Recalculate"}
          </button>
        </div>
      )}

      {showSets && (
        <>
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
            {displayMode === "all" && (
              <div style={{ display: "flex", gap: "6px" }}>
                {onToggleElectricityFlow && (
                  <button
                    type="button"
                    className={`btn ${electricityFlowActive ? "btn--primary" : "btn--secondary"}`}
                    onClick={onToggleElectricityFlow}
                    aria-pressed={electricityFlowActive}
                    title="Toggle animated 3D solar electricity flow"
                  >
                    <Zap size={14} strokeWidth={2} aria-hidden="true" />
                    {electricityFlowActive ? "Flow Active" : "Electricity Flow"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={onRecalculate}
                  disabled={isPlacing}
                  title="Recalculate panel placement from the current settings"
                >
                  {isPlacing ? (
                    <Loader2 size={15} className="spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
                  )}
                  {isPlacing ? "Recalculating…" : "Recalculate"}
                </button>
              </div>
            )}
          </div>

      {/* Feature 2: Explicit Placement Options when no panels placed */}
      {panelCount === 0 && (
        <div className="panel-placement-prompt" role="region" aria-label="Solar panel placement options">
          <h4 className="panel-placement-prompt__title">Place Solar Panels</h4>
          <p className="panel-placement-prompt__body">
            No panels placed yet. Choose how you would like to arrange modules on this roof:
          </p>
          <div className="panel-placement-prompt__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRequestAutoPlace}
              disabled={isPlacing}
              title="Automatically arrange solar panels within the usable roof area"
            >
              {isPlacing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 size={14} strokeWidth={2} aria-hidden="true" />
              )}
              {isPlacing ? "Placing..." : "Auto-Place Panels"}
            </button>
            <button
              type="button"
              className={`btn ${manualPlaceActive ? "btn--primary" : "btn--secondary"}`}
              onClick={onToggleManualPlace}
              disabled={isPlacing}
              title="Click directly on the 3D roof to position panels individually or in sets"
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              {manualPlaceActive ? "Placement Active" : "Add Panel Manually"}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog before overwriting existing layout */}
      {confirmReplace && (
        <div className="panel-replace-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-replace-title">
          <h4 id="confirm-replace-title" className="panel-replace-dialog__title">
            <AlertTriangle size={15} aria-hidden="true" /> Replace Existing Layout?
          </h4>
          <p className="panel-replace-dialog__message">
            {confirmReplace === "set"
              ? `Auto-placing will replace all ${activeSet?.panels.length ?? 0} existing panels in "${activeSet?.name ?? "this set"}". Any custom layout adjustments will be overwritten.`
              : `Auto-placing will regenerate all panel sets, replacing all existing placed panels across the roof. This action cannot be undone.`}
          </p>
          <div className="panel-replace-dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setConfirmReplace(null)}
              disabled={isPlacing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const target = confirmReplace;
                setConfirmReplace(null);
                if (target === "set") onAutoPlace?.();
                else if (target === "all") onAutoPlaceAll?.();
              }}
              disabled={isPlacing}
            >
              {isPlacing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {isPlacing ? " Placing..." : "Confirm Auto-Place"}
            </button>
          </div>
        </div>
      )}

      {/* A manually edited set keeps its stored positions when the configuration
          changes — the new tilt/height/dimensions apply to rendering, but the
          arrangement is no longer the lattice output. Auto-place regenerates it
          (overwriting the custom layout), Recalculate only refreshes
          validation. Neither happens silently: both are explicit buttons. */}
      {activeSet?.userModified && (
        <p className="panel-group__hint" role="note">
          Custom arrangement — changing settings keeps these panel positions. Use
          Auto-place set to regenerate the layout (this overwrites the custom arrangement).
        </p>
      )}

      {/* Placement: auto per set, auto for all, and undo for manual edits. */}
      <div className="panel-set-actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleRequestAutoPlace}
          disabled={isPlacing}
          title="Automatically arrange this set inside the usable roof"
        >
          {isPlacing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 size={14} strokeWidth={2} aria-hidden="true" />
          )}{" "}
          {isPlacing ? "Placing..." : "Auto-place set"}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleRequestAutoPlaceAll}
          disabled={isPlacing || setsList.length < 2}
          title="Auto-place every set (sets may then overlap if the roof is crowded)"
        >
          {isPlacing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 size={14} strokeWidth={2} aria-hidden="true" />
          )}{" "}
          {isPlacing ? "Placing all..." : "Auto-place all"}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onUndoLast}
          disabled={isPlacing || !activeSet || activeSet.panels.length === 0}
          title="Undo the most recent manual placement"
        >
          Undo last panel
        </button>
      </div>

      {/* Manual placement mode. Two granularities share one roof-click stream:
          "single" keeps the original one-panel-per-click behaviour, "set"
          commits the whole configured rows-by-columns group in one click. Both
          are validated by the SAME shared validator the auto-placement lattice
          uses, so either way an invalid position places nothing. */}
      <div className="panel-set-actions">
        <button
          type="button"
          className={`btn${manualPlaceActive ? " btn--primary" : " btn--secondary"}`}
          onClick={onToggleManualPlace}
          disabled={isPlacing}
          aria-pressed={manualPlaceActive}
          title={
            manualPlaceMode === "set"
              ? "Click the roof to place the whole panel set"
              : "Click the roof to place one panel at a time"
          }
        >
          {manualPlaceActive
            ? `Manual placement: on${manualPlaceMode === "set" ? " (set)" : ""}`
            : "Manual placement"}
        </button>
        {onManualPlaceModeChange && (
          <div className="segmented" role="group" aria-label="Manual placement granularity">
            <button
              type="button"
              className={`segmented__btn${manualPlaceMode === "single" ? " is-active" : ""}`}
              aria-pressed={manualPlaceMode === "single"}
              onClick={() => onManualPlaceModeChange("single")}
              title="Each roof click adds one panel"
            >
              One panel
            </button>
            <button
              type="button"
              className={`segmented__btn${manualPlaceMode === "set" ? " is-active" : ""}`}
              aria-pressed={manualPlaceMode === "set"}
              onClick={() => onManualPlaceModeChange("set")}
              title="Each roof click adds the whole configured panel set"
            >
              Whole set
            </button>
          </div>
        )}
        {onUndoLastSet && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onUndoLastSet}
            disabled={!canUndoLastSet}
            title="Remove the most recently placed panel set"
          >
            Undo last set
          </button>
        )}
        {manualPlaceActive && (
          <span className="panel-group__hint">
            {manualPlaceMode === "set"
              ? `Move the pointer over the roof to preview ${config.setRows} x ${config.setCols}, then click to place the whole set - ${manualPlacedCount} in this set`
              : `Click the roof to add a panel - ${manualPlacedCount} placed`}
          </span>
        )}
        {manualPlaceMode === "set" && onRotateSet && (
          <div className="panel-set-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => onRotateSet(-90)}
              title="Rotate the group 90 degrees anticlockwise"
              aria-label="Rotate group left"
            >
              <RotateCw size={14} strokeWidth={2} aria-hidden="true" style={{ transform: "scaleX(-1)" }} /> 90&deg;
            </button>
            <span className="panel-group__hint" role="status">
              Group rotation: {Math.round(((setRotationDeg % 360) + 360) % 360)}&deg;
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => onRotateSet(90)}
              title="Rotate the group 90 degrees clockwise"
              aria-label="Rotate group right"
            >
              <RotateCw size={14} strokeWidth={2} aria-hidden="true" /> 90&deg;
            </button>
          </div>
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

      {/* Panels in set: the rows x columns size of the whole group, directly
          under the One panel / Whole set switch so whole-set placement is
          configured where it is used. The maxima come from the usable roof,
          the panel orientation, dimensions and spacing, so an impossible
          request is refused with a reason instead of being silently
          clamped. */}
      {(manualPlaceMode === "set" || manualPlaceActive) && (
        <div className="panel-group">
        <span className="panel-group__label" id="panel-set-label">Panels in set</span>
        <div className="field-grid" role="group" aria-labelledby="panel-set-label">
          <IntStepperField
            id="panel-set-rows"
            label="Rows"
            title="Panel rows in the set: they stack along the panel length direction (roof north-south before rotation)"
            value={config.setRows}
            min={PANEL_SET_ROWS_MIN}
            max={maxSetRows && maxSetRows > 0 ? Math.min(maxSetRows, PANEL_SET_ROWS_MAX) : PANEL_SET_ROWS_MAX}
            hint={
              maxSetRows === null
                ? null
                : maxSetRows === 0
                  ? "No row fits the usable roof"
                  : `Max ${maxSetRows} on this roof`
            }
            onChange={(value) => onConfigChange({ setRows: value })}
          />
          <IntStepperField
            id="panel-set-cols"
            label="Columns"
            title="Panel columns in the set: they run along the panel width direction (roof east-west before rotation)"
            value={config.setCols}
            min={PANEL_SET_COLS_MIN}
            max={maxSetCols && maxSetCols > 0 ? Math.min(maxSetCols, PANEL_SET_COLS_MAX) : PANEL_SET_COLS_MAX}
            hint={
              maxSetCols === null
                ? null
                : maxSetCols === 0
                  ? "No column fits the usable roof"
                  : `Max ${maxSetCols} on this roof`
            }
            onChange={(value) => onConfigChange({ setCols: value })}
          />
        </div>
        <p className="sun-readout" role="status">
          Panels in set: {setRowsValue} &times; {setColsValue} = {setTotal}
        </p>
        {(maxSetRows !== null && config.setRows > maxSetRows) ||
        (maxSetCols !== null && config.setCols > maxSetCols) ? (
          <p className="panel-group__hint" role="note">
            Larger than this roof can hold ({maxSetRows ?? "?"} rows / {maxSetCols ?? "?"} columns).
            The preview stays red and placement is refused until the set fits.
          </p>
        ) : null}
      </div>
      )}
      {(manualStatus || setWarning) && (
        <p className="obstacle-warning" role="alert">
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{manualStatus ?? setWarning}</span>
        </p>
      )}
        </>
      )}

      {showConfig && (
        <>
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

      {/* Mounting type / structure selector */}
      <div className="panel-group">
        <span className="panel-group__label" id="panel-mounting-label">
          {config.installationType === "ground" ? "Ground mounting structure" : "Mounting type"}
        </span>
        <div className="segmented" role="group" aria-labelledby="panel-mounting-label" style={{ flexWrap: "wrap", gap: "4px" }}>
          {config.installationType === "ground" ? (
            GROUND_MOUNTING_TYPES.map((mounting) => (
              <button
                key={mounting.type}
                type="button"
                className={`segmented__btn${config.mounting === mounting.type ? " is-active" : ""}`}
                aria-pressed={config.mounting === mounting.type}
                disabled={mounting.disabled}
                title={mounting.description}
                onClick={() => {
                  if (!mounting.disabled) {
                    onConfigChange({ mounting: mounting.type as MountingType });
                  }
                }}
                style={
                  mounting.disabled
                    ? { opacity: 0.55, cursor: "not-allowed", fontSize: "0.78rem" }
                    : { fontSize: "0.82rem" }
                }
              >
                {mounting.label}
                {mounting.badge && (
                  <span
                    style={{
                      marginLeft: "6px",
                      fontSize: "0.68rem",
                      padding: "1px 5px",
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: "4px",
                    }}
                  >
                    {mounting.badge}
                  </span>
                )}
              </button>
            ))
          ) : (
            MOUNTING_TYPES.filter((mounting) => mounting.type === "flat").map((mounting) => (
              <button
                key={mounting.type}
                type="button"
                className={`segmented__btn${config.mounting === mounting.type ? " is-active" : ""}`}
                aria-pressed={config.mounting === mounting.type}
                onClick={() => onConfigChange({ mounting: mounting.type as MountingType })}
              >
                {mounting.label}
              </button>
            ))
          )}
        </div>
        <p className="panel-group__hint">
          {config.installationType === "ground"
            ? "Engineered dual-post steel table with driven pile foundations, sloped rafters, purlins, clamps and knee braces."
            : "Panels on supports above the flat roof — tilt and facing are adjustable."}
        </p>
      </div>

      {/* Capacity target — bounds placement without violating geometry or setbacks */}
      <div className="panel-group">
        <span className="panel-group__label" id="panel-target-capacity-label">
          Capacity target
        </span>
        <div className="segmented" role="group" aria-labelledby="panel-target-capacity-label">
          {[
            { id: "auto", label: "Auto / Max fit", kwp: null },
            { id: "1kw", label: "1 kWp", kwp: 1 },
            { id: "2kw", label: "2 kWp", kwp: 2 },
            { id: "3kw", label: "3 kWp", kwp: 3 },
            { id: "5kw", label: "5 kWp", kwp: 5 },
            { id: "10kw", label: "10 kWp", kwp: 10 },
            { id: "custom", label: "Custom", kwp: -1 },
          ].map((preset) => {
            const isActive =
              preset.kwp === null
                ? config.targetCapacityKwp === null || config.targetCapacityKwp === undefined
                : preset.kwp === -1
                  ? config.targetCapacityKwp !== null &&
                    config.targetCapacityKwp !== undefined &&
                    ![1, 2, 3, 5, 10].includes(config.targetCapacityKwp)
                  : config.targetCapacityKwp === preset.kwp;
            return (
              <button
                key={preset.id}
                type="button"
                className={`segmented__btn${isActive ? " is-active" : ""}`}
                aria-pressed={isActive}
                onClick={() =>
                  onConfigChange({
                    targetCapacityKwp:
                      preset.kwp === -1
                        ? config.targetCapacityKwp && config.targetCapacityKwp > 0
                          ? config.targetCapacityKwp
                          : 4
                        : preset.kwp,
                  })
                }
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        {config.targetCapacityKwp !== null &&
          config.targetCapacityKwp !== undefined &&
          ![1, 2, 3, 5, 10].includes(config.targetCapacityKwp) && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <SliderNumberField
                id="panel-custom-target-capacity"
                label="Custom target capacity"
                value={config.targetCapacityKwp}
                min={0.5}
                max={100}
                step={0.5}
                unit="kWp"
                onChange={(value) => onConfigChange({ targetCapacityKwp: value > 0 ? value : null })}
              />
            </div>
          )}
        {targetStatus && (
          <p
            className="panel-group__hint"
            role="status"
            style={{
              color:
                targetStatus.includes("bounded") || targetStatus.includes("limited")
                  ? "var(--color-warning, #f59e0b)"
                  : "var(--color-primary, #38bdf8)",
              marginTop: "4px",
            }}
          >
            {targetStatus}
          </p>
        )}
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
        <SliderNumberField
          id="panel-tilt"
          label={tiltLabel}
          value={config.tiltDeg}
          min={0}
          max={60}
          step={1}
          unit="°"
          onChange={(value) => onConfigChange({ tiltDeg: value })}
        />
        <SliderNumberField
          id="panel-azimuth"
          label="Azimuth (from N)"
          value={config.azimuthDeg}
          min={0}
          max={360}
          step={5}
          unit="°"
          onChange={(value) => onConfigChange({ azimuthDeg: value })}
        />
        <SliderNumberField
          id="panel-spacing"
          label="Panel spacing"
          value={config.spacingM}
          min={0}
          max={3}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ spacingM: value })}
        />
        <SliderNumberField
          id="panel-row-spacing"
          label="Vertical (row) spacing"
          value={config.rowSpacingM ?? config.spacingM}
          min={PANEL_SPACING_MIN_M}
          max={PANEL_SPACING_MAX_M}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ rowSpacingM: value })}
        />
        <SliderNumberField
          id="panel-col-spacing"
          label="Horizontal (col) spacing"
          value={config.colSpacingM ?? config.spacingM}
          min={PANEL_SPACING_MIN_M}
          max={PANEL_SPACING_MAX_M}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ colSpacingM: value })}
        />
      </div>

      {config.installationType === "ground" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "4px",
            fontSize: "0.75rem",
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: "6px",
            padding: "6px 10px",
          }}
        >
          <span>
            Recommended shadow-clear row spacing:{" "}
            <b>{calculateSolarRowSpacing(selected.lengthM, config.tiltDeg).toFixed(2)} m</b>
          </span>
          <button
            type="button"
            className="btn btn--subtle"
            style={{ fontSize: "0.72rem", padding: "2px 8px", minHeight: "24px" }}
            onClick={() => onConfigChange({ rowSpacingM: calculateSolarRowSpacing(selected.lengthM, config.tiltDeg) })}
            title="Apply solar shadow-clear row spacing estimate"
          >
            Apply
          </button>
        </div>
      )}

      {optimalOrientation && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "4px",
            fontSize: "0.75rem",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            borderRadius: "6px",
            padding: "6px 10px",
          }}
        >
          <span>
            Optimal orientation for site:{" "}
            <b>
              {optimalOrientation.azimuthDeg}° (from N) · {optimalOrientation.tiltDeg}° tilt
            </b>
          </span>
          {onApplyOptimalOrientation && (
            <button
              type="button"
              className="btn btn--subtle"
              style={{ fontSize: "0.72rem", padding: "2px 8px", minHeight: "24px" }}
              onClick={onApplyOptimalOrientation}
              title="Apply recommended solar orientation to this panel set"
            >
              Apply
            </button>
          )}
        </div>
      )}

      {/* Mounting height — support stand-off above the roof or ground plane */}
      <div className="field-grid">
        <SliderNumberField
          id="panel-mount-height"
          label={config.installationType === "ground" ? "Ground clearance (lower edge)" : "Panel mounting height"}
          value={config.mountHeightM}
          min={config.installationType === "ground" ? 0.2 : 0.02}
          max={config.installationType === "ground" ? 3.5 : 2}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ mountHeightM: value })}
        />
        <SliderNumberField
          id="panel-custom-width"
          label="Custom width (optional)"
          value={config.customWidthM ?? selected.widthM}
          min={PANEL_MIN_SIDE_M}
          max={PANEL_MAX_SIDE_M}
          step={0.05}
          unit="m"
          onChange={(value) => onConfigChange({ customWidthM: value })}
        />
        <SliderNumberField
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

      {/* Mounting frame: spacing and support parameters for this set. The
          set SIZE (rows x columns) is edited in the placement block above,
          next to One panel / Whole set, so whole-set placement is configured
          where it is used. Structure legs sets the rendered support grid,
          visual only. */}
      <div className="panel-group">
        <span className="panel-group__label" id="panel-frame-label">Frame</span>
        <div className="field-grid">
          <SliderNumberField
            id="panel-row-spacing"
            label="Row spacing"
            value={config.rowSpacingM ?? config.spacingM}
            min={PANEL_SPACING_MIN_M}
            max={PANEL_SPACING_MAX_M}
            step={0.05}
            unit="m"
            onChange={(value) => onConfigChange({ rowSpacingM: value })}
          />
          <SliderNumberField
            id="panel-col-spacing"
            label="Column spacing"
            value={config.colSpacingM ?? config.spacingM}
            min={PANEL_SPACING_MIN_M}
            max={PANEL_SPACING_MAX_M}
            step={0.05}
            unit="m"
            onChange={(value) => onConfigChange({ colSpacingM: value })}
          />
        </div>
        <span className="panel-group__label" id="panel-legs-label" style={{ marginTop: "var(--space-2)" }}>
          Structure Legs (Table)
        </span>
        <div className="field-grid" role="group" aria-labelledby="panel-legs-label">
          <IntStepperField
            id="panel-leg-rows"
            label="Rows"
            title="Shared support legs along the table slope axis"
            value={config.legRows}
            min={PANEL_LEGS_MIN}
            max={PANEL_LEGS_MAX}
            onChange={(value) => onConfigChange({ legRows: value })}
          />
          <IntStepperField
            id="panel-leg-cols"
            label="Columns"
            title="Shared support legs across the table width axis"
            value={config.legCols}
            min={PANEL_LEGS_MIN}
            max={PANEL_LEGS_MAX}
            onChange={(value) => onConfigChange({ legCols: value })}
          />
        </div>
        <p className="panel-group__hint">
          Panel Sets share continuous rails and structural table legs (Rows × Columns). Single panel mode retains individual module legs.
        </p>
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
        </>
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
