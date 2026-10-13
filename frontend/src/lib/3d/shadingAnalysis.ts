/**
 * M4: Advanced Annual Shading Analysis and Module-Level Shading Engine
 *
 * Implements deterministic geometric and solar-physics analytical models:
 * 1. Sun position calculation across seasonal/hourly timestamps (reusing Meeus / NOAA algorithms).
 * 2. Obstacle, tree canopy, and parapet shadow projection onto individual solar panels.
 * 3. Exact Sutherland-Hodgman polygon clipping / polygon area intersection to evaluate
 *    geometric shaded-area fraction for EACH panel.
 * 4. Distinct calculations for:
 *    - Geometric area shaded fraction (0 to 1)
 *    - Direct-beam irradiance blocked vs diffuse / albedo irradiance
 *    - Plane-Of-Array (POA) shaded vs unshaded irradiance (W/m²)
 *    - Temperature-derated AC power (W) and energy production (kWh)
 *    - Module-level electrical shading loss using cell string approximation (documented assumption).
 * 5. Annual simulation across representative seasonal days (e.g. solstices, equinoxes, and mid-seasons),
 *    weighted to yield 365-day annual production (kWh/yr) and shading loss (kWh/yr, %).
 * 6. Explicit height uncertainty tracking for trees, obstacles, parapets, and surrounding buildings.
 *
 * Zero random numbers. Zero canvas/Three.js pixel dependencies.
 */

import type { Obstacle, Point2 } from "./obstacles";
import type { Tree } from "./treeTypes";
import { treeFootprint } from "./treeTypes";
import { effectivePanelDims, panelTypeDefinition, type PanelLayoutConfig } from "./panels";
import { rectangleCorners } from "./panelPlacement";
import { solarPosition } from "../solar/solarPosition";
import { localWallClockToUtc, resolveSiteTimezone } from "../solar/timezone";

/** Point in 3D local metric coordinates (X = East, Y = North, Z = Up). */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Surrounding building reference with optional height data. */
export interface SurroundingBuildingRef {
  id: string;
  footprint: Point2[];
  heightM: number | null;
  distanceM: number;
}

/** Information about an evaluated individual panel. */
export interface AnalyzedPanel {
  id: string;
  setId: string;
  panelIndex: number;
  center: Point2;
  rotationDeg: number;
  corners: Point2[];
  tiltDeg: number;
  azimuthDeg: number;
  wattageW: number;
  /** Mean geometric shaded area fraction across all daylight hours (0 - 1). */
  annualMeanShadeFraction: number;
  /** Peak geometric shaded area fraction encountered (0 - 1). */
  peakShadeFraction: number;
  /** Estimated unshaded annual energy in kWh/year. */
  annualUnshadedKwh: number;
  /** Estimated shaded annual energy in kWh/year. */
  annualShadedKwh: number;
  /** Annual energy lost due to shading in kWh/year. */
  annualLossKwh: number;
  /** Percentage energy loss relative to unshaded baseline (0 - 100). */
  annualLossPercent: number;
  /** Shading severity category for UI visualization: 'none' | 'moderate' | 'severe'. */
  severity: "none" | "moderate" | "severe";
  /** Hourly shaded fraction profile for representative timestamps. */
  seasonalSampleShades: Array<{
    season: "winter_solstice" | "spring_equinox" | "summer_solstice" | "autumn_equinox";
    hour: number;
    shadeFraction: number;
  }>;
}

/** Season definition for annual weighted solar simulation. */
export interface RepresentativeSeason {
  id: "winter_solstice" | "spring_equinox" | "summer_solstice" | "autumn_equinox";
  label: string;
  date: string; // ISO date YYYY-MM-DD
  dayOfYear: number;
  weightDays: number; // Number of days in the year represented by this season slice
}

export const REPRESENTATIVE_SEASONS: RepresentativeSeason[] = [
  { id: "winter_solstice", label: "Winter (Dec 21)", date: "2026-12-21", dayOfYear: 355, weightDays: 91 },
  { id: "spring_equinox", label: "Spring (Mar 20)", date: "2026-03-20", dayOfYear: 79, weightDays: 91 },
  { id: "summer_solstice", label: "Summer (Jun 21)", date: "2026-06-21", dayOfYear: 172, weightDays: 92 },
  { id: "autumn_equinox", label: "Autumn (Sep 22)", date: "2026-09-22", dayOfYear: 265, weightDays: 91 },
];

/** Summary of annual shading analysis across all placed panels. */
export interface AnnualShadingResult {
  panels: AnalyzedPanel[];
  totalPanels: number;
  installedCapacityKwp: number;
  annualUnshadedKwh: number;
  annualShadedKwh: number;
  annualLossKwh: number;
  annualLossPercent: number;
  /** Count of panels categorized by severity. */
  severityCounts: {
    none: number;
    moderate: number;
    severe: number;
  };
  /** Seasonal breakdown of energy and loss. */
  seasons: Array<{
    id: RepresentativeSeason["id"];
    label: string;
    unshadedKwh: number;
    shadedKwh: number;
    lossPercent: number;
  }>;
  /** Height uncertainty and data completeness metadata. */
  uncertainty: {
    missingBuildingHeight: boolean;
    missingNearbyHeightsCount: number;
    estimatedTreeCanopiesCount: number;
    confidence: "high" | "medium" | "low";
    notes: string[];
  };
}

