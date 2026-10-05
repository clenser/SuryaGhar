import { describe, expect, it } from "vitest";
import { buildMapStyle, IMAGERY_LAYER_ID, TERRAIN_SOURCE_ID } from "../components/map/mapStyle";
import { EsriWorldImagery } from "../providers/imagery";
import { AwsTerrariumTerrain } from "../providers/terrain";
import { BUILDINGS_LAYER_ID, getBasemapLayers } from "../providers/basemap";
import { INDIAN_TEST_SITES } from "../config/locations";

describe("imagery provider", () => {
  it("exposes source config and attribution behind the interface", () => {
    const provider = new EsriWorldImagery();
    const source = provider.getSourceConfig();
    expect(source.type).toBe("raster");
    expect(source.tiles[0]).toContain("{z}/{y}/{x}");
    expect(source.maxzoom).toBe(19);
    expect(provider.getAttribution()).toMatch(/Esri/);
  });

  it("flags the anonymous Esri endpoint as prototype-only (AGENTS.md section 4)", () => {
    expect(new EsriWorldImagery().getCoverageInfo().prototypeOnly).toBe(true);
  });

  it("never claims imagery is higher resolution than native zoom", () => {
    const notes = new EsriWorldImagery().getCoverageInfo().notes.toLowerCase();
    expect(notes).toContain("blur");
    expect(notes).not.toContain("high resolution");
  });
});

describe("terrain provider", () => {
  it("records resolution limits and avoids building-height claims", () => {
    const coverage = new AwsTerrariumTerrain().getCoverage();
    expect(coverage.maxZoom).toBeGreaterThan(0);
    expect(coverage.resolutionNote.toLowerCase()).toContain("too coarse");
  });

  it("uses terrarium encoding for raster-dem", () => {
    expect(new AwsTerrariumTerrain().getEncoding()).toBe("terrarium");
  });
});

describe("map style", () => {
  it("builds a valid v8 style with imagery, OSM context, and DEM sources", () => {
    const style = buildMapStyle();
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources)).toEqual(expect.arrayContaining(["imagery", "osm-context", TERRAIN_SOURCE_ID]));
    const imageryLayer = style.layers.find((l) => l.id === IMAGERY_LAYER_ID);
    expect(imageryLayer?.type).toBe("raster");
  });

  it("contains no secret-like values and no provider keys", () => {
    const serialised = JSON.stringify(buildMapStyle()).toLowerCase();
    expect(serialised).not.toContain("groq");
    expect(serialised).not.toMatch(/api[_-]?key|token=|secret/);
  });

  it("starts with 3D buildings hidden", () => {
    const building = getBasemapLayers().find((l) => l.id === BUILDINGS_LAYER_ID);
    expect(building?.layout).toEqual({ visibility: "none" });
  });

  it("uses the terrain tile URLs supplied by the terrain provider", () => {
    const style = buildMapStyle();
    const dem = style.sources[TERRAIN_SOURCE_ID] as { tiles: string[] };
    expect(dem.tiles).toEqual(new AwsTerrariumTerrain().getTileUrls());
  });
});

describe("Indian test sites", () => {
  it("covers the mandated locations and all sit inside India's bounding box", () => {
    const labels = INDIAN_TEST_SITES.map((s) => s.label);
    for (const required of ["Kolkata", "Kalna", "New Delhi", "Mumbai", "Bengaluru"]) {
      expect(labels).toContain(required);
    }
    for (const site of INDIAN_TEST_SITES) {
      expect(site.place.latitude).toBeGreaterThan(6);
      expect(site.place.latitude).toBeLessThan(37);
      expect(site.place.longitude).toBeGreaterThan(68);
      expect(site.place.longitude).toBeLessThan(98);
      expect(site.place.country).toBe("India");
    }
  });
});
