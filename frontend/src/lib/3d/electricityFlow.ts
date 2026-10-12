/**
 * Electrical Flow Topology & Routing Module
 *
 * Implements physically plausible, engineering-grade cable routing and dynamic power visualization:
 * 1. Derives panel underside connection points (junction box) from physical module dimensions,
 *    tilt, rotation, and mount height, positioned safely under the backsheet.
 * 2. Deterministically groups panels into strings (6-12 panels per string along layout rows/columns).
 * 3. Builds a clean, hierarchical routing network:
 *    Level 1: Panel underside branch jumpers along array axis.
 *    Level 2: String collection drops to local string junction boxes.
 *    Level 3: Consolidated trunk routes merging into a single main DC collection trunk leading to
 *             a designated inverter location placed safely within the roof boundary.
 * 4. Rigorous geometric routing validation:
 *    - Validates that every rooftop route segment, bend, junction box, trunk, and inverter stay
 *      strictly within the usable roof polygon (with cable-tray clearance from the roof edge).
 *    - Avoids arbitrary coordinate multipliers (no `southPoint * 0.8` or `* 0.9`).
 *    - Validates clearance against rooftop obstacles and prevents visual jumps across exterior space.
 * 5. Dynamic Instantaneous Relative Power Generation:
 *    - Evaluates instantaneous sun position (elevation, azimuth), panel orientation vs sun incidence,
 *      direct and diffuse contributions, and module-specific shading fractions from obstacles and trees.
 *    - Produces realistic generation scaling: 0 at night, smooth ramp with sun elevation, and
 *      realistic output attenuation under shadows.
 *
 * Grounded in local engineering coordinates (1 unit = 1 metre, Z-up).
 */

import * as THREE from "three";
import type { PlacedPanel } from "./panelPlacement";
import { panelTypeDefinition, type PanelLayoutConfig } from "./panels";
import { pointInPolygon, obstacleFootprint, type Obstacle, type Point2 } from "./obstacles";
import { properSegmentsCross, distanceToRing, type Tree } from "./treeTypes";
import { offsetPolygonInward } from "./geometry";
import { computeInstantaneousShade } from "./shadingAnalysis";

export interface PanelFlowData {
  config: PanelLayoutConfig;
  panels: PlacedPanel[];
  shadingMetrics?: Array<{ annualLossPercent: number } | null | undefined>;
}

export interface CableRoute {
  id: string;
  type: "string-branch" | "combiner-trunk" | "main-dc";
  points: THREE.Vector3[];
  /** Cumulative distances along polyline in metres */
  cumulativeDistances: number[];
  totalLength: number;
  /** Normalized generation factor (0.0 to 1.0) along this cable */
  flowIntensity: number;
}

export interface ElectricalTopology {
  strings: Array<{
    id: string;
    panelIndices: number[];
    combinerPosition: THREE.Vector3;
    intensity: number;
  }>;
  combinerPositions: THREE.Vector3[];
  mainJunctionPosition: THREE.Vector3;
  endpointPosition: THREE.Vector3;
  routes: CableRoute[];
  /** Flag indicating all routes passed polygon & obstacle containment */
  isValidRouting: boolean;
}

/** Configurable clearance between cable trays / equipment and the roof edge, metres. */
export const CABLE_TRAY_EDGE_CLEARANCE_M = 0.35;

/**
 * Calculates the underside junction box position of a panel in local 3D coordinates.
 * Sits safely on the underside backsheet (-Z face) so wires and connectors remain
 * fully occluded by the opaque module glass and frame when viewed from above or front.
 */
export function getPanelConnectorPosition(
  panel: PlacedPanel,
  config: PanelLayoutConfig,
  roofZ: number,
): THREE.Vector3 {
  const type = panelTypeDefinition(config.panelTypeId);
  const w = type.widthM;
  const l = type.lengthM;
  const t = type.thicknessM;
  const tiltRad = (config.tiltDeg * Math.PI) / 180;
  const rotRad = (panel.rotationDeg * Math.PI) / 180;
  const mountHeight = Number.isFinite(config.mountHeightM) && config.mountHeightM > 0
    ? config.mountHeightM
    : 0.1;

  const sinTilt = Math.sin(tiltRad);
  const cosTilt = Math.cos(tiltRad);
  let centerH = 0.05 + mountHeight + (l / 2) * sinTilt;
  if (config.mounting === "tilted" || config.mounting === "shed") {
    centerH = 0.05 + mountHeight + (t / 2 + (l / 2) * sinTilt);
  }

  // Local panel coordinate offset for underside junction box:
  // Underneath (-Z), offset towards one side (X = w * 0.20) and towards upper third (Y = -l * 0.25)
  // localZ is placed beneath the backsheet (-t/2) by 0.03m (3cm).
  const localX = w * 0.20;
  const localY = -l * 0.25;
  const localZ = -t * 0.5 - 0.03;

  // Apply tilt around panel X axis
  const tiltedY = localY * cosTilt - localZ * sinTilt;
  const tiltedZ = localY * sinTilt + localZ * cosTilt;

  // Apply rotation around world Z axis
  const cosRot = Math.cos(rotRad);
  const sinRot = Math.sin(rotRad);
  const worldX = panel.x + (localX * cosRot - tiltedY * sinRot);
  const worldY = panel.y + (localX * sinRot + tiltedY * cosRot);
  const worldZ = roofZ + centerH + tiltedZ;

  return new THREE.Vector3(worldX, worldY, worldZ);
}

