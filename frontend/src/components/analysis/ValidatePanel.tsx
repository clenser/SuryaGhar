import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, Loader2, Play } from "lucide-react";
import { BACKEND_WAITING_LABEL } from "../../hooks/useBackendStatus";
import {
  SEGMENTATION_MODELS,
  fetchSegmentationModelStatus,
  type ModelStatusItem,
  type SegmentationModel,
  type ValidationResult,
} from "../../services/analysis";
import type { ValidationSnapshot } from "../../hooks/useValidation";
import { downloadBillOfMaterialsCSV, generateBillOfMaterials } from "../../lib/solar/bom";
import type { InstallationType, MountingType, PanelTypeId } from "../../lib/3d/panels";

interface ValidatePanelProps {
  /** Persisted validation state (owned by App, survives tab switches). */
  snapshot: ValidationSnapshot;
  /** Live wall-clock seconds while a request is in flight. */
  elapsed: number;
  segmentationModel: SegmentationModel;
  onSegmentationModelChange: (model: SegmentationModel) => void;
  onProceed: (model: SegmentationModel) => void;
  onContinue: () => void;
  onRedraw: () => void;
  /** Navigate back to Step 2 (3D building model). */
  onBackToModel?: () => void;
  /** Backend readiness: model browsing stays usable while false, but the
   * analysis request itself is locked until the server is ready. */
  backendReady: boolean;
  /** Optional initial model status map (tests or preloaded config). */
  initialModelStatuses?: Record<string, ModelStatusItem>;
  /** Optional placed panel count for Bill of Materials */
  panelCount?: number;
  panelTypeId?: PanelTypeId;
  mountingType?: MountingType;
  installationType?: InstallationType;
}

/** Stage 3: surface assessment. Pure view over persisted validation state:
 *  the user picks a model, then explicitly clicks "Proceed with analysis".
 *  Changing the selection alone never triggers a request, and unmounting
 *  (tab switch) never loses the result. */
