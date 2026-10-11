/**
 * TreeEditor - Compact ground-based tree form
 *
 * Controlled form for adding and editing trees on the ground plane (Z = 0)
 * outside the building footprint. All values are metres/degrees.
 */

import { type FormEvent } from "react";
import { X } from "lucide-react";
import {
  TREE_TYPES,
  type TreeDraft,
  type TreeType,
} from "../../lib/3d/treeTypes";

interface TreeEditorProps {
  mode: "adding" | "editing";
  draft: TreeDraft;
  /** Live validation error for the draft (shown after submit attempt) */
  error: string | null;
  onDraftChange: (draft: TreeDraft) => void;
  /** Changing the category reloads that category's presets */
  onTypeChange: (type: TreeType) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

type NumericField = "height" | "canopyWidth" | "rotation" | "x" | "y";

export function TreeEditor({
  mode,
  draft,
  error,
  onDraftChange,
  onTypeChange,
  onSubmit,
  onCancel,
}: TreeEditorProps) {
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
    <form className="obstacle-form" onSubmit={handleSubmit} noValidate>
      <div className="obstacle-form__header">
        <h4 className="obstacle-form__title">
          {mode === "adding" ? "Add ground tree" : "Edit tree"}
        </h4>
        <button
          type="button"
          className="icon-btn"
          onClick={onCancel}
          aria-label="Cancel tree edit"
          title="Cancel"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="field">
        <label htmlFor="tree-type">Tree type</label>
        <select
          id="tree-type"
          value={draft.type}
          onChange={(e) => onTypeChange(e.target.value as TreeType)}
        >
          {TREE_TYPES.map((def) => (
            <option key={def.type} value={def.type}>
              {def.label}
            </option>
          ))}
        </select>
      </div>

      <div className="obstacle-form__grid">
        {numericInput("tree-height", "Tree height", "height", "m")}
        {numericInput("tree-canopy-width", "Canopy width", "canopyWidth", "m")}
      </div>

      <div className="obstacle-form__grid">
        {numericInput("tree-pos-x", "East offset", "x", "m")}
        {numericInput("tree-pos-y", "North offset", "y", "m")}
      </div>

      {numericInput("tree-rotation", "Rotation", "rotation", "°")}

      {error && (
        <p className="obstacle-form__error" role="alert">
          {error}
        </p>
      )}

      <div className="obstacle-form__actions">
        <button type="submit" className="btn btn--primary">
          {mode === "adding" ? "Place tree" : "Save changes"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default TreeEditor;