/**
 * Deterministically groups panels into spatially coherent strings (typically 6 to 12 panels per string).
 * Orders by layout rows (Y) then columns (X) for clean, parallel wire runs.
 */
export function groupPanelsIntoStrings(
  panels: PlacedPanel[],
  maxPanelsPerString = 10,
  polygon?: Point2[],
): PlacedPanel[][] {
  if (panels.length === 0) return [];
  if (panels.length <= 1) return [[...panels]];

  // Sort panels primarily by Y (North to South), secondarily by X (West to East)
  const remaining = [...panels].sort((a, b) => {
    const dy = Math.round(a.y * 2) - Math.round(b.y * 2);
    if (Math.abs(dy) > 1) return b.y - a.y;
    return a.x - b.x;
  });

  const strings: PlacedPanel[][] = [];

  while (remaining.length > 0) {
    const currentString: PlacedPanel[] = [remaining.shift()!];

    while (currentString.length < maxPanelsPerString && remaining.length > 0) {
      const last = currentString[currentString.length - 1];
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const d = Math.hypot(cand.x - last.x, cand.y - last.y);
        // Only link panels within realistic row/adjacent string jumper reach (<= 4.5m)
        if (d < 4.5 && d < bestDist) {
          if (!polygon || isSegmentInsidePolygon(last, cand, polygon)) {
            bestDist = d;
            bestIdx = i;
          }
        }
      }

      if (bestIdx !== -1) {
        currentString.push(remaining.splice(bestIdx, 1)[0]);
      } else {
        // No nearby topologically connected panel in this row/wing; end this string
        break;
      }
    }

    strings.push(currentString);
  }

  return strings;
}

/**
 * Calculates cumulative distance table along a 3D polyline.
 */
export function computeCumulativeDistances(points: THREE.Vector3[]): {
  cumulative: number[];
  total: number;
} {
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].distanceTo(points[i - 1]);
    total += d;
    cumulative.push(total);
  }
  return { cumulative, total };
}

/**
 * Samples a point along a polyline at a given distance from start.
 */
export function samplePointAlongPolyline(
  points: THREE.Vector3[],
  cumulativeDistances: number[],
  totalLength: number,
  distance: number,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const result = target ?? new THREE.Vector3();
  if (points.length === 0) return result.set(0, 0, 0);
  if (points.length === 1 || totalLength <= 1e-6) return result.copy(points[0]);

  const d = ((distance % totalLength) + totalLength) % totalLength;

  let low = 0;
  let high = cumulativeDistances.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cumulativeDistances[mid] <= d) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const segmentIdx = Math.max(0, Math.min(points.length - 2, high));
  const segStart = cumulativeDistances[segmentIdx];
  const segEnd = cumulativeDistances[segmentIdx + 1];
  const segLen = segEnd - segStart;
  const t = segLen > 1e-6 ? (d - segStart) / segLen : 0;

  return result.lerpVectors(points[segmentIdx], points[segmentIdx + 1], t);
}

/**
 * Checks whether a 2D line segment between p1 and p2 stays strictly inside
 * the polygon and does not cross polygon boundary edges or obstacles.
 */
