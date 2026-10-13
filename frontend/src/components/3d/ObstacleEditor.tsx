/**
 * ObstacleEditor - Compact rooftop obstacle form
 *
 * Controlled form: the parent (ModelPanel) owns the draft so it can show the
 * translucent preview in the 3D viewport while the user types.
 *
 * Workflow (AGENTS.md §15): choose a type → define the footprint → enter the
 * height → place it on the roof (click the roof in the viewport) → add.
 * All values are metres/degrees; nothing is measured from the screen
 * (AGENTS.md §52). Validation itself is deterministic and lives in
 * `lib/3d/obstacles`.
 */

import { type FormEvent } from "react";
import { Building2, X } from "lucide-react";
import {
  OBSTACLE_TYPES,
  type ObstacleDraft,
  type ObstacleType,
} from "../../lib/3d/obstacles";

interface ObstacleEditorProps {
  mode: "adding" | "editing";
  draft: ObstacleDraft;
  /** Live validation error for the draft (shown after the first submit) */
  error: string | null;
  onDraftChange: (draft: ObstacleDraft) => void;
  /** Changing the category reloads that category's preset footprint */
  onTypeChange: (type: ObstacleType) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Start interactive footprint drawing (Custom obstacles, adding only). */
  onDrawFootprint?: () => void;
  /** Start map outline drawing for a nearby building obstacle. */
  onDrawNearbyBuilding?: () => void;
}

type NumericField = "length" | "width" | "height" | "rotation";

export function ObstacleEditor({
  mode,
  draft,
  error,
  onDraftChange,
  onTypeChange,
  onSubmit,
  onCancel,
  onDrawFootprint,
  onDrawNearbyBuilding,
}: ObstacleEditorProps) {
  const setField = (field: NumericField, value: string) => {
    onDraftChange({ ...draft, [field]: value });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const numericInput = (
    id: string,
    label: string,
    field: NumericField,
    unit: string,
  ) => (
    <div className="field" key={id}>
      <label htmlFor={id}>{label}</label>
      <div className="height-input-row">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft[field]}
          onChange={(e) => setField(field, e.target.value)}
        />
        <span className="height-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  );

  return (
    <form className="obstacle-form" onSubmit={handleSubmit} aria-label="Obstacle editor">
      <div className="obstacle-form__header">
        <span className="obstacle-form__title">
          {mode === "adding" ? "Add obstacle" : "Edit obstacle"}
        </span>
        <button type="button" className="btn btn--subtle" onClick={onCancel}>
          <X size={14} aria-hidden="true" />
          Cancel
        </button>
      </div>

      <div className="field-grid">
        <div className="field field--full">
          <label htmlFor="obstacle-type">Obstacle type</label>
          <select
            id="obstacle-type"
            value={draft.type}
            onChange={(e) => onTypeChange(e.target.value as ObstacleType)}
          >
            {OBSTACLE_TYPES.map((type) => (
              <option key={type.type} value={type.type}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {draft.polygon && draft.polygon.length >= 3 ? (
          <p className="obstacle-form__hint">
            Drawn polygon footprint — reshape by deleting this obstacle and drawing a new one.
            Rotation and height remain editable below; drag the obstacle in the 3D view to move it.
          </p>
        ) : (
          <>
            {numericInput("obstacle-length", "Length", "length", "m")}
            {numericInput("obstacle-width", "Width", "width", "m")}
          </>
        )}
        {numericInput("obstacle-height", "Height", "height", "m")}
        {numericInput("obstacle-rotation", "Rotation", "rotation", "°")}
      </div>

      <p className="obstacle-form__hint">
        Click the roof in the 3D view to position the footprint, or drag it directly once placed.
        Rotation turns the footprint counter-clockwise around the vertical axis.
      </p>

      {error && (
        <p className="obstacle-form__error" role="alert">
          {error}
        </p>
      )}

      <div className="obstacle-form__actions">
        {mode === "adding" && draft.type === "custom" && onDrawFootprint && (
          <button type="button" className="btn btn--secondary" onClick={onDrawFootprint}>
            Draw footprint
          </button>
        )}
        {mode === "adding" && draft.type === "building" && onDrawNearbyBuilding && (
          <button type="button" className="btn btn--secondary" onClick={onDrawNearbyBuilding}>
            <Building2 size={14} aria-hidden="true" />
            Outline on map
          </button>
        )}
        <button type="submit" className="btn btn--primary">
          {mode === "adding" ? "Add obstacle" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
