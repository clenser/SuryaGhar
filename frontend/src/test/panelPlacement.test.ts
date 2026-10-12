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
    // Smaller modules fit at least as many complete sets; block granularity
    // can tie the count, but the installed capacity always differs.
    expect(tall.panels.length).toBeGreaterThanOrEqual(base.panels.length);
    expect(tall.panels.length % (2 * 5)).toBe(0);
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

  it("applies row and column spacing on their own axes", () => {
    // Wide column gap thins each row; tight row gap packs rows closer.
    const wide = placePanels({
      ...request(),
      config: { ...DEFAULT_PANEL_CONFIG, rowSpacingM: 0.05, colSpacingM: 2.0 },
    });
    const even = placePanels(request());
    expect(wide.panels.length).toBeLessThan(even.panels.length);
    // Columns still respect the explicit 2 m gap.
    const type = panelTypeDefinition(DEFAULT_PANEL_CONFIG.panelTypeId);
    for (let i = 0; i < wide.panels.length; i++) {
      for (let j = i + 1; j < wide.panels.length; j++) {
        const a = wide.panels[i];
        const b = wide.panels[j];
        const footprintA = rectangleCorners(
          a.x,
          a.y,
          type.widthM + 2 * 2.0,
          type.lengthM,
          a.rotationDeg,
        );
        const footprintB = rectangleCorners(b.x, b.y, type.widthM, type.lengthM, b.rotationDeg);
        expect(footprintsOverlap(footprintA, footprintB)).toBe(false);
      }
    }
  });

  it("places each set as a complete rows-by-columns block", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 2, setCols: 5 };
    const { panels, reason } = placePanels({ ...request(), config });
    expect(reason).toBeNull();
    // 10 panels per block; the count is always a multiple of the block size.
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.length % (2 * 5)).toBe(0);
  });

  it("rejects a set that would cross the roof instead of clipping it", () => {
    // A 2x5 block of 550 W portrait panels needs ~7 m x ~12 m plus setbacks:
    // far too wide for a 6 m roof, so nothing is placed and the reason says so.
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 2, setCols: 5 };
    const { panels, reason } = placePanels({ ...request(), terrace: rectRing(6, 6), config });
    expect(panels).toHaveLength(0);
    expect(reason).toMatch(/2x5|set/i);
  });

  it("fits several complete sets on a large roof without overlap", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 2 };
    const { panels } = placePanels({ ...request(), terrace: rectRing(30, 20), config });
    expect(panels.length).toBeGreaterThanOrEqual(4);
    expect(panels.length % 2).toBe(0);
    const type = panelTypeDefinition(config.panelTypeId);
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i];
        const b = panels[j];
        expect(
          footprintsOverlap(
            rectangleCorners(a.x, a.y, type.widthM, type.lengthM, a.rotationDeg),
            rectangleCorners(b.x, b.y, type.widthM, type.lengthM, b.rotationDeg),
          ),
        ).toBe(false);
      }
    }
  });

  it("relays out when set dimensions change", () => {
    const twoByFive = placePanels({
      ...request(),
      config: { ...DEFAULT_PANEL_CONFIG, setRows: 2, setCols: 5 },
    });
    const oneByFour = placePanels({
      ...request(),
      config: { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 4 },
    });
    expect(twoByFive.panels.length % 10).toBe(0);
    expect(oneByFour.panels.length % 4).toBe(0);
    expect(oneByFour.panels).not.toEqual(twoByFive.panels);
  });

  it("maximizes packing on concave / notched roofs across separated rows", () => {
    // L-shaped roof:
    // Bottom wing: X in [-10, 0], Y in [-10, 0]
    // Top wing: X in [-10, 10], Y in [0, 10]
    // An obstacle or notch in the bottom wing must NOT prevent panels from filling the top wing
    const lShapedTerrace: Point2[] = [
      { x: -10, y: -10 },
      { x: 0, y: -10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1 };
    const { panels, reason } = placePanels({
      terrace: lShapedTerrace,
      obstacles: [],
      config,
    });
    expect(reason).toBeNull();
    // In an L-shaped roof of 100m² + 100m² = 200m², single panels must populate both wings
    expect(panels.length).toBeGreaterThan(20);

    const hasBottomWing = panels.some((p) => p.x < 0 && p.y < 0);
    const hasTopWing = panels.some((p) => p.x > 0 && p.y > 0);
    expect(hasBottomWing).toBe(true);
    expect(hasTopWing).toBe(true);
  });

  it("continues placing valid panels after an obstacle blocks an intermediate row", () => {
    // Rectangular roof with a wide obstacle across the center Y = [-1, 1]
    const terrace = rectRing(25, 25);
    const centerObstacle: Obstacle = {
      id: "divider",
      type: "staircase-room",
      position: { x: 0, y: 0 },
      width: 22,
      length: 4,
      height: 2.5,
      rotation: 0,
    };
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1 };
    const { panels, reason } = placePanels({
      terrace,
      obstacles: [centerObstacle],
      config,
    });
    expect(reason).toBeNull();
    // Panels must be placed on BOTH sides of the obstacle (north and south)
    const northPanels = panels.filter((p) => p.y > 3);
    const southPanels = panels.filter((p) => p.y < -3);
    expect(northPanels.length).toBeGreaterThan(0);
    expect(southPanels.length).toBeGreaterThan(0);
  });
});

