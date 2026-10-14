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
  effectiveColSpacingM,
  effectivePanelDims,
  effectiveRowSpacingM,
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
  /** Shared mounting table identifier when placed as part of a multi-panel set. */
  tableId?: string;
  tableRow?: number;
  tableCol?: number;
  tableRows?: number;
  tableCols?: number;
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
  /**
   * Roof boundary ring in local metres. This is the RAW terrace
   * ring — the OUTER edge of the parapet wall (createParapetMeshes
   * builds the wall on this ring and insets the inner face by the
   * wall thickness). Both the setback containment rule and the
   * parapet clearance rule measure from this same ring, so the two
   * rules can never contradict or double-count each other.
   */
  terrace: Point2[];
  /** Obstacles on the roof. */
  obstacles: Obstacle[];
  /**
   * Required inset from the roof boundary, metres: parapet wall
   * thickness + the configured panel-to-parapet clearance. Every
   * panel corner must keep at least this distance from the terrace
   * ring, which is exactly "clearance clear of the parapet inner
   * face". 0 disables the rule.
   */
  parapetInsetM: number;
  /**
   * The user-configured clear gap from the parapet inner face, in
   * metres. Carried separately so a rejection can name the value
   * the user actually configured (the inset above also contains the
   * wall thickness). Optional: callers that have no separate
   * setting fall back to `parapetInsetM` in the message.
   */
  parapetClearanceM?: number;
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
  /** Optional table id if this peer belongs to a shared mounting table/set. */
  tableId?: string;
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
  tableId?: string,
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
    return {
      valid: false,
      error: `Panel must stay at least ${config.setbackM.toFixed(1)} m inside the rooftop edge`,
    };
  }

  // Parapet inner edge: the footprint must keep the required clearance.
  // `parapetInsetM` is measured from the RAW roof boundary, so this
  // enforces "parapetClearanceM clear of the parapet inner face"
  // (the inner face sits wall-thickness inside the boundary).
  if (context.parapetInsetM > 0) {
    let closest = Number.POSITIVE_INFINITY;
    for (const c of rectangleCorners(x, y, dims.widthM, dims.lengthM, rotationDeg)) {
      for (let i = 0; i < terrace.length; i++) {
        closest = Math.min(closest, pointSegmentDistance(c, terrace[i], terrace[(i + 1) % terrace.length]));
      }
    }
    if (closest < context.parapetInsetM) {
      // Name the constraint that actually fired, with the value the
      // user configured (not the wall-adjusted inset).
      const gap = context.parapetClearanceM ?? context.parapetInsetM;
      const label =
        context.parapetClearanceM !== undefined
          ? "clear of the parapet inner face"
          : "clear of the parapet edge";
      return {
        valid: false,
        error: `Panel must stay at least ${gap.toFixed(1)} m ${label}`,
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
    // Skip self
    if (Math.abs(peer.x - x) < 1e-9 && Math.abs(peer.y - y) < 1e-9) continue;
    // Panels within the same structured multi-panel mounting table / block share structured spacing
    // and must not reject each other as collisions.
    if (tableId && peer.tableId && tableId === peer.tableId) continue;

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
      kept.push({ ...p, index: kept.length });
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
    panels: result.panels.map((p) => ({ ...p, index: 0 })),
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

/**
 * Rigidly update panel positions and rotation when azimuth changes.
 *
 * For structured multi-panel tables (e.g. 2x5 tables), rotating each panel
 * in-place independently distorts the table frame and causes peer overlaps.
 * Instead, this helper identifies each table's center and rotates the table
 * rigidly around its center to the target panel rotation.
 * For standalone / single panels, the panel rotates around its own center.
 */
export function rotatePanelsForAzimuth(
  panels: PlacedSetPanel[],
  config: PanelLayoutConfig,
  targetRotationDeg: number,
): PlacedSetPanel[] {
  if (panels.length === 0) return [];
  const dims = effectivePanelDims(config);
  const stepU = dims.widthM + effectiveColSpacingM(config);
  const stepV = dims.lengthM + effectiveRowSpacingM(config);

  const radNew = (targetRotationDeg * Math.PI) / 180;
  const cosNew = Math.cos(radNew);
  const sinNew = Math.sin(radNew);
  const uxNew = cosNew;
  const uyNew = sinNew;
  const vxNew = -sinNew;
  const vyNew = cosNew;

  // Group by tableId
  const byTable = new Map<string, PlacedSetPanel[]>();
  const standalone: PlacedSetPanel[] = [];

  for (const p of panels) {
    const tRows = p.tableRows ?? config.setRows;
    const tCols = p.tableCols ?? config.setCols;
    if (p.tableId && (tRows > 1 || tCols > 1)) {
      const list = byTable.get(p.tableId);
      if (list) list.push(p);
      else byTable.set(p.tableId, [p]);
    } else {
      standalone.push(p);
    }
  }

  const result: PlacedSetPanel[] = [];

  // 1. Process multi-panel tables
  for (const [, members] of byTable.entries()) {
    const first = members[0];
    const oldRotRad = (first.rotationDeg * Math.PI) / 180;
    const oldCos = Math.cos(oldRotRad);
    const oldSin = Math.sin(oldRotRad);

    // Compute table center
    let sumCx = 0;
    let sumCy = 0;
    for (const m of members) {
      if (
        m.tableRow !== undefined &&
        m.tableCol !== undefined &&
        m.tableRows !== undefined &&
        m.tableCols !== undefined
      ) {
        const du = (m.tableCol - (m.tableCols - 1) / 2) * stepU;
        const dv = (m.tableRow - (m.tableRows - 1) / 2) * stepV;
        sumCx += m.x - (du * oldCos - dv * oldSin);
        sumCy += m.y - (du * oldSin + dv * oldCos);
      } else {
        sumCx += m.x;
        sumCy += m.y;
      }
    }
    const centerX = sumCx / members.length;
    const centerY = sumCy / members.length;

    // Rigidly place each panel around table center at target rotation
    for (const m of members) {
      if (
        m.tableRow !== undefined &&
        m.tableCol !== undefined &&
        m.tableRows !== undefined &&
        m.tableCols !== undefined
      ) {
        const du = (m.tableCol - (m.tableCols - 1) / 2) * stepU;
        const dv = (m.tableRow - (m.tableRows - 1) / 2) * stepV;
        result.push({
          ...m,
          x: centerX + du * uxNew + dv * vxNew,
          y: centerY + du * uyNew + dv * vyNew,
          rotationDeg: targetRotationDeg,
        });
      } else {
        result.push({
          ...m,
          rotationDeg: targetRotationDeg,
        });
      }
    }
  }

  // 2. Standalone panels rotate in-place around own center
  for (const s of standalone) {
    result.push({
      ...s,
      rotationDeg: targetRotationDeg,
    });
  }

  // Re-sort to preserve original indexing
  result.sort((a, b) => a.index - b.index);
  return result;
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
      setbackM: 0.2,
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
    // Every OTHER panel of this set, with resolved dimensions and tableId.
    const peers: PlacedPanelPeer[] = set.panels
      .filter((p) => p.index !== panel.index)
      .map((p) => ({
        x: p.x,
        y: p.y,
        rotationDeg: p.rotationDeg,
        width: dims.widthM,
        length: dims.lengthM,
        tableId: p.tableId,
      }));
    const result = validatePanelPlacement(
      panel.x,
      panel.y,
      panel.rotationDeg,
      set.config,
      {
        ...context,
        peers,
      },
      panel.tableId,
    );
    if (!result.valid) invalid.push({ panel, error: result.error ?? "Invalid panel" });
  }
  return invalid;
}


/* ------------------------------------------------------------------ */
/* Manual set placement: rectangular rows x cols groups.               */
/* ------------------------------------------------------------------ */

/**
 * Panel centres for one rows x cols block centred on (centreX, centreY).
 *
 * Axis mapping (documented, not guessed): the block lives in the panel
 * frame shared with `rectangleCorners` and the auto lattice. Columns step
 * along the panel WIDTH axis by width + column spacing; rows step along the
 * panel LENGTH axis by length + row spacing. `rotationDeg` is the shared
 * CCW panel rotation (from the set azimuth plus any manual group rotation).
 * Panel (r, c) sits at centre + c pitches along width + r pitches along
 * length, so a 2 x 5 set is 2 deep and 5 across with uniform gaps.
 */
export function setBlockPanels(
  config: PanelLayoutConfig,
  centreX: number,
  centreY: number,
  rotationDeg: number,
): Array<Omit<PlacedSetPanel, "index">> {
  const dims = effectivePanelDims(config);
  const rowSpacing = effectiveRowSpacingM(config);
  const colSpacing = effectiveColSpacingM(config);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Unit axes of the panel frame in world metres (same frame as the auto
  // lattice: u = width axis, v = length axis).
  const ux = cos;
  const uy = sin;
  const vx = -sin;
  const vy = cos;
  const stepU = dims.widthM + colSpacing;
  const stepV = dims.lengthM + rowSpacing;
  const isMultiPanelTable = config.setRows > 1 || config.setCols > 1;
  const tableId = isMultiPanelTable
    ? `set-${centreX.toFixed(3)}-${centreY.toFixed(3)}-${rotationDeg.toFixed(1)}-${config.setRows}x${config.setCols}`
    : undefined;
  const panels: Array<Omit<PlacedSetPanel, "index">> = [];
  for (let r = 0; r < config.setRows; r++) {
    for (let c = 0; c < config.setCols; c++) {
      const du = (c - (config.setCols - 1) / 2) * stepU;
      const dv = (r - (config.setRows - 1) / 2) * stepV;
      panels.push({
        x: centreX + du * ux + dv * vx,
        y: centreY + du * uy + dv * vy,
        rotationDeg,
        ...(isMultiPanelTable
          ? {
              tableId,
              tableRow: r,
              tableCol: c,
              tableRows: config.setRows,
              tableCols: config.setCols,
            }
          : {}),
      });
    }
  }
  return panels;
}

/**
 * Validate a whole set block atomically: every panel must satisfy the same
 * rules the single-panel validator enforces (roof, parapet, obstacles,
 * peers). Siblings inside the candidate block join the peer set, so
 * intra-block spacing is enforced exactly like cross-set spacing.
 *
 * Returns the panels to commit on success (positions already computed, so
 * the commit path cannot drift from what was validated). On any failure the
 * whole block is rejected with the first precise reason - never partially
 * committed.
 */
export function validateSetPlacement(
  centreX: number,
  centreY: number,
  rotationDeg: number,
  config: PanelLayoutConfig,
  context: PlacementContext,
): { valid: true; panels: Array<Omit<PlacedSetPanel, "index">> } | { valid: false; error: string } {
  if (!Number.isFinite(centreX) || !Number.isFinite(centreY)) {
    return { valid: false, error: "Set position is not a valid number" };
  }
  if (!Number.isFinite(rotationDeg)) {
    return { valid: false, error: "Set rotation is not a valid number" };
  }
  const configError = validatePanelConfig(config);
  if (configError) return { valid: false, error: configError };
  if (context.terrace.length < 3) return { valid: false, error: "Roof footprint is missing" };
  const block = setBlockPanels(config, centreX, centreY, rotationDeg);
  const dims = effectivePanelDims(config);
  for (let i = 0; i < block.length; i++) {
    const peers: PlacedPanelPeer[] = [
      ...context.peers,
      ...block
        .filter((_, j) => j !== i)
        .map((p) => ({ x: p.x, y: p.y, rotationDeg: p.rotationDeg, width: dims.widthM, length: dims.lengthM })),
    ];
    const result = validatePanelPlacement(block[i].x, block[i].y, rotationDeg, config, {
      ...context,
      peers,
    });
    if (!result.valid) {
      return { valid: false, error: result.error ?? "Set does not fit here" };
    }
  }
  return { valid: true, panels: block };
}

/**
 * Approximate upper bounds for set rows/columns on a rectangular usable
 * area of usableW x usableH metres (same frame as the block: width/columns
 * along X, length/rows along Y, before azimuth rotation). n panels need
 * n * size + (n - 1) * gap metres, so n <= floor((extent + gap) / pitch).
 *
 * Approximate on purpose: it guides the steppers, while the polygon-level
 * validator has the final word on irregular roofs.
 */
export function maxSetGrid(
  config: PanelLayoutConfig,
  usableW: number,
  usableH: number,
): { maxRows: number; maxCols: number } {
  const dims = effectivePanelDims(config);
  const rowSpacing = effectiveRowSpacingM(config);
  const colSpacing = effectiveColSpacingM(config);
  // The setback keeps every panel off the roof edge, so the lattice cannot
  // use the outer strip of the usable area on either side.
  const setback = Number.isFinite(config.setbackM) ? Math.max(0, config.setbackM) : 0;
  const fit = (extent: number, size: number, gap: number): number => {
    if (!(extent > 0) || !(size > 0)) return 0;
    return Math.max(0, Math.floor((extent + gap) / (size + gap)));
  };
  return {
    maxRows: fit(usableH - 2 * setback, dims.lengthM, rowSpacing),
    maxCols: fit(usableW - 2 * setback, dims.widthM, colSpacing),
  };
}

/**
 * Realign placed panel coordinates when panel dimensions or spacings change.
 *
 * For multi-panel tables (shared mounting structures), keeps the table's
 * physical anchor/center stationary in the world and recalculates each panel's
 * offset using the new panel dimensions (width/length/orientation) and new
 * column/row spacings. This guarantees that panel unit meshes and shared
 * mounting frames (purlins, rafters, torque tubes, legs) stay mathematically
 * aligned without floating, detaching, or protruding through modules.
 */
export function realignPanelsForConfig(
  panels: PlacedSetPanel[],
  oldConfig: PanelLayoutConfig,
  newConfig: PanelLayoutConfig,
): PlacedSetPanel[] {
  if (panels.length === 0) return panels;

  const oldDims = effectivePanelDims(oldConfig);
  const oldStepU = oldDims.widthM + effectiveColSpacingM(oldConfig);
  const oldStepV = oldDims.lengthM + effectiveRowSpacingM(oldConfig);

  const newDims = effectivePanelDims(newConfig);
  const newStepU = newDims.widthM + effectiveColSpacingM(newConfig);
  const newStepV = newDims.lengthM + effectiveRowSpacingM(newConfig);

  if (
    Math.abs(oldStepU - newStepU) < 1e-4 &&
    Math.abs(oldStepV - newStepV) < 1e-4 &&
    Math.abs(oldDims.widthM - newDims.widthM) < 1e-4 &&
    Math.abs(oldDims.lengthM - newDims.lengthM) < 1e-4
  ) {
    return panels;
  }

  const hasTableIds = panels.some((p) => Boolean(p.tableId));

  if (!hasTableIds && (oldConfig.setRows > 1 || oldConfig.setCols > 1)) {
    const blockSize = oldConfig.setRows * oldConfig.setCols;
    if (panels.length === blockSize) {
      const rotDeg = panels[0].rotationDeg;
      const rad = (rotDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ux = cos;
      const uy = sin;
      const vx = -sin;
      const vy = cos;

      let sumX = 0;
      let sumY = 0;
      for (const p of panels) {
        sumX += p.x;
        sumY += p.y;
      }
      const centreX = sumX / panels.length;
      const centreY = sumY / panels.length;

      return panels.map((p, i) => {
        const r = Math.floor(i / oldConfig.setCols);
        const c = i % oldConfig.setCols;
        const newDu = (c - (oldConfig.setCols - 1) / 2) * newStepU;
        const newDv = (r - (oldConfig.setRows - 1) / 2) * newStepV;
        return {
          ...p,
          x: centreX + newDu * ux + newDv * vx,
          y: centreY + newDu * uy + newDv * vy,
          tableRow: r,
          tableCol: c,
          tableRows: oldConfig.setRows,
          tableCols: oldConfig.setCols,
        };
      });
    }
  }

  const byTable = new Map<string, PlacedSetPanel[]>();
  const standalone: PlacedSetPanel[] = [];

  for (const p of panels) {
    const tRows = p.tableRows ?? oldConfig.setRows;
    const tCols = p.tableCols ?? oldConfig.setCols;
    if (p.tableId && (tRows > 1 || tCols > 1)) {
      const list = byTable.get(p.tableId);
      if (list) list.push(p);
      else byTable.set(p.tableId, [p]);
    } else {
      standalone.push(p);
    }
  }

  const realignedMap = new Map<number, PlacedSetPanel>();
  for (const p of standalone) {
    realignedMap.set(p.index, { ...p });
  }

  for (const [, members] of byTable.entries()) {
    if (members.length === 0) continue;
    const first = members[0];
    const rotDeg = first.rotationDeg;
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ux = cos;
    const uy = sin;
    const vx = -sin;
    const vy = cos;

    let sumCx = 0;
    let sumCy = 0;
    let count = 0;

    for (const m of members) {
      if (
        m.tableRow !== undefined &&
        m.tableCol !== undefined &&
        m.tableRows !== undefined &&
        m.tableCols !== undefined
      ) {
        const du = (m.tableCol - (m.tableCols - 1) / 2) * oldStepU;
        const dv = (m.tableRow - (m.tableRows - 1) / 2) * oldStepV;
        sumCx += m.x - (du * ux + dv * vx);
        sumCy += m.y - (du * uy + dv * vy);
        count++;
      }
    }

    const tableCx = count > 0 ? sumCx / count : first.x;
    const tableCy = count > 0 ? sumCy / count : first.y;

    for (const m of members) {
      if (
        m.tableRow !== undefined &&
        m.tableCol !== undefined &&
        m.tableRows !== undefined &&
        m.tableCols !== undefined
      ) {
        const newDu = (m.tableCol - (m.tableCols - 1) / 2) * newStepU;
        const newDv = (m.tableRow - (m.tableRows - 1) / 2) * newStepV;
        realignedMap.set(m.index, {
          ...m,
          x: tableCx + newDu * ux + newDv * vx,
          y: tableCy + newDu * uy + newDv * vy,
        });
      } else {
        realignedMap.set(m.index, { ...m });
      }
    }
  }

  return panels.map((p) => realignedMap.get(p.index) ?? p);
}

