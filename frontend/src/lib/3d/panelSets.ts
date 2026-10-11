/**
 * Panel sets, the shared placement validator and the hourly shading model.
 *
 * A panel SET is a group of panels sharing one configuration. Sets live in the
 * same local metric frame as the building (X = east, Y = north, Z = up, 1 unit
 * = 1 metre — AGENTS.md §13, §64). Nothing here touches Three.js: placement and
 * energy maths stay testable and deterministic.
 *
 * Determinism (AGENTS.md §57): the auto-placement lattice and the shading sums
 * iterate sorted structures with fixed step sizes, so identical inputs always
 * produce identical results. No randomness, no AI.
 */

import {
  footprintInsidePolygon,
  footprintsOverlap,
  type Obstacle,
  type Point2,
} from "./obstacles";
import {
  effectivePanelDims,
  panelTypeDefinition,
  validatePanelConfig,
  type PanelLayoutConfig,
} from "./panels";
import {
  PANEL_OBSTACLE_CLEARANCE_M,
  placePanels,
  rectangleCorners,
} from "./panelPlacement";

/**
 * One placed panel in a set.
 *
 * The record stores the placement (`x`, `y`, `rotationDeg`) plus its index in
 * the set's placement order. Set-level changes (move/rotate/reconfigure)
 * transform every member; per-panel overrides are NOT stored here — the
 * set-level configuration is applied to all members consistently.
 */
export interface PlacedSetPanel {
  index: number;
  x: number;
  y: number;
  rotationDeg: number;
}

/** Auto or manual placement, plus a label. */
export type PanelPlacementMode = "auto" | "manual";

export interface PanelSet {
  id: string;
  /** User-facing label ("Roof A", "South row"). */
  name: string;
  config: PanelLayoutConfig;
  mode: PanelPlacementMode;
  panels: PlacedSetPanel[];
  /** True while the user has manually adjusted this set. */
  userModified: boolean;
}

/** Validate placement without mutating anything — used by both auto and manual paths. */
export interface PlacementValidation {
  valid: boolean;
  error: string | null;
}

export interface PlacementContext {
  /** Terrace ring in local metres (roof boundary). */
  terrace: Point2[];
  /** Obstacles on the roof. */
  obstacles: Obstacle[];
  /** Required clearance inside the parapet (parapet + clearance), metres. */
  parapetInsetM: number;
  /** Other panels already placed — for panel-to-panel collision. */
  peers: PlacedPanelPeer[];
  /** Clearance from obstacle footprints, metres. */
  obstacleClearanceM?: number;
}

/** A placed panel to validate against: position + its own effective dims. */
export interface PlacedPanelPeer {
  x: number;
  y: number;
  rotationDeg: number;
  width: number;
  length: number;
}

/**
 * Validate a single panel position against the roof, obstacles and its peers.
 *
 * This is the ONE core geometric rule set both automatic and manual placement
 * use. It validates the panel's actual rotated footprint — never just its
 * centre point (AGENTS.md §6) — inflated by the setback against the roof ring,
 * inflated by the obstacle clearance against every obstacle, and against every
 * already-placed peer inflated by the configured spacing.
 */
