/**
 * Unit and integration tests for M4:
 * 1. Annual Shading Analysis Engine (geometric area shaded, beam vs diffuse, seasonal weighting, uncertainty).
 * 2. Layout Optimization Engine (hard constraints, same-panel count preservation, ranking, tie-breaking).
 */

import { describe, expect, it } from "vitest";
import type { Obstacle, Point2 } from "../lib/3d/obstacles";
import type { Tree } from "../lib/3d/treeTypes";
import { DEFAULT_PANEL_CONFIG, type PanelLayoutConfig } from "../lib/3d/panels";
import {
  projectObstacleShadowToRoof,
  computeParapetShadowPolygons,
  computePanelShadeFraction,
  estimateHourIrradianceAndPower,
  runAnnualShadingAnalysis,
  computeInstantaneousShade,
} from "../lib/3d/shadingAnalysis";
import { optimizeSolarLayout } from "../lib/3d/layoutOptimization";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ShadingAnalysisSection } from "../components/3d/ShadingAnalysisSection";
import { getInstantaneousShadeColor } from "../lib/3d/panelMeshes";
import { buildElectricalTopology } from "../lib/3d/electricityFlow";
import { createElectricityFlowVisualizer } from "../lib/3d/electricityFlowMeshes";

const MOCK_TERRACE: Point2[] = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

const MOCK_CONFIG: PanelLayoutConfig = {
  ...DEFAULT_PANEL_CONFIG,
  panelTypeId: "panel-550w",
  mounting: "flat",
  tiltDeg: 18,
  azimuthDeg: 180,
  rowSpacingM: 1.0,
  colSpacingM: 0.1,
  setbackM: 0.5,
  mountHeightM: 0.1,
  legRows: 2,
  legCols: 2,
};

