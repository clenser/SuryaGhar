/**
 * Parapet enhancement: inward offset math, parapet mesh construction,
 * height rules, and parapet-aware obstacle validation.
 */
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_PARAPET_HEIGHT_M,
  DEFAULT_PARAPET_THICKNESS_M,
  PARAPET_CLEARANCE_M,
  createBuildingMeshes,
  createParapetMeshes,
  disposeBuildingMeshes,
  offsetPolygonInward,
  validateParapetHeight,
} from "../lib/3d/geometry";
import { terraceToLocal3D } from "../lib/3d/coordinates";
import type { LngLat } from "../lib/geo";
import {
  pointSegmentDistance,
  validateObstacle,
  type Obstacle,
} from "../lib/3d/obstacles";

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return { ...actual, WebGLRenderer: vi.fn() };
});

const SQUARE: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

// Concave L-shape in local metres (notch at the top-right).
const LSHAPE = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 8 },
  { x: 8, y: 8 },
  { x: 8, y: 20 },
  { x: 0, y: 20 },
];

function tankAt(x: number, y: number): Obstacle {
  return {
    id: "t1",
    type: "water-tank",
    position: { x, y },
    width: 2.5,
    length: 2.5,
    height: 2,
    rotation: 0,
  };
}

describe("offsetPolygonInward", () => {
  it("insets a square uniformly on every side", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const inner = offsetPolygonInward(ring, 0.6);
    expect(inner).not.toBeNull();
    const xs = inner!.map((p) => p.x);
    const ys = inner!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0.6, 6);
    expect(Math.max(...xs)).toBeCloseTo(19.4, 6);
    expect(Math.min(...ys)).toBeCloseTo(0.6, 6);
    expect(Math.max(...ys)).toBeCloseTo(19.4, 6);
  });

  it("keeps a concave L-shape valid with exact miter joints", () => {
    const inner = offsetPolygonInward(LSHAPE, 0.6);
    expect(inner).not.toBeNull();
    // Out[i] corresponds to LSHAPE[i]; spot-check convex and notch corners.
    const at = (i: number) => inner![i];
    expect(at(0).x).toBeCloseTo(0.6, 6);
    expect(at(0).y).toBeCloseTo(0.6, 6);
    expect(at(1).x).toBeCloseTo(19.4, 6);
    expect(at(2).y).toBeCloseTo(7.4, 6);
    expect(at(3).x).toBeCloseTo(7.4, 6);
    expect(at(3).y).toBeCloseTo(7.4, 6);
    expect(at(4).x).toBeCloseTo(7.4, 6);
    expect(at(5).y).toBeCloseTo(19.4, 6);
  });

  it("returns null when the offset consumes the polygon", () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(offsetPolygonInward(tiny, 5)).toBeNull();
    expect(offsetPolygonInward(tiny, 0)).toBeNull();
    expect(offsetPolygonInward([{ x: 0, y: 0 }], 0.5)).toBeNull();
  });
});

describe("parapet heights", () => {
  it("validates the parapet range", () => {
    expect(validateParapetHeight(1.0)).toBeNull();
    expect(validateParapetHeight(0.1)).toMatch(/at least/);
    expect(validateParapetHeight(5)).toMatch(/exceed/);
    expect(validateParapetHeight(NaN)).toMatch(/valid number/);
  });

  it("computes total height as building plus parapet, never double-counted", () => {
    const coords = terraceToLocal3D(SQUARE, 15);
    const meshes = createBuildingMeshes(
      coords,
      undefined,
      undefined,
      { heightM: DEFAULT_PARAPET_HEIGHT_M, thicknessM: DEFAULT_PARAPET_THICKNESS_M },
    );
    try {
      expect(meshes.parapet).not.toBeNull();
      const box = new THREE.Box3().setFromObject(meshes.parapet!);
      // Base exactly on the roof, top exactly roof + parapet.
      expect(box.min.z).toBeCloseTo(15, 3);
      expect(box.max.z).toBeCloseTo(15 + DEFAULT_PARAPET_HEIGHT_M, 3);
      const body = new THREE.Box3().setFromObject(meshes.building);
      expect(body.max.z).toBeCloseTo(15, 3); // roof unmoved
    } finally {
      disposeBuildingMeshes(meshes);
    }
  });

  it("omits the parapet when none is requested (backward compatible)", () => {
    const coords = terraceToLocal3D(SQUARE, 15);
    const meshes = createBuildingMeshes(coords);
    try {
      expect(meshes.parapet).toBeNull();
      expect(meshes.all).toHaveLength(3);
    } finally {
      disposeBuildingMeshes(meshes);
    }
  });

  it("rejects a parapet that cannot fit the footprint", () => {
    expect(() =>
      createParapetMeshes(
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 1, 0)],
        10,
        { heightM: 1, thicknessM: 5 },
      ),
    ).toThrow(/does not fit|degenerat/);
  });
});

describe("parapet-aware obstacle validation", () => {
  const inset = DEFAULT_PARAPET_THICKNESS_M + PARAPET_CLEARANCE_M; // 0.6 m
  const terrace = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ];

  it("accepts a centred obstacle with room to spare", () => {
    expect(validateObstacle(tankAt(0, 0), { terrace, others: [], parapetInsetM: inset }).valid).toBe(true);
  });

  it("rejects an obstacle corner inside the parapet clear zone", () => {
    // 2.5 m tank centred at x = 8.5: east corners at 9.75, only 0.25 m
    // from the edge — inside the 0.6 m clear zone.
    const result = validateObstacle(tankAt(8.5, 0), { terrace, others: [], parapetInsetM: inset });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/parapet|inside the rooftop edge/);
  });

  it("measures exact corner-to-edge distance", () => {
    expect(pointSegmentDistance({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5, 9);
    expect(pointSegmentDistance({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5, 9);
    expect(pointSegmentDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0, 9);
  });
});
