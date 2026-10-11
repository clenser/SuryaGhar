/**
 * Hourly solar-energy estimation with dynamic obstacle shading.
 *
 * This is a FRONTEND, deterministic model deliberately separate from the
 * backend's annual pvlib/PVGIS pipeline (AGENTS.md §55: the existing solar
 * engine stays authoritative for annual output). This module answers the
 * question the visual workspace needs: "for THIS day, at each hour, how much
 * does each panel produce once real shadows are projected onto it?"
 *
 * Real weather data is fetched from PVGIS by the backend and passed in; when
 * none is available the caller supplies its own weather rows. Nothing here
 * fabricates irradiance — a missing hour is simply zeroed and reported.
 *
 * Coordinate conventions (AGENTS.md §13, §64): X = east, Y = north, Z = up,
 * 1 unit = 1 metre. Azimuth is degrees clockwise from true North; elevation
 * is degrees above the horizon.
 */

import type { Point2 } from "./obstacles";
import { rectangleCorners } from "./panelPlacement";
import { effectivePanelDims, panelTypeDefinition, type PanelLayoutConfig } from "./panels";
import type { Obstacle } from "./obstacles";
import { offsetPolygonInward } from "./geometry";

/** One hour of real meteorological + solar-position data for the site. */
export interface HourlyWeather {
  /** Local wall-clock hour of the day (0–23). */
  hour: number;
  /** Direct normal irradiance, W/m2. Missing/0 when unavailable. */
  dni: number;
  /** Diffuse horizontal irradiance, W/m2. */
  dhi: number;
  /** Global horizontal irradiance, W/m2 (DNI + DHI, or measured). */
  ghi: number;
  /** Solar azimuth, degrees clockwise from North (NaN when below horizon). */
  solarAzimuthDeg: number;
  /** Solar elevation, degrees above the horizon (negative = night). */
  solarElevationDeg: number;
  /** Ambient temperature, °C (used for the temperature derate only). */
  temperatureDeg: number;
  /**
   * True when this row is real measured/modelled weather. False marks a row
   * synthesised by the caller as a documented fallback.
   */
  measured: boolean;
}

/** A rooftop panel to simulate: position, rotation and its configuration. */
export interface SimulatedPanel {
  x: number;
  y: number;
  rotationDeg: number;
  config: PanelLayoutConfig;
}

export interface PanelHourResult {
  hour: number;
  /** Plane-of-array irradiance BEFORE shading, W/m2. */
  poaUnshaded: number;
  /** Fraction of direct-beam area shaded by obstacles + parapet (0–1). */
  shadeFraction: number;
  /** Effective POA after applying the shade fraction to the beam, W/m2. */
  poaShaded: number;
  /** Unshaded AC power, W. */
  powerShadedW: number;
  /** Shaded AC power, W. */
  powerShadedW2: number;
  /** Shading loss in W. */
  shadeLossW: number;
  solarElevationDeg: number;
  solarAzimuthDeg: number;
  night: boolean;
}

export interface PanelDayResult {
  panels: PanelHourResult[];
  /** Total unshaded energy for the day, kWh. */
  energyUnshadedKwh: number;
  /** Total shaded energy for the day, kWh. */
  energyShadedKwh: number;
  /** Shading loss as a percentage of unshaded energy (0–100). */
  shadeLossPercent: number;
  /** Hours with at least some irradiance (used for reporting). */
  daylightHours: number;
  /** True when every hour was real measured data. */
  fullyMeasured: boolean;
}

/* ------------------------------------------------------------------ */
/* Geometry: sun direction and shadow projection                        */
/* ------------------------------------------------------------------ */

/**
 * Unit vector pointing TOWARDS the sun for an azimuth/elevation pair, in the
 * Z-up local frame (x = east, y = north, z = up). Matches
 * `sunDirectionVector` in lighting.ts — one convention across the app.
 */
export function sunVector(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(el);
  return {
    x: horizontal * Math.sin(az),
    y: horizontal * Math.cos(az),
    z: Math.sin(el),
  };
}

/** Horizontal length of a shadow cast by an object of height h at elevation el. */
export function shadowLength(heightM: number, elevationDeg: number): number {
  const el = (elevationDeg * Math.PI) / 180;
  const tan = Math.tan(el);
  // At/below the horizon there is no defined beam shadow; report a long
  // (unreachable) length rather than a misleading zero.
  if (tan <= 1e-6) return Number.POSITIVE_INFINITY;
  return heightM / tan;
}

/**
 * Project a horizontal footprint along the sun's azimuth by a shadow length,
 * returning the swept polygon. Panels inside this swept shadow volume are
 * shaded for that time step.
 */
