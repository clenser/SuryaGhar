/**
 * Solar panel domain model (Phase 5).
 *
 * Panel records and configuration live in React state; Three.js only renders
 * them (AGENTS.md §40, §72). This module is deliberately free of any Three.js
 * import so placement and capacity maths stay testable in isolation.
 *
 * Dimensions are REPRESENTATIVE DEFAULTS for common commercial modules
 * (roughly the sizes quoted in AGENTS.md §38) — they are configurable values,
 * not manufacturer-specific specifications. Rated power is an independent
 * field: a higher-wattage panel is NOT derived from (or assumed to be) a
 * larger panel.
 *
 * Coordinate conventions (AGENTS.md §13/§64): X = East, Y = North, Z = Up,
 * 1 unit = 1 metre. `azimuthDeg` follows the solar convention used across the
 * app: degrees from true North clockwise (0 = N, 90 = E, 180 = S, 270 = W).
 */

export type InstallationType = "rooftop" | "ground";

export type PanelTypeId = "panel-450w" | "panel-550w" | "panel-600w";

/** Ground-mounted structure catalogue types (Phase 3). */
export type GroundMountingType =
  | "ground_fixed"
  | "ground_adjustable"
  | "ground_tracker_single"
  | "ground_elevated"
  | "ground_pole";

/** Mounting arrangements offered in the UI (both rooftop and ground). */
export type MountingType = "flat" | "tilted" | "shed" | GroundMountingType;

/** One selectable panel product. Dimensions in metres. */
export interface PanelTypeDefinition {
  id: PanelTypeId;
  label: string;
  /** Rated power in watts (independent of the physical dimensions). */
  watts: number;
  /** Short side — X extent at rotation 0. */
  widthM: number;
  /** Long side — Y extent at rotation 0. */
  lengthM: number;
  /** Module thickness (frame depth). */
  thicknessM: number;
  /** Maximum power voltage (V) under Standard Test Conditions (STC: 1000 W/m², 25°C). */
  vmpV?: number;
  /** Maximum power current (A) under Standard Test Conditions (STC). */
  impA?: number;
  /** Open-circuit voltage (V) under Standard Test Conditions (STC). */
  vocV?: number;
  /** Short-circuit current (A) under Standard Test Conditions (STC). */
  iscA?: number;
}

/**
 * Representative commercial module sizes. AGENTS.md §38: the library is
 * configurable; these defaults are plausible values, not a catalogue.
 */
export const PANEL_TYPES: PanelTypeDefinition[] = [
  { id: "panel-450w", label: "450 W", watts: 450, widthM: 1.13, lengthM: 1.72, thicknessM: 0.03, vmpV: 41.5, impA: 10.85, vocV: 49.8, iscA: 11.5 },
  { id: "panel-550w", label: "550 W", watts: 550, widthM: 1.13, lengthM: 2.28, thicknessM: 0.035, vmpV: 42.0, impA: 13.1, vocV: 50.0, iscA: 14.0 },
  { id: "panel-600w", label: "600 W", watts: 600, widthM: 1.13, lengthM: 2.38, thicknessM: 0.04, vmpV: 45.5, impA: 13.2, vocV: 54.5, iscA: 14.1 },
];

/** Rooftop mounting-type catalogue. */
export const MOUNTING_TYPES: Array<{ type: MountingType; label: string }> = [
  { type: "flat", label: "Flat Roof" },
  { type: "tilted", label: "Tilted Roof" },
  { type: "shed", label: "Shed" },
];

export interface GroundMountingDefinition {
  type: GroundMountingType;
  label: string;
  description: string;
  disabled: boolean;
  badge?: string;
}

/**
 * Ground-mounted structure catalogue (Phase 3).
 *
 * `ground_fixed` is fully implemented first with an authentic structural load path
 * (piles/foundations -> front/rear posts -> sloped rafters -> purlin rails -> clamps + knee braces).
 * Remaining types are clearly marked "Coming Soon" and disabled until their kinematics
 * and geometries are functional (Phase 3 constraint & user correction).
 */
export const GROUND_MOUNTING_TYPES: GroundMountingDefinition[] = [
  {
    type: "ground_fixed",
    label: "Fixed-Tilt Ground Mount",
    description: "Multi-panel ground table with driven pile foundations, front/rear posts, inclined rafters, purlins and diagonal knee braces.",
    disabled: false,
  },
  {
    type: "ground_adjustable",
    label: "Seasonal Adjustable",
    description: "Telescoping rear strut with locking pin plates and front hinge pivots allowing 10°-45° seasonal tilt optimization.",
    disabled: false,
  },
  {
    type: "ground_tracker_single",
    label: "Single-Axis Tracker",
    description: "Horizontal single-axis tracker (HSAT) with continuous torque tube, bearing pillow blocks, and central slew drive motor.",
    disabled: false,
  },
  {
    type: "ground_elevated",
    label: "Elevated / Agrivoltaic",
    description: "High-clearance canopy (2.5m - 3.5m) portal frame for dual agricultural land-use, farm machinery, or parking clearance.",
    disabled: false,
  },
  {
    type: "ground_pole",
    label: "Pole Mount",
    description: "Heavy central cylindrical steel mast embedded in concrete, with top-of-pole azimuth collar and radiating truss strongback.",
    disabled: false,
  },
];

