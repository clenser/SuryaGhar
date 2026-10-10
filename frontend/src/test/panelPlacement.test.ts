/**
 * Panel placement tests (Phase 5): roof-boundary containment with the edge
 * setback, obstacle avoidance, panel spacing, orientation, zero-panel states
 * and deterministic regeneration.
 */

import { describe, expect, it } from "vitest";
import {
  PANEL_OBSTACLE_CLEARANCE_M,
  panelRotationForAzimuth,
  placePanels,
  rectangleCorners,
  type PlacementRequest,
} from "../lib/3d/panelPlacement";
import {
  DEFAULT_PANEL_CONFIG,
  panelTypeDefinition,
  totalCapacityKw,
} from "../lib/3d/panels";
import {
  footprintsOverlap,
  obstacleFootprint,
  footprintInsidePolygon,
  type Obstacle,
  type Point2,
} from "../lib/3d/obstacles";

/** Axis-aligned rectangle ring centred on the origin (local metres). */
function rectRing(widthM: number, lengthM: number, cx = 0, cy = 0): Point2[] {
  return [
    { x: cx - widthM / 2, y: cy - lengthM / 2 },
    { x: cx + widthM / 2, y: cy - lengthM / 2 },
    { x: cx + widthM / 2, y: cy + lengthM / 2 },
    { x: cx - widthM / 2, y: cy + lengthM / 2 },
  ];
}

function request(overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return {
    terrace: rectRing(30, 20),
    obstacles: [],
    config: DEFAULT_PANEL_CONFIG,
    ...overrides,
  };
}

describe("placement geometry", () => {
  it("maps azimuth to the panel's Z rotation (long side points at the azimuth)", () => {
    expect(panelRotationForAzimuth(0)).toBe(0);
    expect(panelRotationForAzimuth(180)).toBe(180);
    expect(panelRotationForAzimuth(90)).toBe(270);
    expect(panelRotationForAzimuth(360)).toBe(0);
    expect(panelRotationForAzimuth(-90)).toBe(90); // −90 ≡ 270° (west)
  });

  it("builds rotated rectangle corners", () => {
    const corners = rectangleCorners(1, 2, 4, 2, 0);
    expect(corners[0]).toEqual({ x: -1, y: 1 });
    expect(corners[2]).toEqual({ x: 3, y: 3 });
    // 90° CCW: width/length swap in world axes around the centre.
    const rotated = rectangleCorners(0, 0, 4, 2, 90);
    expect(rotated[2].x).toBeCloseTo(-1, 10);
    expect(rotated[2].y).toBeCloseTo(2, 10);
  });
});

