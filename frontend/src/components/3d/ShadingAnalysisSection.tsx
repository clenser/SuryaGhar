/**
 * ShadingAnalysisSection: Module-Level Shading & Layout Optimization UI (M4)
 *
 * Provides:
 * 1. Shading visualization toggle (color-coded module surfaces by analytical loss severity).
 * 2. Annual & seasonal energy production summary (unshaded vs shaded kWh/yr, % loss).
 * 3. Individual module inspection (hover/selection reveals exact % shaded, peak shading, kWh loss).
 * 4. Layout optimization suite:
 *    - Generates up to 3 constrained alternatives preserving panel count.
 *    - Real-time preview of candidate without mutating active state.
 *    - Explicit confirmation to Apply candidate atomically.
 *    - Revert / Cancel preview cleanly.
 */

import React from "react";
import {
  Sun,
  Eye,
  Sparkles,
  Info,
  Compass,
  Zap,
  Loader2,
} from "lucide-react";
import type { AnnualShadingResult, AnalyzedPanel } from "../../lib/3d/shadingAnalysis";
import type { OptimizationCandidate, OptimizationResult } from "../../lib/3d/layoutOptimization";
import { compassDirection, type SolarResult } from "../../services/analysis";

export type HeatmapMode = "annual" | "instantaneous";

interface ShadingAnalysisSectionProps {
  shadingResult: AnnualShadingResult | null;
  shadingVisualizationActive: boolean;
  onToggleShadingVisualization: () => void;
  heatmapMode?: HeatmapMode;
  onChangeHeatmapMode?: (mode: HeatmapMode) => void;
  selectedPanelId: string | null;
  onSelectPanelId: (id: string | null) => void;
  onRunOptimization: () => void;
  optimizationResult: OptimizationResult | null;
  isOptimizing: boolean;
  previewCandidate: OptimizationCandidate | null;
  onPreviewCandidate: (cand: OptimizationCandidate | null) => void;
  onApplyCandidate: (cand: OptimizationCandidate) => void;

  /** Consolidated Weather-Resource and Orientation Analysis (pvlib / PVGIS) */
  solarResourceResult?: SolarResult | null;
  isLoadingSolarResource?: boolean;
  solarResourceError?: string | null;
  onFetchSolarResource?: () => void;
  onApplyRecommendedOrientation?: (tilt: number, azimuth: number) => void;

  /** Live simulation sun parameters for real-time shadow feedback */
  sunElevationDeg?: number;
  sunAzimuthDeg?: number;
  isNight?: boolean;
  isSimulatingSun?: boolean;
}

