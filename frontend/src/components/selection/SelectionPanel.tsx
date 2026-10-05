import { MousePointerSquareDashed, Undo2, Trash2, Check, X, PencilRuler } from "lucide-react";
import type { SelectionState } from "../../hooks/useSelection";
import { formatArea } from "../../lib/geo";

interface SelectionPanelProps {
  selection: SelectionState;
  onStartValidate: () => void;
}

/** Contextual selection stage panel (Milestone 2 workflow). */
export function SelectionPanel({ selection, onStartValidate }: SelectionPanelProps) {
  const { mode, vertices, metrics, historyDepth } = selection;

  if (mode === "idle") {
    return (
      <div className="stage-card">
        <p className="stage-card__eyebrow">Stage 1 of 5</p>
        <h2 className="stage-card__title">Select an area</h2>
        <p className="stage-card__body">
          Zoom to a rooftop or open ground, then draw a polygon around it.
        </p>
        <button type="button" className="btn btn--primary" onClick={selection.start}>
          <MousePointerSquareDashed size={16} strokeWidth={1.75} aria-hidden="true" />
          Select area
        </button>
      </div>
    );
  }

  if (mode === "drawing") {
    return (
      <div className="stage-card">
        <p className="stage-card__eyebrow">Stage 1 of 5</p>
        <h2 className="stage-card__title">Draw the boundary</h2>
        <p className="stage-card__body">
          Click to place points. Click the first point again, double-click, or press “Finish polygon” to end (minimum 3 points).
        </p>
        <p className="stage-card__meta" aria-live="polite">
          {vertices.length} point{vertices.length === 1 ? "" : "s"}
        </p>
        <div className="stage-card__actions">
          <button type="button" className="btn btn--primary" onClick={selection.finishDrawing} disabled={vertices.length < 3}>
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            Finish polygon
          </button>
          <button type="button" className="btn" onClick={selection.undo} disabled={historyDepth === 0}>
            <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
            Undo
          </button>
          <button type="button" className="btn" onClick={selection.clear}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 1 of 5</p>
      <h2 className="stage-card__title">
        {mode === "confirmed" ? "Area confirmed" : "Review the area"}
      </h2>

      {metrics ? (
        <>
          <dl className="metric-list">
            <div>
              <dt>Area</dt>
              <dd>{formatArea(metrics.areaM2)}</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{metrics.perimeterM.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>Centroid</dt>
              <dd>
                {metrics.centroid.lat.toFixed(5)}°, {metrics.centroid.lng.toFixed(5)}°
              </dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd>{vertices.length}</dd>
            </div>
          </dl>
          {!metrics.valid && <p className="stage-card__warning" role="alert">{metrics.issue}</p>}
        </>
      ) : (
        <p className="stage-card__body">Add at least 3 points to compute an area.</p>
      )}

      {mode === "editing" && (
        <p className="stage-card__hint">
          <PencilRuler size={14} strokeWidth={1.75} aria-hidden="true" />
          Drag a point to adjust. Right-click a point to delete it.
        </p>
      )}

      <div className="stage-card__actions">
        <button type="button" className="btn" onClick={selection.undo} disabled={historyDepth === 0}>
          <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
          Undo
        </button>
        <button type="button" className="btn" onClick={selection.redraw}>
          <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
          {mode === "confirmed" ? "Redraw" : "Clear"}
        </button>
        {mode === "editing" ? (
          <button type="button" className="btn btn--primary" onClick={selection.confirm} disabled={!metrics?.valid}>
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            Confirm selection
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={selection.enterEditing}>
              Edit
            </button>
            <button type="button" className="btn btn--primary" onClick={onStartValidate}>
              Continue to Validate
            </button>
          </>
        )}
      </div>
    </div>
  );
}
