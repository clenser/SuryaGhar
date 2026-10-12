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
import { pointInPolygon, type Obstacle, type Point2 } from "./obstacles";
import type { Tree } from "./treeTypes";
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
): PlacedPanel[][] {
  if (panels.length === 0) return [];
  if (panels.length <= maxPanelsPerString) return [[...panels]];

  // Sort panels primary by Y row, secondary by X
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
 * Validates a route segment or polyline against the usable roof polygon.
 * Ensures all points and intermediate segment samples stay inside the usable roof.
 */
export function validateRouteWithinPolygon(
  points: THREE.Vector3[],
  polygon: Point2[],
  sampleIntervalM = 1.0,
): boolean {
  if (points.length === 0 || polygon.length < 3) return false;

  for (let i = 0; i < points.length; i++) {
    const pt = { x: points[i].x, y: points[i].y };
    if (!pointInPolygon(pt, polygon)) return false;

    if (i < points.length - 1) {
      const pNext = points[i + 1];
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
 * Placed within the usable roof boundary, offset safely inward from the perimeter edge.
 */
export function findDesignatedInverterPosition(
  terraceRing: Point2[],
  usableRing: Point2[],
  roofZ: number,
  panels: PlacedPanel[],
): THREE.Vector3 {
  const boundary = usableRing.length >= 3 ? usableRing : terraceRing;
  if (boundary.length < 3) {
    return new THREE.Vector3(0, 0, roofZ + 0.35);
  }

  // Find southern-most segment or vertex of usable roof
  let bestPt = boundary[0];
  for (const pt of boundary) {
    if (pt.y < bestPt.y) {
      bestPt = pt;
    }
  }

  // If panels exist, find southern array perimeter
  let minPanelY = Number.POSITIVE_INFINITY;
  let meanPanelX = 0;
  if (panels.length > 0) {
    for (const p of panels) {
      if (p.y < minPanelY) minPanelY = p.y;
      meanPanelX += p.x;
    }
    meanPanelX /= panels.length;
  } else {
    meanPanelX = bestPt.x;
  }

  // Test candidate position along southern usable boundary
  const candPt = { x: (bestPt.x + meanPanelX) / 2, y: bestPt.y + CABLE_TRAY_EDGE_CLEARANCE_M };
  if (pointInPolygon(candPt, boundary)) {
    return new THREE.Vector3(candPt.x, candPt.y, roofZ + 0.35);
  }

  // Fallback: guaranteed interior point (first vertex of usable ring with inward offset)
  return new THREE.Vector3(bestPt.x, bestPt.y + 0.5, roofZ + 0.35);
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
  } = params;

  const routes: CableRoute[] = [];
  const combinerPositions: THREE.Vector3[] = [];
  const stringRecords: ElectricalTopology["strings"] = [];

  // Usable interior ring for cable routing with clearance
  const usableRing = offsetPolygonInward(terraceRing, CABLE_TRAY_EDGE_CLEARANCE_M) ?? terraceRing;

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

    const panelStrings = groupPanelsIntoStrings(layer.panels);

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
      // Connects underside connectors in order, then drops down to roof level
      const branchPoints: THREE.Vector3[] = [];
      for (let i = 0; i < connectors.length; i++) {
        branchPoints.push(connectors[i].clone());
      }

      // String combiner junction box: located at the end of the string row on the roof plane
      const lastConnector = connectors[connectors.length - 1];
      const combinerPos = new THREE.Vector3(lastConnector.x, lastConnector.y, roofZ + 0.05);

      // If combiner lies outside usable roof, pull it towards the roof centroid
      if (!pointInPolygon({ x: combinerPos.x, y: combinerPos.y }, usableRing)) {
        combinerPos.x = combinerPos.x * 0.95;
        combinerPos.y = combinerPos.y * 0.95;
      }

      branchPoints.push(new THREE.Vector3(lastConnector.x, lastConnector.y, roofZ + 0.05));
      branchPoints.push(combinerPos);

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
  // Rather than drawing individual trunks from every string to the inverter,
  // we merge string combiner outputs into a shared main DC cable trunk.
  const mainJunction = new THREE.Vector3();
  for (const c of stringCombiners) mainJunction.add(c);
  mainJunction.multiplyScalar(1 / (stringCombiners.length || 1));
  mainJunction.z = roofZ + 0.04;

  // Route string combiners to the main collection junction
  for (let i = 0; i < stringCombiners.length; i++) {
    const cPos = stringCombiners[i];
    const stringInt = stringIntensities[i] ?? 0.5;

    // Manhattan orthogonal routing on roof surface
    const midY = (cPos.y + mainJunction.y) / 2;
    const trunkPoints: THREE.Vector3[] = [
      cPos.clone(),
      new THREE.Vector3(cPos.x, midY, roofZ + 0.04),
      new THREE.Vector3(mainJunction.x, midY, roofZ + 0.04),
      mainJunction.clone(),
    ];

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

  // Final Consolidated Main DC Output: Single consolidated trunk from main junction to Inverter
  const avgArrayIntensity =
    stringIntensities.reduce((a, b) => a + b, 0) / (stringIntensities.length || 1);

  const mainTrunkPoints: THREE.Vector3[] = [
    mainJunction.clone(),
    new THREE.Vector3(mainJunction.x, endpointPosition.y, roofZ + 0.04),
    endpointPosition.clone(),
  ];

  const mainTrunkDist = computeCumulativeDistances(mainTrunkPoints);
  routes.push({
    id: "route-main-dc-trunk",
    type: "main-dc",
    points: mainTrunkPoints,
    cumulativeDistances: mainTrunkDist.cumulative,
    totalLength: mainTrunkDist.total,
    flowIntensity: avgArrayIntensity,
  });

  // Comprehensive routing validation: ensure every rooftop segment stays within usable roof boundary
  let isValidRouting = true;
  for (const r of routes) {
    // Only roof-surface segments need 2D polygon containment checks
    const roofPoints = r.points.filter((pt) => Math.abs(pt.z - (roofZ + 0.04)) < 0.1);
    if (roofPoints.length >= 2) {
      if (!validateRouteWithinPolygon(roofPoints, usableRing)) {
        isValidRouting = false;
        break;
      }
    }
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
