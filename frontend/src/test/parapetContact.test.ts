/**
 * Parapet contact policy (MASTER FIX §2).
 *
 * Obstacles may TOUCH the inner face of the parapet wall — a fused rooftop
 * structure — while anything that actually crosses into the wall/cap volume is
 * rejected. The test geometry uses a 20 x 14 m rectangular terrace with the
 * inner wall face inset by the parapet thickness, so every expected value is
 * exact rather than approximated.
 *
 * Contact rule under test (from `obstacles.ts`):
 *   closestCornerToEdge >= parapetContactM - PARAPET_CONTACT_TOLERANCE_M
 * where `closestCornerToEdge` is the distance from the nearest footprint corner
 * to the exterior terrace edge.
 */

import { describe, expect, it } from "vitest";
import {
  PARAPET_CONTACT_TOLERANCE_M,
  obstacleFootprint,
  obstaclesOverlap,
  validateFootprint,
  validateObstacle,
  type Obstacle,
  type Point2,
} from "../lib/3d/obstacles";
import { DEFAULT_PARAPET_THICKNESS_M } from "../lib/3d/geometry";

/** A 20 x 14 m terrace ring, centred on the origin. */
const TERRACE: Point2[] = [
  { x: -10, y: -7 },
  { x: 10, y: -7 },
  { x: 10, y: 7 },
  { x: -10, y: 7 },
];

/** Inner face of the parapet wall = terrace inset by the wall thickness. */
const CONTACT = DEFAULT_PARAPET_THICKNESS_M; // 0.3 m

/** The maintenance clearance used for other purposes (wall + service gap). */
const CLEARANCE = DEFAULT_PARAPET_THICKNESS_M + 0.3; // 0.6 m

/** A rectangular obstacle at (x, y) with `w` x `d` and no rotation. */
function rect(
  x: number,
  y: number,
  w: number,
  d: number,
  height = 1.5,
  id = "o1",
): Obstacle {
  return {
    id,
    type: "water-tank",
    position: { x, y },
    width: w,
    length: d,
    height,
    rotation: 0,
  };
}

/** Distance from a rectangle's nearest corner to the nearest terrace edge. */
function cornerGap(obstacle: Obstacle): number {
  const ring = TERRACE;
  let closest = Infinity;
  for (const c of obstacleFootprint(obstacle)) {
    for (let i = 0; i < ring.length; i++) {
      closest = Math.min(closest, pointDistance(c, ring[i], ring[(i + 1) % ring.length]));
    }
  }
  return closest;
}

function pointDistance(p: Point2, a: Point2, b: Point2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

describe("obstacle parapet contact", () => {
  it("accepts an obstacle sitting exactly on the inner parapet face", () => {
    // East edge at x = 10, inner face at x = 9.7. A 2.0 m tank centred at
    // x = 8.7 has its east face exactly on the inner face.
    const tank = rect(8.7, 0, 2.0, 2.0);
    expect(cornerGap(tank)).toBeCloseTo(CONTACT, 9);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a contact that is marginally inside the tolerance", () => {
    // 2 mm INSIDE the wall band: closer than the true inner face, but within
    // the float slack, so contact is still permitted.
    const tank = rect(8.7 + PARAPET_CONTACT_TOLERANCE_M / 2, 0, 2.0, 2.0);
    expect(cornerGap(tank)).toBeLessThan(CONTACT);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts an obstacle comfortably clear of the parapet", () => {
    const tank = rect(0, 0, 2.5, 2.5);
    expect(cornerGap(tank)).toBeGreaterThan(CONTACT);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an obstacle that penetrates the parapet wall", () => {
    // 2.0 m tank centred at x = 9.1: east face at 10.1 — past the terrace edge
    // entirely, so it both penetrates the wall and leaves the roof.
    const tank = rect(9.1, 0, 2.0, 2.0);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/parapet|beyond the rooftop/);
  });

  it("rejects an obstacle that crosses the exterior roof boundary", () => {
    // A large tank centred so its whole east half hangs off the roof.
    const tank = rect(11, 0, 4, 4);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/beyond the rooftop|penetrates the parapet/);
  });

  it("rejects an obstacle that eats into the wall band past the tolerance", () => {
    // 2.0 m tank centred at x = 8.85: east face at 9.85, so the corner is
    // 0.15 m from the terrace edge — well inside the 0.3 m wall band and far
    // past the 2 mm contact slack. This is parapet penetration.
    const tank = rect(8.85, 0, 2.0, 2.0);
    expect(cornerGap(tank)).toBeLessThan(CONTACT - PARAPET_CONTACT_TOLERANCE_M);
    const result = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/parapet/);
  });

  it("keeps the strict clearance when a caller does NOT opt in to contact", () => {
    // Without `parapetContactM` the legacy clearance behaviour is preserved:
    // the same flush tank is refused because it is inside the 0.6 m zone.
    const tank = rect(8.7, 0, 2.0, 2.0);
    const strict = validateObstacle(tank, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
    });
    expect(strict.valid).toBe(false);
    if (!strict.valid) expect(strict.error).toMatch(/parapet/);
  });
});