export function shadowedRegion(
  footprint: Point2[],
  azimuthDeg: number,
  elevationDeg: number,
  objectHeightM: number,
): Point2[] {
  const length = shadowLength(objectHeightM, elevationDeg);
  if (!Number.isFinite(length) || length <= 0) return [];
  const az = (azimuthDeg * Math.PI) / 180;
  // Away from the sun: the shadow lies opposite the azimuth direction.
  const dx = -Math.sin(az) * length;
  const dy = -Math.cos(az) * length;
  // Convex-ish hull of footprint + footprint + delta. For the convex
  // footprints produced by obstacleFootprint this is exact.
  const points = [...footprint.map((p) => ({ ...p })), ...footprint.map((p) => ({ x: p.x + dx, y: p.y + dy }))];
  return convexHull(points);
}

/** Monotone-chain convex hull of small point sets (≥ 3 points). */
export function convexHull(points: Point2[]): Point2[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const pts = points.map((p) => ({ ...p })).sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (input: Point2[]): Point2[] => {
    const stack: Point2[] = [];
    for (const p of input) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
        stack.pop();
      }
      stack.push(p);
    }
    return stack;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Fraction of a rectangle's area that lies inside a (convex) polygon. */
export function overlapFraction(
  rect: Point2[],
  polygon: Point2[],
): number {
  const rectArea = Math.abs(ringArea2(rect)) / 2;
  if (rectArea <= 1e-12) return 0;
  // Clip the polygon to the rectangle with Sutherland–Hodgman and measure.
  let clipped = polygon.map((p) => ({ ...p }));
  for (let i = 0; i < rect.length && clipped.length > 0; i++) {
    clipped = clipToHalfPlane(clipped, rect[i], rect[(i + 1) % rect.length]);
  }
  if (clipped.length < 3) return 0;
  const clippedArea = Math.abs(ringArea2(clipped)) / 2;
  return Math.min(1, Math.max(0, clippedArea / rectArea));
}

/** Twice the signed area of a ring. */
function ringArea2(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Keep only the part of `subject` on the inside of edge a→b. */
function clipToHalfPlane(subject: Point2[], a: Point2, b: Point2): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < subject.length; i++) {
    const current = subject[i];
    const next = subject[(i + 1) % subject.length];
    const dc = sideOf(current, a, b);
    const dn = sideOf(next, a, b);
    if (dc <= 0) out.push(current);
    if ((dc < 0 && dn > 0) || (dc > 0 && dn < 0)) {
      out.push(intersection(current, next, a, b));
    }
  }
  return out;
}