/** Display label for any mounting type (rooftop or ground). */
export function mountingTypeLabel(type: MountingType): string {
  const groundMatch = GROUND_MOUNTING_TYPES.find((m) => m.type === type);
  if (groundMatch) return groundMatch.label;
  return MOUNTING_TYPES.find((m) => m.type === type)?.label ?? "Flat Roof";
}

/** Look up a panel definition (falls back to 550 W). */
export function panelTypeDefinition(id: PanelTypeId): PanelTypeDefinition {
  return PANEL_TYPES.find((p) => p.id === id) ?? PANEL_TYPES[1];
}

/** Full panel layout configuration — the React state that drives placement. */
export interface PanelLayoutConfig {
  /** Installation domain mode: rooftop (default) or ground-mounted (Phase 1). */
  installationType?: InstallationType;
  panelTypeId: PanelTypeId;
  mounting: MountingType;
  /** Tilt above the roof/ground plane, degrees (0–60). */
  tiltDeg: number;
  /** Facing direction, degrees from North clockwise (0–360). */
  azimuthDeg: number;
  /** Clear gap between adjacent panels, metres. */
  spacingM: number;
  /**
   * Row gap (along the panel length axis) and column gap (along the width
   * axis), metres. Null means "follow spacingM", so existing configurations
   * behave exactly as before until the user separates them.
   */
  rowSpacingM: number | null;
  colSpacingM: number | null;
  /** Required clearance from the roof edge or usable boundary, metres. */
  setbackM: number;
  /**
   * Height of the mounting supports above the roof or ground surface, metres.
   * Controls both rendered support geometry and panel standoff.
   */
  mountHeightM: number;
  /**
   * Physical mounting orientation of the module: `portrait` keeps the module's
   * short side horizontal (upright), `landscape` swaps it. This is geometry,
   * not the array's facing — azimuth and tilt stay independent (AGENTS.md §33).
   */
  orientation: PanelOrientation;
  /**
   * Custom module dimensions (metres). Null means "use the catalog entry for
   * `panelTypeId`". Lets the user place a module that is not in the catalog
   * without inventing a catalogue entry for it.
   */
  customWidthM: number | null;
  customLengthM: number | null;
  /**
   * Panel-set grid: rows × columns of panels placed as one rectangular group.
   * Rows advance along the panel length axis, columns along the width axis
   * (before azimuth rotation). Positive integers; the roof geometry bounds
   * what actually fits.
   */
  setRows: number;
  setCols: number;
  /**
   * Support-leg grid rendered under each panel (flat mounting): legRows legs
   * spread along the row (width) direction, legCols along the column (length)
   * direction, so legRows × legCols legs stand under every panel. The default
   * 2 × 2 is exactly the four corner legs; 2 × 3 adds a mid-span pair on the
   * long edges. Visual mounting-hardware parameter only: positions follow the
   * panel footprint, and no structural-safety claim is made.
   */
  legRows: number;
  legCols: number;
  /**
   * Target installed capacity (kWp). Null means "Auto / Maximum fit".
   * Bounds automatic placement without violating roof geometry, setbacks,
   * or obstacle exclusions.
   */
  targetCapacityKwp?: number | null;
}

/** How the module's short/long sides map to the roof's X/Y axes. */
export type PanelOrientation = "portrait" | "landscape";

/**
 * Effective module footprint in metres, resolving custom dimensions over the
 * catalogue entry and swapping the sides for landscape mounting. Placement and
 * rendering MUST both go through this so the form, the layout and the mesh
 * never disagree about the panel's real size.
 */
export function effectivePanelDims(config: PanelLayoutConfig): { widthM: number; lengthM: number } {
  const base = panelTypeDefinition(config.panelTypeId);
  const rawWidth = config.customWidthM ?? base.widthM;
  const rawLength = config.customLengthM ?? base.lengthM;
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : base.widthM;
  const length = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : base.lengthM;
  // Portrait = short side along X; landscape = long side along X.
  return config.orientation === "landscape"
    ? { widthM: Math.max(width, length), lengthM: Math.min(width, length) }
    : { widthM: Math.min(width, length), lengthM: Math.max(width, length) };
}