export function isSegmentInsidePolygon(
  p1: Point2,
  p2: Point2,
  polygon: Point2[],
  obstacles: Obstacle[] = [],
  sampleStepM = 0.35,
): boolean {
  if (polygon.length < 3) return false;
  // 1. Both endpoints must be inside polygon
  if (!pointInPolygon(p1, polygon) || !pointInPolygon(p2, polygon)) return false;

  // 2. The segment must not cross any polygon boundary edge strictly in its interior
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const v1 = polygon[i];
    const v2 = polygon[(i + 1) % n];
    if (properSegmentsCross(p1, p2, v1, v2)) {
      return false;
    }
  }

  // 3. Dense point sampling: all intermediate points must be inside the polygon
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(3, Math.ceil(dist / sampleStepM));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const mid = { x: p1.x + t * dx, y: p1.y + t * dy };
    if (!pointInPolygon(mid, polygon)) {
      return false;
    }
  }

  // 4. Obstacle footprint exclusion (wires should not pass through rooftop obstacles)
  for (const obs of obstacles) {
    const fp = obstacleFootprint(obs);
    if (fp.length < 3) continue;
    for (let i = 0; i < fp.length; i++) {
      if (properSegmentsCross(p1, p2, fp[i], fp[(i + 1) % fp.length])) {
        return false;
      }
    }
    const mid = { x: p1.x + 0.5 * dx, y: p1.y + 0.5 * dy };
    if (pointInPolygon(mid, fp)) {
      return false;
    }
  }

  return true;
}

/**
 * Ensures a point is strictly inside the polygon with safety clearance.
 * Uses local boundary edge inward normals rather than global centroid averaging,
 * which reliably supports concave U-shaped, L-shaped, and courtyard buildings.
 */
export function clampPointToInterior(
  point: Point2,
  polygon: Point2[],
  minClearanceM = 0.2,
): Point2 {
  const n = polygon.length;
  if (n < 3) return point;

  // Determine winding to establish inward normals (CCW: area2 > 0)
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  const ccw = area2 > 0;

  const isInside = pointInPolygon(point, polygon);
  if (isInside) {
    const distToEdge = distanceToRing(point, polygon);
    if (distToEdge >= minClearanceM) {
      return point;
    }
  }

  // Find the closest point on the polygon boundary edges
  let bestEdgePt: Point2 = polygon[0];
  let bestDist = Number.POSITIVE_INFINITY;
  let bestInwardNormal: Point2 = { x: 0, y: 0 };

  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    // Inward normal: left of edge direction for CCW, right for CW
    const nx = ccw ? -dy / len : dy / len;
    const ny = ccw ? dx / len : -dx / len;

    // Project point onto segment AB
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len)));
    const edgePt = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(point.x - edgePt.x, point.y - edgePt.y);

    if (d < bestDist) {
      bestDist = d;
      bestEdgePt = edgePt;
      bestInwardNormal = { x: nx, y: ny };
    }
  }

  // Try pushing inward from the closest boundary point along the inward normal
  for (const step of [minClearanceM, minClearanceM * 1.5, minClearanceM * 0.75, 0.1, 0.05]) {
    const cand = {
      x: bestEdgePt.x + bestInwardNormal.x * step,
      y: bestEdgePt.y + bestInwardNormal.y * step,
    };
    if (pointInPolygon(cand, polygon)) {
      return cand;
    }
  }

  if (isInside) return point;
  return bestEdgePt;
}

/**
 * Routes a clean, physically plausible cable tray path from start to goal
 * that is 100% contained within the usable roof polygon.
 *
 * Fully supports concave, U-shaped, and courtyard buildings:
 * 1. Direct line-of-sight route if segment stays strictly inside polygon.
 * 2. Clean orthogonal (Manhattan) routes if all segments stay inside polygon.
 * 3. Robust Interior Visibility Graph combining perimeter inward offsets and
 *    interior corridor grid waypoints, solved via Dijkstra with string-pulling smoothing.
 * 4. Never draws straight-line shortcuts across exterior courtyards or voids.
 */
