/**
 * Tests for manual panel-SET placement: the rows-by-columns block, its
 * atomic validation and the roof-derived size limits.
 *
 * The prompt requirements covered here:
 *  - a configured N x M group is committed as ONE set (10 panels from a
 *    2 x 5 configuration with a single confirmation),
 *  - rows and columns follow the panel orientation and spacing,
 *  - maximum feasible rows/columns respond to the usable roof dimensions,
 *  - irregular roofs, parapet clearance, obstacles and already-placed sets
 *    reject a set, and rejection is atomic (nothing is committed),
 *  - group rotation positions the block as expected.
 */

import { describe, expect, it } from "vitest";
import { maxSetGrid, setBlockPanels, validateSetPlacement } from "../lib/3d/panelSets";
import {
  DEFAULT_PANEL_CONFIG,
  effectiveColSpacingM,
  effectivePanelDims,
  effectiveRowSpacingM,
  type PanelLayoutConfig,
} from "../lib/3d/panels";
import type { Obstacle, Point2 } from "../lib/3d/obstacles";

/** Axis-aligned rectangle ring, centred unless offsets are given. */
function rect(w: number, h: number, cx = 0, cy = 0): Point2[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

const config = (patch: Partial<PanelLayoutConfig> = {}): PanelLayoutConfig => ({
  ...DEFAULT_PANEL_CONFIG,
  ...patch,
});

/** A roof large enough for any configuration used below. */
const bigRoof = () => rect(60, 40);

function obstacle(o: Partial<Obstacle> = {}): Obstacle {
  return {
    id: "o1",
    type: "hvac",
    position: { x: 0, y: 0 },
    width: 2,
    length: 1.5,
    height: 0.8,
    rotation: 0,
    ...o,
  };
}

const ctx = (overrides: Partial<Parameters<typeof validateSetPlacement>[4]> = {}) => ({
  terrace: bigRoof(),
  obstacles: [] as Obstacle[],
  parapetInsetM: 0,
  peers: [],
  ...overrides,
});

describe("setBlockPanels", () => {
  it("places a 2 x 5 group as exactly ten panels", () => {
    const panels = setBlockPanels(config({ setRows: 2, setCols: 5 }), 0, 0, 0);
    expect(panels).toHaveLength(10);
  });

  it("places a 1 x 4 group as exactly four panels", () => {
    const panels = setBlockPanels(config({ setRows: 1, setCols: 4 }), 0, 0, 0);
    expect(panels).toHaveLength(4);
  });

  it("places a 3 x 3 group as exactly nine panels", () => {
    const panels = setBlockPanels(config({ setRows: 3, setCols: 3 }), 0, 0, 0);
    expect(panels).toHaveLength(9);
  });

  it("commits exactly rows x columns panels for any valid size", () => {
    // The number of panels a click commits must follow the configuration:
    // the same function feeds the preview, the validator and the commit.
    for (const [rows, cols] of [[1, 1], [1, 6], [2, 5], [3, 3], [4, 4], [5, 2]] as const) {
      const cfg = config({ setRows: rows, setCols: cols });
      const panels = setBlockPanels(cfg, 0, 0, 0);
      expect(panels).toHaveLength(rows * cols);
      const result = validateSetPlacement(0, 0, 0, cfg, ctx());
      if (result.valid) expect(result.panels).toHaveLength(rows * cols);
    }
  });

  it("ignores the mounting height: geometry never moves a placed set", () => {
    // Mounting height is a rendered-support detail only. Changing it must not
    // reposition, add or remove a committed set.
    const low = setBlockPanels(config({ mountHeightM: 0.2 }), 2, -1, 30);
    const high = setBlockPanels(config({ mountHeightM: 2 }), 2, -1, 30);
    expect(high).toEqual(low);
  });

  it("steps columns along the width axis and rows along the length axis", () => {
    const cfg = config({ setRows: 2, setCols: 3, colSpacingM: 0.4, rowSpacingM: 0.6 });
    const dims = effectivePanelDims(cfg);
    const panels = setBlockPanels(cfg, 0, 0, 0);
    expect(panels).toHaveLength(6);

    const pitchX = dims.widthM + effectiveColSpacingM(cfg); // 1.13 + 0.4
    const pitchY = dims.lengthM + effectiveRowSpacingM(cfg); // 2.28 + 0.6
    const xs = [...new Set(panels.map((p) => Math.round(p.x * 1e6) / 1e6))].sort((a, b) => a - b);
    const ys = [...new Set(panels.map((p) => Math.round(p.y * 1e6) / 1e6))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(2);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(pitchX, 9);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(pitchY, 9);
    // Centred: without centring the group would drift off the anchor.
    expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(0, 9);
    expect((ys[0] + ys[ys.length - 1]) / 2).toBeCloseTo(0, 9);
  });

  it("follows the portrait/landscape orientation for both pitches", () => {
    const portrait = effectivePanelDims(config({ orientation: "portrait" }));
    const landscape = effectivePanelDims(config({ orientation: "landscape" }));
    expect(portrait.widthM).toBeCloseTo(1.13, 9);
    expect(portrait.lengthM).toBeCloseTo(2.28, 9);
    expect(landscape.widthM).toBeCloseTo(2.28, 9);
    expect(landscape.lengthM).toBeCloseTo(1.13, 9);

    const wide = setBlockPanels(config({ orientation: "landscape", setRows: 1, setCols: 3 }), 0, 0, 0);
    const spread = Math.max(...wide.map((p) => p.x)) - Math.min(...wide.map((p) => p.x));
    expect(spread).toBeCloseTo(2 * (landscape.widthM + effectiveColSpacingM(config())), 9);
  });

  it("rotates the whole group about its centre", () => {
    const cfg = config({ setRows: 1, setCols: 3 });
    const dims = effectivePanelDims(cfg);
    const pitchX = dims.widthM + effectiveColSpacingM(cfg);
    const panels = setBlockPanels(cfg, 0, 0, 90);
    // A quarter turn swaps the axes: the column pitch now runs along +Y and
    // the group keeps its centred anchor, with the same magnitude.
    const xs = [...new Set(panels.map((p) => Math.round(p.x * 1e6) / 1e6))];
    const ys = [...new Set(panels.map((p) => Math.round(p.y * 1e6) / 1e6))];
    expect(xs).toHaveLength(1);
    expect(ys).toHaveLength(3);
    for (const p of panels) {
      expect(p.rotationDeg).toBe(90);
      expect(Math.abs(p.x)).toBeCloseTo(0, 9);
      expect(p.y).toBeCloseTo(Math.round(p.y / pitchX) * pitchX, 9);
    }
  });
});

describe("validateSetPlacement", () => {
  it("commits the whole configured group when it fits", () => {
    const result = validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), ctx());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.panels).toHaveLength(10);
  });

  it("rejects the entire set when the anchor is not finite", () => {
    const result = validateSetPlacement(Number.NaN, 0, 0, config(), ctx());
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toMatch(/number/i);
  });

  it("reports the exact reason rather than silently clamping", () => {
    const result = validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), {
      ...ctx(),
      terrace: rect(4, 4),
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBeTruthy();
  });

  it("rejects a set that crosses an irregular roof edge", () => {
    // L-shaped roof: the north-east quadrant is missing, so a group placed
    // near the top right would hang outside the footprint.
    const l: Point2[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 10 },
    ];
    const result = validateSetPlacement(7, 7, 0, config({ setRows: 1, setCols: 5 }), ctx({ terrace: l }));
    expect(result.valid).toBe(false);
    // And the same group is accepted away from the missing quadrant.
    const ok = validateSetPlacement(-5, -5, 0, config({ setRows: 1, setCols: 5 }), ctx({ terrace: l }));
    expect(ok.valid).toBe(true);
  });

  it("rejects a set that would touch the parapet clearance", () => {
    // A 9 x 9 roof leaves the outermost panel corner only 1.28 m from the
    // edge: fine for a 1 m clearance, refused for 1.5 m.
    const roof = rect(9, 9);
    expect(
      validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), ctx({ terrace: roof, parapetInsetM: 1 })).valid,
    ).toBe(true);
    const result = validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), ctx({ terrace: roof, parapetInsetM: 1.5 }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toMatch(/parapet|edge/i);
  });

  it("rejects a set that overlaps an obstacle", () => {
    const result = validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), {
      ...ctx(),
      obstacles: [obstacle({ width: 6, length: 4 })],
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toMatch(/obstacle/i);
  });

  it("rejects a set that overlaps panels from another set", () => {
    const dims = effectivePanelDims(config());
    const peers = [{ x: 0, y: 0, rotationDeg: 0, width: dims.widthM, length: dims.lengthM }];
    const result = validateSetPlacement(0, 0, 0, config({ setRows: 2, setCols: 5 }), {
      ...ctx(),
      peers,
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toMatch(/another panel/i);
  });

  it("never commits a partially invalid set", () => {
    // The last column would fall off the roof: every panel is rejected either
    // way, and the caller must receive zero panels to place.
    const result = validateSetPlacement(4.6, 0, 0, config({ setRows: 1, setCols: 5 }), {
      ...ctx(),
      terrace: rect(10, 20),
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected rejection");
    const nested = setBlockPanels(config({ setRows: 1, setCols: 5 }), 4.6, 0, 0);
    expect(nested).toHaveLength(5); // positions exist, but must NOT be committed
  });

  it("accepts a rotated group on a roof that only fits it rotated", () => {
    // 20 m wide but only 4 m deep: a 5-row x 2-column group does not fit
    // flat (its rows run along the short axis) but fits a quarter turn on.
    const cfg = config({ setRows: 5, setCols: 2, setbackM: 0 });
    const roof = rect(20, 4);
    expect(validateSetPlacement(0, 0, 0, cfg, ctx({ terrace: roof })).valid).toBe(false);
    expect(validateSetPlacement(0, 0, 90, cfg, ctx({ terrace: roof })).valid).toBe(true);
  });
});

describe("maxSetGrid", () => {
  it("derives the row/column ceilings from the usable roof extents", () => {
    const cfg = config({ setRows: 1, setCols: 1 });
    const dims = effectivePanelDims(cfg);
    const pitchX = dims.widthM + effectiveColSpacingM(cfg);
    const pitchY = dims.lengthM + effectiveRowSpacingM(cfg);
    const limits = maxSetGrid(cfg, 20, 14);
    expect(limits.maxCols).toBe(Math.floor((20 + 0.2) / pitchX));
    expect(limits.maxRows).toBe(Math.floor((14 + 0.2) / pitchY));
  });

  it("responds to per-axis spacing and to a shrinking roof", () => {
    const base = config({ setRows: 1, setCols: 1 });
    const wide = config({ setRows: 1, setCols: 1, colSpacingM: 1 });
    expect(maxSetGrid(wide, 20, 14).maxCols).toBeLessThan(maxSetGrid(base, 20, 14).maxCols);

    const tight = maxSetGrid(base, 3, 2);
    expect(tight.maxCols).toBeGreaterThanOrEqual(1);
    expect(tight.maxRows).toBe(0); // 2 m cannot hold a 2.28 m row plus spacing
  });

  it("returns zero rather than a negative count when nothing fits", () => {
    const tiny = maxSetGrid(config({ setRows: 1, setCols: 1 }), 0.5, 0.5);
    expect(tiny.maxRows).toBe(0);
    expect(tiny.maxCols).toBe(0);
  });
});
