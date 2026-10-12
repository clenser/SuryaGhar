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
 *     terrace (square inflation ? disc inflation, so the true clearance from
 *     every roof edge is = setback);
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
  obstacleFootprint,
  type Obstacle,
  type Point2,
} from "./obstacles";
import { effectiveColSpacingM, effectivePanelDims, effectiveRowSpacingM, type PanelLayoutConfig } from "./panels";

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

/**
 * Actual footprint ring of an obstacle, in absolute local metres.
 *
 * A custom polygon uses its drawn ring (already rotated and positioned by
 * `obstacleFootprint`); a predefined rectangular type uses its rotated
 * rectangle. This is what panel placement excludes, so a custom obstacle never
 * throws away the roof it does not occupy.
 */
function footprintRing(obstacle: Obstacle): Point2[] {
  return obstacleFootprint(obstacle);
}

/**
 * Grow a footprint ring outward by `clearance` metres.
 *
 * Each edge is offset outward by exactly `clearance` along its own outward
 * normal, and adjacent offset edges are intersected — the standard miter
 * offset. Edge distance is preserved exactly, so a panel kept `clearance` from
 * every edge of the RESULT is at least `clearance` from every real edge.
 *
 * Non-convex, degenerate or self-touching rings fall back to the axis-aligned
 * bounding box grown by the clearance, which is a conservative superset: it
 * can only exclude more, never accept a collision the real footprint rejects.
 */
function inflateRing(ring: Point2[], clearance: number): Point2[] {
  if (!(clearance > 0) || ring.length < 3) return ring.map((p) => ({ ...p }));

  const n = ring.length;
  const signed = signedArea2(ring);
  if (Math.abs(signed) < 1e-12) {
    return convexFallback(ring, clearance);
  }
  // Outward normal for a CCW ring is the right-hand normal of travel.
  const ccw = signed > 0;

  const offsetEdge = (a: Point2, b: Point2): Line2 => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal perpendicular to the edge.
    let nx = -dy / len;
    let ny = dx / len;
    if (ccw) {
      // right-hand normal points inward for CCW travel, so flip it.
      nx = -nx;
      ny = -ny;
    }
    return {
      px: a.x + nx * clearance,
      py: a.y + ny * clearance,
      dx: dx,
      dy: dy,
    };
  };

  const out: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const incoming = offsetEdge(ring[i], ring[(i + 1) % n]);
    const outgoing = offsetEdge(ring[(i + n - 1) % n], ring[i]);
    const joint = intersectLines(incoming, outgoing);
    if (!joint || !Number.isFinite(joint.x) || !Number.isFinite(joint.y)) {
      return convexFallback(ring, clearance);
    }
    // A joint flung far from its vertex means the offset degenerated.
    if (Math.hypot(joint.x - ring[i].x, joint.y - ring[i].y) > clearance * 12 + 1) {
      return convexFallback(ring, clearance);
    }
    out.push(joint);
  }
  return out;
}

/** Axis-aligned bounding box grown by `clearance`. */
function convexFallback(ring: Point2[], clearance: number): Point2[] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return rectangleCorners(
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    Math.max(...xs) - Math.min(...xs) + 2 * clearance,
    Math.max(...ys) - Math.min(...ys) + 2 * clearance,
    0,
  );
}

