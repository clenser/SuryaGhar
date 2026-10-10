/**
 * Solar position tests.
 *
 * The implementation is the NOAA/Meeus algorithm family, so the checks here
 * are astronomical rather than self-referential. Reference times come from an
 * independent service (api.sunrise-sunset.org, retrieved 2026-03-21 data):
 *
 *   Kolkata (22.5726, 88.3639): solar noon 06:13:46Z, sunrise 00:08:34Z
 *   Sydney  (-33.8688, 151.2093): solar noon 02:02:26Z, sunset 08:07:14Z
 *
 * Those two locations also derive an equation of time of ≈ −7.2 min for that
 * date, which the local equation-of-time helper must reproduce — that is the
 * cross-check against the backend's pvlib results (pvlib's SPA and this
 * algorithm agree to well inside 0.1° for normal elevations).
 */

import { describe, expect, it } from "vitest";
import {
  equationOfTimeMinutes,
  refractionDegrees,
  solarPosition,
} from "../lib/solar/solarPosition";

const KOLKATA = { lat: 22.5726, lng: 88.3639 };
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

const DATE = "2026-03-21";

/** Position for a minute-of-day expressed in UTC on `DATE`. */
function atMinute(lat: number, lng: number, minuteUtc: number) {
  const instant = new Date(Date.parse(`${DATE}T00:00:00Z`) + minuteUtc * 60_000);
  return solarPosition(lat, lng, instant);
}

/** Minute of the daily elevation maximum (i.e. solar noon). */
function solarNoonMinute(lat: number, lng: number): number {
  let best = 0;
  let bestElevation = -Infinity;
  for (let minute = 0; minute <= 1440; minute++) {
    const elevation = atMinute(lat, lng, minute).elevationDeg;
    if (elevation > bestElevation) {
      bestElevation = elevation;
      best = minute;
    }
  }
  return best;
}

/** Minute where the geometric elevation crosses `threshold`. */
function crossingMinute(
  lat: number,
  lng: number,
  from: number,
  to: number,
  threshold: number,
  direction: "up" | "down",
): number {
  let previous = atMinute(lat, lng, from).elevationDeg;
  for (let minute = from + 1; minute <= to; minute++) {
    const elevation = atMinute(lat, lng, minute).elevationDeg;
    const crossed =
      direction === "up"
        ? previous < threshold && elevation >= threshold
        : previous >= threshold && elevation < threshold;
    if (crossed) {
      const t = (threshold - previous) / (elevation - previous);
      return minute - 1 + t;
    }
    previous = elevation;
  }
  throw new Error("threshold was never crossed");
}

