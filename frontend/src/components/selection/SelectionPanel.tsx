import { useState } from "react";
import { MousePointerSquareDashed, Undo2, Trash2, Check, X, PencilRuler, Loader2 } from "lucide-react";
import { BACKEND_WAITING_LABEL } from "../../hooks/useBackendStatus";
import type { SelectionState } from "../../hooks/useSelection";
import { formatArea } from "../../lib/geo";
import type { InstallationType } from "../../lib/3d/panels";

interface SelectionPanelProps {
  selection: SelectionState;
  onStartValidate: () => void;
  /** Backend readiness: selection/editing stay usable while false, but the
   * transition into Validate is locked until the server is ready. */
  backendReady: boolean;
  /** Installation mode: rooftop (default) or ground-mounted (Phase 1). */
  installationType?: InstallationType;
  onInstallationTypeChange?: (type: InstallationType) => void;
}

/** Contextual selection stage panel (Milestone 2 workflow). */
export function SelectionPanel({
  selection,
  onStartValidate,
  backendReady,
  installationType = "rooftop",
  onInstallationTypeChange,
}: SelectionPanelProps) {
  const { mode, vertices, metrics, historyDepth } = selection;
  const isGround = installationType === "ground";

  const [isContinuing, setIsContinuing] = useState(false);

  const renderInstallationSelector = () => (
    <div className="panel-group" style={{ marginBottom: "0.85rem" }}>
      <span className="panel-group__label" id="installation-type-label">
        Installation Type
      </span>
      <div className="segmented" role="group" aria-labelledby="installation-type-label">
        <button
          type="button"
          className={`segmented__btn${!isGround ? " is-active" : ""}`}
          aria-pressed={!isGround}
          onClick={() => onInstallationTypeChange?.("rooftop")}
        >
          Rooftop
        </button>
        <button
          type="button"
          className={`segmented__btn${isGround ? " is-active" : ""}`}
          aria-pressed={isGround}
          onClick={() => onInstallationTypeChange?.("ground")}
        >
          Ground-mounted
        </button>
      </div>
    </div>
  );

  if (mode === "idle") {
    return (
      <div className="stage-card">
        <p className="stage-card__eyebrow">Stage 1 of 3</p>
        {renderInstallationSelector()}
        <h2 className="stage-card__title">
          {isGround ? "Select usable land to begin" : "Select a rooftop to begin"}
        </h2>
        <p className="stage-card__body">
          {isGround
            ? "Zoom to usable open land, then trace its perimeter. Draw at least three points — the outlined boundary becomes the solar site."
            : "Zoom to a rooftop or building terrace, then trace its boundary. Draw at least three points — the outlined area becomes the solar site."}
        </p>
        <button type="button" className="btn btn--primary" onClick={selection.start}>
          <MousePointerSquareDashed size={16} strokeWidth={1.75} aria-hidden="true" />
          {isGround ? "Select land area" : "Select area"}
        </button>
      </div>
    );
  }

  if (mode === "drawing") {
    return (
      <div className="stage-card">
        <p className="stage-card__eyebrow">Stage 1 of 3</p>
        {renderInstallationSelector()}
        <h2 className="stage-card__title">
          {isGround ? "Draw usable land boundary" : "Draw the boundary"}
        </h2>
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
      <p className="stage-card__eyebrow">Stage 1 of 3</p>
      {renderInstallationSelector()}
      <h2 className="stage-card__title">
        {mode === "confirmed"
          ? isGround
            ? "Land boundary confirmed"
            : "Area confirmed"
          : isGround
            ? "Review the land area"
            : "Review the area"}
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
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setIsContinuing(true);
                const isTest = (typeof process !== "undefined" && process.env?.NODE_ENV === "test") || Boolean(import.meta.env?.MODE === "test");
                if (isTest) {
                  onStartValidate();
                } else {
                  setTimeout(() => onStartValidate(), 25);
                }
              }}
              disabled={!backendReady || isContinuing}
              title={backendReady ? undefined : BACKEND_WAITING_LABEL}
            >
              {isContinuing ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : null}
              {isContinuing
                ? "Loading 3D workspace…"
                : isGround
                  ? "Continue to 3D workspace"
                  : "Continue to 3D model"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