describe("custom polygon parapet contact", () => {
  /** Draw a rectangle ring with x in [west, east] and y in [south, north]. */
  function ringWith(w: number, d: number, cx: number, cy: number): Point2[] {
    const hw = w / 2;
    const hd = d / 2;
    return [
      { x: cx - hw, y: cy - hd },
      { x: cx + hw, y: cy - hd },
      { x: cx + hw, y: cy + hd },
      { x: cx - hw, y: cy + hd },
    ];
  }

  it("accepts a custom polygon flush against the inner parapet face", () => {
    // East edge of the drawn polygon at x = 9.7 == inner face.
    const points = ringWith(3.0, 2.0, 8.2, 0);
    const result = validateFootprint(points, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a custom polygon pushed into the parapet wall", () => {
    const points = ringWith(3.0, 2.0, 8.4, 0); // east edge 9.9 -> 0.1 m gap
    const result = validateFootprint(points, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/parapet|rooftop/);
  });

  it("still rejects a self-intersecting drawn polygon", () => {
    const bowtie: Point2[] = [
      { x: -8, y: 0 },
      { x: 8, y: 0 },
      { x: -8, y: 1 },
      { x: 8, y: 1 },
    ];
    const result = validateFootprint(bowtie, {
      terrace: TERRACE,
      others: [],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/degenerate|cross/i);
  });

  it("still rejects a drawn polygon that overlaps an existing obstacle", () => {
    // The drawn ring (3x3 centred at 4.5, 1.5) genuinely crosses the existing
    // 2x2 tank at (4, 0): its bottom edge passes through the tank's interior,
    // so this is a real collision, not a permitted edge-touch.
    const existing = rect(4, 0, 2, 2, 1.5, "existing");
    const drawn = ringWith(3, 3, 4.5, 1.5);
    const result = validateFootprint(drawn, {
      terrace: TERRACE,
      others: [existing],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/overlaps/);
  });

  it("still allows a drawn polygon that merely touches an obstacle edge", () => {
    // Edge-touching is deliberately permitted (OVERLAP_EPSILON_M semantics), so
    // a polygon flush against an obstacle's side stays valid.
    const existing = rect(4, 0, 2, 2, 1.5, "existing"); // x in [3, 5]
    const drawn = ringWith(2, 2, 6, 0);               // x in [5, 7] — shares x = 5
    const result = validateFootprint(drawn, {
      terrace: TERRACE,
      others: [existing],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(true);
  });
});

describe("obstacle overlap is unaffected by contact policy", () => {
  it("still rejects genuinely overlapping obstacles", () => {
    const a = rect(0, 0, 2, 2, 1.5, "a");
    const b = rect(0.5, 0, 2, 2, 1.5, "b");
    expect(obstaclesOverlap(a, b)).toBe(true);
    const result = validateObstacle(b, {
      terrace: TERRACE,
      others: [a],
      parapetInsetM: CLEARANCE,
      parapetContactM: CONTACT,
    });
    expect(result.valid).toBe(false);
  });

  it("allows obstacles that merely touch each other's edges", () => {
    const a = rect(0, 0, 2, 2, 1.5, "a");
    const b = rect(2, 0, 2, 2, 1.5, "b"); // shares the x = 1 plane
    expect(obstaclesOverlap(a, b)).toBe(false);
  });
});
