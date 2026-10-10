/**
 * Site timezone tests.
 *
 * The simulation must follow the site's clock, not a hard-coded offset: the
 * country of the selected place picks a zone where it is unambiguous, DST is
 * resolved for the actual date, and everything degrades to the browser zone
 * rather than guessing.
 */

import { describe, expect, it } from "vitest";
import {
  FALLBACK_TIMEZONE,
  formatClockTime,
  formatSiteDateTime,
  formatTimezoneLabel,
  formatUtcOffset,
  isValidTimezone,
  localWallClockToUtc,
  resolveSiteTimezone,
  timezoneOffsetMinutes,
} from "../lib/solar/timezone";

describe("timezoneOffsetMinutes", () => {
  it("returns the fixed offset for India year-round", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(timezoneOffsetMinutes("Asia/Kolkata", winter)).toBe(330);
    expect(timezoneOffsetMinutes("Asia/Kolkata", summer)).toBe(330);
  });

  it("follows daylight saving for the actual date", () => {
    // US DST 2026: 8 March → 1 November.
    expect(timezoneOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(timezoneOffsetMinutes("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe(-240);
  });

  it("handles a zero offset", () => {
    expect(timezoneOffsetMinutes("UTC", new Date("2026-03-21T12:00:00Z"))).toBe(0);
  });
});

describe("localWallClockToUtc", () => {
  it("converts a Kolkata local time to the right UTC instant", () => {
    const instant = localWallClockToUtc("2026-03-21", 12 * 60, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-03-21T06:30:00.000Z");
  });

  it("resolves times on both sides of a DST transition", () => {
    // US spring-forward 2026-03-08 02:00 local.
    const before = localWallClockToUtc("2026-03-08", 60, "America/New_York"); // 01:00 EST
    expect(before.toISOString()).toBe("2026-03-08T06:00:00.000Z");

    const after = localWallClockToUtc("2026-03-08", 13 * 60, "America/New_York"); // 13:00 EDT
    expect(after.toISOString()).toBe("2026-03-08T17:00:00.000Z");
  });

  it("rejects a malformed date", () => {
    expect(() => localWallClockToUtc("", 0, "UTC")).toThrow(/YYYY-MM-DD/);
    expect(() => localWallClockToUtc("21/03/2026", 0, "UTC")).toThrow(/YYYY-MM-DD/);
  });
});

describe("resolveSiteTimezone", () => {
  it("maps a known single-zone country", () => {
    expect(resolveSiteTimezone("India")).toBe("Asia/Kolkata");
    expect(resolveSiteTimezone("  india ")).toBe("Asia/Kolkata");
    expect(resolveSiteTimezone("Bangladesh")).toBe("Asia/Dhaka");
  });

  it("falls back to the browser zone instead of assuming a shared offset", () => {
    const zone = resolveSiteTimezone("Atlantis");
    expect(isValidTimezone(zone)).toBe(true);

    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(zone).toBe(isValidTimezone(browserZone) ? browserZone : FALLBACK_TIMEZONE);
  });

  it("falls back for an unknown or missing country", () => {
    expect(resolveSiteTimezone(null)).toBe(resolveSiteTimezone(undefined));
    expect(resolveSiteTimezone("")).toBe(resolveSiteTimezone(undefined));
  });
});

describe("labels", () => {
  it("formats the clock in 12-hour AM/PM including the end of day", () => {
    expect(formatClockTime(0)).toBe("12:00 AM");
    expect(formatClockTime(8 * 60)).toBe("8:00 AM");
    expect(formatClockTime(12 * 60 + 30)).toBe("12:30 PM");
    expect(formatClockTime(16 * 60 + 30)).toBe("4:30 PM");
    expect(formatClockTime(1439)).toBe("11:59 PM");
    expect(formatClockTime(1440)).toBe("12:00 AM");
    expect(formatClockTime(1441)).toBe("12:00 AM"); // clamped, never wraps past midnight
  });

  it("formats signed UTC offsets", () => {
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
    expect(formatUtcOffset(-240)).toBe("UTC-04:00");
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
    expect(formatUtcOffset(-210)).toBe("UTC-03:30");
  });

  it("labels a zone with its offset for the simulated instant", () => {
    const label = formatTimezoneLabel("Asia/Kolkata", new Date("2026-03-21T06:30:00Z"));
    expect(label).toBe("Asia/Kolkata (UTC+05:30)");
  });

  it("formats an IST site date/time from selected state, not the machine clock", () => {
    expect(formatSiteDateTime("2026-10-10", 15 * 60 + 30, "Asia/Kolkata")).toBe(
      "10 Oct 2026 · 3:30 PM IST",
    );
    expect(formatSiteDateTime("2026-01-05", 8 * 60, "Asia/Kolkata")).toBe(
      "5 Jan 2026 · 8:00 AM IST",
    );
    expect(formatSiteDateTime("2026-01-05", 12 * 60, "Asia/Kolkata")).toBe(
      "5 Jan 2026 · 12:00 PM IST",
    );
  });

  it("uses the selected site zone for non-Indian locations, never a hardcoded IST", () => {
    const label = formatSiteDateTime("2026-03-21", 12 * 60, "America/New_York");
    expect(label).toContain("12:00");
    expect(label).not.toContain("IST");
    expect(label).toMatch(/EDT|EST|GMT-4/); // ICU short name varies by runtime
  });

  it("validates zone strings without throwing", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
});
