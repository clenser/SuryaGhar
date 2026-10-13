/**
 * Coordinate conversion: Geographic (WGS84) → UTM metric → Local 3D (Three.js)
 *
 * The authoritative geographic geometry comes from the existing `projectUtm` in
 * `lib/geo.ts`. This module only translates those projected metres into a local
 * engineering frame centred on the terrace centroid, so Three.js never has to
 * handle multi-million-metre UTM values (AGENTS.md §13, §64, §65).
 *
 * Pipeline:
 *   Lat/Lon → UTM (existing geometry engine) → local metres → Three.js units
 *
 * 1 Three.js unit = 1 metre (AGENTS.md §64). Nothing here measures pixels,
 * screen distance, or the rendered Google Maps polygon: every number is
 * projected geometry (AGENTS.md §52).
 */

import * as THREE from "three";
import { projectUtm, type LngLat } from "../geo";

export interface LocalCoords3D {
  /** Polygon vertices in local coordinates (centroid at origin, Z = 0) */
  vertices: THREE.Vector3[];
  /** Building height in metres (user-entered) */
  height: number;
  /** UTM zone used for the projection (reference/debugging) */
  utmZone: number;
  /** Local origin expressed in UTM metres (for reverse transformation) */
  centroidUtm: { x: number; y: number };
  /** Local origin expressed in WGS84 (for reference) */
  centroidLngLat: LngLat;
}

/**
 * Determine the UTM zone from a longitude.
 * Matches `utmZoneFor` in `lib/geo.ts`.
 */
export function getUtmZone(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

/**
 * Compute the centroid of a polygon in WGS84 degrees (arithmetic mean of the
 * unique vertices). Used for UTM zone determination and display only — metric
 * work always happens on projected coordinates.
 */
export function computeCentroidLngLat(vertices: LngLat[]): LngLat {
  const n = vertices.length;
  const lng = vertices.reduce((sum, v) => sum + v.lng, 0) / n;
  const lat = vertices.reduce((sum, v) => sum + v.lat, 0) / n;
  return { lng, lat };
}

/** Drop a duplicated closing vertex when the ring repeats its first point. */
function uniqueRing(points: LngLat[]): LngLat[] {
  if (points.length > 3 && points[0].lng === points[points.length - 1].lng && points[0].lat === points[points.length - 1].lat) {
    return points.slice(0, -1);
  }
  return points;
}

/**
 * Compute the centroid in UTM metres for a polygon in WGS84.
 */
export function computeCentroidUtm(vertices: LngLat[]): { x: number; y: number } {
  const ring = uniqueRing(vertices);
  if (ring.length === 0) return { x: 0, y: 0 };
  const utmVertices = ring.map(projectUtm);
  const anchor = utmVertices[0];
  let sumDx = 0;
  let sumDy = 0;
  for (const v of utmVertices) {
    sumDx += v.x - anchor.x;
    sumDy += v.y - anchor.y;
  }
  return {
    x: anchor.x + sumDx / utmVertices.length,
    y: anchor.y + sumDy / utmVertices.length,
  };
}

/**
 * Convert an arbitrary WGS84 polygon into local metres relative to a site's UTM origin.
 */
export function wgsPolygonToLocalMetres(
  polygon: LngLat[],
  originUtm: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const ring = uniqueRing(polygon);
  return ring.map((pt) => {
    const utm = projectUtm(pt);
    return {
      x: utm.x - originUtm.x,
      y: utm.y - originUtm.y,
    };
  });
}

/**
 * Convert a terrace polygon from WGS84 to local 3D coordinates.
 *
 * @param vertices Terrace polygon in WGS84 (closed or open — both accepted)
 * @param height   Building height in metres; must be a positive finite number
 * @throws when there are fewer than 3 vertices or the height is not positive
 */
export function terraceToLocal3D(vertices: LngLat[], height: number): LocalCoords3D {
  if (vertices.length < 3) {
    throw new Error("Need at least 3 vertices to create a building");
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error("Building height must be a positive number of metres");
  }

  // Unique vertices first: the closing duplicate must not weight the centroid.
  const ring = uniqueRing(vertices);
  const centroidLngLat = computeCentroidLngLat(ring);
  const utmZone = getUtmZone(centroidLngLat.lng);

  // Project every vertex with the authoritative UTM projection.
  const utmVertices = ring.map(projectUtm);

  // Local origin: the centroid in UTM metres. The mean is accumulated relative
  // to the first vertex so ~6,000,000 m northing never enters the summation —
  // otherwise double rounding alone would leave a visible offset at the origin.
  const anchor = utmVertices[0];
  let sumDx = 0;
  let sumDy = 0;
  for (const v of utmVertices) {
    sumDx += v.x - anchor.x;
    sumDy += v.y - anchor.y;
  }
  const meanDx = sumDx / utmVertices.length;
  const meanDy = sumDy / utmVertices.length;
  const centroidUtm = { x: anchor.x + meanDx, y: anchor.y + meanDy };

  // Translate to local metres: X = easting, Y = northing, Z = 0 (ground).
  const verticesLocal = utmVertices.map(
    (v) => new THREE.Vector3(v.x - anchor.x - meanDx, v.y - anchor.y - meanDy, 0),
  );

  return {
    vertices: verticesLocal,
    height,
    utmZone,
    centroidUtm,
    centroidLngLat,
  };
}

/**
 * Convert a ground usable area polygon from WGS84 to local 3D coordinates at ground level (Z = 0).
 *
 * @param vertices Ground boundary polygon in WGS84
 * @param groundElevationM Base ground elevation in metres (default 0)
 * @throws when there are fewer than 3 vertices
 */
export function groundPolygonToLocal3D(vertices: LngLat[], groundElevationM: number = 0): LocalCoords3D {
  if (vertices.length < 3) {
    throw new Error("Need at least 3 vertices to create a ground site");
  }

  const ring = uniqueRing(vertices);
  const centroidLngLat = computeCentroidLngLat(ring);
  const utmZone = getUtmZone(centroidLngLat.lng);
  const utmVertices = ring.map(projectUtm);

  const anchor = utmVertices[0];
  let sumDx = 0;
  let sumDy = 0;
  for (const v of utmVertices) {
    sumDx += v.x - anchor.x;
    sumDy += v.y - anchor.y;
  }
  const meanDx = sumDx / utmVertices.length;
  const meanDy = sumDy / utmVertices.length;
  const centroidUtm = { x: anchor.x + meanDx, y: anchor.y + meanDy };

  const verticesLocal = utmVertices.map(
    (v) => new THREE.Vector3(v.x - anchor.x - meanDx, v.y - anchor.y - meanDy, groundElevationM),
  );

  return {
    vertices: verticesLocal,
    height: 0,
    utmZone,
    centroidUtm,
    centroidLngLat,
  };
}

/**
 * Axis-aligned bounds of local vertices, for camera framing and readouts.
 */
export function getLocalBounds(vertices: THREE.Vector3[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const v of vertices) {
    box.expandByPoint(v);
  }
  return box;
}

/**
 * Ground radius: the farthest vertex distance from the local origin.
 * Used to size the camera framing and the ground reference plane.
 */
export function getGroundRadius(vertices: THREE.Vector3[]): number {
  let maxDist = 0;
  for (const v of vertices) {
    const dist = Math.hypot(v.x, v.y);
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist;
}
