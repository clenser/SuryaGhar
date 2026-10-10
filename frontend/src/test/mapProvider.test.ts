/**
 * Map-provider state machine: readiness watch, visible countdown, backup
 * readiness and retry — all with mocked providers (fake timers), never by
 * disrupting a live browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_COUNTDOWN_S,
  GOOGLE_READY_TIMEOUT_MS,
  MAPLIBRE_READY_TIMEOUT_MS,
  beginGoogleWatch,
  ensureProviderWatch,
  failGoogleWatch,
  failMapProvider,
  getMapProviderCountdown,
  getMapProviderError,
  getMapProviderState,
  markGoogleReady,
  markMapLibreReady,
  resetMapProviderForTests,
  retryMapProvider,
} from "../services/mapProvider";

beforeEach(() => {
  vi.useFakeTimers();
  resetMapProviderForTests();
});

afterEach(() => {
  resetMapProviderForTests();
  vi.useRealTimers();
});

describe("map provider state machine", () => {
  it("google-ready before the timeout cancels the fallback entirely", () => {
    beginGoogleWatch();
    expect(getMapProviderState()).toBe("google-loading");
    vi.advanceTimersByTime(2000);
    markGoogleReady();
    expect(getMapProviderState()).toBe("google-ready");
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS + 10_000);
    expect(getMapProviderState()).toBe("google-ready"); // no countdown ever
    expect(getMapProviderCountdown()).toBe(0);
  });

  it("readiness timeout starts the 5…1 countdown, then mounts MapLibre", () => {
    beginGoogleWatch();
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS);
    expect(getMapProviderState()).toBe("fallback-countdown");
    expect(getMapProviderCountdown()).toBe(FALLBACK_COUNTDOWN_S);
    for (let expected = FALLBACK_COUNTDOWN_S - 1; expected >= 1; expected -= 1) {
      vi.advanceTimersByTime(1000);
      expect(getMapProviderCountdown()).toBe(expected);
    }
    vi.advanceTimersByTime(1000);
    expect(getMapProviderState()).toBe("maplibre-loading");
  });

  it("a definitive Google failure counts down immediately, without the 5s wait", () => {
    beginGoogleWatch();
    vi.advanceTimersByTime(100); // barely started
    failGoogleWatch("Google Maps rejected the API key (authentication failed).");
    expect(getMapProviderState()).toBe("fallback-countdown");
    expect(getMapProviderCountdown()).toBe(FALLBACK_COUNTDOWN_S);
    expect(getMapProviderError()).toMatch(/API key/);
  });

  it("StrictMode double-mount keeps a single watch (one countdown, right phase)", () => {
    beginGoogleWatch();
    beginGoogleWatch(); // second mount: idempotent
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS);
    expect(getMapProviderState()).toBe("fallback-countdown");
    expect(getMapProviderCountdown()).toBe(FALLBACK_COUNTDOWN_S);
  });

  it("backup map reaches maplibre-ready and stays there", () => {
    beginGoogleWatch();
    failGoogleWatch("loader failed");
    vi.advanceTimersByTime(FALLBACK_COUNTDOWN_S * 1000);
    expect(getMapProviderState()).toBe("maplibre-loading");
    markMapLibreReady();
    expect(getMapProviderState()).toBe("maplibre-ready");
    vi.advanceTimersByTime(MAPLIBRE_READY_TIMEOUT_MS + 5000);
    expect(getMapProviderState()).toBe("maplibre-ready");
  });

  it("backup timeout reports map-error and retry restarts with Google", () => {
    beginGoogleWatch();
    failGoogleWatch("loader failed");
    vi.advanceTimersByTime(FALLBACK_COUNTDOWN_S * 1000);
    expect(getMapProviderState()).toBe("maplibre-loading");
    vi.advanceTimersByTime(MAPLIBRE_READY_TIMEOUT_MS);
    expect(getMapProviderState()).toBe("map-error");
    retryMapProvider();
    expect(getMapProviderState()).toBe("google-loading");
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS);
    expect(getMapProviderState()).toBe("fallback-countdown"); // fresh watch armed
  });

  it("direct fatal backup failure maps to map-error without waiting", () => {
    beginGoogleWatch();
    failGoogleWatch("loader failed");
    vi.advanceTimersByTime(FALLBACK_COUNTDOWN_S * 1000);
    failMapProvider("Backup map could not be created.");
    expect(getMapProviderState()).toBe("map-error");
    expect(getMapProviderError()).toMatch(/could not be created/);
  });

  it("late or duplicate signals cannot corrupt the state", () => {
    beginGoogleWatch();
    failGoogleWatch("first failure");
    failGoogleWatch("second failure"); // ignored — already counting down
    expect(getMapProviderError()).toBe("first failure");
    markGoogleReady(); // ignored — past google-loading
    expect(getMapProviderState()).toBe("fallback-countdown");
    markMapLibreReady(); // ignored — not maplibre-loading yet
    expect(getMapProviderState()).toBe("fallback-countdown");
  });

  it("soft mount preserves terminal provider states (design-mode return)", () => {
    beginGoogleWatch();
    markGoogleReady();
    ensureProviderWatch();
    expect(getMapProviderState()).toBe("google-ready"); // no fresh cycle
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS + 5000);
    expect(getMapProviderState()).toBe("google-ready"); // no watch armed
  });

  it("soft mount preserves an active backup map", () => {
    beginGoogleWatch();
    failGoogleWatch("loader failed");
    vi.advanceTimersByTime(FALLBACK_COUNTDOWN_S * 1000);
    markMapLibreReady();
    ensureProviderWatch();
    expect(getMapProviderState()).toBe("maplibre-ready");
  });

  it("soft mount arms a watch only when none is live", () => {
    resetMapProviderForTests(); // google-loading, no timer yet
    ensureProviderWatch();
    vi.advanceTimersByTime(GOOGLE_READY_TIMEOUT_MS);
    expect(getMapProviderState()).toBe("fallback-countdown"); // armed
  });
});
