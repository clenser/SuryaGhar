import { describe, expect, it } from "vitest";
import { formatScale, metersPerPixel } from "../components/workspace/StatusBar";
import { formatPlaceContext } from "../services/geocode";

describe("scale math", () => {
  it("uses latitude-corrected metres per pixel (not a flat constant)", () => {
    const equator = metersPerPixel(0, 10);
    const kolkata = metersPerPixel(22.57, 10);
    expect(kolkata).toBeLessThan(equator);
    expect(kolkata / equator).toBeCloseTo(Math.cos((22.57 * Math.PI) / 180), 4);
  });

  it("halves metres per pixel for each zoom level", () => {
    expect(metersPerPixel(22, 13) / metersPerPixel(22, 14)).toBeCloseTo(2, 6);
  });

  it("picks a round scale label and a bar width that fits the target size", () => {
    const { label, width } = formatScale(22.57, 16);
    expect(label).toMatch(/^\d+ m$/);
    // Smallest round step that is at least the target width, so the bar is never shorter than ~96px.
    expect(width).toBeGreaterThanOrEqual(96);
    expect(width).toBeLessThanOrEqual(96 * 2.6);
  });

  it("switches to kilometres for large scales", () => {
    expect(formatScale(22.57, 8).label).toMatch(/km$/);
  });
});

describe("place context formatting", () => {
  it("joins locality, state and country without repeating the name", () => {
    expect(
      formatPlaceContext({ name: "Salt Lake", locality: "Salt Lake", state: "West Bengal", country: "India", latitude: 0, longitude: 0, bounds: null }),
    ).toBe("West Bengal, India");
  });

  it("returns an empty string when there is no context", () => {
    expect(formatPlaceContext({ name: "X", locality: null, state: null, country: null, latitude: 0, longitude: 0, bounds: null })).toBe("");
  });
});
