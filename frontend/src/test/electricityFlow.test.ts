/**
 * Tests for Electrical Flow Topology, Routing, and Mesh Visualization
 *
 * Requirements verified:
 * 1. Derives panel connection points from actual panel world transforms.
 * 2. Deterministic string grouping along rows/sets.
 * 3. Polyline distance table generation and smooth curve sampling.
 * 4. Production-intensity color mapping.
 * 5. Topology construction with valid branch, combiner trunk, and inverter routes.
 * 6. Clean lifecycle and disposal.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  getPanelConnectorPosition,
  groupPanelsIntoStrings,
  computeCumulativeDistances,
  samplePointAlongPolyline,
  buildElectricalTopology,
  computePanelInstantaneousPower,
  type PanelFlowData,
} from "../lib/3d/electricityFlow";
import {
  createElectricityFlowVisualizer,
  getFlowParticleColor,
} from "../lib/3d/electricityFlowMeshes";
import { DEFAULT_PANEL_CONFIG } from "../lib/3d/panels";
import type { PlacedPanel } from "../lib/3d/panelPlacement";
import { pointInPolygon, type Obstacle } from "../lib/3d/obstacles";

describe("Electrical Flow Topology & Routing", () => {
  const mockConfig = {
    ...DEFAULT_PANEL_CONFIG,
    panelTypeId: "panel-550w" as const,
    tiltDeg: 15,
    mountHeightM: 0.2,
  };

  it("calculates underside connector position matching physical panel transform", () => {
    const panel: PlacedPanel = {
      index: 0,
      x: 10,
      y: 5,
      rotationDeg: 180,
    };
    const roofZ = 12;

    const pos = getPanelConnectorPosition(panel, mockConfig, roofZ);

    // Connector must sit in the vicinity of panel footprint
    expect(pos.x).toBeCloseTo(panel.x, 0);
    expect(Math.abs(pos.y - panel.y)).toBeLessThan(1.2);
    // Elevation must sit above roof level (roofZ = 12)
    expect(pos.z).toBeGreaterThan(roofZ);
    // Elevation should be beneath or close to the panel face
    expect(pos.z).toBeLessThan(roofZ + 2.0);
  });

  it("deterministically groups panels into strings preserving row ordering", () => {
    const panels: PlacedPanel[] = Array.from({ length: 25 }, (_, i) => ({
      index: i,
      x: (i % 5) * 2,
      y: Math.floor(i / 5) * 3,
      rotationDeg: 0,
    }));

    const strings1 = groupPanelsIntoStrings(panels, 10);
    const strings2 = groupPanelsIntoStrings(panels, 10);

    expect(strings1.length).toBe(3); // 10, 10, 5
    expect(strings1).toEqual(strings2); // Deterministic

    const totalGrouped = strings1.reduce((sum, s) => sum + s.length, 0);
    expect(totalGrouped).toBe(25);
  });

  it("computes cumulative distances along a 3D polyline accurately", () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(3, 0, 0),
      new THREE.Vector3(3, 4, 0),
    ];
    const { cumulative, total } = computeCumulativeDistances(points);

    expect(total).toBeCloseTo(7, 4);
    expect(cumulative).toEqual([0, 3, 7]);
  });

  it("samples points along polyline smoothly across segment boundaries", () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
    ];
    const { cumulative, total } = computeCumulativeDistances(points);

    const mid = samplePointAlongPolyline(points, cumulative, total, 5);
    expect(mid.x).toBeCloseTo(5, 4);
    expect(mid.y).toBeCloseTo(0, 4);

    const wrapped = samplePointAlongPolyline(points, cumulative, total, 15);
    expect(wrapped.x).toBeCloseTo(5, 4);
  });

  it("builds complete electrical topology with branch, combiner and main routes", () => {
    const panels: PlacedPanel[] = [
      { index: 0, x: 2, y: 2, rotationDeg: 0 },
      { index: 1, x: 4, y: 2, rotationDeg: 0 },
      { index: 2, x: 6, y: 2, rotationDeg: 0 },
    ];
    const layer: PanelFlowData = {
      config: mockConfig,
      panels,
    };
    const terraceRing = [
      { x: -5, y: -5 },
      { x: 10, y: -5 },
      { x: 10, y: 10 },
      { x: -5, y: 10 },
    ];

    const topo = buildElectricalTopology({
      panelLayers: [layer],
      roofZ: 10,
      terraceRing,
    });

    expect(topo.combinerPositions.length).toBeGreaterThan(0);
    expect(topo.routes.length).toBeGreaterThan(0);
    expect(topo.endpointPosition.z).toBeGreaterThan(10);

    const branch = topo.routes.find((r) => r.type === "string-branch");
    const trunk = topo.routes.find((r) => r.type === "combiner-trunk");
    expect(branch).toBeDefined();
    expect(trunk).toBeDefined();
    expect(branch!.totalLength).toBeGreaterThan(0);
  });

  it("maps production intensity to the appropriate color spectrum", () => {
    const dim = getFlowParticleColor(0.1);
    const mid = getFlowParticleColor(0.5);
    const bright = getFlowParticleColor(0.95);

    // Dim has strong blue, low green
    expect(dim.b).toBeGreaterThan(dim.g);
    // Mid has balanced cyan-blue
    expect(mid.b).toBeGreaterThan(0.7);
    // Bright has high green and blue (cyan/white)
    expect(bright.g).toBeGreaterThan(0.8);
    expect(bright.b).toBeGreaterThan(0.9);
  });

  it("creates visualizer meshes, animates with delta time, and disposes cleanly", () => {
    const panels: PlacedPanel[] = [
      { index: 0, x: 0, y: 0, rotationDeg: 0 },
      { index: 1, x: 2, y: 0, rotationDeg: 0 },
    ];
    const layer: PanelFlowData = {
      config: mockConfig,
      panels,
    };
    const topo = buildElectricalTopology({
      panelLayers: [layer],
      roofZ: 10,
      terraceRing: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
    });

    const visualizer = createElectricityFlowVisualizer(topo);
    expect(visualizer.group.children.length).toBeGreaterThan(0);

    // Update with delta time
    expect(() => visualizer.update(0.016)).not.toThrow();

    // Dispose cleanly
    visualizer.dispose();
    expect(visualizer.group.children.length).toBe(0);
  });

  describe("Dynamic Instantaneous Power & Geometry Validation", () => {
    it("returns zero power during night (solar elevation <= 0)", () => {
      const nightPower = computePanelInstantaneousPower({
        solarElevationDeg: -5,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "sunny",
      });
      expect(nightPower).toBe(0.0);

      const zeroElevPower = computePanelInstantaneousPower({
        solarElevationDeg: 0,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "sunny",
      });
      expect(zeroElevPower).toBe(0.0);
    });

    it("scales power with solar elevation and incidence angle", () => {
      const highSunPower = computePanelInstantaneousPower({
        solarElevationDeg: 60,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "sunny",
      });

      const lowSunPower = computePanelInstantaneousPower({
        solarElevationDeg: 15,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "sunny",
      });

      expect(highSunPower).toBeGreaterThan(lowSunPower);
      expect(highSunPower).toBeGreaterThan(0.5);
    });

    it("attenuates power under direct shading and weather conditions", () => {
      const unshadedPower = computePanelInstantaneousPower({
        solarElevationDeg: 50,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "sunny",
      });

      const shadedPower = computePanelInstantaneousPower({
        solarElevationDeg: 50,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 1.0, // full shadow
        weatherPreset: "sunny",
      });

      const rainyPower = computePanelInstantaneousPower({
        solarElevationDeg: 50,
        solarAzimuthDeg: 180,
        panelTiltDeg: 20,
        panelAzimuthDeg: 180,
        shadeFraction: 0,
        weatherPreset: "rainy",
      });

      expect(shadedPower).toBeLessThan(unshadedPower);
      expect(shadedPower).toBeGreaterThan(0.0); // retains partial diffuse light
      expect(rainyPower).toBeLessThan(unshadedPower);
    });

    it("verifies designated inverter and routes stay strictly within usable roof polygon", () => {
      const terraceRing = [
        { x: -10, y: -8 },
        { x: 10, y: -8 },
        { x: 10, y: 8 },
        { x: -10, y: 8 },
      ];
      const panels: PlacedPanel[] = [
        { index: 0, x: -3, y: 0, rotationDeg: 0 },
        { index: 1, x: 0, y: 0, rotationDeg: 0 },
        { index: 2, x: 3, y: 0, rotationDeg: 0 },
      ];

      const topo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 15,
        terraceRing,
        solarElevationDeg: 45,
        solarAzimuthDeg: 180,
      });

      expect(topo.isValidRouting).toBe(true);

      // Verify designated inverter position is strictly inside terraceRing
      const invPt = { x: topo.endpointPosition.x, y: topo.endpointPosition.y };
      const insideTerrace =
        invPt.x >= -10 && invPt.x <= 10 && invPt.y >= -8 && invPt.y <= 8;
      expect(insideTerrace).toBe(true);

      // Check all points of every route stay inside terrace bounds
      for (const route of topo.routes) {
        for (const pt of route.points) {
          expect(pt.x).toBeGreaterThanOrEqual(-10);
          expect(pt.x).toBeLessThanOrEqual(10);
          expect(pt.y).toBeGreaterThanOrEqual(-8);
          expect(pt.y).toBeLessThanOrEqual(8);
        }
      }
    });

    it("updates visualizer particle intensities dynamically without recreating meshes", () => {
      const panels: PlacedPanel[] = [
        { index: 0, x: -2, y: 0, rotationDeg: 0 },
        { index: 1, x: 2, y: 0, rotationDeg: 0 },
      ];
      const terraceRing = [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ];

      const daytimeTopo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 10,
        terraceRing,
        solarElevationDeg: 55,
        solarAzimuthDeg: 180,
      });

      const visualizer = createElectricityFlowVisualizer(daytimeTopo);
      const initialMeshCount = visualizer.group.children.length;

      const nightTopo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 10,
        terraceRing,
        solarElevationDeg: 0,
        solarAzimuthDeg: 180,
      });

      // Update intensities
      visualizer.updateIntensities(nightTopo);

      // Mesh count remains constant
      expect(visualizer.group.children.length).toBe(initialMeshCount);

      visualizer.dispose();
    });

    it("guarantees 100% of cable routes and inverter stay inside a tapered roof", () => {
      // Tapered roof narrowing from south to north (triangle/trapezoid)
      const taperedTerrace = [
        { x: -15, y: -10 },
        { x: 15, y: -10 },
        { x: 2, y: 15 },
        { x: -2, y: 15 },
      ];
      // Strings placed at wide southern base and narrow northern apex
      const panels: PlacedPanel[] = [
        { index: 0, x: -8, y: -6, rotationDeg: 0 },
        { index: 1, x: -6, y: -6, rotationDeg: 0 },
        { index: 2, x: 6, y: -6, rotationDeg: 0 },
        { index: 3, x: 8, y: -6, rotationDeg: 0 },
        { index: 4, x: 0, y: 10, rotationDeg: 0 },
      ];

      const topo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 14,
        terraceRing: taperedTerrace,
      });

      expect(topo.isValidRouting).toBe(true);

      // Verify inverter is strictly inside
      expect(pointInPolygon({ x: topo.endpointPosition.x, y: topo.endpointPosition.y }, taperedTerrace)).toBe(true);
      expect(topo.endpointPosition.z).toBeGreaterThanOrEqual(14);

      // Verify every single point of every route is strictly inside taperedTerrace
      for (const route of topo.routes) {
        expect(route.points.length).toBeGreaterThanOrEqual(2);
        for (const pt of route.points) {
          expect(pointInPolygon({ x: pt.x, y: pt.y }, taperedTerrace)).toBe(true);
          expect(pt.z).toBeGreaterThanOrEqual(14); // no cable drops to ground (Z=0)
        }
      }
    });

    it("prevents cables from crossing the exterior notch of an L-shaped concave roof", () => {
      // L-shaped roof with an exterior notch in the bottom-right quadrant:
      // (0,0) to (12,0) to (12,6) to (6,6) to (6,12) to (0,12)
      // Notch is between (6,6) and (12,12)
      const lShapedTerrace = [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 12 },
        { x: 0, y: 12 },
      ];

      // Panels in the top-left wing and bottom-right wing
      const panels: PlacedPanel[] = [
        { index: 0, x: 2, y: 9, rotationDeg: 0 },
        { index: 1, x: 2, y: 7, rotationDeg: 0 },
        { index: 2, x: 8, y: 2, rotationDeg: 0 },
        { index: 3, x: 10, y: 2, rotationDeg: 0 },
      ];

      const topo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 10,
        terraceRing: lShapedTerrace,
      });

      expect(topo.isValidRouting).toBe(true);
      expect(pointInPolygon({ x: topo.endpointPosition.x, y: topo.endpointPosition.y }, lShapedTerrace)).toBe(true);

      // Test that NO route crosses through the exterior notch (x > 6 and y > 6 is outside)
      for (const route of topo.routes) {
        for (const pt of route.points) {
          expect(pointInPolygon({ x: pt.x, y: pt.y }, lShapedTerrace)).toBe(true);
          const inNotch = pt.x > 6.01 && pt.y > 6.01;
          expect(inNotch).toBe(false);
        }
      }
    });

    it("keeps all wiring inside the parapet inner face when a parapet wall is present", () => {
      const terraceRing = [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ];
      const panels: PlacedPanel[] = [
        { index: 0, x: -5, y: -2, rotationDeg: 0 },
        { index: 1, x: 0, y: -2, rotationDeg: 0 },
        { index: 2, x: 5, y: -2, rotationDeg: 0 },
      ];

      const parapetThicknessM = 0.3;
      const parapetHeightM = 1.0;

      const topo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 12,
        terraceRing,
        parapetHeightM,
        parapetThicknessM,
      });

      expect(topo.isValidRouting).toBe(true);

      // All rooftop route points must maintain clearance from outer boundary >= parapetThicknessM
      for (const route of topo.routes) {
        for (const pt of route.points) {
          if (Math.abs(pt.z - (12 + 0.04)) < 0.1) {
            const minX = Math.min(Math.abs(pt.x - 10), Math.abs(pt.x - (-10)));
            const minY = Math.min(Math.abs(pt.y - 10), Math.abs(pt.y - (-10)));
            const distToOuterEdge = Math.min(minX, minY);
            expect(distToOuterEdge).toBeGreaterThanOrEqual(parapetThicknessM - 0.05);
          }
        }
      }
    });

    it("ensures cable conduits do not penetrate rooftop obstacles", () => {
      const terraceRing = [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ];
      const panels: PlacedPanel[] = [
        { index: 0, x: -5, y: 5, rotationDeg: 0 },
        { index: 1, x: 5, y: -5, rotationDeg: 0 },
      ];
      const waterTank: Obstacle = {
        id: "tank-1",
        type: "water-tank",
        length: 3.0,
        width: 3.0,
        height: 2.0,
        rotation: 0,
        position: { x: 0, y: 0 },
      };

      const topo = buildElectricalTopology({
        panelLayers: [{ config: mockConfig, panels }],
        roofZ: 15,
        terraceRing,
        obstacles: [waterTank],
      });

      expect(topo.isValidRouting).toBe(true);

      // Verify no rooftop cable point is inside the center water tank [-1.4, 1.4] x [-1.4, 1.4]
      for (const route of topo.routes) {
        for (const pt of route.points) {
          if (Math.abs(pt.z - (15 + 0.04)) < 0.1) {
            const insideTank = Math.abs(pt.x) < 1.3 && Math.abs(pt.y) < 1.3;
            expect(insideTank).toBe(false);
          }
        }
      }
    });
  });
});
