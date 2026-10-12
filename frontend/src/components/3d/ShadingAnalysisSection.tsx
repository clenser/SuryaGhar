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
} from "lucide-react";
import type { AnnualShadingResult, AnalyzedPanel } from "../../lib/3d/shadingAnalysis";
import type { OptimizationCandidate, OptimizationResult } from "../../lib/3d/layoutOptimization";

interface ShadingAnalysisSectionProps {
  shadingResult: AnnualShadingResult | null;
  shadingVisualizationActive: boolean;
  onToggleShadingVisualization: () => void;
  selectedPanelId: string | null;
  onSelectPanelId: (id: string | null) => void;
  onRunOptimization: () => void;
  optimizationResult: OptimizationResult | null;
  isOptimizing: boolean;
  previewCandidate: OptimizationCandidate | null;
  onPreviewCandidate: (cand: OptimizationCandidate | null) => void;
  onApplyCandidate: (cand: OptimizationCandidate) => void;
}

export const ShadingAnalysisSection: React.FC<ShadingAnalysisSectionProps> = ({
  shadingResult,
  shadingVisualizationActive,
  onToggleShadingVisualization,
  selectedPanelId,
  onSelectPanelId,
  onRunOptimization,
  optimizationResult,
  isOptimizing,
  previewCandidate,
  onPreviewCandidate,
  onApplyCandidate,
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
            Module Shading Overlay
          </span>
          <button
            type="button"
            className={`btn ${shadingVisualizationActive ? "btn--primary" : "btn--secondary"}`}
            style={{ fontSize: "0.75rem", padding: "4px 10px", minHeight: "28px" }}
            onClick={onToggleShadingVisualization}
            aria-pressed={shadingVisualizationActive}
          >
            <Eye size={13} style={{ marginRight: "4px" }} />
            {shadingVisualizationActive ? "Overlay Active" : "Color by Shading"}
          </button>
        </div>

        {/* Continuous Heatmap Legend */}
        <div style={{ marginTop: "10px" }}>
          <div
            style={{
              height: 10,
              borderRadius: 5,
              background: "linear-gradient(to right, #1d4ed8 0%, #06b6d4 25%, #eab308 50%, #f97316 75%, #ef4444 100%)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
              marginBottom: 4,
            }}
            title="Continuous annual loss heatmap: 0% (deep blue) to >=20% (crimson red)"
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
            <span>0% loss</span>
            <span>5% (cyan)</span>
            <span>10% (yellow)</span>
            <span>15% (orange)</span>
            <span>&ge;20% (red)</span>
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
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }} title="Low shading (<3.5%)">
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
            {isOptimizing ? "Optimizing..." : "Find Alternatives"}
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
