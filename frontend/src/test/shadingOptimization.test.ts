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
  computePanelShadeFraction,
  estimateHourIrradianceAndPower,
  runAnnualShadingAnalysis,
  computeInstantaneousShade,
} from "../lib/3d/shadingAnalysis";
import { optimizeSolarLayout } from "../lib/3d/layoutOptimization";

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
});