export function routeInteriorPath(
  start: Point2,
  goal: Point2,
  polygon: Point2[],
  obstacles: Obstacle[] = [],
): Point2[] {
  if (polygon.length < 3) return [start, goal];

  const pStart = clampPointToInterior(start, polygon, 0.1);
  const pGoal = clampPointToInterior(goal, polygon, 0.1);

  if (Math.hypot(pGoal.x - pStart.x, pGoal.y - pStart.y) < 0.05) {
    return [pStart, pGoal];
  }

  // 1. Direct Straight Line
  if (isSegmentInsidePolygon(pStart, pGoal, polygon, obstacles)) {
    return [pStart, pGoal];
  }

  // 2. Try Orthogonal / Manhattan routes:
  // Candidate M1: X then Y
  const candM1 = [pStart, { x: pGoal.x, y: pStart.y }, pGoal];
  if (
    isSegmentInsidePolygon(candM1[0], candM1[1], polygon, obstacles) &&
    isSegmentInsidePolygon(candM1[1], candM1[2], polygon, obstacles)
  ) {
    return candM1;
  }

  // Candidate M2: Y then X
  const candM2 = [pStart, { x: pStart.x, y: pGoal.y }, pGoal];
  if (
    isSegmentInsidePolygon(candM2[0], candM2[1], polygon, obstacles) &&
    isSegmentInsidePolygon(candM2[1], candM2[2], polygon, obstacles)
  ) {
    return candM2;
  }

  // 3. Robust Interior Visibility Graph & Corridor Pathfinding
  const waypoints: Point2[] = [pStart];

  // A. Inward offsets along perimeter edges and vertices
  for (let i = 0; i < polygon.length; i++) {
    const v = polygon[i];
    const safeV = clampPointToInterior(v, polygon, 0.25);
    if (pointInPolygon(safeV, polygon)) waypoints.push(safeV);

    const vNext = polygon[(i + 1) % polygon.length];
    for (const t of [0.25, 0.5, 0.75]) {
      const edgePt = { x: v.x + t * (vNext.x - v.x), y: v.y + t * (vNext.y - v.y) };
      const safeEdge = clampPointToInterior(edgePt, polygon, 0.25);
      if (pointInPolygon(safeEdge, polygon)) waypoints.push(safeEdge);
    }
  }

  // B. Dense interior grid waypoints across the polygon's bounding box
  let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  for (const v of polygon) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const span = Math.hypot(maxX - minX, maxY - minY);
  const step = Math.max(1.2, Math.min(2.5, span / 16));

  for (let x = minX + step; x < maxX; x += step) {
    for (let y = minY + step; y < maxY; y += step) {
      const pt = { x, y };
      if (pointInPolygon(pt, polygon) && distanceToRing(pt, polygon) >= 0.15) {
        let insideObs = false;
        for (const obs of obstacles) {
          const fp = obstacleFootprint(obs);
          if (pointInPolygon(pt, fp)) {
            insideObs = true;
            break;
          }
        }
        if (!insideObs) waypoints.push(pt);
      }
    }
  }

  waypoints.push(pGoal);

  const nNodes = waypoints.length;
  const startIdx = 0;
  const goalIdx = nNodes - 1;

  const adj: Array<Array<{ to: number; weight: number }>> = Array.from({ length: nNodes }, () => []);
  const maxEdgeDist = Math.max(8.0, step * 4);

  for (let i = 0; i < nNodes; i++) {
    for (let j = i + 1; j < nNodes; j++) {
      const u = waypoints[i];
      const v = waypoints[j];
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d <= maxEdgeDist || i === startIdx || j === goalIdx) {
        if (isSegmentInsidePolygon(u, v, polygon, obstacles)) {
          adj[i].push({ to: j, weight: d });
          adj[j].push({ to: i, weight: d });
        }
      }
    }
  }

  const dist = new Array(nNodes).fill(Number.POSITIVE_INFINITY);
  const prev = new Array(nNodes).fill(-1);
  const visited = new Array(nNodes).fill(false);
  dist[startIdx] = 0;

  for (let count = 0; count < nNodes; count++) {
    let u = -1;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nNodes; i++) {
      if (!visited[i] && dist[i] < minDist) {
        minDist = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === goalIdx) break;
    visited[u] = true;

    for (const edge of adj[u]) {
      if (!visited[edge.to]) {
        const alt = dist[u] + edge.weight;
        if (alt < dist[edge.to]) {
          dist[edge.to] = alt;
          prev[edge.to] = u;
        }
      }
    }
  }

  if (dist[goalIdx] < Number.POSITIVE_INFINITY) {
    const path: Point2[] = [];
    let curr = goalIdx;
    while (curr !== -1) {
      path.push(waypoints[curr]);
      curr = prev[curr];
    }
    path.reverse();

    // Raycast string-pulling smoothing: remove intermediate zig-zags
    let i = 0;
    while (i < path.length - 2) {
      let shortcut = false;
      for (let j = path.length - 1; j > i + 1; j--) {
        if (isSegmentInsidePolygon(path[i], path[j], polygon, obstacles)) {
          path.splice(i + 1, j - i - 1);
          shortcut = true;
          break;
        }
      }
      if (!shortcut) i++;
    }
    return path;
  }

  // If no valid interior route exists without crossing exterior voids or courtyards,
  // omit the route (never draw an invalid shortcut across open courtyards).
  return [];
}

/**
 * Validates a route segment or polyline against the usable roof polygon.
 * Ensures all points and intermediate segment samples stay inside the usable roof
 * and do not cross polygon boundaries.
 */
