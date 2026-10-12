/**
 * BuildingHeightPanel - Building Height Input Stage
 *
 * Stage 2 (Model): after the terrace is confirmed, the user enters the building
 * height in metres. That value drives the vertical extrusion of the 3D model.
 *
 * AGENTS.md §11: the user is prompted for building height in metres; the system
 * never pretends the height is known when it is not.
 * AGENTS.md §51: a positive, plausible height is required before proceeding.
 */

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Ruler, Box, AlertTriangle, Check } from "lucide-react";
import { BACKEND_WAITING_LABEL } from "../../hooks/useBackendStatus";
import type { LngLat, PolygonMetrics } from "../../lib/geo";
import { formatArea } from "../../lib/geo";
import { DEFAULT_BUILDING_HEIGHT_M, MAX_BUILDING_HEIGHT_M, MIN_BUILDING_HEIGHT_M, validateBuildingHeight } from "../../lib/3d/building";

interface BuildingHeightPanelProps {
  vertices: LngLat[];
  metrics: PolygonMetrics | null;
  onConfirm: (height: number) => void;
  /** Backend readiness: input stays usable while false, but creation locks until ready. */
  backendReady: boolean;
  /** Prefill the field (e.g. when editing an existing height). */
  initialHeight?: number;
}

const DEFAULT_HEIGHT = DEFAULT_BUILDING_HEIGHT_M; // Prefill for a new building

/** Parse the raw field value; an empty or non-numeric entry is NaN. */
function parseHeight(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

export function BuildingHeightPanel({
  vertices,
  metrics,
  onConfirm,
  backendReady,
  initialHeight,
}: BuildingHeightPanelProps) {
  const [rawHeight, setRawHeight] = useState(String(initialHeight ?? DEFAULT_HEIGHT));
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const height = parseHeight(rawHeight);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setRawHeight(next);
    // Once the user has tried to submit, keep validating live so a fixed
    // value clears the error without another click.
    if (submitted) setError(validateBuildingHeight(parseHeight(next)));
  };

  const handleBlur = () => {
    if (submitted) setError(validateBuildingHeight(height));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const err = validateBuildingHeight(height);
    setError(err);
    if (err) return;
    onConfirm(height);
  };

  const areaText = metrics ? formatArea(metrics.areaM2) : "—";
  const perimeterText = metrics ? `${metrics.perimeterM.toFixed(1)} m` : "—";
  const showHint =
    !error &&
    Number.isFinite(height) &&
    height >= MIN_BUILDING_HEIGHT_M &&
    height <= MAX_BUILDING_HEIGHT_M;

  return (
    <div className="stage-card">
      {/* noValidate: the range is enforced by our own messages so the user
          always sees an in-design explanation instead of a native bubble. */}
      <form onSubmit={handleSubmit} noValidate>
        <p className="stage-card__eyebrow">Stage 2 of 3</p>
        <h2 className="stage-card__title">Building height</h2>
        <p className="stage-card__body">
          Enter the building height to generate the 3D model. The terrace outline will be
          extruded vertically by this amount.
        </p>

        {/* Terrace summary (measured geometry, never estimated) */}
        <dl className="metric-list" style={{ marginBottom: "var(--space-3)" }}>
          <div>
            <dt>Terrace area</dt>
            <dd>{areaText}</dd>
          </div>
          <div>
            <dt>Perimeter</dt>
            <dd>{perimeterText}</dd>
          </div>
          <div>
            <dt>Vertices</dt>
            <dd>{vertices.length}</dd>
          </div>
        </dl>

        {/* Height input */}
        <div className="field" style={{ marginBottom: "var(--space-3)" }}>
          <label htmlFor="building-height" className="field-label">
            <Ruler size={14} strokeWidth={1.75} aria-hidden="true" />
            Building height (metres)
          </label>
          <div className="height-input-row">
            <input
              id="building-height"
              type="number"
              step="0.1"
              min={MIN_BUILDING_HEIGHT_M}
              max={MAX_BUILDING_HEIGHT_M}
              value={rawHeight}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={!backendReady}
              className={error ? "field-input--error" : ""}
              aria-describedby={error ? "height-error" : "height-hint"}
              aria-invalid={!!error}
              title={!backendReady ? BACKEND_WAITING_LABEL : undefined}
            />
            <span className="height-unit">m</span>
          </div>
          {error && (
            <p id="height-error" className="stage-card__warning" role="alert" style={{ marginTop: 4 }}>
              <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" />
              {error}
            </p>
          )}
          {showHint && (
            <p id="height-hint" className="result-note" style={{ marginTop: 4 }}>
              Will create a 3D building with {vertices.length}-sided terrace extruded to {height.toFixed(1)} m.
            </p>
          )}
        </div>

        {/* Visual preview of what will be created */}
        <div className="building-preview" style={{ marginTop: "var(--space-3)" }}>
          <Box size={32} strokeWidth={1.5} color="var(--color-primary)" aria-hidden="true" />
        </div>

        {/* Submit button */}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={!!error || !backendReady}
          title={!backendReady ? BACKEND_WAITING_LABEL : error ? undefined : "Create the 3D building model"}
        >
          {submitted && !error ? (
            <>
              <Check size={15} strokeWidth={2.5} aria-hidden="true" />
              Creating 3D model…
            </>
          ) : (
            <>
              <Box size={15} strokeWidth={2} aria-hidden="true" />
              Create 3D Building
            </>
          )}
        </button>

        {!backendReady && (
          <p className="readiness-lock" role="status" style={{ marginTop: "var(--space-2)" }}>
            <span className="readiness-lock__dot" aria-hidden="true" />
            {BACKEND_WAITING_LABEL} Height input works offline; creation needs the analysis server.
          </p>
        )}
      </form>
    </div>
  );
}