interface Line2 {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

/** Intersection of two 2D lines; null when (near-)parallel. */
function intersectLines(a: Line2, b: Line2): { x: number; y: number } | null {
  const denom = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / denom;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/** Twice the signed area of a ring (winding + degeneracy check). */
function signedArea2(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
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
  // Orientation-aware: portrait vs landscape swaps width/length, and custom
  // module sizes override the catalogue. Both placement and rendering call
  // effectivePanelDims so they can never disagree about the footprint.
  const dims = effectivePanelDims(config);
  const width = dims.widthM;
  const length = dims.lengthM;
  const rotation = panelRotationForAzimuth(config.azimuthDeg);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Panel axes in world coordinates: u = width axis, v = length axis.
  const u = { x: cos, y: sin };
  const v = { x: -sin, y: cos };
  const clearance = request.obstacleClearanceM ?? PANEL_OBSTACLE_CLEARANCE_M;

  // Obstacle exclusion rings. The ring is the obstacle's ACTUAL footprint —
  // its drawn polygon when it has one, otherwise its rotated rectangle —
  // grown by the clearance. Using a drawn polygon's axis-aligned bounding box
  // instead excludes a wedge of usable roof beside every custom obstacle,
  // which is what left the empty regions visible on the roof.
  const obstacleRings: Point2[][] = obstacles.map((o) =>
    inflateRing(footprintRing(o), clearance),
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

  const rowSpacing = effectiveRowSpacingM(config);
  const colSpacing = effectiveColSpacingM(config);
  const rows = config.setRows;
  const cols = config.setCols;
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
    return { panels: [], reason: "Panel set rows and columns must be positive whole numbers" };
  }
  const stepU = width + colSpacing;
  const stepV = length + rowSpacing;
  const insetU = width / 2 + config.setbackM;
  const insetV = length / 2 + config.setbackM;
  if (uMax - uMin < 2 * insetU || vMax - vMin < 2 * insetV) {
    return {
      panels: [],
      reason: `Roof is too small for one ${width.toFixed(2)} x ${length.toFixed(2)} m panel with a ${config.setbackM} m setback`,
    };
  }

  const inflateU = colSpacing > 0 ? colSpacing : 0;
  const inflateV = rowSpacing > 0 ? rowSpacing : 0;

  /**
   * Lattice phases to try, as fractions of one step. The lattice is anchored on
   * the terrace bounding box, so an unaligned origin can strand a whole row or
   * column. Sweeping deterministic phases and keeping the densest result
   * recovers those columns without changing the spacing rule: within any one
   * phase the step is still exactly one panel pitch per axis.
   */
  const PHASES = [0, 0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];

  let best: PlacedPanel[] = [];
  for (const phaseU of PHASES) {
    for (const phaseV of PHASES) {
      const placed = latticeAt(
        uMin + insetU + phaseU * stepU,
        vMin + insetV + phaseV * stepV,
      );
      if (placed.length > best.length) best = placed;
    }
  }

  if (best.length === 0) {
    return {
      panels: [],
      reason:
        obstacles.length > 0
          ? `Obstacles and roof edges leave no room for one ${rows}x${cols} set with the current setback`
          : `No room for one ${rows}x${cols} set with a ${config.setbackM} m setback - try a smaller set or setback`,
    };
  }
  return { panels: best, reason: null };

  /**
   * One lattice anchored at (originU, originV) in the panel frame. Each
   * lattice point is the centre of panel (0, 0) of a candidate rows x cols
   * block; the block is accepted only when EVERY panel in it passes the
   * roof, obstacle and peer checks (all-or-nothing: a set never straddles
   * an edge, an obstacle or another set). Block pitch equals the intra-set
   * panel pitch, so gaps stay uniform within and between sets.
   *
   * Crucially, candidate rows and columns are searched across the full
   * bounding extent. A row or section that cannot fit a panel (e.g. Due to
   * a courtyard, notch, obstacle, or setback) does NOT terminate the search,
   * ensuring concave/L-shaped/U-shaped roofs and separated usable regions
   * are fully packed to maximum feasible density.
   */
  function latticeAt(originU: number, originV: number): PlacedPanel[] {
    const placed: PlacedPanel[] = [];
    // Hard bounds in the panel frame: the terrace bounding box guarantees no
    // valid centre lies outside it, so the loops can never run away even if a
    // phase starts completely off-roof (which `continue`s on every candidate).
    const uLimit = uMax;
    const vLimit = vMax;
    for (let bv = originV; bv <= vLimit + 1e-9; bv += stepV) {
      for (let bu = originU; bu <= uLimit + 1e-9; bu += stepU) {
        const block = blockAt(bu, bv, placed);
        if (block === null) continue;
        for (const panel of block) placed.push({ ...panel, index: placed.length });
      }
    }
    return placed;
  }

  /**
   * Validate one candidate block whose (0, 0) panel centre sits at (bu, bv)
   * in the panel frame. Returns the rows x cols panels with running indices,
   * or null when any single panel fails - the whole set is then skipped and
   * the lattice moves on, leaving that roof area for other candidates.
   */
  function blockAt(bu: number, bv: number, accepted: PlacedPanel[]): PlacedPanel[] | null {
    // Panel (r, c) centre in panel-frame coordinates.
    const toWorld = (pu: number, pv: number): Point2 => ({
      x: pu * u.x + pv * v.x,
      y: pu * u.y + pv * v.y,
    });
    const rects: Point2[][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const centre = toWorld(bu + c * stepU, bv + r * stepV);
        const rect = rectangleCorners(centre.x, centre.y, width, length, rotation);
        // 1. Setback: the rectangle inflated by the setback must fit inside.
        const insetRect = rectangleCorners(
          centre.x,
          centre.y,
          width + 2 * config.setbackM,
          length + 2 * config.setbackM,
          rotation,
        );
        if (!footprintInsidePolygon(insetRect, terrace)) return null;
        // 2. Obstacles: the panel must clear every exclusion ring.
        if (obstacleRings.some((ring) => footprintsOverlap(rect, ring))) return null;
        rects.push(rect);
      }
    }
    // 3. Panel-to-panel spacing against everything accepted so far, using
    // the per-axis clear gap between panel edges. Siblings inside this
    // block are exactly one pitch apart by construction, so only the
    // accepted set needs checking.
    for (const rect of rects) {
      if (
        accepted.some((p) =>
          footprintsOverlap(
            rect,
            rectangleCorners(p.x, p.y, width + inflateU, length + inflateV, rotation),
          ),
        )
      ) {
        return null;
      }
    }
    return rects.map((_, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const centre = toWorld(bu + c * stepU, bv + r * stepV);
      return { index: -1, x: centre.x, y: centre.y, rotationDeg: rotation };
    });
  }
}