/**
 * 2D cross product of vectors OA and OB.
 */
function cross(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Twice the signed area of a 2D polygon. */
export function polygonArea2(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Convex hull using Monotone Chain. */
export function computeConvexHull(points: Point2[]): Point2[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const sorted = points.map((p) => ({ ...p })).sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Point2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Line intersection for Sutherland-Hodgman clipping. */
function lineIntersection(p: Point2, q: Point2, a: Point2, b: Point2): Point2 {
  const a1 = b.y - a.y;
  const b1 = a.x - b.x;
  const c1 = a1 * a.x + b1 * a.y;
  const a2 = q.y - p.y;
  const b2 = p.x - q.x;
  const c2 = a2 * p.x + b2 * p.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) return { x: q.x, y: q.y };
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

function sideOfEdge(p: Point2, a: Point2, b: Point2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Clip subject polygon to one half-plane of edge a->b. */
function clipHalfPlane(subject: Point2[], a: Point2, b: Point2): Point2[] {
  const result: Point2[] = [];
  for (let i = 0; i < subject.length; i++) {
    const curr = subject[i];
    const next = subject[(i + 1) % subject.length];
    const dc = sideOfEdge(curr, a, b);
    const dn = sideOfEdge(next, a, b);
    if (dc <= 0) result.push(curr);
    if ((dc < 0 && dn > 0) || (dc > 0 && dn < 0)) {
      result.push(lineIntersection(curr, next, a, b));
    }
  }
  return result;
}

/** Ensure polygon has clockwise winding order for clipToHalfPlane. */
export function ensureClockwise(polygon: Point2[]): Point2[] {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  // If signed area is positive (counter-clockwise), reverse to clockwise
  if (sum > 0) {
    return [...polygon].reverse();
  }
  return polygon;
}

/** Clip subject polygon inside a convex clipper polygon. */
export function clipPolygonConvex(subject: Point2[], clipper: Point2[]): Point2[] {
  const cwClipper = ensureClockwise(clipper);
  let output = subject.map((p) => ({ ...p }));
  for (let i = 0; i < cwClipper.length && output.length > 0; i++) {
    output = clipHalfPlane(output, cwClipper[i], cwClipper[(i + 1) % cwClipper.length]);
  }
  return output;
}

/**
 * Projects an elevated obstacle onto the roof plane (at roofZ) along the sun ray.
 *
 * For rooftop obstacles: baseZ = roofZ, topZ = roofZ + height.
 * For ground-planted trees: baseZ is the canopy base elevation (or 0 for trunk), topZ is the total tree height.
 * 
 * Physics principles:
 * 1. If topZ <= roofZ: The entire obstacle is below or level with the roof plane.
 *    Downwards sunlight rays cannot intersect the roof plane after passing through the obstacle.
 *    Returns empty array [] (zero shadow on roof).
 * 2. Only the portion of the obstacle above the roof plane (z >= roofZ) can cast a shadow ONTO the roof plane.
 *    The elevation range above the roof plane is [effectiveBaseZ, topZ] where effectiveBaseZ = Math.max(roofZ, baseZ).
 * 3. A point (x, y, z) casts shadow onto the horizontal plane at Z = roofZ at:
 *    (x - (z - roofZ)/tan(el) * sin(az), y - (z - roofZ)/tan(el) * cos(az)).
 *
 * @param footprint 2D footprint of the obstacle in local metres
 * @param baseZ Elevation of the obstacle base in local metres (e.g. roofZ for rooftop obstacles, canopy base for trees)
 * @param topZ Elevation of the obstacle top in local metres (total height)
 * @param roofZ Elevation of the roof surface in local metres
 * @param solarAzimuthDeg Solar azimuth degrees clockwise from North
 * @param solarElevationDeg Solar elevation degrees above horizon
 * @param receiverElevationAboveRoof Elevation of the receiver plane above the roof (e.g. panel surface elevation)
 */
export function projectObstacleShadowToRoof(
  footprint: Point2[],
  baseZ: number,
  topZ: number,
  roofZ: number,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
  receiverElevationAboveRoof: number = 0,
): Point2[] {
  if (solarElevationDeg <= 1.0) return []; // Sun at or below horizon
  const receiverZ = roofZ + Math.max(0, receiverElevationAboveRoof);
  if (topZ <= receiverZ) return []; // Obstacle does not reach receiver plane height

  const elRad = (solarElevationDeg * Math.PI) / 180;
  const azRad = (solarAzimuthDeg * Math.PI) / 180;
  const tanEl = Math.tan(elRad);
  if (tanEl <= 1e-4) return [];

  // Elevation span above receiver plane
  const effectiveTopH = topZ - receiverZ;
  const effectiveBaseH = Math.max(0, baseZ - receiverZ);

  const lenTop = effectiveTopH / tanEl;
  const lenBase = effectiveBaseH / tanEl;

  // Displacement pointing away from the sun
  const dxTop = -Math.sin(azRad) * lenTop;
  const dyTop = -Math.cos(azRad) * lenTop;
  const dxBase = -Math.sin(azRad) * lenBase;
  const dyBase = -Math.cos(azRad) * lenBase;

  const points: Point2[] = [
    ...footprint.map((p) => ({ x: p.x + dxBase, y: p.y + dyBase })),
    ...footprint.map((p) => ({ x: p.x + dxTop, y: p.y + dyTop })),
  ];

  return computeConvexHull(points);
}

/**
 * Projects parapet wall shadows onto the receiver surface along the sun ray.
 * 
 * Unlike solid obstacles whose entire footprint casts a single shadow hull,
 * a rooftop parapet is a thin perimeter wall standing on the outer edge of the roof.
 * Each wall edge (from A to B) only casts a shadow inward onto the roof plane
 * when the sun shines over that wall towards the roof interior.
 * The shadow cast by that wall edge is the narrow band/parallelogram
 * formed by [A, B, B + d, A + d] where d is the shadow displacement vector.
 * Walls where the sun shines from inside outward cast shadows away from the building
 * onto the exterior ground/facade, producing 0 shadow on the roof.
 */
export function computeParapetShadowPolygons(
  terraceRing: Point2[],
  parapetHeightM: number,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
  receiverElevationAboveRoof: number = 0,
): Point2[][] {
  const effectiveParapetH = Math.max(0, parapetHeightM - Math.max(0, receiverElevationAboveRoof));
  if (effectiveParapetH <= 0 || solarElevationDeg <= 1.0 || terraceRing.length < 3) return [];

  const elRad = (solarElevationDeg * Math.PI) / 180;
  const azRad = (solarAzimuthDeg * Math.PI) / 180;
  const tanEl = Math.tan(elRad);
  if (tanEl <= 1e-4) return [];

  const shadowLen = effectiveParapetH / tanEl;
  const dxTop = -Math.sin(azRad) * shadowLen;
  const dyTop = -Math.cos(azRad) * shadowLen;

  const cw = ensureClockwise(terraceRing);
  const shadowQuads: Point2[][] = [];

  for (let i = 0; i < cw.length; i++) {
    const a = cw[i];
    const b = cw[(i + 1) % cw.length];
    // Check if shadow displacement points inward into the clockwise polygon:
    // For clockwise winding, (B - A) x d < 0 indicates inward displacement.
    const crossVal = (b.x - a.x) * dyTop - (b.y - a.y) * dxTop;
    if (crossVal < -1e-4) {
      const quad = ensureClockwise([
        a,
        b,
        { x: b.x + dxTop, y: b.y + dyTop },
        { x: a.x + dxTop, y: a.y + dyTop },
      ]);
      if (quad.length >= 3) {
        shadowQuads.push(quad);
      }
    }
  }

  return shadowQuads;
}

/**
 * Computes inter-row panel shadow polygons cast by tilted panels onto neighboring panels.
 * In a tilted solar array, the raised back edge of a front row casts a shadow towards the back row
 * during low sun angles (e.g. morning, evening, or winter solstice).
 */
export function computePanelSelfShadowPolygons(
  panels: Array<{
    id: string;
    x: number;
    y: number;
    rotationDeg: number;
    config: PanelLayoutConfig;
  }>,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
): Map<string, Point2[][]> {
  const panelShadowMap = new Map<string, Point2[][]>();
  if (solarElevationDeg <= 1.0 || panels.length < 2) return panelShadowMap;

  const elRad = (solarElevationDeg * Math.PI) / 180;
  const azRad = (solarAzimuthDeg * Math.PI) / 180;
  const tanEl = Math.tan(elRad);
  if (tanEl <= 1e-4) return panelShadowMap;

  // Pre-compute geometric metadata per panel:
  const metadata = panels.map((p) => {
    const dims = effectivePanelDims(p.config);
    const tiltRad = (p.config.tiltDeg * Math.PI) / 180;
    const mountH = p.config.mountHeightM ?? 0.4;
    const elevatedSpan = dims.lengthM * Math.sin(tiltRad);
    const topZ = mountH + elevatedSpan;
    const receiverZ = mountH + 0.5 * elevatedSpan;
    const corners = rectangleCorners(p.x, p.y, dims.widthM, dims.lengthM, p.rotationDeg);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }

    return {
      id: p.id,
      corners,
      topZ,
      receiverZ,
      elevatedSpan,
      minX,
      maxX,
      minY,
      maxY,
    };
  });

  // For each caster panel, determine its shadow polygon on neighboring panels' receiver planes
  for (let i = 0; i < metadata.length; i++) {
    const caster = metadata[i];
    if (caster.elevatedSpan <= 0.05) continue; // Flat panel doesn't cast significant elevated shadow

    for (let j = 0; j < metadata.length; j++) {
      if (i === j) continue;
      const receiver = metadata[j];

      const deltaZ = caster.topZ - receiver.receiverZ;
      if (deltaZ <= 0.05) continue; // Caster is not higher than receiver

      const shadowLen = deltaZ / tanEl;
      if (shadowLen <= 0.01) continue;

      const dx = -Math.sin(azRad) * shadowLen;
      const dy = -Math.cos(azRad) * shadowLen;

      // Shadow bounding box of caster:
      const sMinX = Math.min(caster.minX, caster.minX + dx);
      const sMaxX = Math.max(caster.maxX, caster.maxX + dx);
      const sMinY = Math.min(caster.minY, caster.minY + dy);
      const sMaxY = Math.max(caster.maxY, caster.maxY + dy);

      // Fast AABB intersection test with receiver:
      if (sMaxX < receiver.minX || sMinX > receiver.maxX || sMaxY < receiver.minY || sMinY > receiver.maxY) {
        continue;
      }

      // Compute shadow polygon cast by caster onto receiver plane:
      const displacedCorners = caster.corners.map((c) => ({ x: c.x + dx, y: c.y + dy }));
      const shadowPoly = computeConvexHull([...caster.corners, ...displacedCorners]);

      if (shadowPoly.length >= 3) {
        let list = panelShadowMap.get(receiver.id);
        if (!list) {
          list = [];
          panelShadowMap.set(receiver.id, list);
        }
        list.push(shadowPoly);
      }
    }
  }

  return panelShadowMap;
}


/**
 * Computes fraction of a panel's rectangle covered by a set of shadow polygons.
 */
export function computePanelShadeFraction(
  panelCorners: Point2[],
  shadowPolygons: Point2[][],
): number {
  const panelArea = Math.abs(polygonArea2(panelCorners)) / 2;
  if (panelArea <= 1e-6 || shadowPolygons.length === 0) return 0;

  // 1. Fast bounding box rejection:
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of panelCorners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Find candidate shadow polygons that intersect the panel bounding box
  const overlappingShadows: Point2[][] = [];
  for (const shadow of shadowPolygons) {
    if (shadow.length < 3) continue;
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (const p of shadow) {
      if (p.x < sMinX) sMinX = p.x;
      if (p.x > sMaxX) sMaxX = p.x;
      if (p.y < sMinY) sMinY = p.y;
      if (p.y > sMaxY) sMaxY = p.y;
    }
    if (sMaxX < minX || sMinX > maxX || sMaxY < minY || sMinY > maxY) {
      continue;
    }
    const clipped = clipPolygonConvex(panelCorners, shadow);
    if (clipped.length >= 3) {
      overlappingShadows.push(shadow);
    }
  }

  if (overlappingShadows.length === 0) return 0;
  if (overlappingShadows.length === 1) {
    const clipped = clipPolygonConvex(panelCorners, overlappingShadows[0]);
    const area = Math.abs(polygonArea2(clipped)) / 2;
    return Math.min(1, Math.max(0, area / panelArea));
  }

  // For 2 overlapping shadows: A(P ∩ S1) + A(P ∩ S2) - A(P ∩ S1 ∩ S2)
  if (overlappingShadows.length === 2) {
    const p1 = clipPolygonConvex(panelCorners, overlappingShadows[0]);
    const p2 = clipPolygonConvex(panelCorners, overlappingShadows[1]);
    const a1 = Math.abs(polygonArea2(p1)) / 2;
    const a2 = Math.abs(polygonArea2(p2)) / 2;
    const p12 = clipPolygonConvex(p1, overlappingShadows[1]);
    const a12 = Math.abs(polygonArea2(p12)) / 2;
    const coveredArea = a1 + a2 - a12;
    return Math.min(1, Math.max(0, coveredArea / panelArea));
  }

  // For 3+ overlapping shadows: inclusion-exclusion up to pairwise overlap
  let coveredArea = 0;
  for (let i = 0; i < overlappingShadows.length; i++) {
    const pi = clipPolygonConvex(panelCorners, overlappingShadows[i]);
    coveredArea += Math.abs(polygonArea2(pi)) / 2;
    for (let j = i + 1; j < overlappingShadows.length; j++) {
      const pij = clipPolygonConvex(pi, overlappingShadows[j]);
      coveredArea -= Math.abs(polygonArea2(pij)) / 2;
    }
  }
  return Math.min(1, Math.max(0, coveredArea / panelArea));
}

/**
 * Calculates plane-of-array clear-sky irradiance and temperature derate for an hour.
 */
export function estimateHourIrradianceAndPower(
  watts: number,
  tiltDeg: number,
  azimuthDeg: number,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
  shadeFraction: number,
): { poaUnshaded: number; poaShaded: number; powerUnshadedW: number; powerShadedW: number } {
  if (solarElevationDeg <= 0) {
    return { poaUnshaded: 0, poaShaded: 0, powerUnshadedW: 0, powerShadedW: 0 };
  }

  const deg = Math.PI / 180;
  const zenithDeg = 90 - solarElevationDeg;
  const tRad = tiltDeg * deg;
  const surfaceAzRad = azimuthDeg * deg;
  const sunAzRad = solarAzimuthDeg * deg;
  const zenithRad = zenithDeg * deg;

  const cosIncidence = Math.min(
    1,
    Math.max(
      0,
      Math.sin(zenithRad) * Math.cos(tRad) * Math.cos(surfaceAzRad - sunAzRad) +
        Math.cos(zenithRad) * Math.sin(tRad),
    ),
  );

  // Clear-sky irradiance proxy derived from solar elevation
  const clearSkyGhi = Math.max(0, Math.sin(solarElevationDeg * deg)) * 950;
  const dni = clearSkyGhi * 0.88;
  const dhi = clearSkyGhi * 0.12;

  const beam = dni * cosIncidence;
  const diffuse = dhi * ((1 + Math.cos(tRad)) / 2);
  const groundAlbedo = 0.2;
  const groundReflected = clearSkyGhi * groundAlbedo * ((1 - Math.cos(tRad)) / 2);

  const poaUnshaded = beam + diffuse + groundReflected;
  // Shading blocks direct beam irradiance across the shaded area fraction
  const poaShaded = beam * (1 - shadeFraction) + diffuse + groundReflected;

  // Temperature derate: ambient ~28°C, cell heating with irradiance
  const cellTemp = 28 + Math.max(0, poaShaded / 800) * 30;
  const tempDerate = Math.max(0, 1 - 0.004 * (cellTemp - 25));
  const inverterEff = 0.96;

  const powerUnshadedW = (poaUnshaded / 1000) * watts * tempDerate * inverterEff;

  // Electrical shading model assumption:
  // Bypass diodes prevent total string shutdown, but unshaded portions cannot operate at 100%
  // if sub-strings are bypassed. We model electrical loss factor ~ shadeFraction * 1.15 (clamped at 1).
  const electricalLossFactor = Math.min(1, shadeFraction * 1.15);
  const powerShadedW = powerUnshadedW * (1 - electricalLossFactor);

  return { poaUnshaded, poaShaded, powerUnshadedW, powerShadedW };
}

/**
 * Performs full annual module-level shading analysis for all active panels.
 */
export function runAnnualShadingAnalysis(params: {
  panels: Array<{
    id: string;
    setId: string;
    index: number;
    x: number;
    y: number;
    rotationDeg: number;
    config: PanelLayoutConfig;
  }>;
  terraceRing: Point2[];
  roofZ: number;
  latitude: number;
  longitude: number;
  obstacles: Obstacle[];
  trees: Tree[];
  parapetHeightM: number;
  parapetClearanceM?: number;
  surroundingBuildings?: SurroundingBuildingRef[];
  timezone?: string;
}): AnnualShadingResult {
  const {
    panels,
    terraceRing,
    roofZ,
    latitude,
    longitude,
    obstacles,
    trees,
    parapetHeightM,
    surroundingBuildings = [],
    timezone,
  } = params;

  // Resolve site timezone: explicit parameter -> Indian coordinates -> browser zone
  const tz =
    timezone ||
    (latitude >= 6 && latitude <= 38 && longitude >= 68 && longitude <= 98
      ? "Asia/Kolkata"
      : resolveSiteTimezone());

  // Average receiver elevation above roof across placed panels (mounting height + half tilted length)
  let avgReceiverElev = 0.45;
  if (panels.length > 0) {
    let sumElev = 0;
    for (const p of panels) {
      const dims = effectivePanelDims(p.config);
      const tRad = (p.config.tiltDeg * Math.PI) / 180;
      const mountH = p.config.mountHeightM ?? 0.4;
      sumElev += mountH + (dims.lengthM / 2) * Math.sin(tRad);
    }
    avgReceiverElev = sumElev / panels.length;
  }

  const notes: string[] = [];
  let missingBuildingHeight = false;
  let missingNearbyHeightsCount = 0;
  let estimatedTreeCanopiesCount = 0;

  if (roofZ <= 0) {
    missingBuildingHeight = true;
    notes.push("Building height is 0m; shadows cast onto the roof from ground trees may be inaccurate.");
  }

  for (const b of surroundingBuildings) {
    if (b.heightM === null) missingNearbyHeightsCount++;
  }
  if (missingNearbyHeightsCount > 0) {
    notes.push(`${missingNearbyHeightsCount} nearby buildings have no height tag; excluded from shadow analysis.`);
  }

  for (const t of trees) {
    if (t.height > roofZ + avgReceiverElev) {
      estimatedTreeCanopiesCount++;
    }
  }

  const confidence: "high" | "medium" | "low" = missingBuildingHeight
    ? "low"
    : missingNearbyHeightsCount > 0
    ? "medium"
    : "high";

  // Pre-calculate obstacle footprints
  const obstacleGeoms = obstacles.map((o) => {
    let footprint: Point2[];
    if (o.polygon && o.polygon.length >= 3) {
      const hw = Math.cos((o.rotation * Math.PI) / 180);
      const sh = Math.sin((o.rotation * Math.PI) / 180);
      footprint = o.polygon.map((p) => ({
        x: o.position.x + p.x * hw - p.y * sh,
        y: o.position.y + p.x * sh + p.y * hw,
      }));
    } else {
      footprint = rectangleCorners(o.position.x, o.position.y, o.width, o.length, o.rotation);
    }
    return {
      footprint,
      baseZ: roofZ,
      topZ: roofZ + o.height,
    };
  });

  // Pre-calculate tree footprints and elevated canopy geometry
  // Trees are planted on the ground (ground Z = 0). The foliage canopy begins
  // above trunk height: broadleaf ~0.35H, conifer ~0.20H, small-ornamental ~0.40H.
  const treeGeoms = trees.map((t) => {
    const footprint = treeFootprint(t);
    const trunkFraction = t.type === "broadleaf" ? 0.35 : t.type === "conifer" ? 0.20 : 0.40;
    const canopyBaseZ = t.height * trunkFraction;
    return {
      footprint,
      baseZ: canopyBaseZ,
      topZ: t.height,
    };
  });

  // Initialize panel statistics collectors
  const panelMap = new Map<
    string,
    {
      panel: (typeof panels)[0];
      corners: Point2[];
      wattageW: number;
      totalShadeFractionSum: number;
      daylightHoursCount: number;
      peakShade: number;
      annualUnshadedKwh: number;
      annualShadedKwh: number;
      seasonalSampleShades: AnalyzedPanel["seasonalSampleShades"];
    }
  >();

  for (const p of panels) {
    const dims = effectivePanelDims(p.config);
    const corners = rectangleCorners(p.x, p.y, dims.widthM, dims.lengthM, p.rotationDeg);
    const def = panelTypeDefinition(p.config.panelTypeId);
    panelMap.set(p.id, {
      panel: p,
      corners,
      wattageW: def.watts,
      totalShadeFractionSum: 0,
      daylightHoursCount: 0,
      peakShade: 0,
      annualUnshadedKwh: 0,
      annualShadedKwh: 0,
      seasonalSampleShades: [],
    });
  }

  const seasonalBreakdown: AnnualShadingResult["seasons"] = [];

  // Run simulation across representative seasonal days
  for (const season of REPRESENTATIVE_SEASONS) {
    let seasonUnshadedKwh = 0;
    let seasonShadedKwh = 0;

    // Simulate daylight hours in the site's local wall-clock time
    for (let hour = 6; hour <= 18; hour++) {
      // Calculate sun position at this date & local hour
      const instant = localWallClockToUtc(season.date, hour * 60, tz);
      const sun = solarPosition(latitude, longitude, instant);

      if (sun.apparentElevationDeg <= 1.0) continue;

      // Project all shadows on the panel receiver plane
      const shadowPolygons: Point2[][] = [];

      for (const obs of obstacleGeoms) {
        const shadow = projectObstacleShadowToRoof(
          obs.footprint,
          obs.baseZ,
          obs.topZ,
          roofZ,
          sun.azimuthDeg,
          sun.apparentElevationDeg,
          avgReceiverElev,
        );
        if (shadow.length >= 3) shadowPolygons.push(shadow);
      }

      for (const tree of treeGeoms) {
        if (tree.topZ > roofZ + avgReceiverElev) {
          const shadow = projectObstacleShadowToRoof(
            tree.footprint,
            tree.baseZ,
            tree.topZ,
            roofZ,
            sun.azimuthDeg,
            sun.apparentElevationDeg,
            avgReceiverElev,
          );
          if (shadow.length >= 3) shadowPolygons.push(shadow);
        }
      }

      if (parapetHeightM > avgReceiverElev) {
        const parapetShadows = computeParapetShadowPolygons(
          terraceRing,
          parapetHeightM,
          sun.azimuthDeg,
          sun.apparentElevationDeg,
          avgReceiverElev,
        );
        for (const s of parapetShadows) shadowPolygons.push(s);
      }

      // Inter-row panel self-shading
      const interPanelShadows = computePanelSelfShadowPolygons(
        panels,
        sun.azimuthDeg,
        sun.apparentElevationDeg,
      );

      // Check each panel against the shadow polygons
      for (const entry of panelMap.values()) {
        const selfShadows = interPanelShadows.get(entry.panel.id);
        const allShadows =
          selfShadows && selfShadows.length > 0
            ? [...shadowPolygons, ...selfShadows]
            : shadowPolygons;

        const shade = computePanelShadeFraction(entry.corners, allShadows);
        entry.totalShadeFractionSum += shade;
        entry.daylightHoursCount += 1;
        if (shade > entry.peakShade) entry.peakShade = shade;

        // Collect seasonal sample
        if (hour % 2 === 0) {
          entry.seasonalSampleShades.push({
            season: season.id,
            hour,
            shadeFraction: shade,
          });
        }

        const { powerUnshadedW, powerShadedW } = estimateHourIrradianceAndPower(
          entry.wattageW,
          entry.panel.config.tiltDeg,
          entry.panel.config.azimuthDeg,
          sun.azimuthDeg,
          sun.apparentElevationDeg,
          shade,
        );

        // Hourly energy in kWh scaled by representative seasonal weight
        const unshadedDayKwh = powerUnshadedW / 1000;
        const shadedDayKwh = powerShadedW / 1000;

        entry.annualUnshadedKwh += unshadedDayKwh * season.weightDays;
        entry.annualShadedKwh += shadedDayKwh * season.weightDays;

        seasonUnshadedKwh += unshadedDayKwh * season.weightDays;
        seasonShadedKwh += shadedDayKwh * season.weightDays;
      }
    }

    const seasonLoss =
      seasonUnshadedKwh > 0 ? ((seasonUnshadedKwh - seasonShadedKwh) / seasonUnshadedKwh) * 100 : 0;
    seasonalBreakdown.push({
      id: season.id,
      label: season.label,
      unshadedKwh: Math.round(seasonUnshadedKwh),
      shadedKwh: Math.round(seasonShadedKwh),
      lossPercent: Math.round(seasonLoss * 10) / 10,
    });
  }

  // Aggregate results per panel
  const analyzedPanels: AnalyzedPanel[] = [];
  let severityNone = 0;
  let severityModerate = 0;
  let severitySevere = 0;

  let totalUnshaded = 0;
  let totalShaded = 0;
  let totalWatts = 0;

  for (const entry of panelMap.values()) {
    const meanShade =
      entry.daylightHoursCount > 0 ? entry.totalShadeFractionSum / entry.daylightHoursCount : 0;
    const lossKwh = Math.max(0, entry.annualUnshadedKwh - entry.annualShadedKwh);
    const lossPct =
      entry.annualUnshadedKwh > 0 ? (lossKwh / entry.annualUnshadedKwh) * 100 : 0;

    let severity: AnalyzedPanel["severity"] = "none";
    if (lossPct >= 12.0) {
      severity = "severe";
      severitySevere++;
    } else if (lossPct >= 3.5) {
      severity = "moderate";
      severityModerate++;
    } else {
      severityNone++;
    }

    totalUnshaded += entry.annualUnshadedKwh;
    totalShaded += entry.annualShadedKwh;
    totalWatts += entry.wattageW;

    analyzedPanels.push({
      id: entry.panel.id,
      setId: entry.panel.setId,
      panelIndex: entry.panel.index,
      center: { x: entry.panel.x, y: entry.panel.y },
      rotationDeg: entry.panel.rotationDeg,
      corners: entry.corners,
      tiltDeg: entry.panel.config.tiltDeg,
      azimuthDeg: entry.panel.config.azimuthDeg,
      wattageW: entry.wattageW,
      annualMeanShadeFraction: Math.round(meanShade * 100) / 100,
      peakShadeFraction: Math.round(entry.peakShade * 100) / 100,
      annualUnshadedKwh: Math.round(entry.annualUnshadedKwh),
      annualShadedKwh: Math.round(entry.annualShadedKwh),
      annualLossKwh: Math.round(lossKwh),
      annualLossPercent: Math.round(lossPct * 10) / 10,
      severity,
      seasonalSampleShades: entry.seasonalSampleShades,
    });
  }

  const overallLossKwh = Math.max(0, totalUnshaded - totalShaded);
  const overallLossPct = totalUnshaded > 0 ? (overallLossKwh / totalUnshaded) * 100 : 0;

  return {
    panels: analyzedPanels,
    totalPanels: panels.length,
    installedCapacityKwp: Math.round((totalWatts / 1000) * 100) / 100,
    annualUnshadedKwh: Math.round(totalUnshaded),
    annualShadedKwh: Math.round(totalShaded),
    annualLossKwh: Math.round(overallLossKwh),
    annualLossPercent: Math.round(overallLossPct * 10) / 10,
    severityCounts: {
      none: severityNone,
      moderate: severityModerate,
      severe: severitySevere,
    },
    seasons: seasonalBreakdown,
    uncertainty: {
      missingBuildingHeight,
      missingNearbyHeightsCount,
      estimatedTreeCanopiesCount,
      confidence,
      notes,
    },
  };
}

/** Instantaneous geometric shade result per panel at a specific sun position. */
export interface InstantaneousPanelShade {
  panelId: string;
  setId: string;
  index: number;
  shadeFraction: number; // 0 (unshaded) to 1.0 (fully shaded)
  shadedAreaM2: number;
  totalAreaM2: number;
  isNight?: boolean;
}

/**
 * Computes instantaneous geometric shade fraction for all active panels at the current sun azimuth/elevation.
 * Pure deterministic geometry, zero canvas pixel rendering dependencies.
 */
export function computeInstantaneousShade(params: {
  panels: Array<{
    id: string;
    setId: string;
    index: number;
    x: number;
    y: number;
    rotationDeg: number;
    config: PanelLayoutConfig;
  }>;
  terraceRing: Point2[];
  roofZ: number;
  solarAzimuthDeg: number;
  solarElevationDeg: number;
  obstacles: Obstacle[];
  trees: Tree[];
  parapetHeightM: number;
}): InstantaneousPanelShade[] {
  const { panels, terraceRing, roofZ, solarAzimuthDeg, solarElevationDeg, obstacles, trees, parapetHeightM } = params;

  if (solarElevationDeg <= 1.0 || panels.length === 0) {
    const isNight = solarElevationDeg <= 0;
    return panels.map((p) => {
      const dims = effectivePanelDims(p.config);
      const totalArea = dims.widthM * dims.lengthM;
      return {
        panelId: p.id,
        setId: p.setId,
        index: p.index,
        shadeFraction: 0,
        shadedAreaM2: 0,
        totalAreaM2: totalArea,
        isNight,
      };
    });
  }

  // Average receiver elevation above roof across placed panels (mounting height + half tilted length)
  let avgReceiverElev = 0.45;
  if (panels.length > 0) {
    let sumElev = 0;
    for (const p of panels) {
      const dims = effectivePanelDims(p.config);
      const tRad = (p.config.tiltDeg * Math.PI) / 180;
      const mountH = p.config.mountHeightM ?? 0.4;
      sumElev += mountH + (dims.lengthM / 2) * Math.sin(tRad);
    }
    avgReceiverElev = sumElev / panels.length;
  }

  // 1. Obstacle shadows projected to the elevated panel receiver plane
  const shadowPolygons: Point2[][] = [];
  for (const obs of obstacles) {
    let footprint: Point2[];
    if (obs.polygon && obs.polygon.length >= 3) {
      const hw = Math.cos((obs.rotation * Math.PI) / 180);
      const sh = Math.sin((obs.rotation * Math.PI) / 180);
      footprint = obs.polygon.map((p) => ({
        x: obs.position.x + p.x * hw - p.y * sh,
        y: obs.position.y + p.x * sh + p.y * hw,
      }));
    } else {
      footprint = rectangleCorners(obs.position.x, obs.position.y, obs.width, obs.length, obs.rotation);
    }
    const shadow = projectObstacleShadowToRoof(
      footprint,
      roofZ,
      roofZ + obs.height,
      roofZ,
      solarAzimuthDeg,
      solarElevationDeg,
      avgReceiverElev,
    );
    if (shadow.length >= 3) shadowPolygons.push(shadow);
  }

  // 2. Tree canopy shadows projected to the elevated panel receiver plane
  for (const tree of trees) {
    if (tree.height > roofZ + avgReceiverElev) {
      const footprint = treeFootprint(tree);
      const trunkFraction = tree.type === "broadleaf" ? 0.35 : tree.type === "conifer" ? 0.20 : 0.40;
      const canopyBaseZ = tree.height * trunkFraction;
      const shadow = projectObstacleShadowToRoof(
        footprint,
        canopyBaseZ,
        tree.height,
        roofZ,
        solarAzimuthDeg,
        solarElevationDeg,
        avgReceiverElev,
      );
      if (shadow.length >= 3) shadowPolygons.push(shadow);
    }
  }

  // 3. Parapet shadows projected to the elevated panel receiver plane
  if (parapetHeightM > avgReceiverElev) {
    const parapetShadows = computeParapetShadowPolygons(
      terraceRing,
      parapetHeightM,
      solarAzimuthDeg,
      solarElevationDeg,
      avgReceiverElev,
    );
    for (const s of parapetShadows) shadowPolygons.push(s);
  }

  // 4. Inter-row panel self-shading
  const interPanelShadows = computePanelSelfShadowPolygons(
    panels,
    solarAzimuthDeg,
    solarElevationDeg,
  );

  // 5. Panel geometric shade evaluation
  return panels.map((p) => {
    const dims = effectivePanelDims(p.config);
    const corners = rectangleCorners(p.x, p.y, dims.widthM, dims.lengthM, p.rotationDeg);
    const totalAreaM2 = dims.widthM * dims.lengthM;

    const selfShadows = interPanelShadows.get(p.id);
    const allShadows =
      selfShadows && selfShadows.length > 0
        ? [...shadowPolygons, ...selfShadows]
        : shadowPolygons;

    const shadeFraction = computePanelShadeFraction(corners, allShadows);
    return {
      panelId: p.id,
      setId: p.setId,
      index: p.index,
      shadeFraction: Math.round(shadeFraction * 1000) / 1000,
      shadedAreaM2: Math.round(shadeFraction * totalAreaM2 * 100) / 100,
      totalAreaM2,
      isNight: false,
    };
  });
}

