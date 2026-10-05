import { useEffect, useState } from "react";
import { validateSurface, type ValidationResult } from "../../services/analysis";
import type { LngLat } from "../../lib/geo";

interface ValidatePanelProps {
  vertices: LngLat[];
  onContinue: () => void;
  onRedraw: () => void;
}

/** Stage 2: surface validation (segmentation + optional Groq review). */
export function ValidatePanel({ vertices, onContinue, onRedraw }: ValidatePanelProps) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: ValidationResult }
  >({ kind: "loading" });
  const [view, setView] = useState<"original" | "overlay" | "mask">("overlay");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    validateSurface(vertices, controller.signal)
      .then((result) => setState({ kind: "ok", result }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Validation failed" });
      });
    return () => controller.abort();
  }, [vertices, retryKey]);

  const onRetry = () => setRetryKey((k) => k + 1);

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 2 of 5</p>
      <h2 className="stage-card__title">Surface assessment</h2>

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
            <div className="result-hero">
              <span className="result-hero__value">{labelFor(state.result.classification)}</span>
              <span className="result-hero__label">
                AI assessment · {Math.round(state.result.confidence * 100)}% confidence
                {state.result.confidence_detail?.overall_level ? ` (${String(state.result.confidence_detail.overall_level)})` : ""} ·{" "}
                {Math.round(state.result.coverage * 100)}% looks suitable for solar
              </span>
            </div>
          ) : (
            <div className="stage-card__warning" role="status">
              <strong>Surface assessment unavailable.</strong> AI semantic validation did not complete, so this
              selection has not been classified. Pixel and building-model data below are diagnostics only.
            </div>
          )}

          {state.result.evidence && (
            <dl className="metric-list" aria-label="Evidence">
              <div>
                <dt>Building evidence</dt>
                <dd>{Math.round((state.result.evidence.hotosm_building_fraction ?? 0) * 100)}% (HOTOSM)</dd>
              </div>
              <div>
                <dt>OSM overlap</dt>
                <dd>
                  {state.result.evidence.osm?.available
                    ? `${Math.round((state.result.evidence.osm.overlap_fraction ?? 0) * 100)}%`
                    : "unavailable"}
                </dd>
              </div>
              <div>
                <dt>OSM height</dt>
                <dd>
                  {state.result.evidence.osm?.median_height_m != null
                    ? `${state.result.evidence.osm.median_height_m} m`
                    : state.result.evidence.osm?.available
                      ? "not tagged"
                      : "unavailable"}
                </dd>
              </div>
              <div>
                <dt>Semantic assessment</dt>
                <dd>{aiValidationLabel(state.result.providers?.vision)}</dd>
              </div>
            </dl>
          )}

          {state.result.evidence?.vision?.reason && (
            <p className="result-note">{state.result.evidence.vision.reason}</p>
          )}

          {state.result.evidence?.supporting?.note && (
            <p className="result-note">Supporting evidence: {state.result.evidence.supporting.note}</p>
          )}

          {state.result.components && Object.keys(state.result.components).length > 0 && (
            <details>
              <summary className="result-note" style={{ cursor: "pointer" }}>
                Technical diagnostics ({state.result.providers?.segmentation ?? "heuristic"})
              </summary>
              <div className="bar-list" aria-label="Area composition">
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
            </details>
          )}

          {state.result.images && (
            <>
              <div className="stage-tabs" role="tablist" aria-label="Imagery views">
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

          {state.result.warnings.map((w) => (
            <p className="stage-card__warning" key={w}>{w}</p>
          ))}
          {state.result.providers && (
            <p className="result-note">
              {aiValidationLabel(state.result.providers.vision)} · Imagery: {state.result.providers.imagery}
            </p>
          )}
          {state.result.limitations && (
            <details>
              <summary className="result-note" style={{ cursor: "pointer" }}>Why this may be uncertain</summary>
              <ul className="result-note">
                {state.result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="stage-card__actions">
            <button type="button" className="btn" onClick={onRedraw}>Review selection</button>
            <button type="button" className="btn btn--primary" onClick={onContinue}>Continue to design</button>
          </div>
        </>
      )}
    </div>
  );
}

function semanticAvailable(result: ValidationResult): boolean {
  if (result.evidence?.semantic_available != null) return result.evidence.semantic_available;
  return result.providers?.vision === "groq" || result.providers?.vision === "gemini_fallback";
}

function aiValidationLabel(vision: string | undefined): string {
  if (vision === "groq") return "AI validation: Groq Vision";
  if (vision === "gemini_fallback") return "AI validation: Gemini Vision (fallback)";
  return "AI validation: unavailable (no surface classification made)";
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
