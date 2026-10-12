/**
 * Tree domain model and deterministic validation.
 *
 * Trees live in the SAME local metric frame as the building
 * (Phase 2): Lat/Lon ? UTM ? local metres with the terrace centroid at the
 * origin, 1 unit = 1 metre (AGENTS.md ï¿½13, ï¿½64, ï¿½65). Nothing here measures
 * pixels, screen distance or Three.js mesh bounds (AGENTS.md ï¿½52).
 *
 * This module is deliberately free of any Three.js import: the tree record
 * is the application's source of truth, meshes are only a visualisation of it
 * (AGENTS.md ï¿½40, ï¿½72). The record is also shaped so later phases can consume
 * it directly for panel exclusion, panel clearance, shadow simulation and
 * quantitative shading analysis ï¿½ footprints are plain metric polygons.
 */

/** Tree categories offered by the editor. */
export type TreeType = "broadleaf" | "conifer" | "small-ornamental";

/**
 * Application-level tree state.
 *
 * `position` is the footprint CENTRE in local metres (X = east, Y = north).
 * `height` is the total tree height in metres (from ground up).
 * `canopyWidth` is the approximate horizontal extent of the canopy in metres.
 * `rotation` is degrees counter-clockwise around the vertical Z axis.
 */
export interface Tree {
  id: string;
  type: TreeType;
  position: { x: number; y: number };
  height: number;
  canopyWidth: number;
  rotation: number;
  /** Drawn footprint offset points in local metres RELATIVE TO `position` (the centroid), unrotated. */
  polygon?: Point2[] | null;
}

/** A 2D point in local metres. */
export interface Point2 {
  x: number;
  y: number;
}

/** Form values for the tree editor (kept as strings so partial/invalid input stays editable). */
export interface TreeDraft {
  type: TreeType;
  height: string;
  canopyWidth: string;
  rotation: string;
  x: string;
  y: string;
  /** Drawn polygon footprint: centroid-relative offsets, unrotated. Null means rectangular. */
  polygon?: Point2[] | null;
}

/** Catalog entry for one tree category (dimensions in metres). */
export interface TreeTypeDefinition {
  type: TreeType;
  label: string;
  defaultHeight: number;
  defaultCanopyWidth: number;
  minHeight: number;
  maxHeight: number;
  minCanopyWidth: number;
  maxCanopyWidth: number;
}

/** Minimum tree dimension accepted (metres). */
export const MIN_TREE_HEIGHT_M = 1.0;
/** Maximum tree height accepted (metres) ï¿½ site-scale sanity limit. */
export const MAX_TREE_HEIGHT_M = 30;
/** Minimum canopy width accepted (metres). */
export const MIN_TREE_CANOPY_WIDTH_M = 0.5;
/** Maximum canopy width accepted (metres) ï¿½ roof-scale sanity limit. */
export const MAX_TREE_CANOPY_WIDTH_M = 20;

/** Initial presets; dimensions are metres. */
export const TREE_TYPES: TreeTypeDefinition[] = [
  {
    type: "broadleaf",
    label: "Broadleaf",
    defaultHeight: 8.0,
    defaultCanopyWidth: 5.0,
    minHeight: MIN_TREE_HEIGHT_M,
    maxHeight: MAX_TREE_HEIGHT_M,
    minCanopyWidth: MIN_TREE_CANOPY_WIDTH_M,
    maxCanopyWidth: MAX_TREE_CANOPY_WIDTH_M,
  },
  {
    type: "conifer",
    label: "Conifer",
    defaultHeight: 12.0,
    defaultCanopyWidth: 3.0,
    minHeight: MIN_TREE_HEIGHT_M,
    maxHeight: MAX_TREE_HEIGHT_M,
    minCanopyWidth: MIN_TREE_CANOPY_WIDTH_M,
    maxCanopyWidth: MAX_TREE_CANOPY_WIDTH_M,
  },
  {
    type: "small-ornamental",
    label: "Small Ornamental",
    defaultHeight: 5.0,
    defaultCanopyWidth: 2.0,
    minHeight: MIN_TREE_HEIGHT_M,
    maxHeight: MAX_TREE_HEIGHT_M,
    minCanopyWidth: MIN_TREE_CANOPY_WIDTH_M,
    maxCanopyWidth: MAX_TREE_CANOPY_WIDTH_M,
  },
];