function sideOf(p: Point2, a: Point2, b: Point2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function intersection(p: Point2, q: Point2, a: Point2, b: Point2): Point2 {
  const a1 = b.y - a.y;
  const b1 = a.x - b.x;
  const c1 = a1 * a.x + b1 * a.y;
  const a2 = q.y - p.y;
  const b2 = p.x - q.x;
  const c2 = a2 * p.x + b2 * p.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) return { x: q.x, y: q.y };
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

/* ------------------------------------------------------------------ */
/* Irradiance                                                           */
/* ------------------------------------------------------------------ */

/** Degrees → radians. */
const DEG = Math.PI / 180;

/**
 * Cosine of the incidence angle between a tilted plane and the sun. Uses the
 * standard solar-geometry form; returns ≤ 0 when the panel faces away.
 */
export function incidenceCosine(
  tiltDeg: number,
  azimuthSurfaceDeg: number,
  solarAzimuthDeg: number,
  solarZenithDeg: number,
): number {
  const t = tiltDeg * DEG;
  const surfaceAz = azimuthSurfaceDeg * DEG;
  const sunAz = solarAzimuthDeg * DEG;
  const zenith = solarZenithDeg * DEG;
  const cosIncidence =
    Math.sin(zenith) * Math.cos(t) * Math.cos(surfaceAz - sunAz) +
    Math.cos(zenith) * Math.sin(t);
  return Math.min(1, Math.max(0, cosIncidence));
}

/**
 * Plane-of-array irradiance for a tilted plane.
 *
 * Uses the isotropic sky model — the same model the backend's pvlib call uses
 * (`model="isotropic"`), so the two agree by construction:
 *   POA = direct * max(cos(incidence), 0)
 *       + diffuse * (1 + cos(tilt)) / 2
 *       + ground-reflected from GHI * albedo * (1 - cos(tilt)) / 2
 * Albedo is a fixed engineering default (0.2) and is labelled as such.
 */
export function planeOfArrayIrradiance(
  dni: number,
  dhi: number,
  ghi: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
  groundAlbedo = 0.2,
): number {
  if (solarElevationDeg <= 0) return 0;
  const zenith = 90 - solarElevationDeg;
  const cosI = incidenceCosine(tiltDeg, surfaceAzimuthDeg, solarAzimuthDeg, zenith);
  const beam = Math.max(0, cosI) * Math.max(0, dni);
  const viewFactor = (1 + Math.cos(tiltDeg * DEG)) / 2;
  const diffuse = Math.max(0, dhi) * viewFactor;
  const albedoFactor = (1 - Math.cos(tiltDeg * DEG)) / 2;
  const ground = Math.max(0, ghi) * groundAlbedo * albedoFactor;
  return beam + diffuse + ground;
}

/* ------------------------------------------------------------------ */
/* Panel-level shading                                                  */
/* ------------------------------------------------------------------ */

/** Panel geometry on the roof plane (local metres), rotation-aware. */
function panelRect(panel: SimulatedPanel): Point2[] {
  const dims = effectivePanelDims(panel.config);
  return rectangleCorners(panel.x, panel.y, dims.widthM, dims.lengthM, panel.rotationDeg);
}

/** Rotation (CCW about Z) that points the array at an azimuth. */
export function panelRotationForAzimuth(azimuthDeg: number): number {
  return (((-azimuthDeg) % 360) + 360) % 360;
}

/**
 * Fraction of a panel's area shaded by every obstacle and the parapet at the
 * given sun position. Obstacle shadows are swept along the sun ray; the panel
 * rectangle is clipped against each shadow polygon and the total covered
 * fraction is accumulated (clamped at 1 so overlapping shadows don't
 * double-count into an impossible >100% loss).
 */
export function panelShadeFraction(
  panel: SimulatedPanel,
  obstacles: Obstacle[],
  parapetInsetM: number,
  solarAzimuthDeg: number,
  solarElevationDeg: number,
  terraceRing: Point2[],
): number {
  if (solarElevationDeg <= 0) return 0;
  const rect = panelRect(panel);
  if (rect.length < 3) return 0;

  const shadows: Point2[][] = [];
  for (const obstacle of obstacles) {
    const footprint = obstacleFootprint(obstacle);
    const region = shadowedRegion(footprint, solarAzimuthDeg, solarElevationDeg, obstacle.height);
    if (region.length >= 3) shadows.push(region);
  }

  // Parapet: a ring wall inscribed by parapetInsetM around the terrace edge
  // casts a shadow onto the roof. Modelled as the terrain's own boundary
  // offsetting inward — computed from the terrace ring so it uses the real
  // footprint rather than a rectangle.
  if (parapetInsetM > 0) {
    const inset = offsetRingInward(terraceRing, parapetInsetM);
    if (inset) shadows.push(inset);
  }

  if (shadows.length === 0) return 0;
  // Accumulate the covered area by clipping the panel against each shadow and
  // taking the union area via a raster of candidate polygons.
  let covered = 0;
  let remaining: Point2[][] = [rect];
  for (const shadow of shadows) {
    const next: Point2[][] = [];
    for (const region of remaining) {
      const inside = clipPolygon(region, shadow);
      if (inside.length >= 3) covered += Math.abs(ringArea2(inside)) / 2;
      const outside = clipPolygon(region, invert(shadow));
      if (outside.length >= 3) next.push(outside);
    }
    if (next.length === 0) break;
    remaining = next;
  }
  const rectArea = Math.abs(ringArea2(rect)) / 2;
  return rectArea > 1e-12 ? Math.min(1, covered / rectArea) : 0;
}

/** Absolute footprint of an obstacle (rotated, local metres). */
function obstacleFootprint(obstacle: Obstacle): Point2[] {
  if (obstacle.polygon && obstacle.polygon.length >= 3) {
    const hw = Math.cos((obstacle.rotation * Math.PI) / 180);
    const sh = Math.sin((obstacle.rotation * Math.PI) / 180);
    return obstacle.polygon.map((p) => ({
      x: obstacle.position.x + p.x * hw - p.y * sh,
      y: obstacle.position.y + p.x * sh + p.y * hw,
    }));
  }
  return rectangleCorners(obstacle.position.x, obstacle.position.y, obstacle.width, obstacle.length, obstacle.rotation);
}

/** Offset a ring inward by `distance` metres (delegates to the shared utility). */
function offsetRingInward(ring: Point2[], distance: number): Point2[] | null {
  return offsetPolygonInward(ring, distance);
}

/** Reverse a polygon's winding so clipping keeps only the OUTSIDE. */
function invert(polygon: Point2[]): Point2[] {
  return [...polygon].reverse();
}

/** Clip `subject` by the inside of `clip` (convex). */
function clipPolygon(subject: Point2[], clip: Point2[]): Point2[] {
  let output = subject.map((p) => ({ ...p }));
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    output = clipToHalfPlane(output, clip[i], clip[(i + 1) % clip.length]);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Day simulation                                                       */
/* ------------------------------------------------------------------ */

/** Electrical model defaults — labelled assumptions, not manufacturer data. */
const TEMP_COEFF = -0.004;     // power loss per °C above STC (typical c-Si)
const STC_TEMPERATURE_C = 25;  // standard test conditions
const INVERTER_EFFICIENCY = 0.96;
/** Assumed ground reflectance for the ground-mounted irradiance term. */
const GROUND_ALBEDO = 0.2;

/**
 * Simulate one panel across a whole day.
 *
 * The panel's tilt/azimuth come from its config; the array azimuth is the
 * plane's facing direction. Shading is recomputed at EVERY hour from the
 * actual projected obstacle geometry, so shadow loss tracks the sun through
 * the day rather than being a single daily number.
 *
 * Limitation: this is a beam-shading AREA model, not an electrical string
 * simulation. It estimates partial-shading loss from shaded area and assumes
 * no bypass-diode behaviour, which is the documented approximation.
 */
export function simulatePanelDay(
  panel: SimulatedPanel,
  weather: HourlyWeather[],
  obstacles: Obstacle[],
  parapetInsetM: number,
  terraceRing: Point2[],
): PanelDayResult {
  const def = panelTypeDefinition(panel.config.panelTypeId);
  const surfaceAzimuth = panel.config.azimuthDeg;
  const tilt = panel.config.tiltDeg;

  const results: PanelHourResult[] = [];
  let unshadedKwh = 0;
  let shadedKwh = 0;
  let daylightHours = 0;
  let fullyMeasured = true;

  for (const hour of weather) {
    const night = hour.solarElevationDeg <= 0 || hour.ghi <= 0;
    const poaUnshaded = planeOfArrayIrradiance(
      hour.dni, hour.dhi, hour.ghi,
      tilt, surfaceAzimuth, hour.solarAzimuthDeg, hour.solarElevationDeg,
    );
    const shadeFraction = night
      ? 0
      : panelShadeFraction(panel, obstacles, parapetInsetM, hour.solarAzimuthDeg, hour.solarElevationDeg, terraceRing);
    // Diffuse irradiance is assumed isotropic, so it is NOT reduced by
    // shading; only the direct beam is scaled by the shaded fraction.
    const viewFactor = (1 + Math.cos(tilt * DEG)) / 2;
    const diffuse = hour.dhi * viewFactor;
    const ground = hour.ghi * GROUND_ALBEDO * ((1 - Math.cos(tilt * DEG)) / 2);
    const beam = Math.max(0, poaUnshaded - diffuse - ground);
    const poaShaded = beam * (1 - shadeFraction) + diffuse + ground;

    // DC model. Explicitly labelled assumptions (not manufacturer data):
    // peak power scales linearly with the POA-to-1-sun ratio, and a cell
    // temperature derate captures the ~0.4%/°C typical of crystalline silicon.
    const cellTemp = hour.temperatureDeg + Math.max(0, poaShaded / 800) * 30;
    const tempDerate = Math.max(0, 1 + TEMP_COEFF * (cellTemp - STC_TEMPERATURE_C));
    const acUnshaded = (poaUnshaded / 1000) * def.watts * tempDerate * INVERTER_EFFICIENCY;
    const acShaded = (poaShaded / 1000) * def.watts * tempDerate * INVERTER_EFFICIENCY;

    if (!night) daylightHours += 1;
    if (!hour.measured) fullyMeasured = false;
    unshadedKwh += acUnshaded / 1000;
    shadedKwh += acShaded / 1000;

    results.push({
      hour: hour.hour,
      poaUnshaded,
      shadeFraction,
      poaShaded,
      powerShadedW: acUnshaded,
      powerShadedW2: acShaded,
      shadeLossW: acUnshaded - acShaded,
      solarElevationDeg: hour.solarElevationDeg,
      solarAzimuthDeg: hour.solarAzimuthDeg,
      night,
    });
  }

  const loss = unshadedKwh > 0 ? ((unshadedKwh - shadedKwh) / unshadedKwh) * 100 : 0;
  return {
    panels: results,
    energyUnshadedKwh: unshadedKwh,
    energyShadedKwh: shadedKwh,
    shadeLossPercent: loss,
    daylightHours,
    fullyMeasured,
  };
}

/**
 * Build a fallback hourly weather row set from clear-sky
 * geometry alone. Used ONLY when no PVGIS/measured data is available, and
 * flagged `measured: false` so the UI can disclose it.
 */
export function clearSkyFallbackWeather(
  hourlySunPosition: Array<{ hour: number; solarAzimuthDeg: number; solarElevationDeg: number }>,
): HourlyWeather[] {
  return hourlySunPosition.map((s) => {
    const night = s.solarElevationDeg <= 0;
    const clearSkyGhi = night ? 0 : Math.max(0, Math.sin(s.solarElevationDeg * DEG)) * 950;
    return {
      hour: s.hour,
      dni: night ? 0 : Math.max(0, clearSkyGhi * (1 - 0.12)),
      dhi: night ? 0 : clearSkyGhi * 0.12,
      ghi: clearSkyGhi,
      solarAzimuthDeg: s.solarAzimuthDeg,
      solarElevationDeg: s.solarElevationDeg,
      temperatureDeg: 28,
      measured: false,
    };
  });
}

/** One row of the hourly energy table the UI displays. */
export interface HourlyEnergyRow {
  hour: number;
  /** Local wall-clock label, e.g. "09:00". */
  timeLabel: string;
  solarElevationDeg: number;
  solarAzimuthDeg: number;
  /** Summed unshaded AC power across the set, W. */
  unshadedW: number;
  /** Summed shaded AC power across the set, W. */
  shadedW: number;
  /** Shading loss in W (unshaded − shaded). */
  shadeLossW: number;
  shadeLossPercent: number;
  night: boolean;
}

export interface EnergySimulation {
  rows: HourlyEnergyRow[];
  /** Total daily energy, kWh. */
  dayEnergyKwh: number;
  dayEnergyUnshadedKwh: number;
  dayShadeLossPercent: number;
  /** True only when every hour used real measured/modelled weather. */
  fullyMeasured: boolean;
  /** Where the weather rows came from, for honest disclosure. */
  weatherSource: "pvgis" | "clear-sky-fallback";
}

/**
 * Aggregate a whole panel-set day simulation into the rows the UI shows.
 *
 * `summer` here means the panels share one configuration; the sums are over
 * the panels the caller supplies.
 */
export function computePanelEnergy(
  panels: SimulatedPanel[],
  weather: HourlyWeather[],
  obstacles: Obstacle[],
  parapetInsetM: number,
  terraceRing: Point2[],
  weatherSource: "pvgis" | "clear-sky-fallback" = "clear-sky-fallback",
): EnergySimulation {
  // Per-panel, per-hour results, then summed across panels.
  const perPanel = panels.map((panel) =>
    simulatePanelDay(panel, weather, obstacles, parapetInsetM, terraceRing),
  );

  const hours = weather.map((w) => w.hour);
  const rows: HourlyEnergyRow[] = hours.map((hour) => {
    let unshaded = 0;
    let shaded = 0;
    let elevation = 0;
    let azimuth = 0;
    let night = true;
    for (const result of perPanel) {
      const entry = result.panels.find((p) => p.hour === hour);
      if (!entry) continue;
      unshaded += entry.powerShadedW;
      shaded += entry.powerShadedW2;
      elevation = entry.solarElevationDeg;
      azimuth = entry.solarAzimuthDeg;
      night = entry.night;
    }
    const lossPercent = unshaded > 0 ? ((unshaded - shaded) / unshaded) * 100 : 0;
    return {
      hour,
      timeLabel: `${String(hour).padStart(2, "0")}:00`,
      solarElevationDeg: elevation,
      solarAzimuthDeg: azimuth,
      unshadedW: unshaded,
      shadedW: shaded,
      shadeLossW: unshaded - shaded,
      shadeLossPercent: lossPercent,
      night,
    };
  });

  const dayEnergyKwh = rows.reduce((s, r) => s + r.shadedW / 1000, 0);
  const dayEnergyUnshadedKwh = rows.reduce((s, r) => s + r.unshadedW / 1000, 0);
  const dayShadeLossPercent =
    dayEnergyUnshadedKwh > 0
      ? ((dayEnergyUnshadedKwh - dayEnergyKwh) / dayEnergyUnshadedKwh) * 100
      : 0;

  return {
    rows,
    dayEnergyKwh,
    dayEnergyUnshadedKwh,
    dayShadeLossPercent,
    fullyMeasured: weather.every((w) => w.measured),
    weatherSource,
  };
}
