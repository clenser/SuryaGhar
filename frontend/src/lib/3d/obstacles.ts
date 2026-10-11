/**
 * Rooftop obstacle domain model and deterministic validation.
 *
 * Obstacles live in the SAME local metric frame as the building
 * (Phase 2): Lat/Lon ? UTM ? local metres with the terrace centroid at the
 * origin, 1 unit = 1 metre (AGENTS.md ï¿½13, ï¿½64, ï¿½65). Nothing here measures
 * pixels, screen distance or Three.js mesh bounds (AGENTS.md ï¿½52).
 *
 * This module is deliberately free of any Three.js import: the obstacle record
 * is the application's source of truth, meshes are only a visualisation of it
 * (AGENTS.md ï¿½40, ï¿½72). The record is also shaped so later phases can consume
 * it directly for panel exclusion, panel clearance, shadow simulation and
 * quantitative shading analysis ï¿½ footprints are plain metric polygons.
 */

/** Obstacle categories offered by the editor. */
export type ObstacleType = "hvac" | "water-tank" | "staircase-room" | "lift-room" | "custom";

/**
 * Application-level obstacle state.
 *
 * `position` is the footprint CENTRE in local metres (X = east, Y = north).
 * `width` is the X extent and `length` the Y extent at rotation 0.
 * `rotation` is degrees counter-clockwise around the vertical Z axis.
 * `height` is the extrusion height in metres above the roof.
 */
export interface Obstacle {
  id: string;
  type: ObstacleType;
  position: { x: number; y: number };
  width: number;
  length: number;
  height: number;
  rotation: number;
  /**
   * Drawn polygon footprint: vertex offsets in local metres RELATIVE TO
   * `position` (the centroid), unrotated ï¿½ `rotation` applies on read.
   * Null means the classic width ï¿½ length rectangle. Stored this way so
   * repositioning (x/y) and rotation keep working through the existing
   * rectangular controls.
   */
  polygon?: Point2[] | null;
}

/** A 2D point in local metres. */
export interface Point2 {
  x: number;
  y: number;
}

/** Catalog entry for one obstacle category (footprint presets in metres). */
export interface ObstacleTypeDefinition {
  type: ObstacleType;
  label: string;
  defaultLength: number;
  defaultWidth: number;
  defaultHeight: number;
}

/** Smallest obstacle dimension accepted (metres). */
export const MIN_OBSTACLE_SIZE_M = 0.1;
/** Largest footprint side accepted (metres) ï¿½ roof-scale sanity limit. */
export const MAX_OBSTACLE_FOOTPRINT_M = 60;
/** Largest obstacle height accepted (metres). */
export const MAX_OBSTACLE_HEIGHT_M = 50;
/** Tolerance for boundary tests (metres); local coordinates are ~10ï¿½ m. */
export const BOUNDARY_TOLERANCE_M = 1e-6;
/** Overlap smaller than this counts as "touching", not overlapping. */
export const OVERLAP_EPSILON_M = 1e-6;
/**
 * Numerical slack on the inner-parapet contact boundary, metres.
 *
 * Contact is a *permitted, deliberate* configuration ï¿½ a water tank fused to
 * the parapet from the inside, a staircase room meeting the parapet wall, a
 * drawn polygon running along the wall. Because an offset ring and a drawn
 * vertex can only coincide to float precision (positions are Float32 in the
 * GPU path and the terrace ring is projected from UTM doubles), the boundary
 * accepts coincidence within 2 mm and rejects anything that actually crosses
 * into the wall/cap volume. This is deliberately tiny: it is float slack, not
 * a clearance the user could tune.
 */
export const PARAPET_CONTACT_TOLERANCE_M = 0.002;

