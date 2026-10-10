/**
 * Site timezone resolution and local ↔ UTC conversion.
 *
 * The simulation runs on the site's clock, not the browser's and not a
 * hard-coded offset: the selected place's country picks a zone where one is
 * unambiguous, otherwise the browser's zone is used (the usual case — the user
 * plans a site in their own timezone). Every conversion goes through `Intl`,
 * so daylight-saving transitions are handled for the actual date instead of
 * assuming a fixed offset (AGENTS.md: no hidden unit/zone assumptions).
 */

/** Used only when neither the place nor the browser offers a usable zone. */
export const FALLBACK_TIMEZONE = "UTC";

/**
 * Countries with a single national zone (the app's region first). Countries
 * with several zones (US, Russia, Australia…) are deliberately absent — a
 * wrong guess would silently shift the sun by hours, so the browser's own
 * zone is the honest fallback for those.
 */
const COUNTRY_TIMEZONES: Record<string, string> = {
  india: "Asia/Kolkata",
  "sri lanka": "Asia/Colombo",
  bangladesh: "Asia/Dhaka",
  nepal: "Asia/Kathmandu",
  bhutan: "Asia/Thimphu",
  pakistan: "Asia/Karachi",
  myanmar: "Asia/Yangon",
  maldives: "Indian/Maldives",
};

/** True when the runtime accepts the zone (guards against typo'd tables). */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * IANA zone used for a site: country table first, then the browser zone,
 * then UTC. Never assumes every site shares one offset.
 */
export function resolveSiteTimezone(country?: string | null): string {
  const key = (country ?? "").trim().toLowerCase();
  const mapped = COUNTRY_TIMEZONES[key];
  if (mapped && isValidTimezone(mapped)) return mapped;

  try {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimezone(browserZone)) return browserZone;
  } catch {
    // Older runtimes without Intl time zone support fall through.
  }
  return FALLBACK_TIMEZONE;
}

/**
 * Offset of `timezone` from UTC at `instantUtc`, in minutes east of UTC
 * (Asia/Kolkata → 330, America/New_York in summer → −240).
 *
 * Implemented by formatting the instant in the target zone and reading the
 * wall clock back, which is the only DST-correct approach without a tz database.
 */
export function timezoneOffsetMinutes(timezone: string, instantUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instantUtc);

  const value = (type: "year" | "month" | "day" | "hour" | "minute" | "second"): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour") % 24, // some engines format midnight as hour 24
    value("minute"),
    value("second"),
  );
  return Math.round((asUtc - instantUtc.getTime()) / 60_000);
}

/**
 * UTC instant for a local wall-clock date (`YYYY-MM-DD`) and minute-of-day in
 * `timezone`. Two passes so a DST change inside the day still resolves.
 */
export function localWallClockToUtc(date: string, minutes: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
  }
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + minutes * 60_000;

  let instant = new Date(naive - timezoneOffsetMinutes(timezone, new Date(naive)) * 60_000);
  const offset = timezoneOffsetMinutes(timezone, instant);
  const corrected = naive - offset * 60_000;
  if (corrected !== instant.getTime()) instant = new Date(corrected);
  return instant;
}

/** `8:00 AM` style clock label for a minute-of-day (12-hour, AM/PM).
 * Midnight (0 and 1440) renders as `12:00 AM`, noon as `12:00 PM`. */
export function formatClockTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1440);
  const h24 = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** `UTC+05:30` style label for a signed minute offset. */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `Asia/Kolkata (UTC+05:30)` — what the UI shows next to the time. */
export function formatTimezoneLabel(timezone: string, instantUtc: Date): string {
  return `${timezone} (${formatUtcOffset(timezoneOffsetMinutes(timezone, instantUtc))})`;
}

/**
 * IANA zone → conventional abbreviation for zones the product explicitly
 * supports. `Intl` short names are environment-dependent (this runtime emits
 * `GMT+5:30` where browsers emit `IST`), so the abbreviation users read is
 * pinned here instead of varying by runtime.
 */
const ZONE_ABBREVIATIONS: Record<string, string> = {
  "Asia/Kolkata": "IST",
  // Legacy IANA alias still reported as the system zone on some machines.
  "Asia/Calcutta": "IST",
};

/**
 * `10 Oct 2026 · 15:30 IST` — readable site date/time with the zone
 * abbreviation resolved for the ACTUAL zone (pinned abbreviations first,
 * `Intl` short names otherwise). Built from the selected date/time state,
 * never the machine clock or a hardcoded example.
 */
export function formatSiteDateTime(date: string, minutes: number, timezone: string): string {
  const instant = localWallClockToUtc(date, Math.round(minutes), timezone);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(instant);
  let zone = ZONE_ABBREVIATIONS[timezone];
  if (!zone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "short",
      }).formatToParts(instant);
      zone = parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
    } catch {
      zone = timezone;
    }
  }
  return `${datePart} · ${formatClockTime(minutes)} ${zone}`;
}