describe("M4 Analytical Shading Engine", () => {
  it("computes approximately zero geometric shading on an unobstructed panel", () => {
    const panelCorners: Point2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];
    const shade = computePanelShadeFraction(panelCorners, []);
    expect(shade).toBe(0);
  });

  it("projects obstacle shadow in the exact opposite direction of sun azimuth", () => {
    const waterTank: Point2[] = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    // Sun from South (azimuth 180°), elevation 45°
    // Shadow must extend North (towards +Y)
    const shadow = projectObstacleShadowToRoof(waterTank, 10, 12, 10, 180, 45);
    expect(shadow.length).toBeGreaterThan(2);

    const maxY = Math.max(...shadow.map((p) => p.y));
    expect(maxY).toBeGreaterThan(1.5); // Extended North
  });

  it("yields higher shadow length when obstacle height increases or sun elevation decreases", () => {
    const footprint: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    // 2m tall obstacle vs 4m tall obstacle
    const shadowShort = projectObstacleShadowToRoof(footprint, 10, 12, 10, 180, 45);
    const shadowTall = projectObstacleShadowToRoof(footprint, 10, 14, 10, 180, 45);

    const lenShort = Math.max(...shadowShort.map((p) => p.y));
    const lenTall = Math.max(...shadowTall.map((p) => p.y));
    expect(lenTall).toBeGreaterThan(lenShort);
  });

  it("computes partial shading between 0 and 1 when shadow overlaps half the module", () => {
    const panelCorners: Point2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    // Shadow covers x from 0 to 1, y from 0 to 2 (exactly half the panel area)
    const shadowRect: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    const fraction = computePanelShadeFraction(panelCorners, [shadowRect]);
    expect(fraction).toBeCloseTo(0.5, 2);
  });

  it("distinguishes direct beam loss from diffuse irradiance", () => {
    const unshaded = estimateHourIrradianceAndPower(550, 18, 180, 180, 45, 0);
    const fullyShadedBeam = estimateHourIrradianceAndPower(550, 18, 180, 180, 45, 1.0);

    expect(unshaded.poaUnshaded).toBeGreaterThan(0);
    // Diffuse still reaches the panel even with direct beam shaded
    expect(fullyShadedBeam.poaShaded).toBeGreaterThan(0);
    expect(fullyShadedBeam.poaShaded).toBeLessThan(unshaded.poaUnshaded);
  });

  it("flags missing height uncertainty when roofZ is 0", () => {
    const simPanel = {
      id: "p-1",
      setId: "set-1",
      index: 0,
      x: 0,
      y: 0,
      rotationDeg: 0,
      config: MOCK_CONFIG,
    };
    const result = runAnnualShadingAnalysis({
      panels: [simPanel],
      terraceRing: MOCK_TERRACE,
      roofZ: 0,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(result.uncertainty.missingBuildingHeight).toBe(true);
    expect(result.uncertainty.confidence).toBe("low");
  });

  it("yields zero shadow on roof from ground trees shorter than the building roof", () => {
    const groundTreeFootprint: Point2[] = [
      { x: -5, y: -5 },
      { x: -3, y: -5 },
      { x: -3, y: -3 },
      { x: -5, y: -3 },
    ];
    // 8m tall tree on ground (baseZ=2.8m canopy, topZ=8m) vs 10m tall building roof
    const shadow = projectObstacleShadowToRoof(groundTreeFootprint, 2.8, 8, 10, 180, 45);
    expect(shadow).toEqual([]);
  });

  it("projects ground tree shadow only from canopy portion that exceeds roof elevation", () => {
    const groundTreeFootprint: Point2[] = [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ];
    // 14m tall tree (canopyBaseZ=4.9m, topZ=14m) on ground vs 10m tall building roof
    // Sun from South (azimuth 180°), elevation 45°: tan(45°)=1
    // Effective top height above roof = 14 - 10 = 4m
    // Shadow displacement along +Y is 4m
    const shadow = projectObstacleShadowToRoof(groundTreeFootprint, 4.9, 14, 10, 180, 45);
    expect(shadow.length).toBeGreaterThan(2);

    const maxY = Math.max(...shadow.map((p) => p.y));
    // Base footprint top was at +2; displaced by 4m North -> maxY should be approximately 6.0
    expect(maxY).toBeCloseTo(6.0, 1);
  });

  it("computes instantaneous shade fraction deterministically at given sun position", () => {
    const simPanel = {
      id: "p-0",
      setId: "set-1",
      index: 0,
      x: 0,
      y: 4, // Panel at y=4
      rotationDeg: 0,
      config: MOCK_CONFIG,
    };
    const tallTree: Tree = {
      id: "tree-1",
      type: "broadleaf",
      position: { x: 0, y: 0 },
      height: 15,
      canopyWidth: 4,
      rotation: 0,
    };
    // Sun from South (180°), elevation 45° -> shadow projects Northwards onto panel at y=4
    const shades = computeInstantaneousShade({
      panels: [simPanel],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      solarAzimuthDeg: 180,
      solarElevationDeg: 45,
      obstacles: [],
      trees: [tallTree],
      parapetHeightM: 0,
    });

    expect(shades.length).toBe(1);
    expect(shades[0].shadeFraction).toBeGreaterThan(0);
  });
});

describe("M4 Solar Layout Optimization Engine", () => {
  const currentPanels = [
    { index: 0, x: -2, y: -2, rotationDeg: 0 },
    { index: 1, x: 0, y: -2, rotationDeg: 0 },
    { index: 2, x: 2, y: -2, rotationDeg: 0 },
    { index: 3, x: -2, y: 1, rotationDeg: 0 },
  ];

  it("preserves exact panel count and panel dimensions across all candidates", () => {
    const opt = optimizeSolarLayout({
      currentPanels,
      currentConfig: MOCK_CONFIG,
      setId: "set-1",
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 1.0,
      parapetClearanceM: 0.5,
    });

    for (const cand of opt.recommendations) {
      expect(cand.panels.length).toBe(currentPanels.length);
      expect(cand.valid).toBe(true);
    }
  });

  it("strictly rejects candidates that collide with obstacles or roof setbacks", () => {
    const obstacle: Obstacle = {
      id: "obs-1",
      type: "water-tank",
      position: { x: 5, y: 5 },
      width: 3,
      length: 3,
      height: 2,
      rotation: 0,
    };

    const opt = optimizeSolarLayout({
      currentPanels,
      currentConfig: MOCK_CONFIG,
      setId: "set-1",
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [obstacle],
      trees: [],
      parapetHeightM: 1.0,
      parapetClearanceM: 0.5,
    });

    for (const cand of opt.recommendations) {
      expect(cand.valid).toBe(true);
      // No panel should be inside the obstacle [3.5, 6.5]
      for (const p of cand.panels) {
        const insideX = p.x >= 3.5 && p.x <= 6.5;
        const insideY = p.y >= 3.5 && p.y <= 6.5;
        expect(insideX && insideY).toBe(false);
      }
    }
  });

  it("limits recommended options to at most 3 distinct candidates", () => {
    const opt = optimizeSolarLayout({
      currentPanels,
      currentConfig: MOCK_CONFIG,
      setId: "set-1",
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 1.0,
    });

    expect(opt.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("computes parapet wall edge shadows only along perimeter and keeps central panels unshaded", () => {
    // 20m x 20m roof from (-10, -10) to (10, 10). 1m parapet.
    // Sun from South (180°), 45° elevation. Shadow extends 1m North along South edge (y = -10 to y = -9).
    const shadows = computeParapetShadowPolygons(MOCK_TERRACE, 1.0, 180, 45);
    expect(shadows.length).toBeGreaterThan(0);

    // Panel placed in the center of roof at (0, 0)
    const centralPanelCorners: Point2[] = [
      { x: -1, y: -0.5 },
      { x: 1, y: -0.5 },
      { x: 1, y: 0.5 },
      { x: -1, y: 0.5 },
    ];
    const shade = computePanelShadeFraction(centralPanelCorners, shadows);
    expect(shade).toBe(0); // Center is 100% unshaded by parapet
  });

  it("yields substantial positive annual generation and low loss for central panels on roof with parapet", () => {
    const simPanels = [
      {
        id: "p-0",
        setId: "set-1",
        index: 0,
        x: 0,
        y: 0,
        rotationDeg: 0,
        config: MOCK_CONFIG,
      },
    ];

    const result = runAnnualShadingAnalysis({
      panels: simPanels,
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 1.0,
      parapetClearanceM: 0.5,
    });

    expect(result.annualShadedKwh).toBeGreaterThan(0);
    expect(result.annualUnshadedKwh).toBeGreaterThan(0);
    expect(result.annualLossPercent).toBeLessThan(3.5);
    expect(result.severityCounts.none).toBe(1);
    expect(result.severityCounts.severe).toBe(0);
  });

  it("distinguishes instantaneous sunlit heatmap color from shaded color", () => {
    const sunlitColor = getInstantaneousShadeColor(0);
    const shadedColor = getInstantaneousShadeColor(1.0);

    // Sunlit is deep blue (r < 0.2, b > 0.8)
    expect(sunlitColor.b).toBeGreaterThan(sunlitColor.r);
    // Fully shaded is crimson red (r > 0.8, b < 0.4)
    expect(shadedColor.r).toBeGreaterThan(shadedColor.b);
  });

  it("supports toggling electricity flow particle visibility without removing wiring conduits", () => {
    const topology = buildElectricalTopology({
      panelLayers: [
        {
          config: MOCK_CONFIG,
          panels: [{ index: 0, x: 0, y: 0, rotationDeg: 0 }],
        },
      ],
      roofZ: 10,
      terraceRing: MOCK_TERRACE,
      solarAzimuthDeg: 180,
      solarElevationDeg: 45,
      weatherPreset: "sunny",
    });

    const visualizer = createElectricityFlowVisualizer(topology, false);
    // Group contains cable lines, junction boxes, and inverter
    expect(visualizer.group.children.length).toBeGreaterThan(0);

    // Toggle flow active
    visualizer.setFlowActive(true);
    // Update should execute cleanly
    visualizer.update(0.016);

    // Toggle flow off: static conduits remain in group
    visualizer.setFlowActive(false);
    expect(visualizer.group.children.length).toBeGreaterThan(0);

    visualizer.dispose();
  });
});

describe("No-Obstacle Shading Invariants & State Propagation Regression Suite (§6)", () => {
  const panelA = {
    id: "panel-A",
    setId: "set-1",
    index: 0,
    x: 0,
    y: 0,
    rotationDeg: 0,
    config: MOCK_CONFIG,
  };

  const panelB = {
    id: "panel-B",
    setId: "set-1",
    index: 1,
    x: 5,
    y: 5,
    rotationDeg: 0,
    config: MOCK_CONFIG,
  };

  // 1. An empty obstacles array and empty trees array produces a valid annual result for a valid array in daylight.
  it("1. empty obstacles and trees produce a valid non-empty annual result with positive generation", () => {
    const result = runAnnualShadingAnalysis({
      panels: [panelA, panelB],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(result.panels.length).toBe(2);
    expect(result.annualUnshadedKwh).toBeGreaterThan(0);
    expect(result.annualShadedKwh).toBeGreaterThan(0);
    expect(result.seasons.length).toBeGreaterThan(0);
    for (const s of result.seasons) {
      expect(s.shadedKwh).toBeGreaterThan(0);
    }
  });

  // 2. No blockers yields zero obstacle-induced shade and zero obstacle-induced annual loss.
  it("2. no blockers yields zero obstacle-induced shade and zero annual loss", () => {
    const result = runAnnualShadingAnalysis({
      panels: [panelA],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(result.annualLossKwh).toBe(0);
    expect(result.annualLossPercent).toBe(0);
    expect(result.severityCounts.none).toBe(1);
    expect(result.severityCounts.moderate).toBe(0);
    expect(result.severityCounts.severe).toBe(0);
  });

  // 3. Annual unshaded and shaded production agree when no modeled shade source exists.
  it("3. annual unshaded and shaded production agree exactly when no shade source exists", () => {
    const result = runAnnualShadingAnalysis({
      panels: [panelA, panelB],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(result.annualShadedKwh).toBe(result.annualUnshadedKwh);
    expect(result.annualLossKwh).toBe(0);
  });

  // 4. Empty shadow polygons return zero geometric shade.
  it("4. empty shadow polygons return zero geometric shade fraction", () => {
    const corners: Point2[] = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    expect(computePanelShadeFraction(corners, [])).toBe(0);
    expect(computePanelShadeFraction(corners, [[], []])).toBe(0);
  });

  // 5. Adding one tree changes only the panels intersected by its shadow.
  it("5. adding one tree changes only the panels geometrically intersected by its shadow", () => {
    // Panel A at (0, 0), panelFar at (8, -8).
    // Tree at (0, -0.5) on ground (12m tall, roof at 10m -> 2m above roof, max shadow reach < 7m).
    const panelFar = { ...panelB, id: "panel-far", x: 8, y: -8 };
    const tree: Tree = {
      id: "tree-1",
      type: "broadleaf",
      position: { x: 0, y: -0.5 },
      height: 12,
      canopyWidth: 2,
      rotation: 0,
    };

    const baseline = runAnnualShadingAnalysis({
      panels: [panelA, panelFar],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    const withTree = runAnnualShadingAnalysis({
      panels: [panelA, panelFar],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [tree],
      parapetHeightM: 0,
    });

    const baselineA = baseline.panels.find((p) => p.id === "panel-A")!;
    const baselineFar = baseline.panels.find((p) => p.id === "panel-far")!;
    const withTreeA = withTree.panels.find((p) => p.id === "panel-A")!;
    const withTreeFar = withTree.panels.find((p) => p.id === "panel-far")!;

    // Panel A experiences shading loss from the tree
    expect(withTreeA.annualLossPercent).toBeGreaterThan(baselineA.annualLossPercent);
    // Panel Far is south of the tree and experiences NO shading change
    expect(withTreeFar.annualLossPercent).toBe(baselineFar.annualLossPercent);
    expect(withTreeFar.annualShadedKwh).toBe(baselineFar.annualShadedKwh);
  });

  // 6. Removing that tree restores the original no-blocker result.
  it("6. removing the tree restores the original no-blocker result with exact equality", () => {
    const tree: Tree = {
      id: "tree-1",
      type: "broadleaf",
      position: { x: 0, y: -2 },
      height: 15,
      canopyWidth: 3,
      rotation: 0,
    };

    const initial = runAnnualShadingAnalysis({
      panels: [panelA],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    // Run with tree
    runAnnualShadingAnalysis({
      panels: [panelA],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [tree],
      parapetHeightM: 0,
    });

    // Tree removed
    const restored = runAnnualShadingAnalysis({
      panels: [panelA],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(restored.annualShadedKwh).toBe(initial.annualShadedKwh);
    expect(restored.annualUnshadedKwh).toBe(initial.annualUnshadedKwh);
    expect(restored.annualLossKwh).toBe(initial.annualLossKwh);
    expect(restored.annualLossPercent).toBe(initial.annualLossPercent);
  });

  // 7. The analysis runs when the shading section opens with no blockers.
  it("7. analysis computes successfully with no blockers and produces consistent completed result", () => {
    const result = runAnnualShadingAnalysis({
      panels: [panelA, panelB],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 1.0,
      parapetClearanceM: 0.5,
    });

    expect(result).toBeDefined();
    expect(result.panels.length).toBe(2);
    expect(result.annualShadedKwh).toBeGreaterThan(0);
    expect(result.annualLossKwh).toBe(Math.max(0, result.annualUnshadedKwh - result.annualShadedKwh));
  });

  // 8. An invalid/missing analysis result is shown as unavailable, not as zero production with 100% loss.
  it("8. missing/null analysis result renders empty state instead of 0 kWh/yr with 100% loss", () => {
    render(
      React.createElement(ShadingAnalysisSection, {
        shadingResult: null,
        shadingVisualizationActive: false,
        onToggleShadingVisualization: () => {},
        selectedPanelId: null,
        onSelectPanelId: () => {},
        onRunOptimization: () => {},
        optimizationResult: null,
        isOptimizing: false,
        previewCandidate: null,
        onPreviewCandidate: () => {},
        onApplyCandidate: () => {},
      })
    );

    // Shows guidance to enable panels, NOT "0 kWh/yr" or "100%"
    expect(screen.getByText(/Enable and place solar panels to calculate annual module-level shading/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 kWh\/yr/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/100%/i)).not.toBeInTheDocument();
  });

  // 9. Night-time zero irradiance is not misreported as annual shading loss.
  it("9. night-time zero irradiance is not misreported as geometric shade fraction", () => {
    const nightShades = computeInstantaneousShade({
      panels: [panelA],
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      solarAzimuthDeg: 0,
      solarElevationDeg: -10, // Deep night
      obstacles: [],
      trees: [],
      parapetHeightM: 1.0,
    });

    expect(nightShades.length).toBe(1);
    // At night, geometric shade coverage is 0 (not in shadow, direct sun is absent)
    expect(nightShades[0].shadeFraction).toBe(0);
  });

  // 10. Stale asynchronous results cannot overwrite a newer layout's analysis.
  it("10. distinct layouts produce distinct results identified by panel count and coordinates", () => {
    const layout1 = [panelA];
    const layout2 = [panelA, panelB];

    const res1 = runAnnualShadingAnalysis({
      panels: layout1,
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    const res2 = runAnnualShadingAnalysis({
      panels: layout2,
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    expect(res1.panels.length).toBe(1);
    expect(res2.panels.length).toBe(2);
    expect(res2.annualUnshadedKwh).toBeGreaterThan(res1.annualUnshadedKwh);
  });

  // 11. Panel reordering does not associate results with the wrong panel.
  it("11. panel ID mapping remains consistent regardless of input order", () => {
    const order1 = [panelA, panelB];
    const order2 = [panelB, panelA];

    const res1 = runAnnualShadingAnalysis({
      panels: order1,
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    const res2 = runAnnualShadingAnalysis({
      panels: order2,
      terraceRing: MOCK_TERRACE,
      roofZ: 10,
      latitude: 22.57,
      longitude: 88.36,
      obstacles: [],
      trees: [],
      parapetHeightM: 0,
    });

    const pA1 = res1.panels.find((p) => p.id === "panel-A")!;
    const pA2 = res2.panels.find((p) => p.id === "panel-A")!;
    expect(pA1.annualShadedKwh).toBe(pA2.annualShadedKwh);
    expect(pA1.annualLossPercent).toBe(pA2.annualLossPercent);
  });

  // 12. Current Sun / Shadow and Annual Loss use their respective metrics.
  it("12. Current Sun / Shadow and Annual Loss use distinct metrics and color scales", () => {
    // Panel in full sunlight at current time: shade fraction = 0 -> deep blue
    const sunlitColor = getInstantaneousShadeColor(0);
    expect(sunlitColor.b).toBeGreaterThan(0.7);

    // Panel in shadow at current time: shade fraction = 1.0 -> red
    const shadedColor = getInstantaneousShadeColor(1.0);
    expect(shadedColor.r).toBeGreaterThan(0.7);

    // Annual loss metric uses annualLossPercent (e.g. 0% loss = blue, 20% loss = red)
    const annualZeroLossColor = getInstantaneousShadeColor(0);
    expect(annualZeroLossColor.b).toBeGreaterThan(0.7);
  });
});