/** Initial presets; dimensions are metres. */
export const OBSTACLE_TYPES: ObstacleTypeDefinition[] = [
  { type: "hvac", label: "AC / HVAC", defaultLength: 1.5, defaultWidth: 1.0, defaultHeight: 0.8 },
  { type: "water-tank", label: "Water Tank", defaultLength: 2.5, defaultWidth: 2.5, defaultHeight: 2.0 },
  { type: "staircase-room", label: "Staircase Room", defaultLength: 4.5, defaultWidth: 3.0, defaultHeight: 3.0 },
  { type: "lift-room", label: "Lift Room", defaultLength: 3.0, defaultWidth: 2.5, defaultHeight: 3.0 },
  { type: "custom", label: "Custom", defaultLength: 2.0, defaultWidth: 2.0, defaultHeight: 1.0 },
];

/** Display name for an obstacle category. */
export function obstacleTypeLabel(type: ObstacleType): string {
  return OBSTACLE_TYPES.find((t) => t.type === type)?.label ?? "Custom";
}

/** Look up a catalog entry (falls back to Custom). */
export function obstacleTypeDefinition(type: ObstacleType): ObstacleTypeDefinition {
  return OBSTACLE_TYPES.find((t) => t.type === type) ?? OBSTACLE_TYPES[OBSTACLE_TYPES.length - 1];
}

let obstacleIdCounter = 0;

/** Create a unique obstacle id within a session. */
export function createObstacleId(): string {
  obstacleIdCounter += 1;
  return `obstacle-${obstacleIdCounter}`;
}

/** Reset the id counter (tests only ï¿½ keeps ids predictable). */
export function resetObstacleIdsForTests(): void {
  obstacleIdCounter = 0;
}

/**
 * Rotate offset points around the origin by degrees counter-clockwise.
 * Shared by rectangular corners and drawn-polygon offsets.
 */
export function rotateOffsets(points: Point2[], rotationDeg: number): Point2[] {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

/**
 * Footprint corners in local metres, clockwise from the local -X/-Y corner,
 * already rotated around `position`. Rectangular obstacles use width/length;
 * drawn-polygon obstacles use their stored offsets. This is the authoritative
 * footprint later phases consume for exclusion geometry and clearance.
 */
export function obstacleFootprint(obstacle: Obstacle): Point2[] {
  if (obstacle.polygon && obstacle.polygon.length >= 3) {
    const rotated = rotateOffsets(obstacle.polygon, obstacle.rotation);
    return rotated.map((p) => ({ x: obstacle.position.x + p.x, y: obstacle.position.y + p.y }));
  }
  const radians = (obstacle.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = obstacle.width / 2;
  const halfL = obstacle.length / 2;
  const corners: Array<[number, number]> = [
    [-halfW, -halfL],
    [halfW, -halfL],
    [halfW, halfL],
    [-halfW, halfL],
  ];
  return corners.map(([cx, cy]) => ({
    x: obstacle.position.x + cx * cos - cy * sin,
    y: obstacle.position.y + cx * sin + cy * cos,
  }));
}

/**
 * Vertical extent of an obstacle on the site: it stands ON the roof, so its
 * base is the building height and its top is base + own height.
 * Example: building 17.2 m + obstacle 2.0 m ? 17.2 ? 19.2 m.
 */
export function obstacleZRange(
  buildingHeight: number,
  obstacle: Pick<Obstacle, "height">,
): { base: number; top: number } {
  return { base: buildingHeight, top: buildingHeight + obstacle.height };
}

/** Ray-cast point-in-polygon test; the boundary itself counts as inside. */export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  if (polygon.length < 3) return false;
  if (distanceToRing(point, polygon) <= BOUNDARY_TOLERANCE_M) return true;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
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
function distanceToRing(p: Point2, ring: Point2[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const d = distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < min) min = d;
  }
  return min;
}

/** +1 / -1 / 0 orientation of the triple (counter-clockwise / clockwise / collinear). */
function orientation(a: Point2, b: Point2, c: Point2): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * True only when the segments properly cross. Touching or collinear contact is
 * not a crossing ï¿½ those cases are already covered by the corner-inside test.
 */
function segmentsProperlyCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return o1 !== o2 && o3 !== o4;
}

