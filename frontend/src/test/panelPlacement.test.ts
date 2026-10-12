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

  it("packs tapered trapezoidal and irregular roofs into narrower margins", () => {
    // Right trapezoid narrowing along the positive Y axis:
    // Base width: X from -15 to +15 (30m wide) at Y = -10
    // Top width: X from -15 to +5 (20m wide) at Y = +10
    const taperedTerrace: Point2[] = [
      { x: -15, y: -10 },
      { x: 15, y: -10 },
      { x: 5, y: 10 },
      { x: -15, y: 10 },
    ];
    const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5 };
    const { panels, reason } = placePanels({
      terrace: taperedTerrace,
      obstacles: [],
      config,
    });
    expect(reason).toBeNull();
    expect(panels.length).toBeGreaterThan(30);

    // Verify all panels are strictly within setback
    const type = panelTypeDefinition(config.panelTypeId);
    for (const p of panels) {
      const inset = rectangleCorners(
        p.x,
        p.y,
        type.widthM + 2 * config.setbackM,
        type.lengthM + 2 * config.setbackM,
        p.rotationDeg,
      );
      expect(footprintInsidePolygon(inset, taperedTerrace)).toBe(true);
    }

    // Verify panels are placed in both the narrow top section and wide bottom section
    const topSection = panels.filter((p) => p.y > 5);
    const bottomSection = panels.filter((p) => p.y < -5);
    expect(topSection.length).toBeGreaterThan(5);
    expect(bottomSection.length).toBeGreaterThan(10);
  });

  describe("Geometry-based roof tiling regression suite (§7)", () => {
    // Fixture A: Long tapered roof matching screenshot proportions
    // Wide central base narrowing to a tapered point/wing
    const longTaperedTerrace: Point2[] = [
      { x: -25, y: -12 },
      { x: 25, y: -12 },
      { x: 8, y: 18 },
      { x: -15, y: 18 },
    ];

    it("Fixture A (Tapered roof): systematically searches wide central region and narrow tapered wings", () => {
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5 };
      const { panels, reason } = placePanels({
        terrace: longTaperedTerrace,
        obstacles: [],
        config,
      });
      expect(reason).toBeNull();
      // Systematic tiling must densely populate the tapered structure
      expect(panels.length).toBeGreaterThanOrEqual(100);

      // Verify narrow top wing (y > 10) and wide base (y < -5) both receive valid panels
      const topWing = panels.filter((p) => p.y > 10);
      const centerRegion = panels.filter((p) => p.y >= -5 && p.y <= 10);
      const baseRegion = panels.filter((p) => p.y < -5);

      expect(topWing.length).toBeGreaterThan(10);
      expect(centerRegion.length).toBeGreaterThan(40);
      expect(baseRegion.length).toBeGreaterThan(30);

      // Verify all panels satisfy setbacks and non-overlap
      const type = panelTypeDefinition(config.panelTypeId);
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        const inset = rectangleCorners(
          p.x,
          p.y,
          type.widthM + 2 * config.setbackM,
          type.lengthM + 2 * config.setbackM,
          p.rotationDeg,
        );
        expect(footprintInsidePolygon(inset, longTaperedTerrace)).toBe(true);

        const rectA = rectangleCorners(p.x, p.y, type.widthM + config.spacingM, type.lengthM + config.spacingM, p.rotationDeg);
        for (let j = i + 1; j < panels.length; j++) {
          const p2 = panels[j];
          const rectB = rectangleCorners(p2.x, p2.y, type.widthM, type.lengthM, p2.rotationDeg);
          expect(footprintsOverlap(rectA, rectB)).toBe(false);
        }
      }
    });

    it("Fixture B (Rectangular roof): preserves dense regular placement without regressions", () => {
      const terrace = rectRing(40, 20);
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5, spacingM: 0.2 };
      const { panels, reason } = placePanels({
        terrace,
        obstacles: [],
        config,
      });
      expect(reason).toBeNull();
      // 40m x 20m roof with 1.13m x 2.28m panels: theoretical max ~ 28 x 7 = 196
      expect(panels.length).toBeGreaterThanOrEqual(180);
    });

    it("Fixture C (Concave L-shaped roof): populates both wings independently across empty regions", () => {
      const lTerrace: Point2[] = [
        { x: -15, y: -15 },
        { x: 15, y: -15 },
        { x: 15, y: -2 },
        { x: -2, y: -2 },
        { x: -2, y: 15 },
        { x: -15, y: 15 },
      ];
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5 };
      const { panels, reason } = placePanels({
        terrace: lTerrace,
        obstacles: [],
        config,
      });
      expect(reason).toBeNull();
      expect(panels.length).toBeGreaterThan(60);

      const verticalWing = panels.filter((p) => p.y > 0 && p.x < 0);
      const horizontalWing = panels.filter((p) => p.x > 0 && p.y < 0);
      expect(verticalWing.length).toBeGreaterThan(15);
      expect(horizontalWing.length).toBeGreaterThan(20);
    });

    it("Fixture D (Obstacle-divided roof): populates both sides of the dividing obstacle", () => {
      const terrace = rectRing(30, 20);
      const divider: Obstacle = {
        id: "long-wall",
        type: "staircase-room",
        position: { x: 0, y: 0 },
        width: 2,
        length: 18,
        height: 2.5,
        rotation: 0,
      };
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5 };
      const { panels, reason } = placePanels({
        terrace,
        obstacles: [divider],
        config,
      });
      expect(reason).toBeNull();
      const westPanels = panels.filter((p) => p.x < -1.5);
      const eastPanels = panels.filter((p) => p.x > 1.5);
      expect(westPanels.length).toBeGreaterThan(30);
      expect(eastPanels.length).toBeGreaterThan(30);
    });

    it("Fixture E (Panel Set mode): places complete, indivisible blocks in tapered and residual regions", () => {
      const terrace = rectRing(30, 20);
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 2, setCols: 4, setbackM: 0.5 };
      const { panels, reason } = placePanels({
        terrace,
        obstacles: [],
        config,
      });
      expect(reason).toBeNull();
      // Block size = 2 * 4 = 8
      expect(panels.length % 8).toBe(0);
      expect(panels.length).toBeGreaterThanOrEqual(32);
    });

    it("Fixture G (Determinism and Caching): identical inputs return identical layouts and invalidate on changes", () => {
      const terrace = rectRing(25, 20);
      const req1 = request({ terrace, config: { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1 } });
      const req2 = request({ terrace, config: { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1 } });
      const res1 = placePanels(req1);
      const res2 = placePanels(req2);
      expect(res1.panels).toEqual(res2.panels);

      // Invalidation on orientation change
      const resLandscape = placePanels({
        ...req1,
        config: { ...req1.config, orientation: "landscape" },
      });
      expect(resLandscape.panels).not.toEqual(res1.panels);

      // Invalidation on custom dimensions
      const resCustom = placePanels({
        ...req1,
        config: { ...req1.config, customWidthM: 1.5, customLengthM: 2.0 },
      });
      expect(resCustom.panels).not.toEqual(res1.panels);
    });

    it("Fixture H (Independent gap validation): no large feasible gaps remain unexplored", () => {
      const terrace = longTaperedTerrace;
      const config = { ...DEFAULT_PANEL_CONFIG, setRows: 1, setCols: 1, setbackM: 0.5, spacingM: 0.2 };
      const { panels } = placePanels({ terrace, obstacles: [], config });

      const type = panelTypeDefinition(config.panelTypeId);
      const candidateWidth = type.widthM;
      const candidateLength = type.lengthM;

      // Sample a test grid across the terrace interior
      // If any grid location can accommodate a full panel (including setbacks and spacing from all existing panels),
      // we check how many unplaced candidates exist. In our systematic search, there should be virtually 0 unplaced
      // standard-aligned candidates.
      let missedFeasibleSlots = 0;
      const stepSample = 1.0;
      for (let y = -11; y <= 17; y += stepSample) {
        for (let x = -24; x <= 24; x += stepSample) {
          const inset = rectangleCorners(x, y, candidateWidth + 2 * config.setbackM, candidateLength + 2 * config.setbackM, 0);
          if (!footprintInsidePolygon(inset, terrace)) continue;

          // Check if it collides with any placed panel (inflated by spacing)
          const testRect = rectangleCorners(x, y, candidateWidth + config.spacingM, candidateLength + config.spacingM, 0);
          const overlapsPlaced = panels.some((p) => {
            const pRect = rectangleCorners(p.x, p.y, candidateWidth, candidateLength, p.rotationDeg);
            return footprintsOverlap(testRect, pRect);
          });

          if (!overlapsPlaced) {
            missedFeasibleSlots++;
          }
        }
      }

      // With systematic tiling, no major grid cluster of missed slots should be left open
      expect(missedFeasibleSlots).toBe(0);
    });
  });
});

