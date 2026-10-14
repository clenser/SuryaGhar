import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetMapProviderForTests } from "../services/mapProvider";

// jsdom does not implement createObjectURL; maplibre-gl calls it at module
// init (it sets a Blob worker URL) as soon as the backup map module loads.
if (typeof URL !== "undefined" && typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:jsdom-test-worker";
  URL.revokeObjectURL = () => {};
}

// Three.js GLTFExporter references global FileReader
if (typeof FileReader === "undefined" && typeof window !== "undefined" && window.FileReader) {
  (globalThis as any).FileReader = window.FileReader;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The map-provider store is module-level (one authority by design); clear
  // its timers between tests so a countdown in one test never leaks into the
  // next render.
  resetMapProviderForTests();
});

// jsdom does not implement these; components rely on them for sizing and scroll behaviour.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Global Google Maps mock for Vitest / JSDOM environment
function createGoogleMapsMock() {
  class LatLng {
    latVal: number;
    lngVal: number;
    constructor(lat: number, lng: number) {
      this.latVal = lat;
      this.lngVal = lng;
    }
    lat() {
      return this.latVal;
    }
    lng() {
      return this.lngVal;
    }
  }

  class LatLngBounds {
    constructor(
      public sw?: { lat: number; lng: number },
      public ne?: { lat: number; lng: number }
    ) {}
  }

  class Map {
    center = new LatLng(22.5726, 88.3639);
    zoom = 13;
    heading = 0;
    tilt = 0;
    mapTypeId = "satellite";

    constructor(public container: HTMLElement, public opts?: Record<string, unknown>) {
      if (opts?.center) {
        const c = opts.center as { lat: number; lng: number };
        this.center = new LatLng(c.lat, c.lng);
      }
      if (typeof opts?.zoom === "number") this.zoom = opts.zoom;
    }

    getCenter() {
      return this.center;
    }
    getZoom() {
      return this.zoom;
    }
    getHeading() {
      return this.heading;
    }
    getTilt() {
      return this.tilt;
    }
    setCenter(c: LatLng | { lat: number; lng: number }) {
      this.center = c instanceof LatLng ? c : new LatLng(c.lat, c.lng);
    }
    setZoom(z: number) {
      this.zoom = z;
    }
    setHeading(h: number) {
      this.heading = h;
    }
    setTilt(t: number) {
      this.tilt = t;
    }
    setMapTypeId(id: string) {
      this.mapTypeId = id;
    }
    panTo(pos: { lat: number; lng: number }) {
      this.setCenter(pos);
    }
    fitBounds() {}
    addListener(_event: string, _handler: (...args: unknown[]) => void) {
      return { remove: () => {} };
    }
  }

  class Marker {
    constructor(public opts?: Record<string, unknown>) {}
    setMap() {}
    addListener() {
      return { remove: () => {} };
    }
  }

  class Polygon {
    constructor(public opts?: Record<string, unknown>) {}
    setPaths() {}
    setMap() {}
    setOptions() {}
    addListener() {
      return { remove: () => {} };
    }
  }

  class Polyline {
    constructor(public opts?: Record<string, unknown>) {}
    setPath() {}
    setMap() {}
    addListener() {
      return { remove: () => {} };
    }
  }

  class OverlayView {
    setMap() {}
    getPanes() {
      return { overlayMouseTarget: document.createElement("div") };
    }
    getProjection() {
      return {
        fromLatLngToDivPixel: () => ({ x: 0, y: 0 }),
      };
    }
    onAdd() {}
    draw() {}
    onRemove() {}
  }

  const event = {
    addListener: vi.fn((_obj, _evt, _cb) => ({ remove: vi.fn() })),
    addListenerOnce: vi.fn((_obj, _evt, cb) => {
      setTimeout(cb, 0);
      return { remove: vi.fn() };
    }),
    removeListener: vi.fn(),
  };

  return {
    maps: {
      Map,
      Marker,
      Polygon,
      Polyline,
      OverlayView,
      LatLng,
      LatLngBounds,
      MapTypeId: {
        SATELLITE: "satellite",
        HYBRID: "hybrid",
        ROADMAP: "roadmap",
        TERRAIN: "terrain",
      },
      SymbolPath: {
        CIRCLE: 0,
        FORWARD_CLOSED_ARROW: 1,
      },
      event,
    },
  };
}

(window as unknown as { google: unknown }).google = createGoogleMapsMock();
