/**
 * Electrical Flow Topology & Routing Module
 *
 * Implements deterministic cable routing and animated particle flow for solar arrays:
 * 1. Derives panel connection points from panel world transforms and physical geometry.
 * 2. Deterministically groups panels into strings (e.g. 8-12 panels per string along layout rows/sets).
 * 3. Builds trunk routes connecting string panels in series/branch topology to string junction/combiner points.
 * 4. Routes combiner points along a shared main DC output trunk to an illustrative inverter / service entrance endpoint.
 * 5. Provides curve point sampling with accumulated distance tables for uniform, delta-time particle flow.
 *
 * Grounded in the existing local engineering coordinates (1 unit = 1 metre, Z-up).
 */

import * as THREE from "three";
import type { PlacedPanel } from "./panelPlacement";
import { panelTypeDefinition, type PanelLayoutConfig } from "./panels";
import type { Point2 } from "./obstacles";

export interface PanelFlowData {
  config: PanelLayoutConfig;
  panels: PlacedPanel[];
  shadingMetrics?: Array<{ annualLossPercent: number } | null | undefined>;
}

export interface CablePoint {
  x: number;
  y: number;
  z: number;
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
  }>;
  combinerPositions: THREE.Vector3[];
  endpointPosition: THREE.Vector3;
  routes: CableRoute[];
}

/**
 * Calculates the underside junction box position of a panel in local 3D coordinates.
 * Connector sits on the panel underside near the top/back edge with a small stand-off to avoid z-fighting.
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

  // Center elevation above roof plane
  const sinTilt = Math.sin(tiltRad);
  const cosTilt = Math.cos(tiltRad);
  let centerH = 0.05 + mountHeight + (l / 2) * sinTilt;
  if (config.mounting === "tilted" || config.mounting === "shed") {
    centerH = 0.05 + mountHeight + (t / 2 + (l / 2) * sinTilt);
  }

  // Local panel coordinate offset for junction box:
  // Underneath (-Z face), slightly towards one side (X = w * 0.25), near upper quarter (Y = -l * 0.2)
  const localX = w * 0.2;
  const localY = -l * 0.25;
  const localZ = -t * 0.5 - 0.02; // 2cm below panel underside glass/backsheet

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
 * Deterministically groups panels into manageable strings (typically 6 to 12 panels per string).
 * Groups by proximity and row alignment.
 */