/**
 * Deterministic "is this rotated rectangle inside this (possibly concave)
 * polygon" test: every corner inside AND no edge crossing the boundary.
 * Corners-only would be wrong for concave terraces.
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
      if (segmentsProperlyCross(a, b, c, d)) return false;
    }
  }
  return true;
}

/** Separating-axes of a rectangle from two of its edge directions. */
function rectangleAxes(footprint: Point2[]): Point2[] {
  const first = { x: footprint[1].x - footprint[0].x, y: footprint[1].y - footprint[0].y };
  const second = { x: footprint[2].x - footprint[1].x, y: footprint[2].y - footprint[1].y };
  const normalize = (v: Point2): Point2 => {
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };
  return [normalize(first), normalize(second)];
}

function project(footprint: Point2[], axis: Point2): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of footprint) {
    const value = p.x * axis.x + p.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Separating-axis test for two convex footprints given as rings. Exact
 * touching is allowed; a real overlap on every axis means the solids
 * intersect (both sit on the same roof, so a plan overlap is a 3D collision
 * too). Exported so panel placement reuses the same authoritative test.
 */
export function footprintsOverlap(a: Point2[], b: Point2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const axes = [...rectangleAxes(a), ...rectangleAxes(b)];
  for (const axis of axes) {
    const projA = project(a, axis);
    const projB = project(b, axis);
    if (projA.max - projB.min <= OVERLAP_EPSILON_M || projB.max - projA.min <= OVERLAP_EPSILON_M) {
      return false;
    }
  }
  return true;
}

/** Two obstacles overlap when their rotated footprints do. */
export function obstaclesOverlap(a: Obstacle, b: Obstacle): boolean {
  // Fast proven path while both are plain rectangles.
  if (!a.polygon && !b.polygon) {
    return footprintsOverlap(obstacleFootprint(a), obstacleFootprint(b));
  }
  return polygonsOverlap(obstacleFootprint(a), obstacleFootprint(b));
}

/** Orientation sign of the turn a?b?c (for segment intersection). */
function turn(a: Point2, b: Point2, c: Point2): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : -1;
}

/** True when segments ab and cd cross (touching at endpoints counts). */
export function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const t1 = turn(a, b, c) * turn(a, b, d);
  const t2 = turn(c, d, a) * turn(c, d, b);
  return t1 <= 0 && t2 <= 0;
}

/** True when a ring self-intersects (any non-adjacent edge pair crosses). */
export function polygonSelfIntersects(ring: Point2[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges (and first/last) share a vertex ï¿½ skip those pairs.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * General polygon-polygon overlap: any proper edge crossing, or either ring
 * containing the other. Touching at edges/corners is allowed (same rule as
 * the rectangular SAT path). Works for concave rings where SAT alone would
 * under-report.
 */
export function polygonsOverlap(a: Point2[], b: Point2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const t1 = turn(a[i], a[(i + 1) % a.length], b[j]) * turn(a[i], a[(i + 1) % a.length], b[(j + 1) % b.length]);
      const t2 = turn(b[j], b[(j + 1) % b.length], a[i]) * turn(b[j], b[(j + 1) % b.length], a[(i + 1) % a.length]);
      // Strict crossing only (t < 0 both ways): touching is permitted.
      if (t1 < 0 && t2 < 0) return true;
    }
  }
  // Containment without edge crossing: a vertex strictly inside the other.
  // Boundary points count as outside here so shared edges stay permitted.
  const strictlyInside = (p: Point2, ring: Point2[]): boolean => {
    if (!pointInPolygon(p, ring)) return false;
    for (let i = 0; i < ring.length; i++) {
      if (pointSegmentDistance(p, ring[i], ring[(i + 1) % ring.length]) < 1e-6) return false;
    }
    return true;
  };
  return a.some((p) => strictlyInside(p, b)) || b.some((p) => strictlyInside(p, a));
}

