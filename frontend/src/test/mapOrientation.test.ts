import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {} }));

import { compassShort, panelCellsFC } from "../components/map/MapView";
import type { FeatureCollection } from "geojson";

describe("panel orientation helpers", () => {
  it("maps backend azimuths to compass directions", () => {
    expect(compassShort(180)).toBe("S");
    expect(compassShort(170)).toBe("S");
    expect(compassShort(135)).toBe("SE");
    expect(compassShort(225)).toBe("SW");
    expect(compassShort(0)).toBe("N");
    expect(compassShort(360)).toBe("N");
    expect(compassShort(90)).toBe("E");
    expect(compassShort(270)).toBe("W");
  });

  it("derives cell divider lines inside each real panel footprint", () => {
    // ~10 m x ~5 m rectangle near Kolkata.
    const ring = [
      [88.3639, 22.5726],
      [88.364, 22.5726],
      [88.364, 22.57265],
      [88.3639, 22.57265],
      [88.3639, 22.5726],
    ];
    const fc = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
    } as unknown as FeatureCollection;
    const cells = panelCellsFC(fc);
    // Frame + longitudinal center + transverse dividers.
    expect(cells.features.length).toBeGreaterThanOrEqual(7);
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    for (const f of cells.features) {
      expect(f.geometry.type).toBe("LineString");
      const coords = (f.geometry as GeoJSON.LineString).coordinates;
      for (const [lng, lat] of coords) {
        expect(lng).toBeGreaterThanOrEqual(Math.min(...lngs) - 1e-9);
        expect(lng).toBeLessThanOrEqual(Math.max(...lngs) + 1e-9);
        expect(lat).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9);
        expect(lat).toBeLessThanOrEqual(Math.max(...lats) + 1e-9);
      }
    }
  });

  it("returns empty output for empty input", () => {
    expect(panelCellsFC(null).features).toHaveLength(0);
    expect(panelCellsFC({ type: "FeatureCollection", features: [] }).features).toHaveLength(0);
  });
});
