/**
 * Tests for GoogleMapView initialization resilience:
 * - Initializes without throwing when google.maps.MapTypeId is undefined (modular/weekly API)
 * - Safe fallback to string literal mapTypeId ("satellite", "hybrid", "roadmap")
 * - Sets draggableCursor to "crosshair" in drawing mode and null when not drawing
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { GoogleMapView } from "../components/map/GoogleMapView";

describe("GoogleMapView initialization & cursor resilience", () => {
  let mockMapInstance: {
    addListener: ReturnType<typeof vi.fn>;
    getCenter: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
    getHeading: ReturnType<typeof vi.fn>;
    getTilt: ReturnType<typeof vi.fn>;
    setOptions: ReturnType<typeof vi.fn>;
    setMapTypeId: ReturnType<typeof vi.fn>;
  };

  let mockMapConstructor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockMapInstance = {
      addListener: vi.fn(() => {
        // Return dummy listener
        return { remove: vi.fn() };
      }),
      getCenter: vi.fn(() => ({ lat: () => 22.5726, lng: () => 88.3639 })),
      getZoom: vi.fn(() => 18),
      getHeading: vi.fn(() => 0),
      getTilt: vi.fn(() => 0),
      setOptions: vi.fn(),
      setMapTypeId: vi.fn(),
    };

    mockMapConstructor = vi.fn().mockImplementation(() => mockMapInstance);

    // Mock window.google WITHOUT MapTypeId to replicate the runtime condition
    // where importLibrary("maps") has resolved but MapTypeId is undefined
    const fakeGoogle = {
      maps: {
        Map: mockMapConstructor,
        MapTypeId: undefined, // Simulating undefined MapTypeId
        event: {
          addListenerOnce: vi.fn((_instance, event, cb) => {
            if (event === "idle") {
              setTimeout(cb, 0);
            }
          }),
          removeListener: vi.fn(),
        },
      },
    };

    (window as unknown as { google: unknown }).google = fakeGoogle;
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_MAPS_API_KEY = "test-key";
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { google?: unknown }).google;
    vi.restoreAllMocks();
  });

  const testLayers = {
    satelliteOpacity: 1,
    contextOpacity: 0,
    buildings3d: false,
    terrain: false,
    terrainExaggeration: 1,
  };

  it("initializes successfully even when google.maps.MapTypeId is undefined", async () => {
    const onViewChange = vi.fn();
    const onReady = vi.fn();
    const onMapError = vi.fn();

    render(
      <GoogleMapView
        layers={testLayers}
        selectionMode="idle"
        vertices={[]}
        onViewChange={onViewChange}
        onReady={onReady}
        onMapError={onMapError}
      />
    );

    // Give microtasks time to execute loadGoogleMaps resolution
    await vi.waitFor(() => {
      expect(mockMapConstructor).toHaveBeenCalled();
    });

    // Check options passed to constructor
    const ctorOptions = mockMapConstructor.mock.calls[0][1];
    expect(ctorOptions.mapTypeId).toBe("satellite");
    expect(onMapError).not.toHaveBeenCalled();
  });

  it("sets draggableCursor to crosshair during drawing mode", async () => {
    const { rerender } = render(
      <GoogleMapView
        layers={testLayers}
        selectionMode="idle"
        vertices={[]}
        onViewChange={vi.fn()}
        onMapError={vi.fn()}
      />
    );

    await vi.waitFor(() => {
      expect(mockMapConstructor).toHaveBeenCalled();
    });

    // Rerender with selectionMode="drawing"
    rerender(
      <GoogleMapView
        layers={testLayers}
        selectionMode="drawing"
        vertices={[]}
        onViewChange={vi.fn()}
        onMapError={vi.fn()}
      />
    );

    expect(mockMapInstance.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ draggableCursor: "crosshair" })
    );

    // Rerender back to confirmed / idle
    rerender(
      <GoogleMapView
        layers={testLayers}
        selectionMode="confirmed"
        vertices={[]}
        onViewChange={vi.fn()}
        onMapError={vi.fn()}
      />
    );

    expect(mockMapInstance.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ draggableCursor: null })
    );
  });
});