/** Display name for a tree category. */
export function treeTypeLabel(type: TreeType): string {
  return TREE_TYPES.find((t) => t.type === type)?.label ?? "Custom";
}

/** Look up a catalog entry (falls back to Small Ornamental). */
export function treeTypeDefinition(type: TreeType): TreeTypeDefinition {
  return TREE_TYPES.find((t) => t.type === type) ?? TREE_TYPES[TREE_TYPES.length - 1];
}

let treeIdCounter = 0;

/** Create a unique tree id within a session. */
export function createTreeId(): string {
  treeIdCounter += 1;
  return `tree-${treeIdCounter}`;
}

/** Reset the id counter (tests only ï¿½ keeps ids predictable). */
export function resetTreeIdsForTests(): void {
  treeIdCounter = 0;
}

/** Rotate offset points around the origin by degrees counter-clockwise. */
export function rotateOffsets(points: Point2[], rotationDeg: number): Point2[] {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

/** Footprint corners in local metres, clockwise from the local -X/-Y corner, already rotated around `position`. Rectangular footprints use canopyWidth; drawn polygons use their stored offsets. */
export function treeFootprint(tree: Tree): Point2[] {
  if (tree.polygon && tree.polygon.length >= 3) {
    const rotated = rotateOffsets(tree.polygon, tree.rotation);
    return rotated.map((p) => ({ x: tree.position.x + p.x, y: tree.position.y + p.y }));
  }
  // Rectangular footprint: canopyWidth is the extent at rotation 0.
  const radians = (tree.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = tree.canopyWidth / 2;
  const corners: Array<[number, number]> = [
    [-halfW, -halfW],
    [halfW, -halfW],
    [halfW, halfW],
    [-halfW, halfW],
  ];
  return corners.map(([cx, cy]) => ({
    x: tree.position.x + cx * cos - cy * sin,
    y: tree.position.y + cx * sin + cy * cos,
  }));
}

/** +1 / -1 / 0 orientation of the triple (counter-clockwise / clockwise / collinear). */
function orientation(a: Point2, b: Point2, c: Point2): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : -1;
}

/** True when segments ab and cd cross (touching at endpoints counts). */
export function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const t1 = orientation(a, b, c) * orientation(a, b, d);
  const t2 = orientation(c, d, a) * orientation(c, d, b);
  return t1 <= 0 && t2 <= 0;
}

/** True when segments ab and cd cross strictly in their interiors (proper intersection). */
export function properSegmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const t1 = orientation(a, b, c) * orientation(a, b, d);
  const t2 = orientation(c, d, a) * orientation(c, d, b);
  return t1 < 0 && t2 < 0;
}

