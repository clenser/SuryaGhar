/**
 * Satellite ground: slippy-map math, zoom selection and provider URL
 * building. Network fetch/stitch runs only in the browser; jsdom covers the
 * deterministic math that alignment depends on.
 */
import { describe, expect, it } from "vitest";
import {
  googleStaticMapUrl,
  groundTileUrl,
  latToTileY,
  lngToTileX,
  metresPerPixel,
  pickGroundZoom,
  tileXToLng,
  tileYToLat,
} from "../lib/3d/satelliteGround";

describe("satelliteGround tile math", () => {
  it("maps Kolkata to the known tile at zoom 14", () => {
    // Cross-checked against live map traffic: the MapLibre map requests
    // z14/y7136-7137 tiles for this area; x ≈ 12213.6, y ≈ 7137.0.
    expect(lngToTileX(88.3639, 14)).toBeCloseTo(12213.6, 0);
    expect(latToTileY(22.5726, 14)).toBeCloseTo(7137.0, 0);
  });

  it("round-trips tile edges through lng/lat", () => {
    const zoom = 17;
    const x = Math.floor(lngToTileX(88.3639, zoom));
    const y = Math.floor(latToTileY(22.5726, zoom));
    const west = tileXToLng(x, zoom);
    const east = tileXToLng(x + 1, zoom);
    const north = tileYToLat(y, zoom);
    const south = tileYToLat(y + 1, zoom);
    expect(west).toBeLessThan(88.3639);
    expect(east).toBeGreaterThan(88.3639);
    expect(north).toBeGreaterThan(22.5726);
    expect(south).toBeLessThan(22.5726);
    // Tile spans a few hundred metres at this zoom (rooftop scale).
    expect((east - west) * 111320 * Math.cos((22.5726 * Math.PI) / 180)).toBeLessThan(1000);
  });

  it("reports finer ground resolution at deeper zooms", () => {
    const coarse = metresPerPixel(22.5726, 14);
    const fine = metresPerPixel(22.5726, 18);
    expect(fine).toBeLessThan(coarse);
    expect(coarse / fine).toBeCloseTo(16, 6);
  });

  it("picks a deep zoom for a rooftop and a shallow one for a district", () => {
    const roof = pickGroundZoom(120, 22.5726);
    const district = pickGroundZoom(4000, 22.5726);
    expect(roof.zoom).toBeGreaterThan(district.zoom);
    expect(roof.zoom).toBeLessThanOrEqual(19);
    expect(roof.tiles * roof.tiles).toBeLessThanOrEqual(36);
  });

  it("builds tile URLs from the active provider template", () => {
    const url = groundTileUrl(12213, 7131, 14);
    expect(url).toContain("/14/7131/12213");
    expect(url).not.toMatch(/[{}]/);
  });

  it("builds Google Static Maps satellite URLs with center, zoom, and key", () => {
    const url = googleStaticMapUrl(22.5726, 88.3639, 19, "test-static-key");
    expect(url).toContain("https://maps.googleapis.com/maps/api/staticmap?");
    expect(url).toContain("maptype=satellite");
    expect(url).toContain("zoom=19");
    expect(url).toContain("key=test-static-key");
  });
});

