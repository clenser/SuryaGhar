import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {} }));

import { compassShort, measureFC, panelCellsFC } from "../components/map/MapView";
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

  it("measures real edge lengths and area from selection geometry", () => {
    // ~22.4 m x ~18.7 m rectangle near Kolkata.
    const vertices = [
      { lng: 88.3639, lat: 22.5726 },
      { lng: 88.36413, lat: 22.5726 },
      { lng: 88.36413, lat: 22.57277 },
      { lng: 88.3639, lat: 22.57277 },
    ];
    const { labels, ticks } = measureFC(vertices);
    const texts = labels.features.map((f) => (f.properties as { label: string }).label);
    // Four edge pills plus one central area pill.
    expect(labels.features).toHaveLength(5);
    expect(ticks.features).toHaveLength(4);
    expect(texts.filter((t) => t.endsWith(" m") && !t.includes("m²"))).toHaveLength(4);
    expect(texts.some((t) => t.includes("m²"))).toBe(true);
    const edgeValues = texts
      .filter((t) => t.endsWith(" m") && !t.includes("m²"))
      .map((t) => parseFloat(t));
    // Opposite edges agree (rectangle) and match real metre scale.
    const sorted = [...edgeValues].sort((a, b) => a - b);
    expect(sorted[0]).toBeGreaterThan(15);
    expect(sorted[0]).toBeLessThan(22);
    expect(sorted[3]).toBeGreaterThan(20);
    expect(sorted[3]).toBeLessThan(26);
    expect(Math.abs(sorted[0] - sorted[1]) / sorted[0]).toBeLessThan(0.02);
    expect(Math.abs(sorted[2] - sorted[3]) / sorted[2]).toBeLessThan(0.02);
  });

  it("emits nothing measurable for degenerate selections", () => {
    const { labels, ticks } = measureFC([
      { lng: 88.3639, lat: 22.5726 },
      { lng: 88.364, lat: 22.5726 },
    ]);
    expect(labels.features).toHaveLength(0);
    expect(ticks.features).toHaveLength(0);
  });
});
