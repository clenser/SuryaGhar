/**
 * useSunSimulation tests: state ownership, sample refresh, playback bounds and
 * the two-way contract with the mutable SunClock consumed by the render loop.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSunSimulation, siteToday } from "../hooks/useSunSimulation";
import {
  DAY_MINUTES,
  DEFAULT_SAMPLE_STEP_MINUTES,
  advanceSunClock,
  localWallClockToUtc,
} from "../lib/solar";

const SITE = { latitude: 22.5726, longitude: 88.3639, siteCountry: "India" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("siteToday", () => {
  it("returns the site's calendar date", () => {
    expect(siteToday("Asia/Kolkata")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(siteToday("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("useSunSimulation", () => {
  it("starts at midday today with a full day of samples", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));
    const sim = result.current;

    expect(sim.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sim.timeMinutes).toBe(12 * 60);
    expect(sim.playing).toBe(false);
    expect(sim.timezone).toBe("Asia/Kolkata");
    expect(sim.samples).not.toBeNull();
    expect(sim.samples!.length).toBe(DAY_MINUTES / DEFAULT_SAMPLE_STEP_MINUTES + 1);
    expect(sim.state).not.toBeNull();
    expect(sim.state!.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(sim.state!.azimuthDeg).toBeLessThan(360);
    expect(sim.state!.night).toBe(false);

    // The clock mirrors React state for the render loop.
    expect(sim.clock.timeMinutes).toBe(12 * 60);
    expect(sim.clock.playing).toBe(false);
    expect(sim.clock.samples).toBe(sim.samples);
  });

  it("does not assume every site uses one timezone", () => {
    const { result, rerender } = renderHook(
      ({ siteCountry }: { siteCountry: string | null }) => useSunSimulation({ ...SITE, siteCountry }),
      { initialProps: { siteCountry: "India" as string | null } },
    );
    expect(result.current.timezone).toBe("Asia/Kolkata");

    rerender({ siteCountry: "Bangladesh" });
    expect(result.current.timezone).toBe("Asia/Dhaka");
  });

  it("scrubbing sets the time, pauses playback and writes the clock immediately", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));

    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(true);

    act(() => result.current.setTime(9 * 60));
    expect(result.current.timeMinutes).toBe(9 * 60);
    expect(result.current.playing).toBe(false);
    expect(result.current.clock.playing).toBe(false);
    expect(result.current.clock.timeMinutes).toBe(9 * 60);
  });

  it("clamps the time to the simulation day", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));

    act(() => result.current.setTime(99 * 60));
    expect(result.current.timeMinutes).toBe(DAY_MINUTES);

    act(() => result.current.setTime(-30));
    expect(result.current.timeMinutes).toBe(0);
    expect(result.current.clock.timeMinutes).toBe(0);
  });

  it("plays and pauses the day", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));

    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(true);
    expect(result.current.clock.playing).toBe(true);

    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(false);
    expect(result.current.clock.playing).toBe(false);
  });

  it("restarts from 00:00 when playing from the end of the day", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));

    act(() => result.current.setTime(DAY_MINUTES));
    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(true);
    expect(result.current.timeMinutes).toBe(0);
    expect(result.current.clock.timeMinutes).toBe(0);
  });

  it("applies throttled ticks from the render loop", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));
    const clock = result.current.clock;
    expect(clock.onTick).toBeTypeOf("function");

    act(() => {
      clock.onTick?.(13 * 60 + 7);
    });
    expect(result.current.timeMinutes).toBe(13 * 60 + 7);
    // The loop owns the clock during playback — React must not write it back.
    expect(result.current.clock.timeMinutes).toBe(12 * 60);
  });

  it("stops cleanly when the loop reaches the end of the day", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));

    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(true);

    // Exactly what the render loop does when playback hits 24:00.
    act(() => {
      const clock = result.current.clock;
      clock.timeMinutes = DAY_MINUTES - 1;
      const ended = advanceSunClock(clock, 10); // overshoot → clamped
      expect(ended).toBe(true);
      clock.onEnd?.();
    });

    expect(result.current.playing).toBe(false);
    expect(result.current.timeMinutes).toBe(DAY_MINUTES);
    expect(result.current.clock.playing).toBe(false);
    expect(result.current.clock.timeMinutes).toBe(DAY_MINUTES);
  });

  it("re-samples the day when the date changes and keeps the time of day", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));
    const before = result.current.samples;

    act(() => result.current.setDate("2026-06-21"));
    expect(result.current.date).toBe("2026-06-21");
    expect(result.current.timeMinutes).toBe(12 * 60);
    expect(result.current.samples).not.toBe(before);

    // June solstice noon sits higher at this latitude than the equinox noon.
    const juneNoon = result.current.state!.elevationDeg;
    expect(juneNoon).toBeGreaterThan(70);

    act(() => result.current.setDate("2026-03-21"));
    expect(result.current.state!.elevationDeg).toBeLessThan(juneNoon);
  });

  it("samples the site's local clock, not UTC", () => {
    const { result } = renderHook(() => useSunSimulation(SITE));
    act(() => result.current.setDate("2026-03-21"));
    act(() => result.current.setTime(12 * 60));

    // The noon sample corresponds to 06:30 UTC for IST sites.
    const noonInstant = localWallClockToUtc("2026-03-21", 12 * 60, "Asia/Kolkata");
    expect(noonInstant.toISOString()).toBe("2026-03-21T06:30:00.000Z");
    expect(result.current.state!.elevationDeg).toBeGreaterThan(50);
  });

  it("degrades to an unavailable state for a cleared date or a missing site", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const cleared = renderHook(() => useSunSimulation(SITE));
    act(() => cleared.result.current.setDate(""));
    expect(cleared.result.current.samples).toBeNull();
    expect(cleared.result.current.state).toBeNull();
    act(() => cleared.result.current.togglePlay());
    expect(cleared.result.current.playing).toBe(false);

    const noSite = renderHook(() => useSunSimulation({ latitude: null, longitude: null }));
    expect(noSite.result.current.samples).toBeNull();
    expect(noSite.result.current.state).toBeNull();
  });
});