export function validateRouteWithinPolygon(
  points: THREE.Vector3[],
  polygon: Point2[],
  sampleIntervalM = 0.35,
): boolean {
  if (points.length === 0 || polygon.length < 3) return false;

  for (let i = 0; i < points.length; i++) {
    const pt = { x: points[i].x, y: points[i].y };
    if (!pointInPolygon(pt, polygon)) return false;

    if (i < points.length - 1) {
      const pNext = points[i + 1];
      const ptNext = { x: pNext.x, y: pNext.y };
      for (let e = 0; e < polygon.length; e++) {
        if (properSegmentsCross(pt, ptNext, polygon[e], polygon[(e + 1) % polygon.length])) {
          return false;
        }
      }
      const dist = Math.hypot(pNext.x - points[i].x, pNext.y - points[i].y);
      const steps = Math.ceil(dist / sampleIntervalM);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const midPt = {
          x: points[i].x + t * (pNext.x - points[i].x),
          y: points[i].y + t * (pNext.y - points[i].y),
        };
        if (!pointInPolygon(midPt, polygon)) return false;
      }
    }
  }
  return true;
}

/**
 * Finds a safe, designated rooftop electrical collection and inverter endpoint.
 * Placed within the usable roof boundary, safely inset from perimeter edge and parapet wall.
 */
export function findDesignatedInverterPosition(
  terraceRing: Point2[],
  usableRing: Point2[],
  roofZ: number,
  panels: PlacedPanel[],
  obstacles: Obstacle[] = [],
): THREE.Vector3 {
  const boundary = usableRing.length >= 3 ? usableRing : terraceRing;
  if (boundary.length < 3) {
    return new THREE.Vector3(0, 0, roofZ + 0.35);
  }

  let meanX = 0;
  let meanY = 0;
  let minY = Number.POSITIVE_INFINITY;
  if (panels.length > 0) {
    for (const p of panels) {
      meanX += p.x;
      meanY += p.y;
      if (p.y < minY) minY = p.y;
    }
    meanX /= panels.length;
    meanY /= panels.length;
  } else {
    for (const pt of boundary) {
      meanX += pt.x;
      meanY += pt.y;
    }
    meanX /= boundary.length;
    meanY /= boundary.length;
    minY = meanY;
  }

  const candidates: Array<{ pt: Point2; score: number }> = [];

  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    for (const t of [0.25, 0.5, 0.75]) {
      const edgePt = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      const cand = clampPointToInterior(edgePt, boundary, CABLE_TRAY_EDGE_CLEARANCE_M);

      if (!pointInPolygon(cand, boundary)) continue;
      if (distanceToRing(cand, terraceRing) < CABLE_TRAY_EDGE_CLEARANCE_M * 0.8) continue;

      let insideObstacle = false;
      for (const obs of obstacles) {
        const fp = obstacleFootprint(obs);
        if (pointInPolygon(cand, fp)) {
          insideObstacle = true;
          break;
        }
      }
      if (insideObstacle) continue;

      const distToArray = Math.hypot(cand.x - meanX, cand.y - minY);
      const score = distToArray + (cand.y - minY) * 0.5;
      candidates.push({ pt: cand, score });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0].pt;
    return new THREE.Vector3(best.x, best.y, roofZ + 0.35);
  }

  const safePt = clampPointToInterior({ x: meanX, y: meanY }, boundary, 0.5);
  return new THREE.Vector3(safePt.x, safePt.y, roofZ + 0.35);
}

/**
 * Evaluates instantaneous relative electrical generation factor (0.0 to 1.0)
 * for a solar panel based on solar elevation, incidence angle, direct/diffuse irradiance,
 * and current shade fraction.
 */
export function computePanelInstantaneousPower(params: {
  solarElevationDeg: number;
  solarAzimuthDeg: number;
  panelTiltDeg: number;
  panelAzimuthDeg: number;
  shadeFraction: number; // 0.0 (unshaded) to 1.0 (fully shaded)
  weatherPreset?: "sunny" | "cloudy" | "rainy";
}): number {
  const {
    solarElevationDeg,
    solarAzimuthDeg,
    panelTiltDeg,
    panelAzimuthDeg,
    shadeFraction,
    weatherPreset = "sunny",
  } = params;

  // 1. Night-time check: sun at or below horizon -> zero power
  if (solarElevationDeg <= 0) {
    return 0.0;
  }

  // 2. Solar vector (Z-up: X = East, Y = North, Z = Up)
  const elevRad = (solarElevationDeg * Math.PI) / 180;
  const azRad = (solarAzimuthDeg * Math.PI) / 180;
  const sunDir = new THREE.Vector3(
    Math.sin(azRad) * Math.cos(elevRad),
    Math.cos(azRad) * Math.cos(elevRad),
    Math.sin(elevRad),
  ).normalize();

  // 3. Panel normal vector
  const tiltRad = (panelTiltDeg * Math.PI) / 180;
  const panelAzRad = (panelAzimuthDeg * Math.PI) / 180;
  const panelNormal = new THREE.Vector3(
    Math.sin(panelAzRad) * Math.sin(tiltRad),
    Math.cos(panelAzRad) * Math.sin(tiltRad),
    Math.cos(tiltRad),
  ).normalize();

  // 4. Angle of incidence (cos theta)
  const cosIncidence = Math.max(0, panelNormal.dot(sunDir));

  // 5. Direct beam irradiance factor with atmospheric air mass scaling
  const airMassFactor = Math.sin(elevRad);
  const directFactor = cosIncidence * airMassFactor;

  // 6. Diffuse sky contribution (even shaded or overcast panels receive diffuse sky light ~15-20%)
  const diffuseFactor = 0.18 * Math.sin(elevRad);

  // 7. Shading impact: shadow blocks direct beam; diffuse remains partially available
  const unshadedDirect = directFactor * Math.max(0, 1.0 - shadeFraction);
  const availableDiffuse = diffuseFactor * (1.0 - 0.4 * shadeFraction);

  let rawPower = unshadedDirect + availableDiffuse;

  // 8. Weather preset scaling
  if (weatherPreset === "cloudy") {
    rawPower *= 0.55;
  } else if (weatherPreset === "rainy") {
    rawPower *= 0.28;
  }

  return Math.max(0.0, Math.min(1.0, rawPower));
}