export function ValidatePanel({
  snapshot: state,
  elapsed,
  segmentationModel,
  onSegmentationModelChange,
  onProceed,
  onContinue,
  onRedraw,
  onBackToModel,
  backendReady,
  initialModelStatuses,
  panelCount,
  panelTypeId,
  mountingType,
  installationType,
}: ValidatePanelProps) {
  // Draft selection only; committed to App on Proceed so it survives remounts.
  const [draft, setDraft] = useState<SegmentationModel>(segmentationModel);
  const [view, setView] = useState<"original" | "overlay" | "mask">("overlay");
  const [modelStatuses, setModelStatuses] = useState<Record<string, ModelStatusItem>>(initialModelStatuses ?? {});

  // Sync draft if parent segmentationModel prop changes externally
  useEffect(() => {
    setDraft(segmentationModel);
  }, [segmentationModel]);

  // Load readiness status of all selectable models from backend /config
  useEffect(() => {
    let active = true;
    if (!backendReady || initialModelStatuses) return;
    fetchSegmentationModelStatus()
      .then((items) => {
        if (!active) return;
        const map: Record<string, ModelStatusItem> = {};
        for (const item of items) {
          map[item.id] = item;
        }
        setModelStatuses(map);
      })
      .catch(() => {
        // Non-blocking; UI displays graceful fallback
      });
    return () => {
      active = false;
    };
  }, [backendReady]);

  const proceed = () => {
    onSegmentationModelChange(draft);
    onProceed(draft);
  };

  const handleSelectModel = (modelId: SegmentationModel) => {
    setDraft(modelId);
    onSegmentationModelChange(modelId);
  };

  const loadingLabel =
    state.kind === "loading" ? modelLabel(state.model) : modelLabel(draft);
  const showTimer = state.kind === "loading";

  const selectedModelStatus = modelStatuses[draft];
  const [isDownloadingBOM, setIsDownloadingBOM] = useState(false);
  const [isTransitioningFinal, setIsTransitioningFinal] = useState(false);

  const bomSummary = useMemo(() => {
    return generateBillOfMaterials({
      panelCount: panelCount ?? 12,
      panelTypeId: panelTypeId ?? "panel-550w",
      mountingType: mountingType ?? (installationType === "ground" ? "ground_fixed" : "tilted"),
      installationType: installationType ?? "rooftop",
    });
  }, [panelCount, panelTypeId, mountingType, installationType]);

  const bomSection = (
    <div
      className="stage-card"
      style={{
        padding: "var(--space-3)",
        marginTop: "var(--space-3)",
        marginBottom: "var(--space-3)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface-muted)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <FileSpreadsheet size={16} strokeWidth={2} style={{ color: "var(--color-primary, #10b981)" }} />
          <strong style={{ fontSize: "0.88rem" }}>Bill of Materials (BOM)</strong>
        </div>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "999px",
            background: "rgba(16, 185, 129, 0.15)",
            color: "var(--color-primary, #10b981)",
          }}
        >
          {bomSummary.totalCapacityKwp} kWp System
        </span>
      </div>
      <p className="stage-card__body" style={{ fontSize: "0.8rem", marginBottom: "var(--space-2)", color: "var(--color-text-muted)" }}>
        Download complete turnkey components list (ALMM solar modules, mounting structure, inverter, AC/DC cabling, protection boxes, earthing &amp; PM Surya Ghar subsidy) in CSV format.
      </p>

      {/* Financial & Capacity Summary Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          background: "var(--color-surface)",
          padding: "8px 10px",
          borderRadius: "6px",
          border: "1px solid var(--color-border)",
          marginBottom: "12px",
          fontSize: "0.75rem",
        }}
      >
        <div>
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>Modules</div>
          <strong style={{ color: "var(--color-text)" }}>{bomSummary.moduleCount} Nos</strong>
        </div>
        <div>
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>Est. Turnkey</div>
          <strong style={{ color: "var(--color-text)" }}>₹{bomSummary.grossTotalInr.toLocaleString("en-IN")}</strong>
        </div>
        <div>
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>
            {bomSummary.subsidyInr > 0 ? "Net Payable" : "Total (INR)"}
          </div>
          <strong style={{ color: "var(--color-primary, #10b981)" }}>
            ₹{bomSummary.netPayableInr.toLocaleString("en-IN")}
          </strong>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--secondary"
        disabled={isDownloadingBOM}
        onClick={() => {
          setIsDownloadingBOM(true);
          setTimeout(() => {
            try {
              downloadBillOfMaterialsCSV({
                panelCount: panelCount ?? 12,
                panelTypeId: panelTypeId ?? "panel-550w",
                mountingType: mountingType ?? (installationType === "ground" ? "ground_fixed" : "tilted"),
                installationType: installationType ?? "rooftop",
              });
            } finally {
              setIsDownloadingBOM(false);
            }
          }, 150);
        }}
        title="Download Bill of Materials CSV"
        style={{ width: "100%", justifyContent: "center" }}
      >
        {isDownloadingBOM ? (
          <Loader2 size={14} className="spin" aria-hidden="true" />
        ) : (
          <Download size={14} strokeWidth={2} aria-hidden="true" />
        )}
        {isDownloadingBOM ? "Generating CSV…" : "Download Bill of Materials (CSV)"}
      </button>
    </div>
  );

  return (
    <div className="stage-card stage-card--validate">
      <div className="stage-card__header-row">
        <p className="stage-card__eyebrow" style={{ margin: 0 }}>Stage 3 of 3</p>
        {onBackToModel && (
          <button
            type="button"
            className="btn btn--subtle"
            onClick={onBackToModel}
            title="Return to Step 2 (3D Building Model)"
          >
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            Back to Step 2
          </button>
        )}
      </div>
      <h2 className="stage-card__title">Surface assessment</h2>

      <div className="seg-switch" role="group" aria-label="Segmentation model">
        <span className="seg-switch__label">Segmentation model</span>
        <div className="seg-options" role="radiogroup" aria-label="Segmentation model options">
          {SEGMENTATION_MODELS.map((m) => {
            const st = modelStatuses[m.id];
            const isAvailable = st ? st.available : true;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={draft === m.id}
                className={`seg-option${draft === m.id ? " is-active" : ""}`}
                onClick={() => handleSelectModel(m.id)}
                disabled={state.kind === "loading"}
                title={st?.unavailable_reason ?? undefined}
              >
                <span className="seg-option__label">{m.label}</span>
                <span className="seg-option__hint">{m.hint}</span>
                {st && (
                  <span
                    className={`seg-option__badge ${
                      isAvailable ? "seg-option__badge--ready" : "seg-option__badge--warn"
                    }`}
                  >
                    {isAvailable ? "Ready" : "Unavailable"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedModelStatus && !selectedModelStatus.available && (
        <p className="stage-card__warning" role="status">
          <strong>{modelLabel(draft)} is currently unavailable:</strong>{" "}
          {selectedModelStatus.unavailable_reason ?? "Dependencies or weights are missing."}
        </p>
      )}

      <div className="stage-card__actions stage-card__actions--inline">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={proceed}
          disabled={state.kind === "loading" || !backendReady}
          title={backendReady ? undefined : BACKEND_WAITING_LABEL}
        >
          {state.kind === "loading" ? (
            <Loader2 size={15} className="spin" aria-hidden="true" />
          ) : (
            <Play size={15} strokeWidth={2} aria-hidden="true" />
          )}
          {state.kind === "loading" ? "Analyzing site..." : state.kind === "ok" ? "Re-analyze" : "Proceed with analysis"}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={onContinue}
          disabled={state.kind === "loading"}
          title="Proceed directly to the next step without running surface analysis"
        >
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          Proceed without analysis
        </button>
      </div>

      {showTimer && (
        <p className="stage-card__body" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Analyzing with {loadingLabel}… Elapsed {elapsed.toFixed(1)} s
        </p>
      )}
      {state.kind === "error" && (
        <>
          <p className="stage-card__warning" role="alert">{state.message}</p>
          <div className="stage-card__actions stage-card__actions--inline">
            <button
              type="button"
              className="btn"
              onClick={proceed}
              disabled={!backendReady}
              title={backendReady ? undefined : BACKEND_WAITING_LABEL}
            >
              Retry
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onContinue}
              title="Proceed directly to the next step without analysis"
            >
              Proceed without analysis
            </button>
            <button type="button" className="btn" onClick={onRedraw}>Back to selection</button>
          </div>
        </>
      )}

      {state.kind !== "ok" && bomSection}

      {state.kind === "ok" && (
        <>
          {state.result.segmentation && (
            <p className="result-note" aria-live="polite">
              Analysis completed in {state.result.segmentation.inference_time_seconds.toFixed(1)} s
            </p>
          )}
          {semanticAvailable(state.result) ? (
            <>
              <div className="result-hero">
                <span className="result-hero__value">
                  <Check size={18} strokeWidth={2.5} aria-hidden="true" className="result-hero__check" />
                  {labelFor(state.result.classification)}
                </span>
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
                    <span className="metric-caption">Detected from segmentation</span>
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
              <dl className="metric-list" aria-label="Model benchmark">
                <div>
                  <dt>Model</dt>
                  <dd>{shortModelLabel(state.result.segmentation?.display_name ?? state.result.providers?.segmentation)}</dd>
                </div>
                <div>
                  <dt>Device</dt>
                  <dd>{(state.result.segmentation?.device ?? "cpu").toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Analysis time</dt>
                  <dd>{state.result.segmentation ? `${state.result.segmentation.inference_time_seconds.toFixed(1)} s` : "—"}</dd>
                </div>
                <div>
                  <dt title="Share of the selected area covered by the model mask. Not accuracy: no ground-truth labels exist yet.">
                    Mask coverage
                  </dt>
                  <dd>{Math.round((state.result.evidence?.hotosm_building_fraction ?? 0) * 100)}%</dd>
                </div>
              </dl>
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
            <section aria-label="Visual results">
              <h3 className="section-heading">Visual results</h3>
              <div className="vis-thumbs" role="tablist" aria-label="Imagery views">
                {(["original", "overlay", "mask"] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    aria-label={`Show ${v} view`}
                    className={`vis-thumb${view === v ? " is-active" : ""}`}
                    onClick={() => setView(v)}
                  >
                    <img src={state.result.images![v]} alt="" aria-hidden="true" />
                    <span>{v === "original" ? "Original" : v === "overlay" ? "Overlay" : "Mask"}</span>
                  </button>
                ))}
              </div>
              <img
                src={state.result.images[view]}
                alt={`Imagery: ${view}`}
                className="vis-preview"
              />
            </section>
          )}

          {visibleWarnings(state.result).map((w) => (
            <p className="stage-card__warning" key={w}>{w}</p>
          ))}

          {bomSection}

          <div className="stage-card__actions stage-card__actions--footer">
            {onBackToModel && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onBackToModel}
                title="Return to Step 2 (3D Building Model)"
              >
                <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
                Back to Step 2
              </button>
            )}
            <button type="button" className="btn" onClick={onRedraw}>Review selection</button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setIsTransitioningFinal(true);
                const isTest =
                  (typeof process !== "undefined" && process.env?.NODE_ENV === "test") ||
                  Boolean(import.meta.env?.MODE === "test");
                if (isTest) {
                  try {
                    onContinue();
                  } finally {
                    setIsTransitioningFinal(false);
                  }
                } else {
                  setTimeout(() => {
                    try {
                      onContinue();
                    } finally {
                      setIsTransitioningFinal(false);
                    }
                  }, 25);
                }
              }}
              disabled={!backendReady || state.kind !== "ok" || isTransitioningFinal}
              title={backendReady ? "View final 3D solar model" : BACKEND_WAITING_LABEL}
            >
              {isTransitioningFinal ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : null}
              {isTransitioningFinal ? "Loading 3D Model…" : "View Final Model"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function modelLabel(model: SegmentationModel): string {
  return SEGMENTATION_MODELS.find((m) => m.id === model)?.label ?? model;
}

function segmentationDisplayName(provider: string | undefined): string {
  if (provider === "hotosm_dinov3s_buildings") return "HOTOSM Buildings";
  if (provider === "sam2_tiny") return "Tiny model";
  if (provider === "sam2_base_plus") return "Base+ model";
  if (provider === "sam2_large") return "Large model";
  return provider ?? "heuristic";
}

/** Backend display names are mapped to the short user-facing labels. */
function shortModelLabel(name: string | undefined): string {
  if (!name) return segmentationDisplayName(undefined);
  const lower = name.toLowerCase();
  if (lower.includes("base+")) return "Base+ model";
  if (lower.includes("large")) return "Large model";
  if (lower.includes("tiny")) return "Tiny model";
  return segmentationDisplayName(name);
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
