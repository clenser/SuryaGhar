/**
 * Solar position (azimuth / elevation) for a site and instant.
 *
 * Implements the NOAA Solar Calculator equations (Meeus, "Astronomical
 * Algorithms" 2nd ed. ch. 25 — apparent longitude, obliquity correction,
 * equation of time and atmospheric refraction). This is the same algorithm
 * family pvlib uses, which the backend already calls for the quantitative
 * analysis (`backend/app/geospatial/shadows.py` → `_sun_position`), so the
 * visual simulation and the authoritative calculations agree to well inside
 * 0.1° for normal sun elevations.
 *
 * Why the calculation runs in the browser: AGENTS.md §59/§60 assigns "visual
 * sun simulation" to the client, the only existing backend path that produces
 * solar positions (`POST /api/shadow-analysis`) also downloads OSM geometry and
 * computes quantitative shading (out of scope here), it wakes the EC2 backend,
 * and its hourly table is fixed to UTC 06–18 which does not cover a local day.
 * Phase 4 must not change the backend, so the day is sampled locally instead
 * of requesting it — no API calls per frame, no wake/inactivity side effects.
 *
 * Conventions (documented once, used everywhere):
 * - azimuth: degrees from true North, clockwise — 0 = N, 90 = E, 180 = S,
 *   270 = W (the pvlib `azimuth` convention the backend already returns).
 * - elevation: degrees above the horizon. `elevationDeg` is geometric,
 *   `apparentElevationDeg` adds refraction and matches pvlib's
 *   `apparent_elevation`, which the backend reports.
 */

/** Degrees → radians (kept local so the module has no Three.js dependency). */
const DEG = Math.PI / 180;

export interface SolarPosition {
  /** Azimuth, degrees from true North, clockwise (0=N, 90=E, 180=S, 270=W). */
  azimuthDeg: number;
  /** Geometric elevation above the horizon, degrees (negative at night). */
  elevationDeg: number;
  /** Elevation with atmospheric refraction applied (pvlib `apparent_elevation`). */
  apparentElevationDeg: number;
}

function norm360(deg: number): number {
  const out = deg % 360;
  return out < 0 ? out + 360 : out;
}

/** Julian centuries since J2000.0 for an instant expressed in UTC. */
function julianCenturies(instantUtc: Date): number {
  const jd = instantUtc.getTime() / 86_400_000 + 2_440_587.5;
  return (jd - 2_451_545.0) / 36_525;
}

/** Minutes elapsed since 00:00 UTC of the instant's UTC calendar day. */
function utcMinutesOfDay(instantUtc: Date): number {
  const dayStart = Date.UTC(
    instantUtc.getUTCFullYear(),
    instantUtc.getUTCMonth(),
    instantUtc.getUTCDate(),
  );
  return (instantUtc.getTime() - dayStart) / 60_000;
}

/**
 * Atmospheric refraction in degrees (NREL SPA / NOAA model — the same
 * polynomial pvlib applies, so horizon positions line up with the backend).
 */
export function refractionDegrees(elevationDeg: number): number {
  if (elevationDeg > 85) return 0;
  const t = Math.tan(elevationDeg * DEG);
  let arcsec: number;
  if (elevationDeg > 5) {
    arcsec = 58.1 / t - 0.07 / (t * t * t) + 0.000086 / (t * t * t * t * t);
  } else if (elevationDeg > -0.575) {
    arcsec =
      1735 +
      elevationDeg *
        (-518.2 + elevationDeg * (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)));
  } else {
    arcsec = -20.774 / t;
  }
  return arcsec / 3600;
}

/**
 * Equation of time in minutes (apparent solar time − mean solar time).
 * Exported for tests: it is what fixes the clock time of solar noon.
 */
export function equationOfTimeMinutes(instantUtc: Date): number {
  const T = julianCenturies(instantUtc);

  const meanLongitude = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const meanAnomaly = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const eccentricity = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  const m = meanAnomaly * DEG;
  const l0 = meanLongitude * DEG;
  const obliquity = meanObliquity(T);

  const y = Math.tan((obliquity / 2) * DEG) ** 2;
  const bracket =
    y * Math.sin(2 * l0) -
    2 * eccentricity * Math.sin(m) +
    4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * m);

  // 4 converts degrees of Earth rotation into minutes; /DEG converts the
  // radian-valued bracket to degrees (NOAA: E = 4·degrees(bracket)).
  return (4 / DEG) * bracket;
}

/** Corrected obliquity of the ecliptic, degrees. */
function meanObliquity(T: number): number {
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const mean = 23 + (26 + seconds / 60) / 60;
  const omega = (125.04 - 1934.136 * T) * DEG;
  return mean + 0.00256 * Math.cos(omega);
}

/**
 * Solar azimuth and elevation for a site and an instant.
 *
 * @param latitudeDeg   site latitude, −90…90
 * @param longitudeDeg  site longitude, −180…180 (east positive)
 * @param instantUtc    the instant, as a UTC JavaScript Date
 * @throws on out-of-range latitude/longitude or an invalid date — callers
 *         decide how to degrade, nothing is silently coerced.
 */
export function solarPosition(
  latitudeDeg: number,
  longitudeDeg: number,
  instantUtc: Date,
): SolarPosition {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new Error("Latitude must be between -90 and 90 degrees");
  }
  if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
    throw new Error("Longitude must be between -180 and 180 degrees");
  }
  if (!(instantUtc instanceof Date) || Number.isNaN(instantUtc.getTime())) {
    throw new Error("A valid UTC date is required for the solar position");
  }

  const T = julianCenturies(instantUtc);

  const meanLongitude = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const meanAnomaly = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;

  const m = meanAnomaly * DEG;
  // Equation of the centre.
  const centre =
    Math.sin(m) * (1.914602 - 0.004817 * T - 0.000014 * T * T) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * T * T) +
    Math.sin(3 * m) * 0.000289;

  const trueLongitude = meanLongitude + centre;
  const omega = (125.04 - 1934.136 * T) * DEG;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega);

  const obliquity = meanObliquity(T);
  const declination =
    Math.asin(
      Math.min(1, Math.max(-1, Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG))),
    ) / DEG;

  // True solar time (minutes) → hour angle. The value may fall outside
  // 0…1440 for UTC instants near the date line; sin/cos wrap it implicitly.
  const trueSolarTime = utcMinutesOfDay(instantUtc) + equationOfTimeMinutes(instantUtc) + 4 * longitudeDeg;
  const hourAngleDeg = trueSolarTime / 4 - 180;

  const lat = latitudeDeg * DEG;
  const dec = declination * DEG;
  const ha = hourAngleDeg * DEG;

  // Azimuth measured from South, westward (Meeus 15.1), then shifted to the
  // from-North-clockwise convention used everywhere else in the application.
  const fromSouth = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
  );
  const azimuthDeg = norm360(fromSouth / DEG + 180);

  const sinElevation =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const elevationDeg = Math.asin(Math.min(1, Math.max(-1, sinElevation))) / DEG;

  return {
    azimuthDeg,
    elevationDeg,
    apparentElevationDeg: elevationDeg + refractionDegrees(elevationDeg),
  };
}
