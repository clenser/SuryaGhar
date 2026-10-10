/**
 * Deterministic rooftop panel placement (Phase 5).
 *
 * Pure geometry in the existing local metric frame (X = east, Y = north,
 * centroid at the origin). No AI, no randomness: a lattice search over the
 * rotated panel frame with exact containment and overlap tests, reusing the
 * Phase 3 polygon utilities so panel checks and obstacle checks agree
 * (AGENTS.md §30, §52, §57 — geometric validity is deterministic maths).
 *
 * Rules enforced for every candidate:
 *  1. the panel footprint INFLATED by the edge setback must lie inside the
 *     terrace (square inflation ⊇ disc inflation, so the true clearance from
 *     every roof edge is ≥ setback);
 *  2. the panel footprint must not overlap any obstacle footprint (inflated
 *     by a small fixed clearance);
 *  3. the panel footprint must not overlap an already-accepted panel
 *     (inflated by the configured spacing).
 * Candidates failing any rule are skipped — panels are never placed outside
 * the roof to increase the count.
 */

import {
  footprintInsidePolygon,
  footprintsOverlap,
  type Obstacle,
  type Point2,
} from "./obstacles";
import { panelTypeDefinition, type PanelLayoutConfig } from "./panels";

/** Fixed clearance kept between panels and obstacle footprints, metres. */
export const PANEL_OBSTACLE_CLEARANCE_M = 0.1;

/** One placed panel: footprint centre in local metres, rotation CCW about Z. */
export interface PlacedPanel {
  /** Stable position in the placement order (also the instance index). */
  index: number;
  x: number;
  y: number;
  /** Degrees counter-clockwise about Z. */
  rotationDeg: number;
}

export interface PlacementRequest {
  /** Terrace ring in local metres (roof boundary). */
  terrace: Point2[];
  /** Obstacles already on the roof — panels must avoid them. */
  obstacles: Obstacle[];
  config: PanelLayoutConfig;
  /** Clearance from obstacle footprints (defaults to a small constant). */
  obstacleClearanceM?: number;
}

export interface PlacementResult {
  panels: PlacedPanel[];
  /** Why nothing was placed — null whenever `panels.length > 0`. */
  reason: string | null;
}

/** Rotation (CCW degrees) that points the panel's long side at `azimuth`. */
export function panelRotationForAzimuth(azimuthDeg: number): number {
  return (((-azimuthDeg) % 360) + 360) % 360;
}

/** Corners of a centre-anchored rectangle rotated CCW by `rotationDeg`. */
export function rectangleCorners(
  cx: number,
  cy: number,
  widthM: number,
  lengthM: number,
  rotationDeg: number,
): Point2[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = widthM / 2;
  const hl = lengthM / 2;
  const local: Array<[number, number]> = [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ];
  return local.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

/**
 * Place panels on the roof.
 *
 * The lattice runs in the panel's own rotated frame: step = panel size +
 * spacing, so the spacing rule holds by construction and the overlap test is
 * a cheap safety net. Deterministic — the same inputs always produce the
 * same layout.
 */
export function placePanels(request: PlacementRequest): PlacementResult {
  const { obstacles, config } = request;
  const invalid = !Array.isArray(request.terrace) || request.terrace.length < 3;
  if (invalid) {
    return { panels: [], reason: "Terrace boundary is missing" };
  }
  if (!Number.isFinite(config.setbackM) || config.setbackM < 0) {
    return { panels: [], reason: "Edge setback is invalid" };
  }
  if (!Number.isFinite(config.spacingM) || config.spacingM < 0) {
    return { panels: [], reason: "Panel spacing is invalid" };
  }

  const terrace = request.terrace;
  const type = panelTypeDefinition(config.panelTypeId);
  const width = type.widthM;
  const length = type.lengthM;
  const rotation = panelRotationForAzimuth(config.azimuthDeg);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Panel axes in world coordinates: u = width axis, v = length axis.
  const u = { x: cos, y: sin };
  const v = { x: -sin, y: cos };
  const clearance = request.obstacleClearanceM ?? PANEL_OBSTACLE_CLEARANCE_M;

  // Obstacle exclusion rings (footprint inflated by the clearance).
  const obstacleRings: Point2[][] = obstacles.map((o) =>
    rectangleCorners(
      o.position.x,
      o.position.y,
      o.width + 2 * clearance,
      o.length + 2 * clearance,
      o.rotation,
    ),
  );

  // Bounding box of the terrace in the panel frame.
  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const p of terrace) {
    const pu = p.x * u.x + p.y * u.y;
    const pv = p.x * v.x + p.y * v.y;
    if (pu < uMin) uMin = pu;
    if (pu > uMax) uMax = pu;
    if (pv < vMin) vMin = pv;
    if (pv > vMax) vMax = pv;
  }

  const stepU = width + config.spacingM;
  const stepV = length + config.spacingM;
  const insetU = width / 2 + config.setbackM;
  const insetV = length / 2 + config.setbackM;
  if (uMax - uMin < 2 * insetU || vMax - vMin < 2 * insetV) {
    return {
      panels: [],
      reason: `Roof is too small for one ${width.toFixed(2)} × ${length.toFixed(2)} m panel with a ${config.setbackM} m setback`,
    };
  }

  const panels: PlacedPanel[] = [];
  const inflate = config.spacingM > 0 ? config.spacingM : 0;

  for (let cv = vMin + insetV; cv <= vMax - insetV + 1e-9; cv += stepV) {
    for (let cu = uMin + insetU; cu <= uMax - insetU + 1e-9; cu += stepU) {
      const cx = cu * u.x + cv * v.x;
      const cy = cu * u.y + cv * v.y;

      // 1. Setback: the rectangle inflated by the setback must fit inside.
      const insetRect = rectangleCorners(
        cx,
        cy,
        width + 2 * config.setbackM,
        length + 2 * config.setbackM,
        rotation,
      );
      if (!footprintInsidePolygon(insetRect, terrace)) continue;

      // 2. Obstacles: the panel must clear every exclusion ring.
      const rect = rectangleCorners(cx, cy, width, length, rotation);
      if (obstacleRings.some((ring) => footprintsOverlap(rect, ring))) continue;

      // 3. Panel-to-panel spacing.
      if (
        panels.some((p) =>
          footprintsOverlap(
            rect,
            rectangleCorners(
              p.x,
              p.y,
              width + inflate,
              length + inflate,
              rotation,
            ),
          ),
        )
      ) {
        continue;
      }

      panels.push({ index: panels.length, x: cx, y: cy, rotationDeg: rotation });
    }
  }

  if (panels.length === 0) {
    return {
      panels: [],
      reason:
        obstacles.length > 0
          ? "Obstacles and roof edges leave no room for a panel with the current setback"
          : `No room for a panel with a ${config.setbackM} m setback — try a smaller setback`,
    };
  }
  return { panels, reason: null };
}