export const ShadingAnalysisSection: React.FC<ShadingAnalysisSectionProps> = ({
  shadingResult,
  shadingVisualizationActive,
  onToggleShadingVisualization,
  heatmapMode = "annual",
  onChangeHeatmapMode,
  selectedPanelId,
  onSelectPanelId,
  onRunOptimization,
  optimizationResult,
  isOptimizing,
  previewCandidate,
  onPreviewCandidate,
  onApplyCandidate,
  solarResourceResult,
  isLoadingSolarResource = false,
  solarResourceError = null,
  onFetchSolarResource,
  onApplyRecommendedOrientation,
  sunElevationDeg,
  sunAzimuthDeg,
  isNight = false,
  isSimulatingSun = false,
}) => {
  if (!shadingResult) {
    return (
      <div className="shading-empty" style={{ padding: "var(--space-3) 0", color: "var(--color-text-subtle)", fontSize: "0.85rem" }}>
        <p>Enable and place solar panels to calculate annual module-level shading and optimization.</p>
      </div>
    );
  }

  const selectedPanel: AnalyzedPanel | undefined = selectedPanelId
    ? shadingResult.panels.find((p) => p.id === selectedPanelId)
    : undefined;

  return (
    <div className="shading-analysis-section" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* 1. Visualization Mode Toggle & Color Legend */}
      <div
        className="shading-viz-card"
        style={{
          background: "var(--color-surface-sunken, rgba(0, 0, 0, 0.15))",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}>
            <Sun size={15} style={{ color: "var(--color-primary, #38bdf8)" }} />
            Module Heatmap Overlay
          </span>
          <button
            type="button"
            className={`btn ${shadingVisualizationActive ? "btn--primary" : "btn--secondary"}`}
            style={{ fontSize: "0.75rem", padding: "4px 10px", minHeight: "28px" }}
            onClick={onToggleShadingVisualization}
            aria-pressed={shadingVisualizationActive}
          >
            <Eye size={13} style={{ marginRight: "4px" }} />
            {shadingVisualizationActive ? "Overlay Active" : "Show Heatmap"}
          </button>
        </div>

        {/* View Mode Selector: Annual Shading Loss vs Current Sun Shadow */}
        {onChangeHeatmapMode && (
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            <button
              type="button"
              className={`btn ${heatmapMode === "annual" ? "btn--primary" : "btn--secondary"}`}
              style={{ flex: 1, fontSize: "0.72rem", padding: "3px 6px", minHeight: "26px" }}
              onClick={() => onChangeHeatmapMode("annual")}
            >
              Annual Loss (%)
            </button>
            <button
              type="button"
              className={`btn ${heatmapMode === "instantaneous" ? "btn--primary" : "btn--secondary"}`}
              style={{ flex: 1, fontSize: "0.72rem", padding: "3px 6px", minHeight: "26px" }}
              onClick={() => onChangeHeatmapMode("instantaneous")}
            >
              Current Sun / Shadow
            </button>
          </div>
        )}

        {heatmapMode === "instantaneous" && (
          <div
            style={{
              padding: "5px 8px",
              background: isNight ? "rgba(30, 41, 59, 0.6)" : "rgba(56, 189, 248, 0.12)",
              borderRadius: "5px",
              border: isNight ? "1px solid rgba(148, 163, 184, 0.25)" : "1px solid rgba(56, 189, 248, 0.25)",
              fontSize: "0.72rem",
              color: isNight ? "var(--color-warning, #f59e0b)" : "var(--color-primary, #38bdf8)",
              marginBottom: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {isNight
                ? "Night: Sun below horizon (panels in night state)"
                : `Live Sun: ${sunElevationDeg !== undefined ? Math.round(sunElevationDeg * 10) / 10 : 0}° elevation · Azimuth ${sunAzimuthDeg !== undefined ? Math.round(sunAzimuthDeg * 10) / 10 : 0}°`}
            </span>
            {isSimulatingSun && (
              <span style={{ fontSize: "0.68rem", opacity: 0.9, fontWeight: 600 }}>Simulating Live</span>
            )}
          </div>
        )}

        {/* Continuous Heatmap Legend */}
        <div style={{ marginTop: "6px" }}>
          <div
            style={{
              height: 10,
              borderRadius: 5,
              background: "linear-gradient(to right, #1d4ed8 0%, #06b6d4 25%, #eab308 50%, #f97316 75%, #ef4444 100%)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
              marginBottom: 4,
            }}
            title={
              heatmapMode === "annual"
                ? "Continuous annual loss heatmap: 0% (deep blue) to >=20% (crimson red)"
                : "Instantaneous geometric shadow coverage: 0% unshaded (deep blue) to 100% full shadow (crimson red)"
            }
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.68rem",
              color: "var(--color-text-subtle, #94a3b8)",
              marginBottom: 8,
            }}
          >
            {heatmapMode === "annual" ? (
              <>
                <span>0% loss (blue)</span>
                <span>5% (cyan)</span>
                <span>10% (yellow)</span>
                <span>15% (orange)</span>
                <span>&ge;20% (red)</span>
              </>
            ) : (
              <>
                <span>0% (Sunlit)</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100% (Shaded)</span>
              </>
            )}
          </div>

          <div
            className="shading-legend"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "var(--space-1)",
              fontSize: "0.72rem",
              paddingTop: 6,
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }} title="Minimal shading (<3.5%)">
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1d4ed8", flexShrink: 0, display: "inline-block" }} />
              <span>&lt;3.5% ({shadingResult.severityCounts.none})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }} title="Moderate shading (3.5%–12%)">
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#06b6d4", flexShrink: 0, display: "inline-block" }} />
              <span>3.5–12% ({shadingResult.severityCounts.moderate})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }} title="Severe loss (>12%)">
              <span style={{ width: 8, height: 8, transform: "rotate(45deg)", background: "#ef4444", flexShrink: 0, display: "inline-block" }} />
              <span>&gt;12% ({shadingResult.severityCounts.severe})</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Annual Energy Production & Shading Loss Metrics */}
      <div
        className="shading-metrics-card"
        style={{
          background: "var(--color-surface-sunken, rgba(0, 0, 0, 0.15))",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-2)" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-subtle)", fontWeight: 500 }}>
            Estimated Annual Production
          </span>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text, #f1f5f9)" }}>
            {shadingResult.annualShadedKwh.toLocaleString()} <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>kWh/yr</span>
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", fontSize: "0.75rem", paddingTop: "var(--space-2)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
          <div>
            <span style={{ color: "var(--color-text-subtle)", display: "block" }}>Unshaded Baseline:</span>
            <span style={{ fontWeight: 600 }}>{shadingResult.annualUnshadedKwh.toLocaleString()} kWh/yr</span>
          </div>
          <div>
            <span style={{ color: "var(--color-text-subtle)", display: "block" }}>Annual Shading Loss:</span>
            <span style={{ fontWeight: 600, color: shadingResult.annualLossPercent > 5 ? "var(--color-warning, #f59e0b)" : "inherit" }}>
              {shadingResult.annualLossKwh.toLocaleString()} kWh ({shadingResult.annualLossPercent}%)
            </span>
          </div>
        </div>

        {/* Seasonal breakdown pill tabs */}
        <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-2)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--color-text-subtle)", marginBottom: "6px" }}>Seasonal Slices (Weighted):</div>
          <div style={{ display: "flex", gap: "4px", overflowX: "auto" }}>
            {shadingResult.seasons.map((s) => (
              <div
                key={s.id}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                  flex: "1 0 auto",
                  textAlign: "center",
                }}
              >
                <div style={{ color: "var(--color-text-subtle)" }}>{s.label.split(" ")[0]}</div>
                <div style={{ fontWeight: 600 }}>{s.shadedKwh} kWh</div>
                <div style={{ color: s.lossPercent > 5 ? "#e5a93c" : "#28a745", fontSize: "0.68rem" }}>-{s.lossPercent}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Uncertainty notice */}
        {shadingResult.uncertainty.notes.length > 0 && (
          <div style={{ marginTop: "var(--space-2)", display: "flex", gap: "5px", alignItems: "flex-start", fontSize: "0.7rem", color: "var(--color-text-subtle)" }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>{shadingResult.uncertainty.notes.join(" ")}</span>
          </div>
        )}
      </div>

      {/* 2b. Meteorological Weather Resource & Orientation Benchmark (pvlib / PVGIS) */}
      <div
        className="weather-resource-card"
        style={{
          background: "var(--color-surface-sunken, rgba(0, 0, 0, 0.15))",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}>
            <Compass size={15} style={{ color: "var(--color-primary, #38bdf8)" }} />
            Weather-Resource & Orientation (pvlib / PVGIS)
          </span>
          {onFetchSolarResource && (
            <button
              type="button"
              className="btn btn--secondary"
              style={{ fontSize: "0.72rem", padding: "3px 8px", minHeight: "26px" }}
              onClick={onFetchSolarResource}
              disabled={isLoadingSolarResource}
              title="Estimate meteorological yield and optimal orientation via pvlib + PVGIS"
            >
              {isLoadingSolarResource ? (
                <Loader2 size={12} className="spin" style={{ marginRight: "4px" }} aria-hidden="true" />
              ) : (
                <Zap size={12} style={{ marginRight: "4px" }} />
              )}
              {isLoadingSolarResource ? "Analysing…" : solarResourceResult ? "Refresh Benchmark" : "Analyse Weather Resource"}
            </button>
          )}
        </div>

        {isLoadingSolarResource && (
          <div style={{ padding: "var(--space-2) 0", fontSize: "0.75rem", color: "var(--color-text-subtle)" }}>
            <div className="progress-indeterminate" aria-hidden="true" style={{ marginBottom: "6px" }}><span /></div>
            Simulating regional meteorological yield with PVGIS TMY / pvlib for {shadingResult.installedCapacityKwp.toFixed(2)} kWp…
          </div>
        )}

        {solarResourceError && (
          <p className="stage-card__warning" role="alert" style={{ margin: "var(--space-1) 0", fontSize: "0.75rem" }}>
            {solarResourceError}
          </p>
        )}

        {!isLoadingSolarResource && !solarResourceResult && !solarResourceError && (
          <p style={{ margin: 0, fontSize: "0.73rem", color: "var(--color-text-subtle)" }}>
            Compare your 3D layout against regional meteorological TMY resource benchmarks and test alternative tilt/azimuth angles.
          </p>
        )}

        {solarResourceResult && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-2)" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--color-text-subtle)", fontWeight: 500 }}>
                Unshaded Weather Baseline
              </span>
              <span style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--color-text, #f1f5f9)" }}>
                {solarResourceResult.annual_kwh !== null
                  ? `≈ ${Math.round(solarResourceResult.annual_kwh).toLocaleString()} kWh/yr`
                  : "Unavailable"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", fontSize: "0.75rem", paddingTop: "var(--space-2)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <div>
                <span style={{ color: "var(--color-text-subtle)", display: "block" }}>Specific Yield:</span>
                <span style={{ fontWeight: 600 }}>
                  {solarResourceResult.specific_yield_kwh_kwp ? `${Math.round(solarResourceResult.specific_yield_kwh_kwp)} kWh/kWp` : "—"}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-subtle)", display: "block" }}>POA Insolation:</span>
                <span style={{ fontWeight: 600 }}>
                  {solarResourceResult.poa_kwh_m2 ? `${Math.round(solarResourceResult.poa_kwh_m2)} kWh/m²` : "—"}
                </span>
              </div>
            </div>

            {/* Recommended Orientation Box */}
            {solarResourceResult.selected.azimuth_deg !== undefined &&
              solarResourceResult.selected.tilt_deg !== undefined && (
                <div
                  style={{
                    marginTop: "var(--space-2)",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "rgba(56, 189, 248, 0.08)",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "0.75rem",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--color-text-subtle)", display: "block", fontSize: "0.7rem" }}>
                      Optimal Solar Orientation:
                    </span>
                    <b>
                      {compassDirection(solarResourceResult.selected.azimuth_deg)} {solarResourceResult.selected.azimuth_deg}° · Tilt {solarResourceResult.selected.tilt_deg}°
                    </b>
                  </div>
                  {onApplyRecommendedOrientation && (
                    <button
                      type="button"
                      className="btn btn--subtle"
                      style={{ fontSize: "0.72rem", padding: "3px 8px", minHeight: "24px" }}
                      onClick={() =>
                        onApplyRecommendedOrientation(
                          solarResourceResult.selected.tilt_deg!,
                          solarResourceResult.selected.azimuth_deg!,
                        )
                      }
                      title="Apply recommended optimal tilt and azimuth to the active 3D array"
                    >
                      Apply to 3D Layout
                    </button>
                  )}
                </div>
              )}

            {/* Candidate Tilt / Azimuth comparison bars */}
            {solarResourceResult.candidates.length > 0 && (
              <div style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-subtle)", marginBottom: "6px" }}>
                  Orientation Sweep ({solarResourceResult.candidates.length} angles tested):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {[...solarResourceResult.candidates]
                    .filter((c) => typeof c.annual_kwh === "number")
                    .sort((a, b) => (b.annual_kwh as number) - (a.annual_kwh as number))
                    .slice(0, 6)
                    .map((c, i) => {
                      const maxVal = Math.max(
                        ...solarResourceResult.candidates.map((x) => (typeof x.annual_kwh === "number" ? x.annual_kwh : 0)),
                      );
                      const pct = maxVal > 0 ? Math.round(((c.annual_kwh as number) / maxVal) * 100) : 0;
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.7rem",
                          }}
                        >
                          <span style={{ width: "70px", flexShrink: 0, color: "var(--color-text-subtle)" }}>
                            {c.tilt_deg}° / {c.azimuth_deg}°
                          </span>
                          <div style={{ flex: 1, background: "rgba(255, 255, 255, 0.06)", height: 6, borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, background: "var(--color-primary, #38bdf8)", height: "100%" }} />
                          </div>
                          <span style={{ width: "45px", textAlign: "right", fontWeight: 500 }}>
                            {Math.round((c.annual_kwh as number) / 1000)}k
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <p style={{ margin: "var(--space-2) 0 0 0", fontSize: "0.68rem", color: "var(--color-text-subtle)" }}>
              Data: {solarResourceResult.resource_provider} · Confidence: {solarResourceResult.confidence}. Accounts for regional solar irradiance, cell temperature derating, and inverter clipping without double-counting rooftop obstacle shading.
            </p>
          </>
        )}
      </div>

      {/* 3. Selected Module Inspection Details */}
      {selectedPanel && (
        <div
          className="selected-panel-card"
          style={{
            background: "var(--color-surface-sunken, rgba(0, 0, 0, 0.25))",
            padding: "var(--space-3)",
            borderRadius: "var(--radius-md, 8px)",
            border: "1px solid var(--color-primary, #38bdf8)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
            <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>
              Panel #{selectedPanel.panelIndex + 1} Shading Detail
            </span>
            <button
              type="button"
              className="btn btn--subtle"
              style={{ fontSize: "0.7rem", padding: "2px 6px", minHeight: "22px" }}
              onClick={() => onSelectPanelId(null)}
            >
              Close
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "0.75rem" }}>
            <div>
              <span style={{ color: "var(--color-text-subtle)" }}>Annual Output:</span>
              <div><b>{selectedPanel.annualShadedKwh} kWh/yr</b> (loss: {selectedPanel.annualLossPercent}%)</div>
            </div>
            <div>
              <span style={{ color: "var(--color-text-subtle)" }}>Peak Shading:</span>
              <div><b>{(selectedPanel.peakShadeFraction * 100).toFixed(0)}%</b> direct beam</div>
            </div>
            <div>
              <span style={{ color: "var(--color-text-subtle)" }}>Position:</span>
              <div>E {selectedPanel.center.x.toFixed(1)}m · N {selectedPanel.center.y.toFixed(1)}m</div>
            </div>
            <div>
              <span style={{ color: "var(--color-text-subtle)" }}>Severity:</span>
              <div style={{ textTransform: "capitalize", fontWeight: 600, color: selectedPanel.severity === "severe" ? "#d94b4b" : selectedPanel.severity === "moderate" ? "#e5a93c" : "#28a745" }}>
                {selectedPanel.severity}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Layout Optimization Suite */}
      <div
        className="optimization-card"
        style={{
          background: "var(--color-surface-sunken, rgba(0, 0, 0, 0.15))",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={15} style={{ color: "#f59e0b" }} />
            Solar Layout Optimization
          </span>
          <button
            type="button"
            className="btn btn--secondary"
            style={{ fontSize: "0.75rem", padding: "4px 10px", minHeight: "28px" }}
            onClick={onRunOptimization}
            disabled={isOptimizing}
          >
            {isOptimizing ? (
              <Loader2 size={13} className="spin" style={{ marginRight: "4px" }} aria-hidden="true" />
            ) : (
              <Sparkles size={13} style={{ marginRight: "4px", color: "#f59e0b" }} aria-hidden="true" />
            )}
            {isOptimizing ? "Optimizing…" : "Find Alternatives"}
          </button>
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--color-text-subtle)", margin: "0 0 var(--space-2) 0" }}>
          Recommends alternative arrangements to reduce obstacle shading and hotspot losses while preserving exact panel count and setbacks.
        </p>

        {/* Preview Banner */}
        {previewCandidate && (
          <div
            style={{
              background: "rgba(56, 189, 248, 0.12)",
              border: "1px solid var(--color-primary, #38bdf8)",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "6px",
              marginBottom: "var(--space-2)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: "0.78rem" }}>
              <span style={{ fontWeight: 600 }}>Previewing Alternative:</span> {previewCandidate.title}
              <div style={{ color: "var(--color-primary, #38bdf8)", fontWeight: 500 }}>
                +{previewCandidate.annualImprovementKwh} kWh/yr ({previewCandidate.annualImprovementPercent}%)
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className="btn btn--subtle"
                style={{ fontSize: "0.72rem", padding: "3px 8px", minHeight: "26px" }}
                onClick={() => onPreviewCandidate(null)}
              >
                Revert
              </button>
              <button
                type="button"
                className="btn btn--primary"
                style={{ fontSize: "0.72rem", padding: "3px 10px", minHeight: "26px" }}
                onClick={() => onApplyCandidate(previewCandidate)}
              >
                Apply Layout
              </button>
            </div>
          </div>
        )}

        {/* Recommendations list */}
        {optimizationResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            {optimizationResult.recommendations.length === 0 ? (
              <p style={{ fontSize: "0.75rem", color: "var(--color-text-subtle)", margin: 0 }}>
                {optimizationResult.searchMessage}
              </p>
            ) : (
              optimizationResult.recommendations.map((cand, idx) => {
                const isPreviewing = previewCandidate?.id === cand.id;
                return (
                  <div
                    key={cand.id}
                    style={{
                      background: isPreviewing ? "rgba(56, 189, 248, 0.08)" : "rgba(255, 255, 255, 0.03)",
                      border: isPreviewing ? "1px solid var(--color-primary, #38bdf8)" : "1px solid rgba(255, 255, 255, 0.06)",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      fontSize: "0.75rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 600 }}>Option {idx + 1}: {cand.title}</span>
                      <span style={{ fontWeight: 700, color: cand.annualImprovementKwh > 0 ? "#28a745" : "inherit" }}>
                        {cand.annualImprovementKwh > 0 ? `+${cand.annualImprovementKwh} kWh/yr` : "Equivalent yield"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "10px", fontSize: "0.72rem", color: "var(--color-primary, #38bdf8)", fontWeight: 500, marginBottom: "4px" }}>
                      <span>Capacity: {cand.installedCapacityKwp} kWp {cand.additionalCapacityKwp > 0 ? `(+${cand.additionalCapacityKwp} kW)` : `(${cand.panels.length} panels)`}</span>
                      <span>Output: {cand.annualProductionKwh.toLocaleString()} kWh/yr</span>
                    </div>
                    <p style={{ margin: "0 0 6px 0", color: "var(--color-text-subtle)", fontSize: "0.72rem" }}>
                      {cand.description}
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--color-text-subtle)", fontSize: "0.7rem" }}>
                        Hotspots: {cand.severeHotspotsCount} (baseline: {optimizationResult.currentBaseline.severeHotspotsCount})
                      </span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className={`btn ${isPreviewing ? "btn--primary" : "btn--secondary"}`}
                          style={{ fontSize: "0.7rem", padding: "2px 8px", minHeight: "24px" }}
                          onClick={() => onPreviewCandidate(isPreviewing ? null : cand)}
                        >
                          {isPreviewing ? "Previewing" : "3D Preview"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          style={{ fontSize: "0.7rem", padding: "2px 8px", minHeight: "24px" }}
                          onClick={() => onApplyCandidate(cand)}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