export function groupPanelsIntoStrings(
  panels: PlacedPanel[],
  maxPanelsPerString = 10,
): PlacedPanel[][] {
  if (panels.length === 0) return [];
  if (panels.length <= maxPanelsPerString) return [[...panels]];

  // Sort panels primary by Y (rows), secondary by X (columns)
  const sorted = [...panels].sort((a, b) => {
    const dy = Math.round(a.y * 2) - Math.round(b.y * 2);
    if (Math.abs(dy) > 1) return b.y - a.y; // North to South
    return a.x - b.x; // West to East
  });

  const strings: PlacedPanel[][] = [];
  let currentString: PlacedPanel[] = [];

  for (const panel of sorted) {
    currentString.push(panel);
    if (currentString.length >= maxPanelsPerString) {
      strings.push(currentString);
      currentString = [];
    }
  }

  if (currentString.length > 0) {
    if (strings.length > 0 && currentString.length < 3) {
      // Append leftover panels to last string to avoid tiny 1-panel strings
      strings[strings.length - 1].push(...currentString);
    } else {
      strings.push(currentString);
    }
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
): THREE.Vector3 {
  if (points.length === 0) return new THREE.Vector3();
  if (points.length === 1 || totalLength <= 1e-6) return points[0].clone();

  const d = ((distance % totalLength) + totalLength) % totalLength;

  // Binary search for segment
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

  return new THREE.Vector3().lerpVectors(points[segmentIdx], points[segmentIdx + 1], t);
}

/**
 * Builds the complete deterministic electrical topology and cable routes.
 */
export function buildElectricalTopology(params: {
  panelLayers: PanelFlowData[];
  roofZ: number;
  terraceRing: Point2[];
  energyDayKwh?: number;
}): ElectricalTopology {
  const { panelLayers, roofZ, terraceRing } = params;
  const routes: CableRoute[] = [];
  const combinerPositions: THREE.Vector3[] = [];

  // Determine a plausible conceptual inverter endpoint:
  // Placed at the southern/lowest roof boundary edge or service edge with small riser
  let southPoint = { x: 0, y: Number.POSITIVE_INFINITY };
  for (const pt of terraceRing) {
    if (pt.y < southPoint.y) {
      southPoint = { x: pt.x, y: pt.y };
    }
  }
  if (!Number.isFinite(southPoint.y)) {
    southPoint = { x: 0, y: -5 };
  }

  // Conceptual Inverter position: mounted at south roof edge, 0.4m above roof plane
  const endpointPosition = new THREE.Vector3(southPoint.x * 0.8, southPoint.y * 0.9, roofZ + 0.4);

  let globalStringId = 1;

  for (let layerIdx = 0; layerIdx < panelLayers.length; layerIdx++) {
    const layer = panelLayers[layerIdx];
    if (layer.panels.length === 0) continue;

    const panelStrings = groupPanelsIntoStrings(layer.panels);

    for (let strIdx = 0; strIdx < panelStrings.length; strIdx++) {
      const stringPanels = panelStrings[strIdx];
      if (stringPanels.length === 0) continue;

      const stringId = `str-${globalStringId++}`;
      const connectors = stringPanels.map((p) => getPanelConnectorPosition(p, layer.config, roofZ));

      // Calculate string combiner location: near string centroid, lowered to roof-tray level (roofZ + 0.05m)
      const centroid = new THREE.Vector3();
      for (const pt of connectors) centroid.add(pt);
      centroid.multiplyScalar(1 / connectors.length);
      const combinerPos = new THREE.Vector3(centroid.x, centroid.y, roofZ + 0.06);
      combinerPositions.push(combinerPos);

      // Average loss if available, otherwise 1.0
      let totalLoss = 0;
      let lossCount = 0;
      if (layer.shadingMetrics) {
        for (const p of stringPanels) {
          const m = layer.shadingMetrics[p.index];
          if (m && Number.isFinite(m.annualLossPercent)) {
            totalLoss += m.annualLossPercent;
            lossCount++;
          }
        }
      }
      const avgLossPercent = lossCount > 0 ? totalLoss / lossCount : 0;
      const intensity = Math.max(0.15, Math.min(1.0, 1.0 - avgLossPercent / 25));

      // 1. String branch cable: connects panel connectors in sequence, then drops to combinerPos
      const branchPoints: THREE.Vector3[] = [];
      for (let i = 0; i < connectors.length; i++) {
        branchPoints.push(connectors[i]);
      }
      // Drop from last connector down to roof level and route to combiner
      const lastConnector = connectors[connectors.length - 1];
      const dropDown = new THREE.Vector3(lastConnector.x, lastConnector.y, roofZ + 0.06);
      branchPoints.push(dropDown);
      branchPoints.push(combinerPos);

      const branchDist = computeCumulativeDistances(branchPoints);
      routes.push({
        id: `route-branch-${stringId}`,
        type: "string-branch",
        points: branchPoints,
        cumulativeDistances: branchDist.cumulative,
        totalLength: branchDist.total,
        flowIntensity: intensity,
      });

      // 2. Trunk from Combiner to Main Output Trunk
      // Route via roof tray lines (Manhattan orthogonal routing on roof surface)
      const trunkPoints: THREE.Vector3[] = [
        combinerPos.clone(),
        new THREE.Vector3(combinerPos.x, endpointPosition.y * 0.9, roofZ + 0.06),
        endpointPosition.clone(),
      ];
      const trunkDist = computeCumulativeDistances(trunkPoints);
      routes.push({
        id: `route-trunk-${stringId}`,
        type: "combiner-trunk",
        points: trunkPoints,
        cumulativeDistances: trunkDist.cumulative,
        totalLength: trunkDist.total,
        flowIntensity: Math.min(1.0, intensity * 1.1),
      });
    }
  }

  return {
    strings: [],
    combinerPositions,
    endpointPosition,
    routes,
  };
}
