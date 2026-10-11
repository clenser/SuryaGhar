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

export type PanelTypeId = "panel-450w" | "panel-550w" | "panel-600w";

/** Mounting arrangements offered in the UI. */
export type MountingType = "flat" | "tilted" | "shed";

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
}

/**
 * Representative commercial module sizes. AGENTS.md §38: the library is
 * configurable; these defaults are plausible values, not a catalogue.
 */
export const PANEL_TYPES: PanelTypeDefinition[] = [
  { id: "panel-450w", label: "450 W", watts: 450, widthM: 1.13, lengthM: 1.72, thicknessM: 0.03 },
  { id: "panel-550w", label: "550 W", watts: 550, widthM: 1.13, lengthM: 2.28, thicknessM: 0.035 },
  { id: "panel-600w", label: "600 W", watts: 600, widthM: 1.13, lengthM: 2.38, thicknessM: 0.04 },
];

/** Mounting-type catalogue for the selector. */
export const MOUNTING_TYPES: Array<{ type: MountingType; label: string }> = [
  { type: "flat", label: "Flat Roof" },
  { type: "tilted", label: "Tilted Roof" },
  { type: "shed", label: "Shed" },
];

/** Display label for a mounting type. */
export function mountingTypeLabel(type: MountingType): string {
  return MOUNTING_TYPES.find((m) => m.type === type)?.label ?? "Flat Roof";
}

/** Look up a panel definition (falls back to 550 W). */
export function panelTypeDefinition(id: PanelTypeId): PanelTypeDefinition {
  return PANEL_TYPES.find((p) => p.id === id) ?? PANEL_TYPES[1];
}

/** Full panel layout configuration — the React state that drives placement. */
export interface PanelLayoutConfig {
  panelTypeId: PanelTypeId;
  mounting: MountingType;
  /** Tilt above the roof plane, degrees (0–60). */
  tiltDeg: number;
  /** Facing direction, degrees from North clockwise (0–360). */
  azimuthDeg: number;
  /** Clear gap between adjacent panels, metres. */
  spacingM: number;
  /** Required clearance from the roof edge, metres. */
  setbackM: number;
  /**
   * Height of the mounting supports above the roof surface, metres. Controls
   * both the rendered support geometry and the panel's stand-off — a larger
   * value lifts the array and lengthens every leg.
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
export const PANEL_MOUNT_HEIGHT_MAX_M = 2;
/** Smallest module side the UI accepts, metres (a real module is > 0.3 m). */
export const PANEL_MIN_SIDE_M = 0.3;
/** Largest module side the UI accepts, metres (roof-scale sanity limit). */
export const PANEL_MAX_SIDE_M = 4;

/** Defaults: south-facing, modest tilt, small gaps (India rooftop typical). */
export const DEFAULT_PANEL_CONFIG: PanelLayoutConfig = {
  panelTypeId: "panel-550w",
  mounting: "flat",
  tiltDeg: 15,
  azimuthDeg: 180,
  spacingM: 0.2,
  setbackM: 0.5,
  // Matches the support stand-off the mesh builder uses by default, so the
  // default configuration renders predictably above the roof surface.
  mountHeightM: 0.4,
  orientation: "portrait",
  customWidthM: null,
  customLengthM: null,
};

/** Clamp-free validation: returns a user-facing error or null. */
export function validatePanelConfig(config: PanelLayoutConfig): string | null {
  if (!PANEL_TYPES.some((p) => p.id === config.panelTypeId)) {
    return "Unknown panel type";
  }
  if (!MOUNTING_TYPES.some((m) => m.type === config.mounting)) {
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