describe("placePanels", () => {
  it("places panels inside the roof honouring the edge setback", () => {
    const terrace = rectRing(30, 20);
    const config = { ...DEFAULT_PANEL_CONFIG, setbackM: 0.6 };
    const { panels, reason } = placePanels(request({ terrace, config }));
    expect(reason).toBeNull();
    expect(panels.length).toBeGreaterThan(10);

    const type = panelTypeDefinition(config.panelTypeId);
    for (const panel of panels) {
      // Raw footprint inside the roof.
      const footprint = rectangleCorners(
        panel.x,
        panel.y,
        type.widthM,
        type.lengthM,
        panel.rotationDeg,
      );
      expect(footprintInsidePolygon(footprint, terrace)).toBe(true);
      // Footprint inflated by the setback inside the roof → every edge keeps
      // at least `setback` metres of clearance.
      const inflated = rectangleCorners(
        panel.x,
        panel.y,
        type.widthM + 2 * config.setbackM,
        type.lengthM + 2 * config.setbackM,
        panel.rotationDeg,
      );
      expect(footprintInsidePolygon(inflated, terrace)).toBe(true);
    }
  });

  it("orients panels towards the configured azimuth", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, azimuthDeg: 90 };
    const { panels } = placePanels({ ...request(), config });
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.rotationDeg).toBe(panelRotationForAzimuth(90));
      expect(panel.rotationDeg).toBe(270);
    }
  });

  it("never places a panel over an obstacle", () => {
    const obstacle: Obstacle = {
      id: "obs-1",
      type: "water-tank",
      position: { x: 0, y: 0 },
      width: 4,
      length: 3,
      height: 1.5,
      rotation: 25,
    };
    const { panels, reason } = placePanels({ ...request(), obstacles: [obstacle] });
    expect(reason).toBeNull();
    expect(panels.length).toBeGreaterThan(0);

    const type = panelTypeDefinition(DEFAULT_PANEL_CONFIG.panelTypeId);
    const ring = obstacleFootprint(obstacle);
    for (const panel of panels) {
      const footprint = rectangleCorners(
        panel.x,
        panel.y,
        type.widthM,
        type.lengthM,
        panel.rotationDeg,
      );
      expect(footprintsOverlap(footprint, ring)).toBe(false);
    }
    // Clearance is kept, not just non-intersection.
    const inflatedRing = rectangleCorners(
      obstacle.position.x,
      obstacle.position.y,
      obstacle.width + 2 * PANEL_OBSTACLE_CLEARANCE_M,
      obstacle.length + 2 * PANEL_OBSTACLE_CLEARANCE_M,
      obstacle.rotation,
    );
    for (const panel of panels) {
      const footprint = rectangleCorners(
        panel.x,
        panel.y,
        type.widthM,
        type.lengthM,
        panel.rotationDeg,
      );
      expect(footprintsOverlap(footprint, inflatedRing)).toBe(false);
    }
  });

  it("keeps the configured spacing between every pair of panels", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, spacingM: 0.35 };
    const { panels } = placePanels({ ...request(), config });
    expect(panels.length).toBeGreaterThan(5);

    const type = panelTypeDefinition(config.panelTypeId);
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i];
        const b = panels[j];
        const footprintA = rectangleCorners(
          a.x,
          a.y,
          // Inflate by 2× the gap: two rects only touch when their centre
          // distance equals panel size + spacing, i.e. a full clear gap.
          type.widthM + 2 * config.spacingM,
          type.lengthM + 2 * config.spacingM,
          a.rotationDeg,
        );
        const footprintB = rectangleCorners(
          b.x,
          b.y,
          type.widthM,
          type.lengthM,
          b.rotationDeg,
        );
        expect(footprintsOverlap(footprintA, footprintB)).toBe(false);
      }
    }
  });

  it("returns zero panels with a reason when the roof is too small", () => {
    const { panels, reason } = placePanels({ ...request(), terrace: rectRing(2, 2) });
    expect(panels).toHaveLength(0);
    expect(reason).toMatch(/too small/i);
  });

  it("returns zero panels when the setback swallows the roof", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, setbackM: 5 };
    const { panels, reason } = placePanels({ ...request(), terrace: rectRing(6, 6), config });
    expect(panels).toHaveLength(0);
    expect(reason).toMatch(/too small|setback/i);
  });

  it("rejects a missing terrace", () => {
    const { panels, reason } = placePanels({ ...request(), terrace: [] });
    expect(panels).toHaveLength(0);
    expect(reason).toMatch(/Terrace/);
  });

  it("is deterministic: identical inputs give identical layouts", () => {
    const a = placePanels(request());
    const b = placePanels(request());
    expect(a.panels).toEqual(b.panels);
  });

  it("changes the layout and capacity when the panel rating changes", () => {
    const base = placePanels(request());
    const tall = placePanels({
      ...request(),
      config: { ...DEFAULT_PANEL_CONFIG, panelTypeId: "panel-450w" },
    });
    expect(tall.panels.length).toBeGreaterThan(base.panels.length);
    expect(totalCapacityKw(tall.panels.length, 450)).not.toBe(
      totalCapacityKw(base.panels.length, 550),
    );
  });

  it("never places panels outside the roof to raise the count", () => {
    // Roof barely fits one panel with the default setback.
    const config = { ...DEFAULT_PANEL_CONFIG, setbackM: 0.5 };
    const type = panelTypeDefinition(config.panelTypeId);
    const terrace = rectRing(
      type.widthM + 2 * config.setbackM + 0.4,
      type.lengthM + 2 * config.setbackM + 0.4,
    );
    const { panels } = placePanels({ ...request(), terrace, config });
    expect(panels.length).toBeLessThanOrEqual(1);
    for (const panel of panels) {
      const inflated = rectangleCorners(
        panel.x,
        panel.y,
        type.widthM + 2 * config.setbackM,
        type.lengthM + 2 * config.setbackM,
        panel.rotationDeg,
      );
      expect(footprintInsidePolygon(inflated, terrace)).toBe(true);
    }
  });
});
