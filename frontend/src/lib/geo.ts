/**
 * Metric geometry for rooftop-scale polygons.
 * Coordinates are projected into the appropriate UTM zone (Transverse Mercator
 * series, accurate to well under a centimetre inside a zone) before any metric
 * calculation. Never computes area directly from degrees.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const K0 = 0.9996;

export function utmZoneFor(lng: number, _lat: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

export function projectUtm(point: LngLat): { x: number; y: number } {
  const { lat, lng } = point;
  const zone = utmZoneFor(lng, lat);
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const latRad = (lat * Math.PI) / 180;
  const dLng = ((lng - lon0) * Math.PI) / 180;
  const e2 = WGS84_E2;
  const ep2 = e2 / (1 - e2);
  const N = WGS84_A / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ep2 * Math.cos(latRad) ** 2;
  const A = dLng * Math.cos(latRad);
  const M =
    WGS84_A *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));
  const x =
    K0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;
  let y =
    K0 *
    (M +
      N *
        Math.tan(latRad) *
        ((A ** 2) / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return { x, y };
}

export interface PolygonMetrics {
  areaM2: number;
  perimeterM: number;
  centroid: LngLat;
  valid: boolean;
  issue: string | null;
}

/** Signed area of a closed ring using the shoelace formula (projected coords). */
function ringArea(coords: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    const b = coords[(i + 1) % coords.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function orientations(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x: number; y: number },
): number {
  const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const o1 = orientations(a, b, c);
  const o2 = orientations(a, b, d);
  const o3 = orientations(c, d, a);
  const o4 = orientations(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

/** True when any non-adjacent edges cross. */
export function ringSelfIntersects(points: LngLat[]): boolean {
  const projected = points.map(projectUtm);
  const n = projected.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (
        segmentsIntersect(projected[i], projected[(i + 1) % n], projected[j], projected[(j + 1) % n])
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Computes area, perimeter, centroid and a basic validity verdict for a WGS84 ring. */
export function analyzePolygon(points: LngLat[]): PolygonMetrics {
  if (points.length < 3) {
    return { areaM2: 0, perimeterM: 0, centroid: points[0] ?? { lng: 0, lat: 0 }, valid: false, issue: "Need at least 3 points" };
  }
  const projected = points.map(projectUtm);
  const area = Math.abs(ringArea(projected));
  let perimeter = 0;
  for (let i = 0; i < projected.length; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    perimeter += Math.hypot(a.x - b.x, a.y - b.y);
  }
  const cx = projected.reduce((s, p) => s + p.x, 0) / projected.length;
  const cy = projected.reduce((s, p) => s + p.y, 0) / projected.length;
  // Inverse of the local projection is well-approximated by one Newton step through linearisation;
  // for the centroid display in degrees, using unproject is simpler via iterative refinement is
  // overkill: fall back to the arithmetic mean in degrees, which differs negligibly at this scale.
  void cx;
  void cy;
  const centroid = {
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
  };
  let valid = true;
  let issue: string | null = null;
  if (ringSelfIntersects(points)) {
    valid = false;
    issue = "Polygon edges cross each other";
  } else if (area < 1) {
    valid = false;
    issue = "Area is effectively zero";
  }
  return { areaM2: area, perimeterM: perimeter, centroid, valid, issue };
}

export function formatArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${m2.toFixed(m2 >= 100 ? 0 : 1)} m²`;
}
