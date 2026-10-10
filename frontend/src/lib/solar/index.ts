/**
 * Solar position and sun-state helpers for the visual sun simulation.
 * See each module for the conventions (azimuth from North clockwise,
 * elevation apparent unless stated, all local time via `timezone`).
 */

export {
  solarPosition,
  equationOfTimeMinutes,
  refractionDegrees,
  type SolarPosition,
} from "./solarPosition";

export {
  resolveSiteTimezone,
  isValidTimezone,
  timezoneOffsetMinutes,
  localWallClockToUtc,
  formatClockTime,
  formatUtcOffset,
  formatTimezoneLabel,
  formatSiteDateTime,
  FALLBACK_TIMEZONE,
} from "./timezone";

export {
  sampleSolarDay,
  sunStateAt,
  shortestAngleDelta,
  DAY_MINUTES,
  DEFAULT_SAMPLE_STEP_MINUTES,
  NIGHT_STATE,
  type SunSample,
  type SunState,
  type SampleSolarDayOptions,
} from "./sunSamples";

export {
  createSunClock,
  advanceSunClock,
  SUN_PLAYBACK_SPEED,
  SUN_UI_TICK_MS,
  type SunClock,
} from "./sunClock";
