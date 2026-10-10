/**
 * Tests for 3D coordinate conversion: Geographic → UTM → Local
 */

import { describe, expect, it } from "vitest";
import { projectUtm, type LngLat } from "../lib/geo";
import {
  terraceToLocal3D,
  getUtmZone,
  computeCentroidLngLat,
  getLocalBounds,
  getGroundRadius,
} from "../lib/3d/coordinates";

// Simple rectangle polygon around a known location (Kolkata area)
const TEST_VERTICES: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

describe("getUtmZone", () => {
  it("returns correct UTM zone for Kolkata (88.36°E)", () => {
    expect(getUtmZone(88.36)).toBe(45);
  });

  it("returns correct UTM zone for Delhi (77.21°E)", () => {
    expect(getUtmZone(77.21)).toBe(43);
  });

  it("returns correct UTM zone for Mumbai (72.88°E)", () => {
    expect(getUtmZone(72.88)).toBe(43);
  });

  it("handles negative longitudes (Western hemisphere)", () => {
    expect(getUtmZone(-74.0)).toBe(18); // New York area
  });
});

describe("computeCentroidLngLat", () => {
  it("computes centroid of a rectangle", () => {
    const centroid = computeCentroidLngLat(TEST_VERTICES);
    expect(centroid.lng).toBeCloseTo(88.3642, 4);
    expect(centroid.lat).toBeCloseTo(22.57285, 4);
  });
});

describe("terraceToLocal3D", () => {
  it("converts vertices to local coordinates centered at origin", () => {
    const height = 10;
    const result = terraceToLocal3D(TEST_VERTICES, height);

    expect(result.height).toBe(height);
    expect(result.utmZone).toBe(45);
    expect(result.vertices.length).toBe(4); // Closed polygon, duplicate removed

    // Centroid should be at origin (0, 0, 0)
    const centroidX = result.vertices.reduce((sum, v) => sum + v.x, 0) / result.vertices.length;
    const centroidY = result.vertices.reduce((sum, v) => sum + v.y, 0) / result.vertices.length;
    expect(Math.abs(centroidX)).toBeLessThan(1e-10);
    expect(Math.abs(centroidY)).toBeLessThan(1e-10);

    // All Z should be 0 (ground level)
    for (const v of result.vertices) {
      expect(v.z).toBe(0);
    }
  });

  it("preserves relative distances between vertices", () => {
    const result = terraceToLocal3D(TEST_VERTICES, 10);

    // Calculate edge lengths in local coordinates
    const edges = [];
    for (let i = 0; i < result.vertices.length; i++) {
      const a = result.vertices[i];
      const b = result.vertices[(i + 1) % result.vertices.length];
      edges.push(Math.hypot(a.x - b.x, a.y - b.y));
    }

    // Compare with UTM-projected edge lengths
    const utmVertices = TEST_VERTICES.map(projectUtm);
    const utmEdges = [];
    for (let i = 0; i < utmVertices.length; i++) {
      const a = utmVertices[i];
      const b = utmVertices[(i + 1) % utmVertices.length];
      utmEdges.push(Math.hypot(a.x - b.x, a.y - b.y));
    }

    // Should match (within floating point precision)
    for (let i = 0; i < edges.length; i++) {
      expect(edges[i]).toBeCloseTo(utmEdges[i], 6);
    }
  });

  it("throws on insufficient vertices", () => {
    expect(() => terraceToLocal3D([{ lng: 0, lat: 0 }], 10)).toThrow("Need at least 3 vertices");
    expect(() => terraceToLocal3D([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], 10)).toThrow(
      "Need at least 3 vertices"
    );
  });

  it("accepts valid building heights", () => {
    for (const height of [0.5, 3, 17.2, 200]) {
      const result = terraceToLocal3D(TEST_VERTICES, height);
      expect(result.height).toBe(height);
      expect(result.vertices).toHaveLength(4);
    }
  });

  it("rejects zero, negative and non-finite heights", () => {
    for (const height of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => terraceToLocal3D(TEST_VERTICES, height)).toThrow(/positive number/i);
    }
  });

  it("handles polygon that is already closed", () => {
    const closedVertices = [...TEST_VERTICES, TEST_VERTICES[0]];
    const result = terraceToLocal3D(closedVertices, 10);

    // Should have 4 unique vertices (duplicate removed)
    expect(result.vertices.length).toBe(4);
  });

  it("centroidUtm matches projected centroid", () => {
    const result = terraceToLocal3D(TEST_VERTICES, 10);
    const utmVertices = TEST_VERTICES.map(projectUtm);
    const expectedCentroidX = utmVertices.reduce((sum, v) => sum + v.x, 0) / utmVertices.length;
    const expectedCentroidY = utmVertices.reduce((sum, v) => sum + v.y, 0) / utmVertices.length;

    expect(result.centroidUtm.x).toBeCloseTo(expectedCentroidX, 6);
    expect(result.centroidUtm.y).toBeCloseTo(expectedCentroidY, 6);
  });
});

describe("getLocalBounds", () => {
  it("computes correct bounding box", () => {
    const result = terraceToLocal3D(TEST_VERTICES, 10);
    const bounds = getLocalBounds(result.vertices);

    expect(bounds.min.x).toBeLessThan(0);
    expect(bounds.max.x).toBeGreaterThan(0);
    expect(bounds.min.y).toBeLessThan(0);
    expect(bounds.max.y).toBeGreaterThan(0);
    expect(bounds.min.z).toBe(0);
    expect(bounds.max.z).toBe(0);
  });
});

describe("getGroundRadius", () => {
  it("returns max distance from origin to any vertex", () => {
    const result = terraceToLocal3D(TEST_VERTICES, 10);
    const radius = getGroundRadius(result.vertices);

    // Should be positive and reasonable for this polygon size
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(500); // Reasonable for rooftop scale
  });
});