/**
 * Day sampling and interpolation for the visual sun simulation.
 *
 * A day's solar positions are computed once per (site, date, timezone) at a
 * fixed interval, then the animation interpolates between samples locally.
 * That keeps the renderer out of any per-frame astronomy and — critically —
 * means no network or backend work happens while the sun is moving
 * (AGENTS.md §59/§69: camera, sun animation and visual shadows stay local).
 *
 * Limitations, by design:
 * - 10-minute samples (≈0.04° of sun motion between samples) linearly
 *   interpolated; elevation error is far below anything visible in a shadow.
 * - Azimuth interpolation takes the short way around the compass, so a
 *   sample pair straddling north never sweeps the long way.
 * - Times are the site's wall clock for the selected date (DST-aware).
 */

import { localWallClockToUtc } from "./timezone";
import { solarPosition } from "./solarPosition";

/** Minutes in a simulation day (0 = 00:00, 1440 = 24:00). */
export const DAY_MINUTES = 1440;

/** Default sampling interval for a day (144 samples/day). */
export const DEFAULT_SAMPLE_STEP_MINUTES = 10;

export interface SunSample {
  /** Local minute-of-day the sample belongs to. */
  minutes: number;
  /** Azimuth, degrees from North clockwise. */
  azimuthDeg: number;
  /** Apparent elevation (refraction applied) in degrees — negative at night. */
  elevationDeg: number;
}

export interface SunState {
  azimuthDeg: number;
  elevationDeg: number;
  /** True when the sun is below the horizon: no direct sunlight. */
  night: boolean;
}

export interface SampleSolarDayOptions {
  latitude: number;
  longitude: number;
  /** Local calendar date for the site, `YYYY-MM-DD`. */
  date: string;
  /** IANA timezone the wall-clock date/time refers to. */
  timezone: string;
  /** Interval between samples in minutes (≥ 1). */
  stepMinutes?: number;
}

/** The night state used when no samples exist (nothing is fabricated). */
export const NIGHT_STATE: SunState = { azimuthDeg: 0, elevationDeg: 0, night: true };

/**
 * Sample the whole local day for a site. Throws for an invalid date/zone or
 * an out-of-range step — the caller decides how to degrade.
 */
export function sampleSolarDay(options: SampleSolarDayOptions): SunSample[] {
  const step = options.stepMinutes ?? DEFAULT_SAMPLE_STEP_MINUTES;
  if (!Number.isFinite(step) || step < 1 || step > DAY_MINUTES) {
    throw new Error("Sample step must be between 1 and 1440 minutes");
  }

  const samples: SunSample[] = [];
  for (let minutes = 0; minutes < DAY_MINUTES; minutes += step) {
    const instant = localWallClockToUtc(options.date, minutes, options.timezone);
    const position = solarPosition(options.latitude, options.longitude, instant);
    samples.push({
      minutes,
      azimuthDeg: position.azimuthDeg,
      elevationDeg: position.apparentElevationDeg,
    });
  }

  // Always close the day so the 24:00 endpoint interpolates instead of
  // clamping to the penultimate sample.
  const last = samples[samples.length - 1];
  if (!last || last.minutes !== DAY_MINUTES) {
    const instant = localWallClockToUtc(options.date, DAY_MINUTES, options.timezone);
    const position = solarPosition(options.latitude, options.longitude, instant);
    samples.push({
      minutes: DAY_MINUTES,
      azimuthDeg: position.azimuthDeg,
      elevationDeg: position.apparentElevationDeg,
    });
  }
  return samples;
}

/** Shortest signed difference between two compass angles, in (−180, 180]. */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  const delta = ((toDeg - fromDeg + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}

/**
 * Interpolated sun state at `minutes`. Clamps outside the sampled range and
 * interpolates azimuth the short way around the compass.
 */
export function sunStateAt(samples: SunSample[], minutes: number): SunState {
  if (!samples.length) return NIGHT_STATE;

  const clamped = Math.min(Math.max(minutes, samples[0].minutes), samples[samples.length - 1].minutes);

  let index = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].minutes <= clamped) {
      index = i;
      break;
    }
  }

  const current = samples[index];
  const next = samples[index + 1];
  if (!next || next.minutes === current.minutes) {
    return {
      azimuthDeg: current.azimuthDeg,
      elevationDeg: current.elevationDeg,
      night: current.elevationDeg <= 0,
    };
  }

  const t = (clamped - current.minutes) / (next.minutes - current.minutes);
  const azimuthDeg =
    (current.azimuthDeg + shortestAngleDelta(current.azimuthDeg, next.azimuthDeg) * t + 360) % 360;
  const elevationDeg = current.elevationDeg + (next.elevationDeg - current.elevationDeg) * t;

  return { azimuthDeg, elevationDeg, night: elevationDeg <= 0 };
}
