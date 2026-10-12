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

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
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

  it("returns window.google directly if already present on window with a valid Map constructor", async () => {
    const fakeGoogle = { maps: { Map: vi.fn() } };
    (window as unknown as { google: unknown }).google = fakeGoogle;

    const res = await loadGoogleMaps();
    expect(res).toBe(fakeGoogle);
    expect(importLibrary).not.toHaveBeenCalled();
  });

  it("does not short-circuit when window.google.maps exists as a bootstrap stub without a Map constructor", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test_key_abc123";

    // Replicate @googlemaps/js-api-loader v2 setOptions() synchronous bootstrap stub:
    // setOptions() creates window.google = { maps: { importLibrary } } before the script loads.
    vi.mocked(setOptions).mockImplementation(() => {
      (window as unknown as { google: unknown }).google = {
        maps: { importLibrary: vi.fn() },
      };
    });

    const MockMapCtor = vi.fn();
    let resolveImport!: (lib: google.maps.MapsLibrary) => void;
    vi.mocked(importLibrary).mockReturnValue(
      new Promise<google.maps.MapsLibrary>((resolve) => {
        resolveImport = resolve;
      }),
    );

    // Call 1 (e.g., first mount in React StrictMode) triggers setOptions -> creates stub
    const call1 = loadGoogleMaps();
    expect((window as unknown as { google?: { maps?: { Map?: unknown } } }).google?.maps).toBeDefined();
    expect((window as unknown as { google?: { maps?: { Map?: unknown } } }).google?.maps?.Map).toBeUndefined();

    // Call 2 (e.g., second mount in React StrictMode) must NOT short-circuit with the stub!
    const call2 = loadGoogleMaps();
    expect(call2).toBe(call1);

    resolveImport({ Map: MockMapCtor } as unknown as google.maps.MapsLibrary);

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(res1.maps.Map).toBe(MockMapCtor);
    expect(res2.maps.Map).toBe(MockMapCtor);
    expect(typeof res2.maps.Map).toBe("function");
  });

  it("uses the MapsLibrary return value from importLibrary('maps') and attaches Map constructor", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test_key_abc123";

    const MockMapCtor = vi.fn();
    const MockPolygonCtor = vi.fn();
    vi.mocked(importLibrary).mockResolvedValueOnce({
      Map: MockMapCtor,
      Polygon: MockPolygonCtor,
    } as unknown as google.maps.MapsLibrary);

    const result = await loadGoogleMaps();
    expect(result.maps.Map).toBe(MockMapCtor);
    expect(result.maps.Polygon).toBe(MockPolygonCtor);
    expect((window as unknown as { google: typeof google }).google.maps.Map).toBe(MockMapCtor);
  });

  it("rejects cleanly when importLibrary('maps') resolves without a valid Map constructor and allows retry", async () => {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test_key_abc123";

    // First attempt: importLibrary resolves with an empty/invalid library object
    vi.mocked(importLibrary).mockResolvedValueOnce({} as unknown as google.maps.MapsLibrary);

    await expect(loadGoogleMaps()).rejects.toThrow(/without a valid Map constructor/i);

    // Second attempt: valid Map constructor succeeds
    const MockMapCtor = vi.fn();
    vi.mocked(importLibrary).mockResolvedValueOnce({
      Map: MockMapCtor,
    } as unknown as google.maps.MapsLibrary);

    const recovered = await loadGoogleMaps();
    expect(recovered.maps.Map).toBe(MockMapCtor);
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
