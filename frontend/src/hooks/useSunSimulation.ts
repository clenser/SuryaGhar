/**
 * useSunSimulation — date/time/playing state for the Phase 4 sun simulation.
 *
 * Responsibilities (AGENTS.md §72/§73 — React owns state, Three.js owns the
 * render loop, and React is never updated per frame):
 *
 * - samples the selected local day once per (site, date, timezone) — no API
 *   call, so the backend wake/inactivity tracking never sees the animation;
 * - mirrors state into the mutable `SunClock` the render loop reads;
 * - receives throttled ticks (≤5 Hz) back from that loop for the clock readout
 *   and stops playback cleanly at 24:00.
 *
 * Writes React → clock happen synchronously inside event handlers, so a
 * playback tick can never be undone by an effect running late (which would
 * make the simulation stutter).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  DAY_MINUTES,
  SUN_PLAYBACK_SPEED,
  createSunClock,
  sampleSolarDay,
  sunStateAt,
  type SunClock,
  type SunSample,
  type SunState,
} from "../lib/solar";
import { resolveSiteTimezone } from "../lib/solar/timezone";

/** Default scrubbed time: solar midday (exact noon comes from the samples). */
export const DEFAULT_SIMULATION_MINUTES = 12 * 60;

/**
 * Today's calendar date in an IANA zone as `YYYY-MM-DD`.
 * Uses the zone rather than `toISOString()` so "today" is the site's today
 * (UTC would be the previous day before 05:30 IST).
 */
export function siteToday(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: "year" | "month" | "day"): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface UseSunSimulationOptions {
  /** Site latitude in degrees, or null while no site is measured yet. */
  latitude: number | null;
  /** Site longitude in degrees east, or null while no site is measured yet. */
  longitude: number | null;
  /** Selected place's country, used to resolve the site timezone. */
  siteCountry?: string | null;
}

export interface SunSimulation {
  /** Local calendar date for the site, `YYYY-MM-DD`. */
  date: string;
  /** Simulated local minute-of-day, 0…1440. */
  timeMinutes: number;
  /** Whether the render loop is advancing the clock. */
  playing: boolean;
  /** Simulated minutes per real second. */
  speed: number;
  /** IANA zone the date/time belong to. */
  timezone: string;
  /** Precomputed day samples, or null when the inputs could not be sampled. */
  samples: SunSample[] | null;
  /** Interpolated position for the current time, or null when unavailable. */
  state: SunState | null;
  /** Stable mutable clock consumed by the Three.js render loop. */
  clock: SunClock;
  setDate: (date: string) => void;
  setSpeed: (speed: number) => void;
  setTime: (minutes: number) => void;
  togglePlay: () => void;
  pause: () => void;
}

export function useSunSimulation(options: UseSunSimulationOptions): SunSimulation {
  const { latitude, longitude, siteCountry } = options;

  const timezone = useMemo(() => resolveSiteTimezone(siteCountry), [siteCountry]);
  const [date, setDateState] = useState(() => siteToday(timezone));
  const [timeMinutes, setTimeState] = useState(DEFAULT_SIMULATION_MINUTES);
  const [playing, setPlayingState] = useState(false);

  // Sample the local day once per (site, date, zone). A missing site or a
  // malformed date (the field can be cleared) yields null instead of crashing
  // the viewport — the controls then say the position is unavailable.
  const samples = useMemo<SunSample[] | null>(() => {
    if (latitude === null || longitude === null) return null;
    try {
      return sampleSolarDay({ latitude, longitude, date, timezone });
    } catch (error) {
      console.error("[useSunSimulation] Solar sampling failed:", error);
      return null;
    }
  }, [latitude, longitude, date, timezone]);

  const [speed, setSpeedState] = useState(SUN_PLAYBACK_SPEED);

  const clockRef = useRef<SunClock | null>(null);
  if (clockRef.current === null) {
    clockRef.current = createSunClock(samples ?? [], timeMinutes, speed);
  }
  const clock = clockRef.current;
  // Keep the clock's sample set and speed current while it is idle or playing:
  if (samples !== null && clock.samples !== samples) clock.samples = samples;
  clock.speed = speed;

  // Loop → React: throttled by the viewer (never per frame).
  const handleTick = useCallback((minutes: number) => {
    setTimeState(minutes);
  }, []);
  const handleEnd = useCallback(() => {
    setPlayingState(false);
    setTimeState(DAY_MINUTES);
  }, []);
  clock.onTick = handleTick;
  clock.onEnd = handleEnd;

  const setDate = useCallback((next: string) => {
    // Samples are recomputed for the new date; the time of day is preserved so
    // scrubbing to noon then comparing dates behaves as users expect.
    setDateState(next);
  }, []);

  const setSpeed = useCallback((nextSpeed: number) => {
    const valid = Number.isFinite(nextSpeed) && nextSpeed > 0 ? nextSpeed : SUN_PLAYBACK_SPEED;
    setSpeedState(valid);
    if (clockRef.current) {
      clockRef.current.speed = valid;
    }
  }, []);

  const setTime = useCallback(
    (minutes: number) => {
      const clamped = Math.min(Math.max(minutes, 0), DAY_MINUTES);
      // Scrubbing always pauses: a playhead fighting a drag is not usable.
      setPlayingState(false);
      setTimeState(clamped);
      clock.playing = false;
      clock.timeMinutes = clamped;
    },
    [clock],
  );

  const pause = useCallback(() => {
    setPlayingState(false);
    clock.playing = false;
  }, [clock]);

  const togglePlay = useCallback(() => {
    if (clock.playing) {
      pause();
      return;
    }
    if (!samples || samples.length === 0) return;
    // Playing from the end of the day restarts it instead of ending instantly.
    if (timeMinutes >= DAY_MINUTES) {
      setTimeState(0);
      clock.timeMinutes = 0;
    }
    clock.playing = true;
    setPlayingState(true);
  }, [clock, pause, samples, timeMinutes]);

  const state = useMemo<SunState | null>(
    () => (samples && samples.length ? sunStateAt(samples, timeMinutes) : null),
    [samples, timeMinutes],
  );

  return {
    date,
    timeMinutes,
    playing,
    speed,
    timezone,
    samples,
    state,
    clock,
    setDate,
    setSpeed,
    setTime,
    togglePlay,
    pause,
  };
}

export default useSunSimulation;