export function validatePanelPlacement(
  x: number,
  y: number,
  rotationDeg: number,
  config: PanelLayoutConfig,
  context: PlacementContext,
): PlacementValidation {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { valid: false, error: "Panel position is not a valid number" };
  }
  if (!Number.isFinite(rotationDeg)) {
    return { valid: false, error: "Panel rotation is not a valid number" };
  }
  const configError = validatePanelConfig(config);
  if (configError) return { valid: false, error: configError };

  const terrace = context.terrace;
  if (terrace.length < 3) return { valid: false, error: "Roof footprint is missing" };

  const dims = effectivePanelDims(config);
  const clearance = context.obstacleClearanceM ?? PANEL_OBSTACLE_CLEARANCE_M;

  // The panel's footprint, inflated by the setback, must lie inside the roof.
  const insetRect = rectangleCorners(
    x, y,
    dims.widthM + 2 * config.setbackM,
    dims.lengthM + 2 * config.setbackM,
    rotationDeg,
  );
  if (!footprintInsidePolygon(insetRect, terrace)) {
    return { valid: false, error: "Panel extends beyond the usable rooftop" };
  }

  // Parapet inner edge: the footprint must keep the required clearance.
  if (context.parapetInsetM > 0) {
    let closest = Number.POSITIVE_INFINITY;
    for (const c of rectangleCorners(x, y, dims.widthM, dims.lengthM, rotationDeg)) {
      for (let i = 0; i < terrace.length; i++) {
        closest = Math.min(closest, pointSegmentDistance(c, terrace[i], terrace[(i + 1) % terrace.length]));
      }
    }
    if (closest < context.parapetInsetM) {
      return {
        valid: false,
        error: `Panel must stay at least ${context.parapetInsetM.toFixed(1)} m inside the rooftop edge`,
      };
    }
  }

  // Obstacle clearance.
  const rect = rectangleCorners(x, y, dims.widthM, dims.lengthM, rotationDeg);
  for (const obstacle of context.obstacles) {
    const ring = rectangleCorners(
      obstacle.position.x,
      obstacle.position.y,
      obstacle.width + 2 * clearance,
      obstacle.length + 2 * clearance,
      obstacle.rotation,
    );
    if (footprintsOverlap(rect, ring)) {
      return { valid: false, error: "Panel overlaps a rooftop obstacle" };
    }
  }

  // Panel-to-panel spacing.
  for (const peer of context.peers) {
    if (Math.abs(peer.x - x) < 1e-9 && Math.abs(peer.y - y) < 1e-9) continue;
    const peerRect = rectangleCorners(peer.x, peer.y, peer.width, peer.length, peer.rotationDeg);
    if (footprintsOverlap(rect, peerRect)) {
      return { valid: false, error: "Panel overlaps another panel" };
    }
  }
  return { valid: true, error: null };
}

/** Shortest distance from a point to a segment (metres). */
function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/* ------------------------------------------------------------------ */
/* Panel-set helpers                                                   */
/* ------------------------------------------------------------------ */

/** Deterministic id generator for a session. */
let setCounter = 0;
export function createPanelSetId(): string {
  setCounter += 1;
  return `panel-set-${setCounter}`;
}
/** Reset the counter (tests only). */
export function resetPanelSetIdsForTests(): void {
  setCounter = 0;
}

/**
 * Auto-place ALL sets into ONE shared collision space.
 *
 * Sets are processed in a deterministic order and each one sees the panels
 * already accepted by the previous sets as occupied, so no two sets can ever
 * overlap. A set that fits keeps its own arrangement; one that is partly
 * blocked keeps the feasible subset and is named in the report.
 */
export function autoPlaceAllSets(
  sets: PanelSet[],
  terrace: Point2[],
  obstacles: Obstacle[],
): { sets: PanelSet[]; report: string | null } {
  const reserved: PlacedPanelPeer[] = [];
  const next: PanelSet[] = [];
  const blocked: string[] = [];

  for (const set of sets) {
    const dims = effectivePanelDims(set.config);
    // The lattice result is independent per set; the shared space is enforced
    // by rejecting any candidate that collides with panels already reserved.
    const result = placePanels({ terrace, obstacles, config: set.config });
    const peers: PlacedPanelPeer[] = [...reserved];
    const kept: PlacedSetPanel[] = [];
    for (const p of result.panels) {
      const rect = rectangleCorners(p.x, p.y, dims.widthM, dims.lengthM, p.rotationDeg);
      const collides = peers.some((peer) =>
        footprintsOverlap(rect, rectangleCorners(peer.x, peer.y, peer.width, peer.length, peer.rotationDeg)),
      );
      if (collides) continue;
      peers.push({ x: p.x, y: p.y, rotationDeg: p.rotationDeg, width: dims.widthM, length: dims.lengthM });
      kept.push({ index: kept.length, x: p.x, y: p.y, rotationDeg: p.rotationDeg });
    }
    if (kept.length === 0) blocked.push(set.name);
    for (const p of kept) {
      reserved.push({ x: p.x, y: p.y, rotationDeg: p.rotationDeg, width: dims.widthM, length: dims.lengthM });
    }
    next.push({ ...set, mode: "auto", userModified: false, panels: kept });
  }

  const report =
    blocked.length > 0
      ? `No room left for ${blocked.join(", ")} once the other sets were placed.`
      : null;
  return { sets: next, report };
}

