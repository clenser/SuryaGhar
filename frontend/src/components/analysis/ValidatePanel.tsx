import { useEffect, useState } from "react";
import {
  SEGMENTATION_MODELS,
  validateSurface,
  type SegmentationModel,
  type ValidationResult,
} from "../../services/analysis";
import type { LngLat } from "../../lib/geo";

interface ValidatePanelProps {
  vertices: LngLat[];
  segmentationModel: SegmentationModel;
  onSegmentationModelChange: (model: SegmentationModel) => void;
  onContinue: () => void;
  onRedraw: () => void;
}

/** Stage 2: surface assessment. Single card: classification, analysis
 *  confidence, building evidence, site interpretation, imagery, actions.
 *  Provider/model terminology stays out of the primary UI, except the
 *  debugging segmentation-model switcher and its diagnostics label. */
export function ValidatePanel({
  vertices,
  segmentationModel,
  onSegmentationModelChange,
  onContinue,
  onRedraw,
}: ValidatePanelProps) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: ValidationResult }
  >({ kind: "loading" });
  const [view, setView] = useState<"original" | "overlay" | "mask">("overlay");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    // The default model is conveyed by OMISSION: the backend default path
    // resolves HOTOSM on capable hosts and degrades to labeled heuristic on
    // hosts too small to survive heavy inference. Only an explicit non-default
    // choice (SAM 2.1 Tiny) is sent, and it is never silently replaced.
    validateSurface(vertices, segmentationModel === "hotosm_buildings" ? undefined : segmentationModel, controller.signal)
      .then((result) => setState({ kind: "ok", result }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Validation failed" });
      });
    return () => controller.abort();
  }, [vertices, segmentationModel, retryKey]);

  const onRetry = () => setRetryKey((k) => k + 1);

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 2 of 5</p>
      <h2 className="stage-card__title">Surface assessment</h2>

      <div className="seg-switch" role="group" aria-label="Segmentation model (debugging)">
        <span className="seg-switch__label">Segmentation model</span>
        <div className="stage-tabs stage-tabs--compact" role="tablist" aria-label="Segmentation model options">
          {SEGMENTATION_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={segmentationModel === m.id}
              className={segmentationModel === m.id ? "is-active" : ""}
              onClick={() => onSegmentationModelChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" && (
        <p className="stage-card__body" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Analyzing selected surface…
        </p>
      )}
      {state.kind === "error" && (
        <>
          <p className="stage-card__warning" role="alert">{state.message}</p>
          <div className="stage-card__actions">
            <button type="button" className="btn" onClick={onRetry}>Retry</button>
            <button type="button" className="btn" onClick={onRedraw}>Back to selection</button>
          </div>
        </>
      )}

      {state.kind === "ok" && (
        <>
          {semanticAvailable(state.result) ? (
            <>
              <div className="result-hero">
                <span className="result-hero__value">{labelFor(state.result.classification)}</span>
                <span className="result-hero__label">
                  Analysis confidence · {Math.round(state.result.confidence * 100)}%
                </span>
                {isSuitable(state.result.classification) && (
                  <span className="result-hero__label">Suitable for solar installation</span>
                )}
              </div>

              <dl className="metric-list" aria-label="Assessment metrics">
                <div>
                  <dt>Surface</dt>
                  <dd>{labelFor(state.result.classification)}</dd>
                </div>
                <div>
                  <dt title="Estimated proportion of the selected area identified as building footprint.">
                    Building evidence
                  </dt>
                  <dd title="Estimated proportion of the selected area identified as building footprint.">
                    {Math.round((state.result.evidence?.hotosm_building_fraction ?? 0) * 100)}%
                  </dd>
                </div>
              </dl>

              {state.result.evidence?.vision?.reason && (
                <p className="stage-card__body">{state.result.evidence.vision.reason}</p>
              )}
            </>
          ) : (
            <div className="stage-card__warning" role="status">
              <strong>Surface assessment unavailable.</strong> The selected area could not be
              classified, so no suitability result is shown.
            </div>
          )}

          {state.result.components && Object.keys(state.result.components).length > 0 && (
            <details>
              <summary className="result-note" style={{ cursor: "pointer" }}>
                Technical details
              </summary>
              <p className="result-note">
                Building segmentation evidence (supporting only — the classification above is
                authoritative and is never derived from these pixel shares).
                {state.result.evidence?.osm?.available &&
                  state.result.evidence.osm.overlap_fraction != null &&
                  ` Map building overlap: ${Math.round((state.result.evidence.osm.overlap_fraction ?? 0) * 100)}%.`}
                {state.result.evidence?.osm?.median_height_m != null &&
                  ` Map building height: ${state.result.evidence.osm.median_height_m} m.`}
              </p>
              <div className="bar-list" aria-label="Building segmentation evidence">
                {Object.entries(state.result.components).map(([name, fraction]) => (
                  <div className="bar-list__row" key={name}>
                    <span>{name}</span>
                    <span className="bar-list__track">
                      <span className="bar-list__fill" style={{ width: `${Math.round(fraction * 100)}%`, display: "block" }} />
                    </span>
                  <span>{Math.round(fraction * 100)}%</span>
                </div>
              ))}
              </div>
              {state.result.providers && (
                <p className="result-note">
                  Segmentation: {segmentationDisplayName(state.result.providers.segmentation)} · Imagery: {state.result.providers.imagery}
                </p>
              )}
            </details>
          )}

          {state.result.images && (
            <>
              <div className="stage-tabs stage-tabs--compact" role="tablist" aria-label="Imagery views">
                {(["original", "overlay", "mask"] as const).map((v) => (
                  <button key={v} role="tab" aria-selected={view === v} className={view === v ? "is-active" : ""} onClick={() => setView(v)}>
                    {v === "original" ? "Original" : v === "overlay" ? "Overlay" : "Mask"}
                  </button>
                ))}
              </div>
              <img
                src={state.result.images[view]}
                alt={`Imagery: ${view}`}
                style={{ width: "100%", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)", marginTop: 8 }}
              />
            </>
          )}

          {visibleWarnings(state.result).map((w) => (
            <p className="stage-card__warning" key={w}>{w}</p>
          ))}

          <div className="stage-card__actions">
            <button type="button" className="btn" onClick={onRedraw}>Review selection</button>
            <button type="button" className="btn btn--primary" onClick={onContinue}>Continue to design</button>
          </div>
        </>
      )}
    </div>
  );
}

function segmentationDisplayName(provider: string | undefined): string {
  if (provider === "hotosm_dinov3s_buildings") return "HOTOSM Buildings";
  if (provider === "sam2_tiny") return "SAM 2.1 Tiny";
  return provider ?? "heuristic";
}

function semanticAvailable(result: ValidationResult): boolean {
  if (result.evidence?.semantic_available != null) return result.evidence.semantic_available;
  return result.providers?.vision === "groq" || result.providers?.vision === "gemini_fallback";
}

function isSuitable(classification: string): boolean {
  return classification === "roof" || classification === "usable_ground";
}

/** Warnings exclude the site interpretation, which is already shown once above. */
function visibleWarnings(result: ValidationResult): string[] {
  const reason = result.evidence?.vision?.reason;
  return result.warnings.filter((w) => !reason || w !== reason);
}

function labelFor(classification: string): string {
  const labels: Record<string, string> = {
    roof: "Rooftop",
    usable_ground: "Usable ground",
    road: "Road",
    water: "Water",
    vegetation: "Vegetation",
    other: "Mixed surface",
    mixed: "Mixed selection",
    unknown: "Inconclusive",
  };
  return labels[classification] ?? classification;
}
