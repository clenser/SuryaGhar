/**
 * Tests for the rooftop obstacle domain model (Phase 3).
 *
 * Everything here is deterministic metric geometry in the Phase 2 local frame
 * (1 unit = 1 metre, centroid at the origin): dimensions, position, rotated
 * footprint containment and obstacle-vs-obstacle overlap. No Three.js, no
 * pixels, no renderer involvement (AGENTS.md §40, §52, §64).
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { createObstacleMesh } from "../lib/3d/obstacleMeshes";
import {
  BOUNDARY_TOLERANCE_M,
  MAX_OBSTACLE_FOOTPRINT_M,
  MAX_OBSTACLE_HEIGHT_M,
  MIN_OBSTACLE_SIZE_M,
  OBSTACLE_TYPES,
  createObstacleId,
  draftToObstacle,
  emptyObstacleDraft,
  findInvalidObstacles,
  formatObstacleDimensions,
  footprintInsidePolygon,
  obstacleFootprint,
  obstacleToDraft,
  obstacleTypeLabel,
  obstacleZRange,
  obstaclesOverlap,
  pointInPolygon,
  polygonsOverlap,
  resetObstacleIdsForTests,
  splitPolygon,
  validateFootprint,
  validateObstacle,
  type Obstacle,
  type ObstacleContext,
  type Point2,
} from "../lib/3d/obstacles";

/** A 30 m × 20 m rooftop centred on the local origin. */
const TERRACE: Point2[] = [
  { x: -15, y: -10 },
  { x: 15, y: -10 },
  { x: 15, y: 10 },
  { x: -15, y: 10 },
];

function makeObstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    id: "obstacle-1",
    type: "water-tank",
    position: { x: 0, y: 0 },
    width: 2.4,
    length: 2.4,
    height: 2,
    rotation: 0,
    ...overrides,
  };
}

function context(others: Obstacle[] = [], terrace: Point2[] = TERRACE): ObstacleContext {
  return { terrace, others };
}