/** Auto-place one set's panels, replacing whatever it currently holds. */
export function autoPlaceSet(
  set: PanelSet,
  terrace: Point2[],
  obstacles: Obstacle[],
): PanelSet {
  const result = placePanels({ terrace, obstacles, config: set.config });
  return {
    ...set,
    mode: "auto",
    userModified: false,
    panels: result.panels.map((p) => ({ index: 0, x: p.x, y: p.y, rotationDeg: p.rotationDeg })),
  };
}

/** Total rated capacity of a set in kWp. */
export function setCapacityKw(set: PanelSet): number {
  const def = panelTypeDefinition(set.config.panelTypeId);
  return (set.panels.length * def.watts) / 1000;
}

/** Combined capacity across sets. */
export function totalCapacityKw(sets: PanelSet[]): number {
  return sets.reduce((sum, set) => sum + setCapacityKw(set), 0);
}

/** Rotate a whole set about the roof origin. */
export function rotateSet(set: PanelSet, deltaDeg: number): PanelSet {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    ...set,
    userModified: true,
    panels: set.panels.map((p) => {
      const nx = p.x * cos - p.y * sin;
      const ny = p.x * sin + p.y * cos;
      return { ...p, x: nx, y: ny, rotationDeg: p.rotationDeg + deltaDeg };
    }),
  };
}

/** Translate a whole set by a delta (metres). */
export function translateSet(set: PanelSet, dx: number, dy: number): PanelSet {
  return {
    ...set,
    userModified: true,
    panels: set.panels.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

/**
 * Rotate every panel of a set about the set's own centroid, keeping the
 * array's relative layout intact.
 */
export function rotateSetAboutCentroid(
  set: PanelSet,
  deltaDeg: number,
): PanelSet {
  if (set.panels.length === 0) return set;
  const cx = set.panels.reduce((s, p) => s + p.x, 0) / set.panels.length;
  const cy = set.panels.reduce((s, p) => s + p.y, 0) / set.panels.length;
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    ...set,
    userModified: true,
    panels: set.panels.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        ...p,
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
        rotationDeg: p.rotationDeg + deltaDeg,
      };
    }),
  };
}

/** Reindex a set's panels into 0..n-1 after a deletion or insertion. */
export function reindexSet(panels: PlacedSetPanel[]): PlacedSetPanel[] {
  return panels.map((p, i) => ({ ...p, index: i }));
}

/** Build a fresh default set (panels are empty until placed — opt-in). */
export function defaultPanelSet(
  id: string,
  overrides: Partial<Pick<PanelSet, "name">> = {},
): PanelSet {
  return {
    id,
    name: overrides.name ?? "Panel set 1",
    config: {
      panelTypeId: "panel-550w",
      mounting: "flat",
      tiltDeg: 15,
      azimuthDeg: 180,
      spacingM: 0.2,
      rowSpacingM: null,
      colSpacingM: null,
      setbackM: 0.5,
      mountHeightM: 0.4,
      orientation: "portrait",
      customWidthM: null,
      customLengthM: null,
      legRows: 2,
      legCols: 2,
      setRows: 2,
      setCols: 5,
    },
    mode: "manual",
    panels: [],
    userModified: false,
  };
}

/** Which panels in a set are now invalid (roof/obstacle/peer violations). */
export function findInvalidPanels(
  set: PanelSet,
  context: Omit<PlacementContext, "peers">,
): Array<{ panel: PlacedSetPanel; error: string }> {
  const invalid: Array<{ panel: PlacedSetPanel; error: string }> = [];
  const dims = effectivePanelDims(set.config);
  for (const panel of set.panels) {
    // Every OTHER panel of this set, with resolved dimensions.
    const peers: PlacedPanelPeer[] = set.panels
      .filter((p) => p.index !== panel.index)
      .map((p) => ({ x: p.x, y: p.y, rotationDeg: p.rotationDeg, width: dims.widthM, length: dims.lengthM }));
    const result = validatePanelPlacement(panel.x, panel.y, panel.rotationDeg, set.config, {
      ...context,
      peers,
    });
    if (!result.valid) invalid.push({ panel, error: result.error ?? "Invalid panel" });
  }
  return invalid;
}