describe("solarPosition", () => {
  it("puts solar noon at the reference clock time for two hemispheres", () => {
    // Independent references: Kolkata 06:13:46Z (373.77 min), Sydney 02:02:26Z (122.43 min).
    expect(Math.abs(solarNoonMinute(KOLKATA.lat, KOLKATA.lng) - 373.77)).toBeLessThanOrEqual(1);
    expect(Math.abs(solarNoonMinute(SYDNEY.lat, SYDNEY.lng) - 122.43)).toBeLessThanOrEqual(1);
  });

  it("crosses the horizon at the reference sunrise and sunset", () => {
    // Standard sunrise convention: geometric centre at −0.833°.
    const kolkataSunrise = crossingMinute(KOLKATA.lat, KOLKATA.lng, 0, 720, -0.833, "up");
    expect(Math.abs(kolkataSunrise - 8.57)).toBeLessThanOrEqual(3); // 00:08:34Z

    const sydneySunset = crossingMinute(SYDNEY.lat, SYDNEY.lng, 0, 720, -0.833, "down");
    expect(Math.abs(sydneySunset - 487.23)).toBeLessThanOrEqual(3); // 08:07:14Z
  });

  it("reproduces the equation of time implied by those references (≈ −7.2 min)", () => {
    const eot = equationOfTimeMinutes(new Date(`${DATE}T12:00:00Z`));
    expect(eot).toBeGreaterThan(-8);
    expect(eot).toBeLessThan(-6);
  });

  it("uses azimuth 0 = North, 90 = East, 180 = South (clockwise)", () => {
    const noon = atMinute(KOLKATA.lat, KOLKATA.lng, 373.77);
    // The sun is due south of a northern-hemisphere site at noon.
    expect(noon.azimuthDeg).toBeCloseTo(180, 1);

    const sydneyNoon = atMinute(SYDNEY.lat, SYDNEY.lng, 122.43);
    // ...and due north of a southern-hemisphere site.
    expect(Math.min(sydneyNoon.azimuthDeg, 360 - sydneyNoon.azimuthDeg)).toBeLessThan(1);
  });

  it("places the morning sun in the east and the afternoon sun in the west", () => {
    const morning = atMinute(KOLKATA.lat, KOLKATA.lng, 3 * 60); // 08:30 IST
    expect(morning.azimuthDeg).toBeGreaterThan(45);
    expect(morning.azimuthDeg).toBeLessThan(135);

    const afternoon = atMinute(KOLKATA.lat, KOLKATA.lng, 10 * 60); // 15:30 IST
    expect(afternoon.azimuthDeg).toBeGreaterThan(225);
    expect(afternoon.azimuthDeg).toBeLessThan(315);
  });

  it("matches the analytic noon elevation 90 − |latitude − declination|", () => {
    // Near the equinox the declination is within ~0.6° of 0, so the noon
    // elevation must land inside a one-degree band around 90 − |latitude|.
    const kolkataNoon = atMinute(KOLKATA.lat, KOLKATA.lng, 373.77);
    expect(kolkataNoon.elevationDeg).toBeGreaterThan(67);
    expect(kolkataNoon.elevationDeg).toBeLessThan(69);

    const sydneyNoon = atMinute(SYDNEY.lat, SYDNEY.lng, 122.43);
    expect(sydneyNoon.elevationDeg).toBeGreaterThan(55);
    expect(sydneyNoon.elevationDeg).toBeLessThan(57);
  });

  it("reports a negative elevation through the night", () => {
    // 18:00Z = 23:30 IST — deep night, well below the horizon.
    const night = solarPosition(KOLKATA.lat, KOLKATA.lng, new Date("2026-03-21T18:00:00Z"));
    expect(night.elevationDeg).toBeLessThan(0);
    expect(night.apparentElevationDeg).toBeLessThan(0);

    // One minute before the reference sunrise (00:08:34Z) the refracted sun
    // is still under the horizon — the day/night boundary is consistent.
    const justBeforeSunrise = atMinute(KOLKATA.lat, KOLKATA.lng, 7);
    expect(justBeforeSunrise.elevationDeg).toBeLessThan(0);
    expect(justBeforeSunrise.apparentElevationDeg).toBeLessThan(0);
  });

  it("adds refraction near the horizon but not overhead", () => {
    const horizon = refractionDegrees(0);
    expect(horizon).toBeGreaterThan(0.4);
    expect(horizon).toBeLessThan(0.6);

    expect(refractionDegrees(86)).toBe(0);

    const low = solarPosition(KOLKATA.lat, KOLKATA.lng, new Date(`${DATE}T00:20:00Z`));
    expect(low.apparentElevationDeg).toBeGreaterThan(low.elevationDeg);
  });

  it("rejects invalid inputs instead of silently coercing them", () => {
    const instant = new Date(`${DATE}T06:00:00Z`);
    expect(() => solarPosition(91, KOLKATA.lng, instant)).toThrow(/Latitude/);
    expect(() => solarPosition(NaN, KOLKATA.lng, instant)).toThrow(/Latitude/);
    expect(() => solarPosition(KOLKATA.lat, 200, instant)).toThrow(/Longitude/);
    expect(() => solarPosition(KOLKATA.lat, KOLKATA.lng, new Date("not a date"))).toThrow(/date/i);
  });
});
