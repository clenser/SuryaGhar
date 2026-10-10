/**
 * SunClock — the shared, mutable simulation clock.
 *
 * React owns the authoritative user-facing state (date, scrubbed time,
 * playing) and writes it into this object from event handlers; the Three.js
 * render loop advances `timeMinutes` while playing and reports back through
 * throttled callbacks. It is deliberately NOT React state: the light moves
 * every frame, and re-rendering the panel 60 times a second is exactly what
 * AGENTS.md §73 forbids.
 */

import { DAY_MINUTES, type SunSample } from "./sunSamples";

/** Simulated minutes per real second while playing (a full day takes 24 s). */
export const SUN_PLAYBACK_SPEED = 60;

/** Minimum real milliseconds between React updates during playback (≤5 Hz). */
export const SUN_UI_TICK_MS = 200;

export interface SunClock {
  /** Precomputed samples for the current site/date/timezone. */
  samples: SunSample[];
  /** Simulated local minute-of-day, 0…1440. Mutated by the render loop. */
  timeMinutes: number;
  /** Whether the render loop should advance the clock. */
  playing: boolean;
  /** Simulated minutes per real second. */
  speed: number;
  /** Throttled UI sync — never called per frame. */
  onTick?: (minutes: number) => void;
  /** Fired once when playback reaches 24:00 (the loop stops itself). */
  onEnd?: () => void;
}

/** Build a clock for a set of samples. Callbacks are attached by the hook. */
export function createSunClock(
  samples: SunSample[],
  timeMinutes: number,
  speed: number = SUN_PLAYBACK_SPEED,
): SunClock {
  return { samples, timeMinutes, playing: false, speed };
}

/**
 * Advance a playing clock by `deltaSeconds` of real time.
 *
 * Returns true exactly once — when playback hits 24:00, at which point the
 * clock is clamped to the end of the day and `playing` is cleared so no loop
 * keeps running past the bounds.
 */
export function advanceSunClock(clock: SunClock, deltaSeconds: number): boolean {
  if (!clock.playing) return false;
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  clock.timeMinutes += delta * clock.speed;

  if (clock.timeMinutes >= DAY_MINUTES) {
    clock.timeMinutes = DAY_MINUTES;
    clock.playing = false;
    return true;
  }
  return false;
}
