import { MousePointerSquareDashed, Pencil, Ruler, Trash2 } from "lucide-react";
import type { SelectionMode } from "../../hooks/useSelection";

interface MapToolbarProps {
  mode: SelectionMode;
  hasVertices: boolean;
  measureOn: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onClear: () => void;
  onMeasure: () => void;
}

/**
 * Floating bottom-center selection toolbar. Every button maps to existing
 * selection state machine actions; Measure only toggles the measurement
 * overlay and never mutates geometry.
 */
export function MapToolbar({ mode, hasVertices, measureOn, onSelect, onEdit, onClear, onMeasure }: MapToolbarProps) {
  return (
    <div className="map-toolbar" role="toolbar" aria-label="Selection tools">
      <button
        type="button"
        className={`map-toolbar__btn${mode === "drawing" ? " is-active" : ""}`}
        onClick={onSelect}
        disabled={mode === "drawing"}
        aria-pressed={mode === "drawing"}
        title="Draw a new rooftop boundary"
      >
        <MousePointerSquareDashed size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Select</span>
      </button>
      <button
        type="button"
        className={`map-toolbar__btn${mode === "editing" || mode === "confirmed" ? " is-active" : ""}`}
        onClick={onEdit}
        disabled={!hasVertices}
        aria-pressed={mode === "editing" || mode === "confirmed"}
        title="Edit the selected boundary"
      >
        <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Edit</span>
      </button>
      <button
        type="button"
        className="map-toolbar__btn"
        onClick={onClear}
        disabled={!hasVertices && mode === "idle"}
        title="Clear the current selection"
      >
        <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Clear</span>
      </button>
      <button
        type="button"
        className={`map-toolbar__btn${measureOn ? " is-active" : ""}`}
        onClick={onMeasure}
        aria-pressed={measureOn}
        title="Measure rooftop dimensions"
      >
        <Ruler size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Measure</span>
      </button>
    </div>
  );
}
