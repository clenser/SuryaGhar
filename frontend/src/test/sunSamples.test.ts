/**
 * Day sampling, interpolation and the playback clock.
 *
 * The samples are precomputed once per (site, date, zone) and the render loop
 * interpolates between them — these tests pin down that contract, the night
 * classification, and the bounded Play/Pause behaviour.
 */

import { describe, expect, it } from "vitest";
import {
  DAY_MINUTES,
  DEFAULT_SAMPLE_STEP_MINUTES,
  NIGHT_STATE,
  advanceSunClock,
  createSunClock,
  sampleSolarDay,
  shortestAngleDelta,
  sunStateAt,
  type SunSample,
} from "../lib/solar";

const SITE = { latitude: 22.5726, longitude: 88.3639 };
const DATE = "2026-03-21";
const TIMEZONE = "Asia/Kolkata";

function daySamples(stepMinutes?: number) {
  return sampleSolarDay({ ...SITE, date: DATE, timezone: TIMEZONE, stepMinutes });
}

describe("sampleSolarDay", () => {
  it("covers the whole local day from 00:00 to 24:00", () => {
    const samples = daySamples();
    expect(samples.length).toBe(DAY_MINUTES / DEFAULT_SAMPLE_STEP_MINUTES + 1);
    expect(samples[0].minutes).toBe(0);
    expect(samples[samples.length - 1].minutes).toBe(DAY_MINUTES);

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].minutes).toBe(samples[i - 1].minutes + DEFAULT_SAMPLE_STEP_MINUTES);
    }
  });

  it("produces plausible values: high sun at noon, negative elevation at night", () => {
    const samples = daySamples(60);
    for (const sample of samples) {
      expect(Number.isFinite(sample.azimuthDeg)).toBe(true);
      expect(sample.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(sample.azimuthDeg).toBeLessThan(360);
      expect(sample.elevationDeg).toBeGreaterThan(-90);
      expect(sample.elevationDeg).toBeLessThan(90);
    }

    const noon = samples.find((s) => s.minutes === 12 * 60)!;
    const deepNight = samples.find((s) => s.minutes === 60)!;
    expect(noon.elevationDeg).toBeGreaterThan(50);
    expect(deepNight.elevationDeg).toBeLessThan(0);
  });

  it("supports a custom step and still closes the day", () => {
    const samples = daySamples(45);
    expect(samples[1].minutes).toBe(45);
    expect(samples[samples.length - 1].minutes).toBe(DAY_MINUTES);
  });

  it("rejects an invalid step or date", () => {
    expect(() => daySamples(0)).toThrow(/step/i);
    expect(() => daySamples(1441)).toThrow(/step/i);
    expect(() => sampleSolarDay({ ...SITE, date: "nope", timezone: TIMEZONE })).toThrow();
    expect(() => sampleSolarDay({ ...SITE, date: DATE, timezone: "Not/AZone" })).toThrow();
    expect(() => sampleSolarDay({ latitude: 200, longitude: 0, date: DATE, timezone: "UTC" })).toThrow();
  });
});

describe("sunStateAt", () => {
  const samples: SunSample[] = [
    { minutes: 0, azimuthDeg: 350, elevationDeg: -20 },
    { minutes: 10, azimuthDeg: 10, elevationDeg: 0 },
    { minutes: 20, azimuthDeg: 30, elevationDeg: 20 },
  ];

  it("returns the sample exactly at its own time", () => {
    expect(sunStateAt(samples, 10)).toEqual({ azimuthDeg: 10, elevationDeg: 0, night: true });
    expect(sunStateAt(samples, 20)).toEqual({ azimuthDeg: 30, elevationDeg: 20, night: false });
  });

  it("interpolates between samples", () => {
    const mid = sunStateAt(samples, 15);
    expect(mid.elevationDeg).toBeCloseTo(10, 6);
    expect(mid.azimuthDeg).toBeCloseTo(20, 6);
    expect(mid.night).toBe(false);
  });

  it("interpolates azimuth the short way around the compass", () => {
    const mid = sunStateAt(samples, 5); // 350° → 10° must pass through 0°, not 180°
    expect(mid.azimuthDeg).toBeCloseTo(0, 6);
  });

  it("clamps outside the sampled range", () => {
    expect(sunStateAt(samples, -500).elevationDeg).toBe(-20);
    expect(sunStateAt(samples, 5000).elevationDeg).toBe(20);
  });

  it("marks the sun below the horizon as night", () => {
    expect(sunStateAt(samples, -10).night).toBe(true); // clamped below the horizon
    expect(sunStateAt(samples, 0).night).toBe(true);
    expect(sunStateAt(samples, 20).night).toBe(false);
    // Exactly on the horizon counts as night: no direct sunlight yet.
    expect(sunStateAt(samples, 10).elevationDeg).toBe(0);
    expect(sunStateAt(samples, 10).night).toBe(true);

    expect(sunStateAt([], 600)).toBe(NIGHT_STATE);
    expect(sunStateAt([], 600).night).toBe(true);
  });

  it("returns the single sample when the endpoints coincide", () => {
    const single: SunSample[] = [{ minutes: 0, azimuthDeg: 90, elevationDeg: 5 }];
    expect(sunStateAt(single, 30)).toEqual({ azimuthDeg: 90, elevationDeg: 5, night: false });
  });
});

describe("shortestAngleDelta", () => {
  it("takes the short way around", () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
    expect(shortestAngleDelta(0, 180)).toBe(180);
    expect(shortestAngleDelta(90, 90)).toBe(0);
  });
});

describe("sun clock", () => {
  it("starts paused at the time it was given", () => {
    const clock = createSunClock([], 720);
    expect(clock.playing).toBe(false);
    expect(clock.timeMinutes).toBe(720);
    expect(clock.speed).toBeGreaterThan(0);
  });

  it("does nothing while paused", () => {
    const clock = createSunClock([], 720);
    expect(advanceSunClock(clock, 10)).toBe(false);
    expect(clock.timeMinutes).toBe(720);
  });

  it("advances by speed × real seconds while playing", () => {
    const clock = createSunClock([], 720);
    clock.playing = true;
    clock.speed = 60;
    expect(advanceSunClock(clock, 0.5)).toBe(false);
    expect(clock.timeMinutes).toBe(750);
  });

  it("stops exactly once at 24:00 and clamps the time", () => {
    const clock = createSunClock([], 1439);
    clock.playing = true;
    expect(advanceSunClock(clock, 10)).toBe(true); // overshoot → clamped
    expect(clock.timeMinutes).toBe(DAY_MINUTES);
    expect(clock.playing).toBe(false);

    expect(advanceSunClock(clock, 10)).toBe(false); // stays stopped, no second end
    expect(clock.timeMinutes).toBe(DAY_MINUTES);
  });

  it("ignores invalid deltas instead of corrupting the timeline", () => {
    const clock = createSunClock([], 720);
    clock.playing = true;
    advanceSunClock(clock, Number.NaN);
    advanceSunClock(clock, -60);
    expect(clock.timeMinutes).toBe(720);
  });
});