/** Accepted ranges (validated before placement). */
export const PANEL_TILT_MIN_DEG = 0;
export const PANEL_TILT_MAX_DEG = 60;
export const PANEL_AZIMUTH_MIN_DEG = 0;
export const PANEL_AZIMUTH_MAX_DEG = 360;
export const PANEL_SPACING_MIN_M = 0;
export const PANEL_SPACING_MAX_M = 3;
export const PANEL_SETBACK_MIN_M = 0;
export const PANEL_SETBACK_MAX_M = 5;
/**
 * Mounting-height range. The floor keeps legs above the roof with a real
 * stand-off (below ~2 cm the supports degenerate and z-fight the roof), and
 * the ceiling keeps the array visually sane for rooftop service access.
 */
export const PANEL_MOUNT_HEIGHT_MIN_M = 0.02;
export const PANEL_MOUNT_HEIGHT_MAX_M = 4.0;
/** Smallest module side the UI accepts, metres (a real module is > 0.3 m). */
export const PANEL_MIN_SIDE_M = 0.3;
/** Largest module side the UI accepts, metres (roof-scale sanity limit). */
export const PANEL_MAX_SIDE_M = 4;
/** Support-leg range per direction (a single centred leg up to a dense row). */
export const PANEL_LEGS_MIN = 1;
export const PANEL_LEGS_MAX = 6;
/** Panel-set grid range per direction (input sanity; the roof bounds reality). */
export const PANEL_SET_ROWS_MIN = 1;
export const PANEL_SET_ROWS_MAX = 50;
export const PANEL_SET_COLS_MIN = 1;
export const PANEL_SET_COLS_MAX = 50;

/** Defaults: south-facing, modest tilt, small gaps (India rooftop typical). */
export const DEFAULT_PANEL_CONFIG: PanelLayoutConfig = {
  installationType: "rooftop",
  panelTypeId: "panel-550w",
  mounting: "flat",
  tiltDeg: 15,
  azimuthDeg: 180,
  spacingM: 0.2,
  rowSpacingM: null,
  colSpacingM: null,
  setbackM: 0.2,
  // Matches the support stand-off the mesh builder uses by default, so the
  // default configuration renders predictably above the roof surface.
  mountHeightM: 0.4,
  orientation: "portrait",
  customWidthM: null,
  customLengthM: null,
  setRows: 2,
  setCols: 5,
  legRows: 2,
  legCols: 2,
  targetCapacityKwp: null,
};

/**
 * Defaults for ground-mounted installation: fixed-tilt ground mount, 0.6m ground clearance,
 * generous setbacks, and 2x8 module tables (Phase 3 & 5).
 */
export const DEFAULT_GROUND_PANEL_CONFIG: PanelLayoutConfig = {
  installationType: "ground",
  panelTypeId: "panel-550w",
  mounting: "ground_fixed",
  tiltDeg: 25,
  azimuthDeg: 180,
  spacingM: 0.05,
  rowSpacingM: 1.5,
  colSpacingM: 0.05,
  setbackM: 1.0,
  mountHeightM: 0.6,
  orientation: "portrait",
  customWidthM: null,
  customLengthM: null,
  setRows: 2,
  setCols: 8,
  legRows: 2,
  legCols: 4,
  targetCapacityKwp: null,
};

/**
 * Initial geometric estimate for row-to-row spacing that mitigates inter-row shading.
 * Accounts for panel slope length, tilt angle, site latitude, design solar elevation,
 * and row azimuth direction (Phase 5 & User Correction 2).
 */
export function calculateSolarRowSpacing(
  panelLengthM: number,
  tiltDeg: number,
  latitudeDeg: number = 22.5,
  solarElevationDeg?: number,
  azimuthOffsetDeg: number = 0,
): number {
  if (!Number.isFinite(panelLengthM) || panelLengthM <= 0) return 0.5;
  if (!Number.isFinite(tiltDeg) || tiltDeg <= 0) return 0.2;

  const tiltRad = (Math.min(tiltDeg, 60) * Math.PI) / 180;
  const deltaH = panelLengthM * Math.sin(tiltRad);

  // Default design elevation: winter solstice solar noon (worst-case sun elevation for row shading)
  const designElevation =
    solarElevationDeg !== undefined && Number.isFinite(solarElevationDeg) && solarElevationDeg > 5
      ? solarElevationDeg
      : Math.max(15, 90 - Math.abs(latitudeDeg) - 23.45);

  const elRad = (designElevation * Math.PI) / 180;
  const tanEl = Math.max(0.1, Math.tan(elRad));
  const rawShadowM = deltaH / tanEl;

  const azFactor = Math.max(0.5, Math.cos((Math.abs(azimuthOffsetDeg) * Math.PI) / 180));
  const recommendedGap = rawShadowM * azFactor;

  // Round to 2 decimal places and clamp to sensible bounds (0.1m - 5m)
  return Math.max(0.1, Math.min(5.0, Math.round(recommendedGap * 100) / 100));
}