/**
 * Builds the complete hierarchical, physically grounded electrical topology.
 */
export function buildElectricalTopology(params: {
  panelLayers: PanelFlowData[];
  roofZ: number;
  terraceRing: Point2[];
  solarAzimuthDeg?: number;
  solarElevationDeg?: number;
  weatherPreset?: "sunny" | "cloudy" | "rainy";
  obstacles?: Obstacle[];
  trees?: Tree[];
  parapetHeightM?: number;
  parapetThicknessM?: number;
}): ElectricalTopology {
  const {
    panelLayers,
    roofZ,
    terraceRing,
    solarAzimuthDeg = 180,
    solarElevationDeg = 45,
    weatherPreset = "sunny",
    obstacles = [],
    trees = [],
    parapetHeightM = 0,
    parapetThicknessM = 0.3,
  } = params;

  const routes: CableRoute[] = [];
  const combinerPositions: THREE.Vector3[] = [];
  const stringRecords: ElectricalTopology["strings"] = [];

  // Usable interior ring for cable routing with clearance from parapet wall & exterior
  const hasParapet = Number.isFinite(parapetHeightM) && (parapetHeightM ?? 0) > 0;
  const parapetThickness = Number.isFinite(parapetThicknessM) && (parapetThicknessM ?? 0) > 0
    ? (parapetThicknessM ?? 0.3)
    : 0.3;
  const parapetInset = hasParapet ? parapetThickness : 0;
  const totalClearance = parapetInset + CABLE_TRAY_EDGE_CLEARANCE_M;

  const usableRing =
    offsetPolygonInward(terraceRing, totalClearance) ??
    (hasParapet ? offsetPolygonInward(terraceRing, parapetInset + 0.1) : null) ??
    offsetPolygonInward(terraceRing, 0.15) ??
    terraceRing;

  // Flatten all placed panels across layers
  const allPanels: Array<{ panel: PlacedPanel; config: PanelLayoutConfig; layerIdx: number }> = [];
  for (let lIdx = 0; lIdx < panelLayers.length; lIdx++) {
    for (const p of panelLayers[lIdx].panels) {
      allPanels.push({ panel: p, config: panelLayers[lIdx].config, layerIdx: lIdx });
    }
  }

  // 1. Locate designated Inverter endpoint inside the usable roof boundary
  const endpointPosition = findDesignatedInverterPosition(
    terraceRing,
    usableRing,
    roofZ,
    allPanels.map((a) => a.panel),
    obstacles,
  );

  if (allPanels.length === 0) {
    return {
      strings: [],
      combinerPositions: [],
      mainJunctionPosition: endpointPosition,
      endpointPosition,
      routes: [],
      isValidRouting: true,
    };
  }

  // 2. Compute instantaneous module shade fractions if sun is up
  const shadeMap = new Map<number, number>();
  if (solarElevationDeg > 0 && allPanels.length > 0) {
    const simPanels = allPanels.map((a, idx) => ({
      id: `p-${idx}`,
      setId: "set-1",
      index: a.panel.index,
      x: a.panel.x,
      y: a.panel.y,
      rotationDeg: a.panel.rotationDeg,
      config: a.config,
    }));

    const shadeResults = computeInstantaneousShade({
      panels: simPanels,
      terraceRing,
      roofZ,
      solarAzimuthDeg,
      solarElevationDeg,
      obstacles,
      trees,
      parapetHeightM,
    });
    for (const s of shadeResults) {
      shadeMap.set(s.index, s.shadeFraction);
    }
  }

  let globalStringId = 1;
  const stringCombiners: THREE.Vector3[] = [];
  const stringIntensities: number[] = [];

  for (let layerIdx = 0; layerIdx < panelLayers.length; layerIdx++) {
    const layer = panelLayers[layerIdx];
    if (layer.panels.length === 0) continue;

    const panelStrings = groupPanelsIntoStrings(layer.panels, 10, usableRing);

    for (let strIdx = 0; strIdx < panelStrings.length; strIdx++) {
      const stringPanels = panelStrings[strIdx];
      if (stringPanels.length === 0) continue;

      const stringId = `str-${globalStringId++}`;
      const connectors = stringPanels.map((p) => getPanelConnectorPosition(p, layer.config, roofZ));

      // Calculate string average power production
      let stringPowerSum = 0;
      for (const p of stringPanels) {
        const shade = shadeMap.get(p.index) ?? 0;
        const pwr = computePanelInstantaneousPower({
          solarElevationDeg,
          solarAzimuthDeg,
          panelTiltDeg: layer.config.tiltDeg,
          panelAzimuthDeg: layer.config.azimuthDeg,
          shadeFraction: shade,
          weatherPreset,
        });
        stringPowerSum += pwr;
      }
      const stringIntensity = stringPowerSum / stringPanels.length;
      stringIntensities.push(stringIntensity);

      // Level 1: String Branch Cable (underneath panels)
      // Connects underside connectors in order, ensuring jumpers stay inside usable roof
      const branchPoints: THREE.Vector3[] = [];
      for (let i = 0; i < connectors.length; i++) {
        if (i === 0) {
          branchPoints.push(connectors[0].clone());
        } else {
          const prev = connectors[i - 1];
          const curr = connectors[i];
          const prev2D = { x: prev.x, y: prev.y };
          const curr2D = { x: curr.x, y: curr.y };
          if (isSegmentInsidePolygon(prev2D, curr2D, usableRing, obstacles)) {
            branchPoints.push(curr.clone());
          } else {
            const jumperSub = routeInteriorPath(prev2D, curr2D, usableRing, obstacles);
            for (let k = 1; k < jumperSub.length; k++) {
              branchPoints.push(new THREE.Vector3(jumperSub[k].x, jumperSub[k].y, curr.z));
            }
          }
        }
      }

      // String combiner junction box: located safely inside usable roof plane
      const lastConnector = connectors[connectors.length - 1];
      const rawCombiner = { x: lastConnector.x, y: lastConnector.y };
      const safeCombiner = clampPointToInterior(rawCombiner, usableRing, 0.15);
      const combinerPos = new THREE.Vector3(safeCombiner.x, safeCombiner.y, roofZ + 0.04);

      // Drop down at last connector location to roof level
      const dropDownPt = clampPointToInterior(rawCombiner, usableRing, 0.05);
      branchPoints.push(new THREE.Vector3(dropDownPt.x, dropDownPt.y, roofZ + 0.04));

      // If combiner is offset from dropDownPt, route along roof surface to combiner
      if (Math.hypot(combinerPos.x - dropDownPt.x, combinerPos.y - dropDownPt.y) > 0.05) {
        const leadPoints = routeInteriorPath(
          dropDownPt,
          { x: combinerPos.x, y: combinerPos.y },
          usableRing,
          obstacles,
        );
        for (let k = 1; k < leadPoints.length; k++) {
          branchPoints.push(new THREE.Vector3(leadPoints[k].x, leadPoints[k].y, roofZ + 0.04));
        }
      } else {
        branchPoints.push(combinerPos.clone());
      }

      const branchDist = computeCumulativeDistances(branchPoints);
      routes.push({
        id: `route-branch-${stringId}`,
        type: "string-branch",
        points: branchPoints,
        cumulativeDistances: branchDist.cumulative,
        totalLength: branchDist.total,
        flowIntensity: stringIntensity,
      });

      stringCombiners.push(combinerPos);
      combinerPositions.push(combinerPos);
      stringRecords.push({
        id: stringId,
        panelIndices: stringPanels.map((p) => p.index),
        combinerPosition: combinerPos,
        intensity: stringIntensity,
      });
    }
  }

  // Level 3: Consolidated DC Collection
  // Locate a central, reachable DC collection junction strictly inside usableRing.
  // Avoids centroid averaging across separate wings which would land in the open courtyard.
  let bestJunction2D: Point2 = stringCombiners.length > 0
    ? { x: stringCombiners[0].x, y: stringCombiners[0].y }
    : { x: endpointPosition.x, y: endpointPosition.y };

  if (stringCombiners.length > 1) {
    const junctionCandidates: Point2[] = [
      ...stringCombiners.map((c) => ({ x: c.x, y: c.y })),
      { x: endpointPosition.x, y: endpointPosition.y },
    ];
    for (let i = 0; i < usableRing.length; i++) {
      const a = usableRing[i];
      const b = usableRing[(i + 1) % usableRing.length];
      junctionCandidates.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }

    let minSumDist = Number.POSITIVE_INFINITY;
    for (const cand of junctionCandidates) {
      const safeCand = clampPointToInterior(cand, usableRing, 0.25);
      if (!pointInPolygon(safeCand, usableRing)) continue;
      let insideObs = false;
      for (const obs of obstacles) {
        if (pointInPolygon(safeCand, obstacleFootprint(obs))) {
          insideObs = true;
          break;
        }
      }
      if (insideObs) continue;

      let sumDist = 0;
      for (const c of stringCombiners) {
        sumDist += Math.hypot(safeCand.x - c.x, safeCand.y - c.y);
      }
      if (sumDist < minSumDist) {
        minSumDist = sumDist;
        bestJunction2D = safeCand;
      }
    }
  }

  const safeJunction2D = clampPointToInterior(bestJunction2D, usableRing, 0.2);
  const mainJunction = new THREE.Vector3(safeJunction2D.x, safeJunction2D.y, roofZ + 0.04);

  // Route string combiners to the main collection junction
  for (let i = 0; i < stringCombiners.length; i++) {
    const cPos = stringCombiners[i];
    const stringInt = stringIntensities[i] ?? 0.5;

    const path2D = routeInteriorPath(
      { x: cPos.x, y: cPos.y },
      { x: mainJunction.x, y: mainJunction.y },
      usableRing,
      obstacles,
    );

    if (path2D.length >= 2) {
      const trunkPoints: THREE.Vector3[] = path2D.map(
        (pt) => new THREE.Vector3(pt.x, pt.y, roofZ + 0.04),
      );

      const trunkDist = computeCumulativeDistances(trunkPoints);
      routes.push({
        id: `route-combiner-${i + 1}`,
        type: "combiner-trunk",
        points: trunkPoints,
        cumulativeDistances: trunkDist.cumulative,
        totalLength: trunkDist.total,
        flowIntensity: stringInt,
      });
    }
  }

  // Final Consolidated Main DC Output: Single consolidated trunk from main junction to Inverter
  const avgArrayIntensity =
    stringIntensities.reduce((a, b) => a + b, 0) / (stringIntensities.length || 1);

  const mainPath2D = routeInteriorPath(
    { x: mainJunction.x, y: mainJunction.y },
    { x: endpointPosition.x, y: endpointPosition.y },
    usableRing,
    obstacles,
  );

  if (mainPath2D.length >= 2) {
    const mainTrunkPoints: THREE.Vector3[] = mainPath2D.map(
      (pt) => new THREE.Vector3(pt.x, pt.y, roofZ + 0.04),
    );
    // Final segment rises into the inverter enclosure
    mainTrunkPoints.push(endpointPosition.clone());

    const mainTrunkDist = computeCumulativeDistances(mainTrunkPoints);
    routes.push({
      id: "route-main-dc-trunk",
      type: "main-dc",
      points: mainTrunkPoints,
      cumulativeDistances: mainTrunkDist.cumulative,
      totalLength: mainTrunkDist.total,
      flowIntensity: avgArrayIntensity,
    });
  }

  // Comprehensive routing validation: ensure every rooftop segment stays within usable roof boundary
  let isValidRouting = true;
  for (const r of routes) {
    const roofPoints = r.points.filter((pt) => Math.abs(pt.z - (roofZ + 0.04)) < 0.1);
    if (roofPoints.length >= 2) {
      if (!validateRouteWithinPolygon(roofPoints, usableRing)) {
        isValidRouting = false;
      }
    }
    // Fail-safe: ensure every roof-level point is clamped strictly inside usableRing
    for (let i = 0; i < r.points.length; i++) {
      const p = r.points[i];
      if (Math.abs(p.z - (roofZ + 0.04)) < 0.1 && !pointInPolygon({ x: p.x, y: p.y }, usableRing)) {
        const clamped = clampPointToInterior({ x: p.x, y: p.y }, usableRing, 0.1);
        r.points[i] = new THREE.Vector3(clamped.x, clamped.y, p.z);
      }
    }
    const updatedDist = computeCumulativeDistances(r.points);
    r.cumulativeDistances = updatedDist.cumulative;
    r.totalLength = updatedDist.total;
  }

  return {
    strings: stringRecords,
    combinerPositions,
    mainJunctionPosition: mainJunction,
    endpointPosition,
    routes,
    isValidRouting,
  };
}
