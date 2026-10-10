/**
 * Tests for the building model state: terrace polygon + height → 3D model.
 *
 * Covers height validation (valid / zero / negative / out of range), height
 * propagation into the extrusion, local-origin placement and preservation of
 * the polygon's real dimensions.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_BUILDING_HEIGHT_M,
  MIN_BUILDING_HEIGHT_M,
  createBuildingModel,
  validateBuildingHeight,
} from "../lib/3d/building";
import { analyzePolygon, projectUtm, type LngLat } from "../lib/geo";

const TERRACE: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

/** Irregular L-shaped terrace: must never be replaced by a rectangle. */
const L_SHAPED: LngLat[] = [
  { lng: 88.3600, lat: 22.5700 },
  { lng: 88.3606, lat: 22.5700 },
  { lng: 88.3606, lat: 22.5704 },
  { lng: 88.3603, lat: 22.5704 },
  { lng: 88.3603, lat: 22.5708 },
  { lng: 88.3600, lat: 22.5708 },
];

/** Shoelace area of a local (metre) ring. */
function localArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

describe("validateBuildingHeight", () => {
  it("accepts valid building heights", () => {
    for (const height of [MIN_BUILDING_HEIGHT_M, 3, 17.2, MAX_BUILDING_HEIGHT_M]) {
      expect(validateBuildingHeight(height)).toBeNull();
    }
  });

  it("rejects zero and negative heights", () => {
    expect(validateBuildingHeight(0)).toMatch(/at least/i);
    expect(validateBuildingHeight(-1)).toMatch(/at least/i);
    expect(validateBuildingHeight(-50)).toMatch(/at least/i);
  });

  it("rejects non-numeric input", () => {
    expect(validateBuildingHeight(Number.NaN)).toMatch(/valid number/i);
    expect(validateBuildingHeight(Number.POSITIVE_INFINITY)).toMatch(/valid number/i);
    expect(validateBuildingHeight(undefined)).toMatch(/valid number/i);
    expect(validateBuildingHeight("17.2" as unknown)).toMatch(/valid number/i);
  });

  it("rejects heights outside the plausible building range", () => {
    expect(validateBuildingHeight(MIN_BUILDING_HEIGHT_M / 2)).toMatch(/at least/i);
    expect(validateBuildingHeight(MAX_BUILDING_HEIGHT_M + 1)).toMatch(/not exceed/i);
  });
});

describe("createBuildingModel", () => {
  it("creates a 3D building state from a valid height", () => {
    const model = createBuildingModel(TERRACE, 17.2);

    expect(model.heightM).toBe(17.2);
    expect(model.coords.height).toBe(17.2);
    expect(model.vertexCount).toBe(4);
    expect(model.coords.utmZone).toBe(45);
    expect(model.extentM.east).toBeGreaterThan(0);
    expect(model.extentM.north).toBeGreaterThan(0);
  });

  it("propagates the height without touching the footprint", () => {
    const short = createBuildingModel(TERRACE, 3);
    const tall = createBuildingModel(TERRACE, 30);

    expect(tall.coords.height).toBe(30);
    expect(short.coords.height).toBe(3);
    expect(tall.extentM.east).toBeCloseTo(short.extentM.east, 9);
    expect(tall.extentM.north).toBeCloseTo(short.extentM.north, 9);

    // Extrusion is vertical only: every footprint vertex stays on the ground.
    for (const v of tall.coords.vertices) expect(v.z).toBe(0);
  });

  it("rejects invalid heights", () => {
    expect(() => createBuildingModel(TERRACE, 0)).toThrow();
    expect(() => createBuildingModel(TERRACE, -4)).toThrow();
    expect(() => createBuildingModel(TERRACE, Number.NaN)).toThrow();
    expect(() => createBuildingModel(TERRACE, MAX_BUILDING_HEIGHT_M + 10)).toThrow();
  });

  it("places the local origin on the terrace centroid", () => {
    const model = createBuildingModel(TERRACE, 10);
    const centroidX = model.coords.vertices.reduce((s, v) => s + v.x, 0) / model.coords.vertices.length;
    const centroidY = model.coords.vertices.reduce((s, v) => s + v.y, 0) / model.coords.vertices.length;

    expect(Math.abs(centroidX)).toBeLessThan(1e-10);
    expect(Math.abs(centroidY)).toBeLessThan(1e-10);

    // The origin recorded in UTM is the projected centroid of the polygon.
    const utm = TERRACE.map(projectUtm);
    const meanX = utm.reduce((s, p) => s + p.x, 0) / utm.length;
    const meanY = utm.reduce((s, p) => s + p.y, 0) / utm.length;
    expect(model.coords.centroidUtm.x).toBeCloseTo(meanX, 6);
    expect(model.coords.centroidUtm.y).toBeCloseTo(meanY, 6);
  });

  it("keeps the exact shape of an irregular terrace", () => {
    const model = createBuildingModel(L_SHAPED, 12);

    // Every vertex survives the conversion — no rectangle substitution.
    expect(model.vertexCount).toBe(L_SHAPED.length);

    // Footprint area in local metres matches the authoritative projected area.
    expect(localArea(model.coords.vertices)).toBeCloseTo(analyzePolygon(L_SHAPED).areaM2, 3);
  });

  it("preserves edge lengths of the terrace", () => {
    const model = createBuildingModel(TERRACE, 10);
    const utm = TERRACE.map(projectUtm);

    for (let i = 0; i < model.coords.vertices.length; i++) {
      const a = model.coords.vertices[i];
      const b = model.coords.vertices[(i + 1) % model.coords.vertices.length];
      const ua = utm[i];
      const ub = utm[(i + 1) % utm.length];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(Math.hypot(ua.x - ub.x, ua.y - ub.y), 6);
    }
  });
});