/** Row gap actually used: explicit value, else the shared spacing. */
export function effectiveRowSpacingM(config: PanelLayoutConfig): number {
  const v = config.rowSpacingM;
  return v === null || v === undefined || !Number.isFinite(v) ? config.spacingM : v;
}

/** Column gap actually used: explicit value, else the shared spacing. */
export function effectiveColSpacingM(config: PanelLayoutConfig): number {
  const v = config.colSpacingM;
  return v === null || v === undefined || !Number.isFinite(v) ? config.spacingM : v;
}

/** Clamp-free validation: returns a user-facing error or null. */
export function validatePanelConfig(config: PanelLayoutConfig): string | null {
  if (!PANEL_TYPES.some((p) => p.id === config.panelTypeId)) {
    return "Unknown panel type";
  }
  const isValidMounting =
    MOUNTING_TYPES.some((m) => m.type === config.mounting) ||
    GROUND_MOUNTING_TYPES.some((m) => m.type === config.mounting);
  if (!isValidMounting) {
    return "Unknown mounting type";
  }
  if (config.orientation !== "portrait" && config.orientation !== "landscape") {
    return "Unknown panel orientation";
  }
  const checks: Array<[number, string, number, number]> = [
    [config.tiltDeg, "Tilt", PANEL_TILT_MIN_DEG, PANEL_TILT_MAX_DEG],
    [config.azimuthDeg, "Azimuth", PANEL_AZIMUTH_MIN_DEG, PANEL_AZIMUTH_MAX_DEG],
    [config.spacingM, "Spacing", PANEL_SPACING_MIN_M, PANEL_SPACING_MAX_M],
    [config.setbackM, "Setback", PANEL_SETBACK_MIN_M, PANEL_SETBACK_MAX_M],
    [config.mountHeightM, "Mounting height", PANEL_MOUNT_HEIGHT_MIN_M, PANEL_MOUNT_HEIGHT_MAX_M],
  ];
  for (const [value, label, min, max] of checks) {
    if (!Number.isFinite(value)) return `${label} must be a valid number`;
    if (value < min || value > max) return `${label} must be between ${min} and ${max}`;
  }
  // Custom dimensions are optional, but when present must be sane.
  for (const [value, label] of [
    [config.customWidthM, "Panel width"],
    [config.customLengthM, "Panel length"],
  ] as Array<[number | null, string]>) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value)) return `${label} must be a valid number`;
    if (value < PANEL_MIN_SIDE_M || value > PANEL_MAX_SIDE_M) {
      return `${label} must be between ${PANEL_MIN_SIDE_M} and ${PANEL_MAX_SIDE_M} m`;
    }
  }
  // Row/column gaps follow the shared spacing when unset; explicit values use
  // the same range.
  for (const [value, label] of [
    [config.rowSpacingM, "Row spacing"],
    [config.colSpacingM, "Column spacing"],
  ] as Array<[number | null, string]>) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value)) return `${label} must be a valid number`;
    if (value < PANEL_SPACING_MIN_M || value > PANEL_SPACING_MAX_M) {
      return `${label} must be between ${PANEL_SPACING_MIN_M} and ${PANEL_SPACING_MAX_M} m`;
    }
  }
  if (
    !Number.isInteger(config.setRows) ||
    config.setRows < PANEL_SET_ROWS_MIN ||
    config.setRows > PANEL_SET_ROWS_MAX
  ) {
    return `Panel rows must be a whole number between ${PANEL_SET_ROWS_MIN} and ${PANEL_SET_ROWS_MAX}`;
  }
  if (
    !Number.isInteger(config.setCols) ||
    config.setCols < PANEL_SET_COLS_MIN ||
    config.setCols > PANEL_SET_COLS_MAX
  ) {
    return `Panel columns must be a whole number between ${PANEL_SET_COLS_MIN} and ${PANEL_SET_COLS_MAX}`;
  }
  for (const [value, label] of [
    [config.legRows, "Row legs"],
    [config.legCols, "Column legs"],
  ] as Array<[number, string]>) {
    if (!Number.isInteger(value) || value < PANEL_LEGS_MIN || value > PANEL_LEGS_MAX) {
      return `${label} must be a whole number between ${PANEL_LEGS_MIN} and ${PANEL_LEGS_MAX}`;
    }
  }
  return null;
}

/**
 * Installed capacity: `count × watts / 1000` → kWp.
 * Explicitly linear in the count — no efficiency or derating assumptions.
 */
export function totalCapacityKw(panelCount: number, watts: number): number {
  if (!Number.isFinite(panelCount) || panelCount < 0 || !Number.isFinite(watts)) return 0;
  return (panelCount * watts) / 1000;
}

/** "31.4 kWp" — two decimals keep small test layouts readable. */
export function formatCapacity(kw: number): string {
  return `${kw.toFixed(2)} kWp`;
}