/** True when a ring self-intersects (any non-adjacent edge pair crosses). */
export function polygonSelfIntersects(ring: Point2[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Deterministic "is this footprint inside this (possibly concave) polygon" test:
 * every corner inside AND no edge crossing the boundary.
 */
export function footprintInsidePolygon(footprint: Point2[], polygon: Point2[]): boolean {
  if (footprint.length < 3 || polygon.length < 3) return false;
  for (const corner of footprint) {
    if (!pointInPolygon(corner, polygon)) return false;
  }
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    for (let j = 0; j < polygon.length; j++) {
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}

/** Minimum distance from a point to a segment. */
function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance from a point to the polygon boundary. */
export function distanceToRing(p: Point2, ring: Point2[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const d = distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < min) min = d;
  }
  return min;
}

/** Ray-cast point-in-polygon test; the boundary itself counts as inside. */
export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  if (polygon.length < 3) return false;
  if (distanceToRing(point, polygon) <= 1e-6) return true;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * General polygon-polygon overlap test (handles concave polygons).
 * Touching along edges or at corners is allowed (zero clearance contact).
 * Returns true only when polygons have strict positive-area overlap.
 */
export function polygonsOverlap(a: Point2[], b: Point2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  // 1. Check for proper edge crossings (strict interior crossing of boundary segments)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const a1 = a[i];
      const a2 = a[(i + 1) % a.length];
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (properSegmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  // 2. Check for vertices strictly contained in the interior (distance to boundary > 1e-4)
  if (a.some((p) => pointInPolygon(p, b) && distanceToRing(p, b) > 1e-4)) return true;
  if (b.some((p) => pointInPolygon(p, a) && distanceToRing(p, a) > 1e-4)) return true;

  // 3. Check edge midpoints strictly contained in interior
  for (let i = 0; i < a.length; i++) {
    const mid = { x: (a[i].x + a[(i + 1) % a.length].x) / 2, y: (a[i].y + a[(i + 1) % a.length].y) / 2 };
    if (pointInPolygon(mid, b) && distanceToRing(mid, b) > 1e-4) return true;
  }
  for (let j = 0; j < b.length; j++) {
    const mid = { x: (b[j].x + b[(j + 1) % b.length].x) / 2, y: (b[j].y + b[(j + 1) % b.length].y) / 2 };
    if (pointInPolygon(mid, a) && distanceToRing(mid, a) > 1e-4) return true;
  }

  // 4. Check centroid interior containment
  const centA = { x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length };
  if (pointInPolygon(centA, b) && distanceToRing(centA, b) > 1e-4) return true;
  const centB = { x: b.reduce((s, p) => s + p.x, 0) / b.length, y: b.reduce((s, p) => s + p.y, 0) / b.length };
  if (pointInPolygon(centB, a) && distanceToRing(centB, a) > 1e-4) return true;

  return false;
}

/**
 * Estimated collision radius of the tree trunk/base in metres.
 * Trunks are slender (0.15m to 0.35m radius depending on species).
 */
export function treeTrunkRadius(type: TreeType): number {
  switch (type) {
    case "broadleaf":
      return 0.28;
    case "conifer":
      return 0.22;
    case "small-ornamental":
      return 0.16;
    default:
      return 0.22;
  }
}

/**
 * Validate a tree footprint against the terrace and existing trees.
 * Requirements:
 * - Trees may be placed immediately beside exterior building walls (zero clearance contact).
 * - The trunk/base must never penetrate the interior of the building footprint.
 * - The canopy may touch or overhang the exterior wall, but trunk position must remain outside.
 * - Canopies of adjacent trees may touch along edges or corners without artificial gaps.
 * - Trunks of adjacent trees must not collide (distance < r1 + r2).
 * Returns { valid: true } or { valid: false; error: string }.
 */
export function validateTree(
  tree: Tree,
  terrace: Point2[],
  others: Tree[],
): { valid: true } | { valid: false; error: string } {
  // 1. Positive dimensions
  if (tree.height <= 0) return { valid: false, error: "Tree height must be greater than 0" };
  if (tree.canopyWidth <= 0) return { valid: false, error: "Canopy width must be greater than 0" };

  // 2. Dimension limits
  if (tree.height < MIN_TREE_HEIGHT_M || tree.height > MAX_TREE_HEIGHT_M) {
    return { valid: false, error: `Tree height must be between ${MIN_TREE_HEIGHT_M} m and ${MAX_TREE_HEIGHT_M} m` };
  }
  if (tree.canopyWidth < MIN_TREE_CANOPY_WIDTH_M || tree.canopyWidth > MAX_TREE_CANOPY_WIDTH_M) {
    return { valid: false, error: `Canopy width must be between ${MIN_TREE_CANOPY_WIDTH_M} m and ${MAX_TREE_CANOPY_WIDTH_M} m` };
  }

  // 3. Tree trunk/base must be placed on the ground outside the building footprint.
  // The trunk base may touch the exterior wall boundary (zero clearance), but its center
  // and trunk radius must not penetrate into the building interior.
  const distToWall = distanceToRing(tree.position, terrace);
  const isInsideBuilding = pointInPolygon(tree.position, terrace) && distToWall > 1e-4;

  const trunkR = treeTrunkRadius(tree.type);
  // Ensure the trunk center remains outside the building footprint
  if (isInsideBuilding) {
    return { valid: false, error: "Tree trunk must be placed on the ground outside the building footprint" };
  }
  // If the tree center is outside, verify trunk center distance to wall permits zero clearance (distToWall >= 0)
  if (distToWall < 0 && trunkR > 0) {
    return { valid: false, error: "Tree trunk intersects building interior" };
  }

  // 4. Overlap and collision with other trees
  const footprint = treeFootprint(tree);
  for (const other of others) {
    if (other.id === tree.id) continue;
    // Trunk collision check: trunks must not collide with other trunks (d < r1 + r2)
    const trunkDist = Math.hypot(tree.position.x - other.position.x, tree.position.y - other.position.y);
    const minTrunkDist = trunkR + treeTrunkRadius(other.type) - 1e-4;
    if (trunkDist < minTrunkDist) {
      return {
        valid: false,
        error: `Tree trunk collides with the ${treeTypeLabel(other.type).toLowerCase()}`,
      };
    }

    const otherFootprint = treeFootprint(other);
    if (polygonsOverlap(footprint, otherFootprint)) {
      return {
        valid: false,
        error: `Tree footprint overlaps the ${treeTypeLabel(other.type).toLowerCase()}`,
      };
    }
  }

  return { valid: true };
}

/** Two tree footprints overlap (authoritative geometric test). */
export function treesOverlap(a: Tree, b: Tree): boolean {
  const aFootprint = treeFootprint(a);
  const bFootprint = treeFootprint(b);
  return polygonsOverlap(aFootprint, bFootprint);
}

/** Fresh draft using the selected category's presets, centred on the roof. */
export function emptyTreeDraft(type: TreeType = "broadleaf"): TreeDraft {
  const definition = treeTypeDefinition(type);
  return {
    type: definition.type,
    height: String(definition.defaultHeight),
    canopyWidth: String(definition.defaultCanopyWidth),
    rotation: "0",
    x: "0",
    y: "0",
  };
}

/** Parse a field value; empty or non-numeric input becomes NaN (invalid). */
function parseNumber(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Convert form values into a tree record (numbers may be NaN/invalid). */
export function draftToTree(draft: TreeDraft, id: string): Tree {
  const polygon = draft.polygon && draft.polygon.length >= 3 ? draft.polygon : null;
  let height = parseNumber(draft.height);
  let canopyWidth = parseNumber(draft.canopyWidth);
  // If polygon draft, derive extents
  if (polygon) {
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    canopyWidth = Math.max(...xs) - Math.min(...xs);
    height = Math.max(...ys) - Math.min(...ys); // use vertical range as height proxy
  }
  return {
    id,
    type: draft.type,
    position: { x: parseNumber(draft.x), y: parseNumber(draft.y) },
    height,
    canopyWidth,
    rotation: parseNumber(draft.rotation),
    polygon,
  };
}

/** Read an existing tree back into the form. */
export function treeToDraft(tree: Tree): TreeDraft {
  return {
    type: tree.type,
    height: String(tree.height),
    canopyWidth: String(tree.canopyWidth),
    rotation: String(tree.rotation),
    x: String(tree.position.x),
    y: String(tree.position.y),
    polygon: tree.polygon && tree.polygon.length >= 3 ? tree.polygon : null,
  };
}

/** Compact metric description used in the list: "8.0 × 5.0 m". */
export function formatTreeDimensions(tree: Tree): string {
  return `${tree.height.toFixed(1)} × ${tree.canopyWidth.toFixed(1)} m`;
}