/**
 * Deterministic placement-density tests (MASTER FIX §5).
 *
 * These assert the *arrangement*, not just the count: the clear gap between
 * adjacent panel edges must equal the configured spacing, smaller spacing must
 * never reduce the count, and portrait/landscape swap the footprint.
 */

import { describe, expect, it } from "vitest";
import {
  placePanels,
  rectangleCorners,
} from "../lib/3d/panelPlacement";
import { DEFAULT_PANEL_CONFIG, effectivePanelDims } from "../lib/3d/panels";
import type { Obstacle, Point2 } from "../lib/3d/obstacles";
import {
  footprintInsidePolygon,
  footprintsOverlap,
  obstacleFootprint,
  polygonsOverlap,
} from "../lib/3d/obstacles";

/** A 20 x 14 m rectangular terrace ring, centred on the origin. */
function terrace(): Point2[] {
  return [
    { x: -10, y: -7 },
    { x: 10, y: -7 },
    { x: 10, y: 7 },
    { x: -10, y: 7 },
  ];
}

function config(overrides: Record<string, unknown> = {}) {
  return { ...DEFAULT_PANEL_CONFIG, ...overrides };
}

/** Separating gap between two rectangles along the axis they differ on. */
function edgeGap(a: Point2[], b: Point2[]): number {
  const axs = a.map((p) => p.x);
  const bxs = b.map((p) => p.x);
  const dx = Math.max(Math.min(...bxs) - Math.max(...axs), Math.min(...axs) - Math.max(...bxs));
  const ays = a.map((p) => p.y);
  const bys = b.map((p) => p.y);
  const dy = Math.max(Math.min(...bys) - Math.max(...ays), Math.min(...ays) - Math.max(...bys));
  return Math.max(dx, dy);
}

describe("placement density", () => {
  it("places a dense regular grid on a rectangular roof", () => {
    const result = placePanels({ terrace: terrace(), obstacles: [], config: config() });
    expect(result.panels.length).toBeGreaterThan(8);

    for (const panel of result.panels) {
      const dims = effectivePanelDims(config());
      const rect = rectangleCorners(panel.x, panel.y, dims.widthM, dims.lengthM, panel.rotationDeg);
      expect(footprintInsidePolygon(rect, terrace())).toBe(true);
    }
  });

  it("keeps the gap between adjacent panel edges equal to the spacing", () => {
    // Azimuth 180 -> the array runs along X, so the clear gap between
    // neighbouring panels in a row is exactly `spacingM`.
    const spacing = 0.25;
    const result = placePanels({
      terrace: terrace(),
      obstacles: [],
      config: config({ spacingM: spacing }),
    });
    expect(result.panels.length).toBeGreaterThan(1);

    const rows = new Map<number, number[]>();
    for (const p of result.panels) {
      const key = Math.round(p.y * 100);
      rows.set(key, [...(rows.get(key) ?? []), p.x]);
    }
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      const dims = effectivePanelDims(config());
      for (let i = 1; i < xs.length; i++) {
        const gap = edgeGap(
          rectangleCorners(xs[i - 1], 0, dims.widthM, dims.lengthM, 0),
          rectangleCorners(xs[i], 0, dims.widthM, dims.lengthM, 0),
        );
        expect(gap).toBeCloseTo(spacing, 6);
      }
    }
  });

  it("never overlaps two panels", () => {
    const result = placePanels({ terrace: terrace(), obstacles: [], config: config() });
    const dims = effectivePanelDims(config());
    for (let i = 0; i < result.panels.length; i++) {
      for (let j = i + 1; j < result.panels.length; j++) {
        const a = rectangleCorners(
          result.panels[i].x, result.panels[i].y, dims.widthM, dims.lengthM, result.panels[i].rotationDeg,
        );
        const b = rectangleCorners(
          result.panels[j].x, result.panels[j].y, dims.widthM, dims.lengthM, result.panels[j].rotationDeg,
        );
        expect(footprintsOverlap(a, b)).toBe(false);
      }
    }
  });

  it("never overlaps an obstacle, including custom polygons", () => {
    const ring: Point2[] = [
      { x: -3, y: -2 },
      { x: 3, y: -3 },
      { x: 2, y: 3 },
      { x: -4, y: 2 },
    ];
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const obstacle: Obstacle = {
      id: "custom-1",
      type: "custom",
      position: { x: cx, y: cy },
      width: 7,
      length: 6,
      height: 1,
      rotation: 0,
      polygon: ring.map((p) => ({ x: p.x - cx, y: p.y - cy })),
    };
    const result = placePanels({
      terrace: terrace(),
      obstacles: [obstacle],
      config: config(),
    });
    const duty = obstacleFootprint(obstacle);
    for (const panel of result.panels) {
      const dims = effectivePanelDims(config());
      const rect = rectangleCorners(panel.x, panel.y, dims.widthM, dims.lengthM, panel.rotationDeg);
      expect(polygonsOverlap(rect, duty)).toBe(false);
    }
  });

  it("places at least as many panels as spacing shrinks", () => {
    const wide = placePanels({ terrace: terrace(), obstacles: [], config: config({ spacingM: 0.3 }) });
    const tight = placePanels({ terrace: terrace(), obstacles: [], config: config({ spacingM: 0.05 }) });
    expect(tight.panels.length).toBeGreaterThanOrEqual(wide.panels.length);
  });

  it("is deterministic for identical inputs", () => {
    const a = placePanels({ terrace: terrace(), obstacles: [], config: config() });
    const b = placePanels({ terrace: terrace(), obstacles: [], config: config() });
    expect(a.panels).toEqual(b.panels);
  });

  it("swaps the footprint for landscape without changing the module", () => {
    const portrait = placePanels({ terrace: terrace(), obstacles: [], config: config({ orientation: "portrait" }) });
    const landscape = placePanels({ terrace: terrace(), obstacles: [], config: config({ orientation: "landscape" }) });
    const p = effectivePanelDims(config({ orientation: "portrait" }));
    const l = effectivePanelDims(config({ orientation: "landscape" }));
    expect(l.widthM).toBeCloseTo(p.lengthM, 9);
    expect(l.lengthM).toBeCloseTo(p.widthM, 9);
    expect(portrait.panels.length).toBeGreaterThan(4);
    expect(landscape.panels.length).toBeGreaterThan(4);
  });

  it("respects a concave roof boundary", () => {
    // An L-shaped roof: the block (0..10, -7..0) is missing.
    const concave: Point2[] = [
      { x: -10, y: -7 },
      { x: 10, y: -7 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 7 },
      { x: -10, y: 7 },
    ];
    const result = placePanels({ terrace: concave, obstacles: [], config: config() });
    for (const panel of result.panels) {
      const dims = effectivePanelDims(config());
      const rect = rectangleCorners(panel.x, panel.y, dims.widthM, dims.lengthM, panel.rotationDeg);
      expect(footprintInsidePolygon(rect, concave)).toBe(true);
    }
    const full = placePanels({ terrace: terrace(), obstacles: [], config: config() });
    expect(result.panels.length).toBeLessThan(full.panels.length);
  });
});