describe("obstacle dimensions", () => {
  it("accepts positive width, length and height", () => {
    const result = validateObstacle(makeObstacle(), context());
    expect(result).toEqual({ valid: true });
  });

  it("accepts the smallest sensible footprint", () => {
    const result = validateObstacle(
      makeObstacle({ width: MIN_OBSTACLE_SIZE_M, length: MIN_OBSTACLE_SIZE_M, height: MIN_OBSTACLE_SIZE_M }),
      context(),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects zero dimensions", () => {
    expect(validateObstacle(makeObstacle({ width: 0 }), context())).toEqual({
      valid: false,
      error: "Width must be greater than 0",
    });
    expect(validateObstacle(makeObstacle({ length: 0 }), context())).toEqual({
      valid: false,
      error: "Length must be greater than 0",
    });
  });

  it("rejects negative dimensions", () => {
    expect(validateObstacle(makeObstacle({ width: -3 }), context())).toEqual({
      valid: false,
      error: "Width must be greater than 0",
    });
    expect(validateObstacle(makeObstacle({ length: -1.5 }), context())).toEqual({
      valid: false,
      error: "Length must be greater than 0",
    });
    expect(validateObstacle(makeObstacle({ height: -1 }), context())).toEqual({
      valid: false,
      error: "Height must be greater than 0",
    });
  });

  it("rejects non-numeric dimensions (empty or partial input)", () => {
    expect(validateObstacle(makeObstacle({ width: Number.NaN }), context())).toEqual({
      valid: false,
      error: "Width must be a valid number",
    });
    expect(validateObstacle(makeObstacle({ height: Number.NaN }), context())).toEqual({
      valid: false,
      error: "Height must be a valid number",
    });
  });

  it("rejects dimensions beyond the sanity limits", () => {
    expect(
      validateObstacle(makeObstacle({ width: MAX_OBSTACLE_FOOTPRINT_M + 1 }), context()),
    ).toEqual({ valid: false, error: `Width must not exceed ${MAX_OBSTACLE_FOOTPRINT_M} m` });
    expect(
      validateObstacle(makeObstacle({ height: MAX_OBSTACLE_HEIGHT_M + 1 }), context()),
    ).toEqual({ valid: false, error: `Height must not exceed ${MAX_OBSTACLE_HEIGHT_M} m` });
  });

  it("rejects height values that are not positive metres", () => {
    expect(validateObstacle(makeObstacle({ height: 0 }), context())).toEqual({
      valid: false,
      error: "Height must be greater than 0",
    });
  });
});

describe("obstacle position", () => {
  it("accepts a position inside the roof", () => {
    expect(validateObstacle(makeObstacle({ position: { x: 8, y: -5 } }), context())).toEqual({
      valid: true,
    });
  });

  it("rejects a non-numeric position", () => {
    expect(
      validateObstacle(makeObstacle({ position: { x: Number.NaN, y: 0 } }), context()),
    ).toEqual({ valid: false, error: "Position must be two valid numbers" });
  });

  it("rejects a non-numeric rotation", () => {
    expect(validateObstacle(makeObstacle({ rotation: Number.NaN }), context())).toEqual({
      valid: false,
      error: "Rotation must be a valid number",
    });
  });
});

describe("footprint containment", () => {
  it("accepts a footprint fully inside the terrace", () => {
    expect(validateObstacle(makeObstacle({ position: { x: 12, y: 7 } }), context())).toEqual({
      valid: true,
    });
  });

  it("rejects a footprint that crosses the rooftop boundary", () => {
    // Centre 1 m from the edge with a 4 m footprint → 1 m hangs over.
    const result = validateObstacle(
      makeObstacle({ width: 4, length: 4, position: { x: 14, y: 0 } }),
      context(),
    );
    expect(result).toEqual({
      valid: false,
      error: "Obstacle extends beyond the rooftop boundary",
    });
  });

  it("rejects a footprint entirely outside the terrace", () => {
    const result = validateObstacle(
      makeObstacle({ position: { x: 40, y: 0 } }),
      context(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/beyond the rooftop boundary/);
  });

  it("rejects a footprint that overhangs a roof corner", () => {
    // Straddling the corner: three corners inside, one outside.
    const result = validateObstacle(
      makeObstacle({ width: 8, length: 8, position: { x: 13, y: 9 } }),
      context(),
    );
    expect(result.valid).toBe(false);
  });

  it("allows a footprint resting exactly on the boundary", () => {
    const result = validateObstacle(
      makeObstacle({ width: 4, length: 4, position: { x: 13, y: 0 } }),
      context(),
    );
    expect(result.valid).toBe(true);
  });

  it("accounts for rotation when validating the footprint", () => {
    // Long and thin: fits across the roof unrotated, overhangs when turned.
    const straight = validateObstacle(
      makeObstacle({ width: 18, length: 4, position: { x: 0, y: 7 }, rotation: 0 }),
      context(),
    );
    expect(straight.valid).toBe(true);

    const turned = validateObstacle(
      makeObstacle({ width: 18, length: 4, position: { x: 0, y: 7 }, rotation: 45 }),
      context(),
    );
    expect(turned).toEqual({
      valid: false,
      error: "Obstacle extends beyond the rooftop boundary",
    });
  });

  it("accepts a footprint that only fits because of its rotation", () => {
    // 30 m long: over the top of a 20 m deep roof unrotated, fits along it at 90°.
    expect(
      validateObstacle(makeObstacle({ width: 4, length: 30, rotation: 0 }), context()).valid,
    ).toBe(false);
    expect(
      validateObstacle(makeObstacle({ width: 4, length: 30, rotation: 90 }), context()).valid,
    ).toBe(true);
  });

  it("treats a small tolerance as still inside the boundary", () => {
    const footprint = TERRACE.map((p) => ({ x: p.x + BOUNDARY_TOLERANCE_M / 10, y: p.y }));
    expect(pointInPolygon({ x: 15, y: 0 }, TERRACE)).toBe(true);
    expect(footprintInsidePolygon(footprint, TERRACE)).toBe(true);
  });

  it("reports points outside a polygon", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, TERRACE)).toBe(true);
    expect(pointInPolygon({ x: 16, y: 0 }, TERRACE)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe("obstacle footprints", () => {
  it("computes unrotated corners from position and dimensions", () => {
    const corners = obstacleFootprint(makeObstacle({ width: 4, length: 2, position: { x: 5, y: 5 } }));
    expect(corners).toEqual([
      { x: 3, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
      { x: 3, y: 6 },
    ]);
  });

  it("rotates corners around the footprint centre", () => {
    const corners = obstacleFootprint(
      makeObstacle({ width: 4, length: 2, position: { x: 0, y: 0 }, rotation: 90 }),
    );
    for (const corner of corners) {
      expect(Math.abs(Math.abs(corner.x) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(corner.y) - 2)).toBeLessThan(1e-9);
    }
  });

  it("reports the vertical range relative to the building height", () => {
    expect(obstacleZRange(17.2, { height: 2 })).toEqual({ base: 17.2, top: 19.2 });
    expect(obstacleZRange(0, { height: 3.5 })).toEqual({ base: 0, top: 3.5 });
  });
});

describe("multiple obstacles", () => {
  it("accepts a second obstacle that does not collide", () => {
    const first = makeObstacle({ id: "obstacle-1", position: { x: -6, y: 0 } });
    const second = makeObstacle({ id: "obstacle-2", type: "hvac", position: { x: 6, y: 0 } });

    expect(validateObstacle(second, context([first]))).toEqual({ valid: true });
  });

  it("rejects a footprint that overlaps an existing obstacle", () => {
    const first = makeObstacle({ id: "obstacle-1", position: { x: 0, y: 0 } });
    const second = makeObstacle({ id: "obstacle-2", type: "hvac", position: { x: 2, y: 0 } });

    expect(validateObstacle(second, context([first]))).toEqual({
      valid: false,
      error: "Obstacle overlaps the water tank",
    });
  });

  it("allows obstacles that only touch", () => {
    const first = makeObstacle({ id: "obstacle-1", width: 4, length: 4, position: { x: -2, y: 0 } });
    const second = makeObstacle({ id: "obstacle-2", width: 4, length: 4, position: { x: 2, y: 0 } });

    expect(obstaclesOverlap(first, second)).toBe(false);
    expect(validateObstacle(second, context([first])).valid).toBe(true);
  });

  it("never treats an obstacle as overlapping itself", () => {
    const obstacle = makeObstacle({ id: "obstacle-1" });
    expect(validateObstacle(obstacle, context([obstacle]))).toEqual({ valid: true });
  });

  it("detects overlap between rotated footprints", () => {
    const first = makeObstacle({ id: "obstacle-1", width: 10, length: 2, rotation: 0 });
    const rotatedSameSpot = makeObstacle({
      id: "obstacle-2",
      width: 10,
      length: 2,
      rotation: 90,
      position: { x: 3, y: 0 },
    });
    expect(obstaclesOverlap(first, rotatedSameSpot)).toBe(true);
  });

  it("validates several obstacles on the same roof", () => {
    const obstacles = [
      makeObstacle({ id: "obstacle-1", position: { x: -8, y: 4 } }),
      makeObstacle({ id: "obstacle-2", type: "hvac", width: 1.2, length: 1.6, position: { x: 8, y: -4 } }),
      makeObstacle({ id: "obstacle-3", type: "lift-room", width: 3, length: 2.5, position: { x: 0, y: -8 } }),
    ];

    expect(findInvalidObstacles(obstacles, TERRACE)).toEqual([]);
  });

  it("reports which obstacle became invalid", () => {
    const obstacles = [
      makeObstacle({ id: "obstacle-1", position: { x: 0, y: 0 } }),
      makeObstacle({ id: "obstacle-2", position: { x: 30, y: 0 } }),
    ];

    const invalid = findInvalidObstacles(obstacles, TERRACE);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].obstacle.id).toBe("obstacle-2");
    expect(invalid[0].error).toMatch(/beyond the rooftop boundary/);
  });

  it("validates nearby building obstacles outside the terrace and at ground level", () => {
    const nearby = makeObstacle({
      id: "building-1",
      type: "building",
      position: { x: 35, y: 0 },
      width: 15,
      length: 20,
      height: 25,
    });
    const result = validateObstacle(nearby, { terrace: TERRACE, others: [] });
    expect(result.valid).toBe(true);
    expect(obstacleZRange(12, nearby)).toEqual({ base: 0, top: 25 });
  });

  it("rejects nearby building obstacles that overlap the main terrace", () => {
    const overlapping = makeObstacle({
      id: "building-bad",
      type: "building",
      position: { x: 5, y: 5 },
      width: 10,
      length: 10,
      height: 20,
    });
    const result = validateObstacle(overlapping, { terrace: TERRACE, others: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/cannot overlap the main rooftop terrace/);
    }
  });
});

describe("obstacle catalog", () => {
  it("offers the initial obstacle types", () => {
    expect(OBSTACLE_TYPES.map((t) => t.type)).toEqual([
      "hvac",
      "water-tank",
      "staircase-room",
      "lift-room",
      "custom",
      "building",
    ]);
  });

  it("labels each type", () => {
    expect(obstacleTypeLabel("hvac")).toBe("AC / HVAC");
    expect(obstacleTypeLabel("water-tank")).toBe("Water Tank");
    expect(obstacleTypeLabel("custom")).toBe("Custom");
  });

  it("provides preset footprints per type", () => {
    const draft = emptyObstacleDraft("staircase-room");
    expect(draft).toMatchObject({ type: "staircase-room", length: "4.5", width: "3", height: "3" });
  });
});

describe("obstacle ids and drafts", () => {
  beforeEach(() => resetObstacleIdsForTests());

  it("creates unique ids", () => {
    const ids = new Set([createObstacleId(), createObstacleId(), createObstacleId()]);
    expect(ids.size).toBe(3);
  });

  it("starts a draft at the roof centre with preset dimensions", () => {
    const draft = emptyObstacleDraft();
    expect(draft).toEqual({
      type: "water-tank",
      length: "2.5",
      width: "2.5",
      height: "2",
      rotation: "0",
      x: "0",
      y: "0",
    });
    const obstacle = draftToObstacle(draft, "obstacle-1");
    expect(validateObstacle(obstacle, context())).toEqual({ valid: true });
  });

  it("turns empty draft fields into invalid values instead of zeros", () => {
    const obstacle = draftToObstacle(
      { ...emptyObstacleDraft(), width: "", height: " " },
      "obstacle-1",
    );
    expect(obstacle.width).toBeNaN();
    expect(obstacle.height).toBeNaN();
    expect(validateObstacle(obstacle, context()).valid).toBe(false);
  });

  it("round-trips an obstacle through the draft", () => {
    const obstacle = makeObstacle({
      id: "obstacle-9",
      type: "lift-room",
      width: 3,
      length: 2.5,
      height: 4,
      rotation: 30,
      position: { x: 4.25, y: -1.5 },
    });
    const back = draftToObstacle(obstacleToDraft(obstacle), obstacle.id);
    // Rectangular records round-trip with an explicit null polygon.
    expect(back).toEqual({ ...obstacle, polygon: null });
  });

  it("formats a compact metric description", () => {
    expect(formatObstacleDimensions(makeObstacle())).toBe("2.4 × 2.4 × 2 m");
  });
});

describe("drawn polygon footprints", () => {
  const terrace = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ];
  const ctx = { terrace, others: [] as Obstacle[] };

  it("splits drawn points into centroid plus relative offsets", () => {
    const { centroid, offsets } = splitPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(centroid).toEqual({ x: 2, y: 1 });
    expect(offsets).toHaveLength(4);
    expect(offsets[0]).toEqual({ x: -2, y: -1 });
    // Re-anchoring recovers the drawn points exactly.
    const rebuilt = offsets.map((p) => ({ x: centroid.x + p.x, y: centroid.y + p.y }));
    expect(rebuilt[2]).toEqual({ x: 4, y: 2 });
  });

  it("round-trips a polygon through draft and obstacle records", () => {
    const draft = {
      ...emptyObstacleDraft("custom"),
      x: "2",
      y: "1",
      height: "2.5",
      polygon: [
        { x: -2, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 1 },
        { x: -2, y: 1 },
      ],
    };
    const obstacle = draftToObstacle(draft, "poly-1");
    expect(obstacle.polygon).toHaveLength(4);
    // Bounding extents shown in the dimension fields, polygon authoritative.
    expect(obstacle.width).toBeCloseTo(4, 9);
    expect(obstacle.length).toBeCloseTo(2, 9);
    expect(obstacleFootprint(obstacle)).toHaveLength(4);
    expect(obstacleToDraft(obstacle).polygon).toHaveLength(4);
  });

  it("rotates drawn offsets around the centroid, never the origin", () => {
    const obstacle: Obstacle = {
      id: "r",
      type: "custom",
      position: { x: 100, y: 100 },
      width: 4,
      length: 2,
      height: 2,
      rotation: 90,
      polygon: [
        { x: -2, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 1 },
        { x: -2, y: 1 },
      ],
    };
    const ring = obstacleFootprint(obstacle);
    // 90° CCW about (100,100): (-2,-1) -> (101,98).
    expect(ring[0].x).toBeCloseTo(101, 9);
    expect(ring[0].y).toBeCloseTo(98, 9);
  });

  it("validates drawn footprints with specific actionable errors", () => {
    expect(validateFootprint([{ x: 0, y: 0 }], ctx).valid).toBe(false);
    expect(validateFootprint([{ x: 0, y: 0 }, { x: 1, y: 1 }], ctx).valid).toBe(false);
    const crossed = validateFootprint(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ],
      ctx,
    );
    expect(crossed.valid).toBe(false);
    if (!crossed.valid) expect(crossed.error).toMatch(/cross|simple/i);
    // Far outside the terrace.
    const outside = validateFootprint(
      [
        { x: 50, y: 50 },
        { x: 54, y: 50 },
        { x: 54, y: 54 },
      ],
      ctx,
    );
    expect(outside.valid).toBe(false);
    if (!outside.valid) expect(outside.error).toMatch(/boundary/);
    // A clean centred quad passes.
    expect(
      validateFootprint(
        [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        ctx,
      ),
    ).toEqual({ valid: true });
  });

  it("detects concave polygon overlap that SAT alone would miss", () => {
    // C-shape vs a bar slotted into its notch: no SAT axis separates them,
    // but the general polygon test must still catch the intrusion.
    const cShape = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ];
    const bar = [
      { x: 3, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 5 },
      { x: 3, y: 5 },
    ];
    expect(polygonsOverlap(cShape, bar)).toBe(true);
    expect(
      polygonsOverlap(
        [
          { x: 20, y: 20 },
          { x: 24, y: 20 },
          { x: 24, y: 24 },
        ],
        bar,
      ),
    ).toBe(false);
  });

  it("renders a drawn polygon as an extruded mesh at roof elevation", () => {
    const obstacle: Obstacle = {
      id: "m",
      type: "custom",
      position: { x: 0, y: 0 },
      width: 4,
      length: 4,
      height: 2.5,
      rotation: 0,
      polygon: [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        { x: -2, y: 2 },
      ],
    };
    const mesh = createObstacleMesh(obstacle, 15);
    try {
      const box = new THREE.Box3().setFromObject(mesh);
      // Base on the roof, top at roof + height, footprint preserved.
      expect(box.min.z).toBeCloseTo(15, 3);
      expect(box.max.z).toBeCloseTo(17.5, 3);
      expect(box.max.x - box.min.x).toBeCloseTo(4, 3);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.userData.obstacleId).toBe("m");
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  it("validates a drawn footprint near the center of a large terrace (probe scenario)", () => {
    // 182m x 182m square terrace (~3.31 ha), centroid at origin
    const largeTerrace = [
      { x: -91, y: -91 },
      { x: 91, y: -91 },
      { x: 91, y: 91 },
      { x: -91, y: 91 },
    ];
    const ctxLarge = { terrace: largeTerrace, others: [] as Obstacle[], parapetInsetM: 0.6 };
    // L-shape similar to probe: centered around (7.5, 7.5) like default camera projection
    const lShape = [
      { x: 5.5, y: 5.5 },
      { x: 9.5, y: 5.5 },
      { x: 9.5, y: 8.5 },
      { x: 6.5, y: 8.5 },
      { x: 6.5, y: 11.5 },
      { x: 5.5, y: 11.5 },
    ];
    const result = validateFootprint(lShape, ctxLarge);
    expect(result.valid).toBe(true);
    if (!result.valid) console.log("ERROR:", result.error);
  });

});