/**
 * Split absolute drawn points into a centroid plus centroid-relative
 * offsets ï¿½ the storage form for drawn-polygon drafts/obstacles, so
 * repositioning (x/y) and rotation keep working through the rectangular
 * controls.
 */
export function splitPolygon(points: Point2[]): { centroid: Point2; offsets: Point2[] } {
  const centroid = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
  return { centroid, offsets: points.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y })) };
}

/** Twice the signed area of a ring (winding + degeneracy check). */
export function ringArea2(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Validate drawn absolute footprint points BEFORE centroid splitting, with
 * specific actionable errors. `others` excludes the obstacle being drawn.
 */
export function validateFootprint(
  points: Point2[],
  context: ObstacleContext,
): ObstacleValidation {
  if (points.length < 3) {
    return { valid: false, error: "Click at least 3 points on the roof to define the footprint" };
  }
  if (Math.abs(ringArea2(points)) < 1e-4) {
    return { valid: false, error: "Footprint is degenerate ï¿½ spread the points wider" };
  }
  if (polygonSelfIntersects(points)) {
    return { valid: false, error: "Footprint edges cross ï¿½ redraw a simple outline" };
  }
  const { centroid, offsets } = splitPolygon(points);
  const candidate: Obstacle = {
    id: "__drawn__",
    type: "custom",
    position: centroid,
    width: 0,
    length: 0,
    height: 1,
    rotation: 0,
    polygon: offsets,
  };
  if (!footprintInsidePolygon(obstacleFootprint(candidate), context.terrace)) {
    return { valid: false, error: "Footprint extends beyond the rooftop boundary" };
  }
  // Parapet contact, applied to the FOOTPRINT (every drawn vertex) rather than
  // the centroid. `parapetContactM` is the inner face of the parapet wall, and
  // touching it is permitted within float tolerance ï¿½ a drawn polygon may run
  // along the wall. A larger `parapetInsetM` alone keeps the legacy strict
  // clearance behaviour for callers that have not opted in.
  const contact = context.parapetContactM ?? context.parapetInsetM ?? 0;
  const contactError = checkParapetContact(obstacleFootprint(candidate), context.terrace, contact);
  if (contactError) return { valid: false, error: contactError };
  for (const other of context.others) {
    if (polygonsOverlap(obstacleFootprint(candidate), obstacleFootprint(other))) {
      return {
        valid: false,
        error: `Footprint overlaps the ${obstacleTypeLabel(other.type).toLowerCase()}`,
      };
    }
  }
  return { valid: true };
}

/** Shortest distance from a point to a segment (metres, exact). */
export function pointSegmentDistance(
  p: Point2,
  a: Point2,
  b: Point2,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(
    1,
    Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2),
  );
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Everything the validator needs about the rooftop. */
export interface ObstacleContext {
  /** Terrace footprint ring in local metres (the roof boundary). */
  terrace: Point2[];
  /** Obstacles already on the roof ï¿½ exclude the one being validated. */
  others: Obstacle[];
  /**
   * Required clearance inside the terrace boundary in metres (parapet wall
   * thickness + maintenance clearance). Every footprint corner must keep at
   * least this distance from every terrace edge. Defaults to 0 (legacy
   * boundary-only check).
   */
  parapetInsetM?: number;
  /**
   * Inset from the terrace edge to the INNER FACE of the parapet wall, in
   * metres. Obstacles may TOUCH this boundary (within
   * PARAPET_CONTACT_TOLERANCE_M); crossing it is parapet penetration and is
   * rejected.
   *
   * This is a *contact boundary*, not a clearance rule: the ordinary
   * maintenance clearance for other purposes (e.g. panel placement) stays in
   * `parapetInsetM`, which is unchanged. When omitted it falls back to
   * `parapetInsetM`, preserving the previous strict-clearance behaviour for
   * callers that have not opted in.
   */
  parapetContactM?: number;
}

export type ObstacleValidation = { valid: true } | { valid: false; error: string };

/**
 * Test an obstacle footprint against the inner parapet boundary.
 *
 * Applied to the FOOTPRINT ï¿½ every corner of the rotated rectangle or the drawn
 * polygon ï¿½ never to the obstacle's centre. Combined with the caller's
 * `footprintInsidePolygon` test (which also rejects a footprint edge crossing
 * the terrace ring), all-corners-inside implies the whole footprint is inside
 * for both convex and concave terraces.
 *
 * Contact policy: a corner may sit ON the inner face (allowed within float
 * tolerance); a corner inside the wall band is parapet penetration and is
 * rejected. Contact is therefore deliberate and permitted, while anything that
 * eats into the wall/cap volume fails.
 *
 * @returns null when the footprint respects the parapet, else an error message.
 */
function checkParapetContact(
  footprint: Point2[],
  ring: Point2[],
  contactM: number,
): string | null {
  if (contactM <= 0) return null;
  let closest = Infinity;
  for (const corner of footprint) {
    for (let i = 0; i < ring.length; i++) {
      closest = Math.min(closest, pointSegmentDistance(corner, ring[i], ring[(i + 1) % ring.length]));
    }
  }
  // `closest` is the distance from the nearest footprint corner to the exterior
  // roof edge. Inside the wall band means closer than the inner face minus the
  // float slack; exactly ON the inner face is permitted contact.
  if (closest < contactM - PARAPET_CONTACT_TOLERANCE_M) {
    return "Obstacle penetrates the parapet ï¿½ it must stay behind the inner parapet wall";
  }
  return null;
}

function checkDimension(value: number, label: string, max: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${label} must be a valid number`;
  }
  if (value <= 0) return `${label} must be greater than 0`;
  if (value < MIN_OBSTACLE_SIZE_M) return `${label} must be at least ${MIN_OBSTACLE_SIZE_M} m`;
  if (value > max) return `${label} must not exceed ${max} m`;
  return null;
}

/**
 * Deterministic obstacle validation (AGENTS.md ï¿½17, ï¿½51):
 *  1. positive width / length / height
 *  2. valid position and rotation
 *  3. rotated footprint fully inside the terrace
 *  4. every corner clear of the parapet inner edge (when an inset applies)
 *  5. no overlap with another obstacle
 *
 * @returns `null`-free result: either `valid` or a user-facing `error`.
 */
export function validateObstacle(obstacle: Obstacle, context: ObstacleContext): ObstacleValidation {
  const dimensions: Array<[number, string, number]> = [
    [obstacle.length, "Length", MAX_OBSTACLE_FOOTPRINT_M],
    [obstacle.width, "Width", MAX_OBSTACLE_FOOTPRINT_M],
    [obstacle.height, "Height", MAX_OBSTACLE_HEIGHT_M],
  ];
  for (const [value, label, max] of dimensions) {
    const error = checkDimension(value, label, max);
    if (error) return { valid: false, error };
  }

  if (!Number.isFinite(obstacle.position?.x) || !Number.isFinite(obstacle.position?.y)) {
    return { valid: false, error: "Position must be two valid numbers" };
  }
  if (!Number.isFinite(obstacle.rotation)) {
    return { valid: false, error: "Rotation must be a valid number" };
  }
  if (context.terrace.length < 3) {
    return { valid: false, error: "Terrace footprint is missing" };
  }

  if (!footprintInsidePolygon(obstacleFootprint(obstacle), context.terrace)) {
    return { valid: false, error: "Obstacle extends beyond the rooftop boundary" };
  }

  // Parapet contact. An obstacle may TOUCH the inner face of the parapet wall
  // (a fused rooftop structure); crossing into the wall/cap volume is
  // penetration and is rejected. The ordinary maintenance clearance for other
  // purposes stays on `parapetInsetM`, which this deliberately does not reuse ï¿½
  // it is a boundary, not a clearance.
  const contact = context.parapetContactM ?? context.parapetInsetM ?? 0;
  const contactError = checkParapetContact(obstacleFootprint(obstacle), context.terrace, contact);
  if (contactError) return { valid: false, error: contactError };

  for (const other of context.others) {
    if (other.id === obstacle.id) continue;
    if (obstaclesOverlap(obstacle, other)) {
      return {
        valid: false,
        error: `Obstacle overlaps the ${obstacleTypeLabel(other.type).toLowerCase()}`,
      };
    }
  }

  return { valid: true };
}

/** Obstacles that no longer satisfy the rules (e.g. the roof changed). */
export function findInvalidObstacles(
  obstacles: Obstacle[],
  terrace: Point2[],
  parapetInsetM = 0,
  parapetContactM?: number,
): Array<{ obstacle: Obstacle; error: string }> {
  return obstacles
    .map((obstacle) => {
      const result = validateObstacle(obstacle, {
        terrace,
        others: obstacles.filter((o) => o.id !== obstacle.id),
        parapetInsetM,
        parapetContactM,
      });
      return result.valid ? null : { obstacle, error: result.error };
    })
    .filter((entry): entry is { obstacle: Obstacle; error: string } => entry !== null);
}

/** Raw form values for the obstacle editor (kept as strings so partial or
 * invalid input stays editable instead of collapsing to 0). */
export interface ObstacleDraft {
  type: ObstacleType;
  length: string;
  width: string;
  height: string;
  rotation: string;
  /** Local metres, east offset from the terrace centroid. */
  x: string;
  /** Local metres, north offset from the terrace centroid. */
  y: string;
  /**
   * Drawn polygon footprint: centroid-relative offsets (see `splitPolygon`).
   * Null means the classic width ï¿½ length rectangle. Only the Custom type
   * produces these; switching type clears them.
   */
  polygon?: Point2[] | null;
}

/** Fresh draft using the selected category's presets, centred on the roof. */
export function emptyObstacleDraft(type: ObstacleType = "water-tank"): ObstacleDraft {
  const definition = obstacleTypeDefinition(type);
  return {
    type: definition.type,
    length: String(definition.defaultLength),
    width: String(definition.defaultWidth),
    height: String(definition.defaultHeight),
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

/** Convert form values into an obstacle record (numbers may be NaN/invalid). */
export function draftToObstacle(draft: ObstacleDraft, id: string): Obstacle {
  const polygon = draft.polygon && draft.polygon.length >= 3 ? draft.polygon : null;
  // Polygon drafts carry their own shape: show bounding extents in the
  // dimension fields so lists stay meaningful; the polygon stays authoritative.
  let length = parseNumber(draft.length);
  let width = parseNumber(draft.width);
  if (polygon) {
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    width = Math.max(...xs) - Math.min(...xs);
    length = Math.max(...ys) - Math.min(...ys);
  }
  return {
    id,
    type: draft.type,
    position: { x: parseNumber(draft.x), y: parseNumber(draft.y) },
    length,
    width,
    height: parseNumber(draft.height),
    rotation: parseNumber(draft.rotation),
    polygon,
  };
}

/** Read an existing obstacle back into the form. */
export function obstacleToDraft(obstacle: Obstacle): ObstacleDraft {
  return {
    type: obstacle.type,
    length: String(obstacle.length),
    width: String(obstacle.width),
    height: String(obstacle.height),
    rotation: String(obstacle.rotation),
    x: String(obstacle.position.x),
    y: String(obstacle.position.y),
    polygon: obstacle.polygon && obstacle.polygon.length >= 3 ? obstacle.polygon : null,
  };
}

/** Compact metric description used in the list: "2.5 ï¿½ 2.5 ï¿½ 2.0 m". */
export function formatObstacleDimensions(obstacle: Obstacle): string {
  return `${obstacle.length} × ${obstacle.width} × ${obstacle.height} m`;
}
