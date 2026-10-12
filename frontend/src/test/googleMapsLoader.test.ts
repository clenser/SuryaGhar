/**
 * Tests for googleMapsLoader:
 * - Missing API key detection
 * - Successful loader initialization
 * - Error classification (blocked by client vs network vs missing key)
 * - Safe retry after failure without corrupting state or duplicating scripts
 * - No duplicate loader initialization on remount
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@googlemaps/js-api-loader", () => {
  return {
    setOptions: vi.fn(),
    importLibrary: vi.fn(),
  };
});

import { importLibrary } from "@googlemaps/js-api-loader";
import {
  classifyGoogleMapsError,
  getGoogleMapsApiKey,
  loadGoogleMaps,
  resetGoogleMapsLoaderForTests,
} from "../services/googleMapsLoader";

describe("googleMapsLoader unit and regression suite", () => {
  const originalEnv = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const originalGoogle = (window as unknown as { google?: unknown }).google;

  beforeEach(() => {
    resetGoogleMapsLoaderForTests();
    vi.clearAllMocks();
    delete (window as unknown as { google?: unknown }).google;
  });

  afterEach(() => {
    resetGoogleMapsLoaderForTests();
    (window as unknown as { google?: unknown }).google = originalGoogle;
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("handles missing API key cleanly with actionable error", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "";
    expect(getGoogleMapsApiKey()).toBe("");

    await expect(loadGoogleMaps()).rejects.toThrow(/API key is missing/i);
  });

  it("classifies ERR_BLOCKED_BY_CLIENT / ad blocker errors without mislabeling as invalid key", () => {
    const blockedErr = new Error("net::ERR_BLOCKED_BY_CLIENT at https://maps.googleapis.com/maps/api/js");
    const classified = classifyGoogleMapsError(blockedErr);

    expect(classified.failureKind).toBe("blocked");
    expect(classified.message).toMatch(/blocked by the browser or an extension/i);
    expect(classified.message).not.toMatch(/API key is invalid/i);
  });

  it("classifies script load failure from @googlemaps/js-api-loader as blocked/network without blaming API key", () => {
    const scriptFail = new Error("The Google Maps JavaScript API could not load.");
    const classified = classifyGoogleMapsError(scriptFail);

    expect(classified.failureKind).toBe("blocked");
    expect(classified.message).toMatch(/could not load/i);
    expect(classified.message).toMatch(/ad blocker or privacy shield/i);
  });

  it("classifies missing key error as missing-key", () => {
    const missingErr = new Error("Google Maps API key is missing. Please set VITE_GOOGLE_MAPS_API_KEY");
    const classified = classifyGoogleMapsError(missingErr);

    expect(classified.failureKind).toBe("missing-key");
  });

  it("returns window.google directly if already present on window without calling loader", async () => {
    const fakeGoogle = { maps: { Map: vi.fn() } };
    (window as unknown as { google: unknown }).google = fakeGoogle;

    const res = await loadGoogleMaps();
    expect(res).toBe(fakeGoogle);
    expect(importLibrary).not.toHaveBeenCalled();
  });

  it("does not poison retry after a failed load attempt", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test_key_abc123";

    // Simulate importLibrary failing on first attempt
    vi.mocked(importLibrary).mockRejectedValueOnce(new Error("The Google Maps JavaScript API could not load."));

    // First attempt fails
    await expect(loadGoogleMaps()).rejects.toThrow(/could not load/);

    // Provide mock google for the second attempt
    const mockGoogle = { maps: { Map: vi.fn(), importLibrary: vi.fn() } };
    vi.mocked(importLibrary).mockImplementationOnce(async () => {
      (window as unknown as { google: unknown }).google = mockGoogle;
      return mockGoogle as unknown as typeof google.maps;
    });

    // Second attempt (retry) succeeds without being locked by stale rejected promise
    const result = await loadGoogleMaps();
    expect(result).toBe(mockGoogle);
  });

  it("deduplicates concurrent loadGoogleMaps calls into a single in-flight promise", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test_key_abc123";

    const mockGoogle = { maps: { Map: vi.fn(), importLibrary: vi.fn() } };
    let resolveFn: () => void;
    const promise = new Promise<typeof google.maps>((resolve) => {
      resolveFn = () => {
        (window as unknown as { google: unknown }).google = mockGoogle;
        resolve(mockGoogle as unknown as typeof google.maps);
      };
    });

    vi.mocked(importLibrary).mockReturnValue(promise);

    const call1 = loadGoogleMaps();
    const call2 = loadGoogleMaps();

    // Verify both calls returned the identical promise instance
    expect(call1).toBe(call2);

    resolveFn!();
    const [res1, res2] = await Promise.all([call1, call2]);
    expect(res1).toBe(mockGoogle);
    expect(res2).toBe(mockGoogle);
  });
});
