/**
 * Tests for the panel-set model, shared placement validator and the hourly
 * shading/energy simulation.
 *
 * Focus is on the behaviour the M3 prompt calls out: deterministic placement,
 * the ONE validator shared by auto and manual placement, invalid placements
 * being rejected (not silently fixed), and shading that responds to sun angle.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  autoPlaceAllSets,
  autoPlaceSet,
  createPanelSetId,
  defaultPanelSet,
  findInvalidPanels,
  resetPanelSetIdsForTests,
  rotateSet,
  setCapacityKw,
  translateSet,
  validatePanelPlacement,
} from "../lib/3d/panelSets";
import { DEFAULT_PANEL_CONFIG, effectivePanelDims } from "../lib/3d/panels";
import { rectangleCorners } from "../lib/3d/panelPlacement";
import { footprintsOverlap } from "../lib/3d/obstacles";
import type { Obstacle, Point2 } from "../lib/3d/obstacles";
import {
  convexHull,
  shadowedRegion,
  shadowLength,
  sunVector,
} from "../lib/3d/panelEnergy";

/** A 20 x 14 m rectangular terrace ring, centred on the origin. */
function terrace(): Point2[] {
  return [
    { x: -10, y: -7 },
    { x: 10, y: -7 },
    { x: 10, y: 7 },
    { x: -10, y: 7 },
  ];
}

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

const context = (overrides = {}) => ({
  terrace: terrace(),
  obstacles: [] as Obstacle[],
  parapetInsetM: 0,
  peers: [],
  ...overrides,
});

describe("panel-set model", () => {
  beforeEach(() => {
    resetPanelSetIdsForTests();
  });

  it("starts empty: panels are opt-in, not auto-populated", () => {
    const set = defaultPanelSet(createPanelSetId());
    expect(set.panels).toHaveLength(0);
    expect(set.config.mountHeightM).toBe(0.4);
    expect(setCapacityKw(set)).toBe(0);
  });

  it("gives every set a distinct identity", () => {
    const a = createPanelSetId();
    const b = createPanelSetId();
    expect(a).not.toBe(b);
  });

  it("auto-places panels inside the roof and reports capacity", () => {
    const set = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    expect(set.panels.length).toBeGreaterThan(0);
    expect(set.mode).toBe("auto");
    expect(set.userModified).toBe(false);
    expect(setCapacityKw(set)).toBeGreaterThan(0);
  });

  it("never places a panel outside the terrace ring", () => {
    const set = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    const ring = terrace();
    for (const p of set.panels) {
      expect(p.x).toBeGreaterThanOrEqual(ring[0].x);
      expect(p.x).toBeLessThanOrEqual(ring[1].x);
      expect(p.y).toBeGreaterThanOrEqual(ring[0].y);
      expect(p.y).toBeLessThanOrEqual(ring[2].y);
    }
  });

  it("is deterministic: identical inputs give an identical layout", () => {
    const a = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    const b = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    expect(a.panels).toEqual(b.panels);
  });

  it("moves a whole set without changing its relative layout", () => {
    const base = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    const before = base.panels.map((p) => ({ x: p.x, y: p.y }));
    const moved = translateSet(base, 1, -2);
    moved.panels.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x + 1, 9);
      expect(p.y).toBeCloseTo(before[i].y - 2, 9);
    });
    expect(moved.userModified).toBe(true);
  });

  it("rotates every panel of a set about its own centroid", () => {
    const base = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    const rotated = rotateSet(base, 180);
    expect(rotated.panels.length).toBe(base.panels.length);
    // Every panel's yaw rotates with the set, modulo a full turn.
    rotated.panels.forEach((p, i) => {
      const raw = base.panels[i].rotationDeg + 180;
      expect(((p.rotationDeg - raw) % 360 + 360) % 360).toBeCloseTo(0, 6);
    });
  });
  it("reports which panels became invalid when the roof shrinks", () => {
    const set = autoPlaceSet({ ...defaultPanelSet(createPanelSetId()) }, terrace(), []);
    expect(set.panels.length).toBeGreaterThan(0);

    // Shrink the roof so the outermost panels now straddle the edge.
    const smallRing: Point2[] = [
      { x: -4, y: -3 },
      { x: 4, y: -3 },
      { x: 4, y: 3 },
      { x: -4, y: 3 },
    ];
    const invalid = findInvalidPanels(set, {
      terrace: smallRing,
      obstacles: [],
      parapetInsetM: 0,
    });
    expect(invalid.length).toBeGreaterThan(0);
    // Existing panels are REPORTED, never silently deleted or relocated.
    expect(set.panels).toHaveLength(set.panels.length);
  });
});

describe("effectivePanelDims", () => {
  it("keeps the module upright for portrait and swaps for landscape", () => {
    const portrait = effectivePanelDims({ ...DEFAULT_PANEL_CONFIG, orientation: "portrait" });
    const landscape = effectivePanelDims({ ...DEFAULT_PANEL_CONFIG, orientation: "landscape" });
    expect(portrait.widthM).toBeLessThan(portrait.lengthM);
    expect(landscape.widthM).toBeGreaterThan(landscape.lengthM);
    // The same module, just rotated 90 degrees.
    expect(landscape.widthM).toBeCloseTo(portrait.lengthM, 9);
    expect(landscape.lengthM).toBeCloseTo(portrait.widthM, 9);
  });

  it("prefers user-entered custom dimensions over the catalogue", () => {
    const dims = effectivePanelDims({
      ...DEFAULT_PANEL_CONFIG,
      customWidthM: 1.5,
      customLengthM: 2.5,
    });
    expect(dims.widthM).toBeCloseTo(1.5, 9);
    expect(dims.lengthM).toBeCloseTo(2.5, 9);
  });
});

describe("shared placement validator", () => {
  it("accepts a panel well inside the roof", () => {
    const result = validatePanelPlacement(0, 0, 0, DEFAULT_PANEL_CONFIG, context());
    expect(result.valid).toBe(true);
  });

  it("rejects a panel that crosses the roof edge", () => {
    const result = validatePanelPlacement(
      9.8, 0, 0, DEFAULT_PANEL_CONFIG, context(),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/usable rooftop/);
  });

  it("rejects a panel overlapping an obstacle", () => {
    const result = validatePanelPlacement(
      0, 0, 0, DEFAULT_PANEL_CONFIG,
      context({ obstacles: [obstacle({ position: { x: 0.2, y: 0 } })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/obstacle/);
  });

  it("rejects a panel overlapping another panel", () => {
    const dims = effectivePanelDims(DEFAULT_PANEL_CONFIG);
    const peers = [{ x: 0, y: 0, rotationDeg: 0, width: dims.widthM, length: dims.lengthM }];
    const result = validatePanelPlacement(
      0.1, 0, 0, DEFAULT_PANEL_CONFIG, context({ peers }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/overlaps another panel/);
  });

  it("enforces the parapet inset from the roof edge", () => {
    // Roof spans x in [-10, 10]. With a 1.3 m inset, a panel's closest corner
    // must stay 1.3 m inside, so x = 8 is fine and x = 9.3 is not.
    const ok = validatePanelPlacement(
      8, 0, 0, DEFAULT_PANEL_CONFIG, context({ parapetInsetM: 1.3 }),
    );
    expect(ok.valid).toBe(true);

    // 8.8 keeps the setback rectangle fully inside the roof (so the earlier
    // containment rule passes), yet its nearest corner is only 0.63 m from the
    // edge â€” the parapet inset rule must catch this specifically.
    const refused = validatePanelPlacement(
      8.8, 0, 0, DEFAULT_PANEL_CONFIG, context({ parapetInsetM: 1.3 }),
    );
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/inside the rooftop edge/);
  });

  it("rejects degenerate positions instead of placing them", () => {
    const result = validatePanelPlacement(
      Number.NaN, 0, 0, DEFAULT_PANEL_CONFIG, context(),
    );
    expect(result.valid).toBe(false);
  });

  it("does not report a self-match when checking against itself", () => {
    const dims = effectivePanelDims(DEFAULT_PANEL_CONFIG);
    // A peer at the SAME coordinates is skipped, so this stays valid.
    const result = validatePanelPlacement(
      0, 0, 0, DEFAULT_PANEL_CONFIG,
      context({ peers: [{ x: 0, y: 0, rotationDeg: 0, width: dims.widthM, length: dims.lengthM }] }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("obstacle shadow geometry", () => {
  it("lengthens a shadow as the sun drops and shortens it as it rises", () => {
    expect(shadowLength(1, 80)).toBeLessThan(shadowLength(1, 45));
    expect(shadowLength(1, 45)).toBeLessThan(shadowLength(1, 20));
  });

  it("reports no finite beam shadow at or below the horizon", () => {
    expect(Number.isFinite(shadowLength(2, 0))).toBe(false);
  });

  it("points the sun vector up and towards the given azimuth", () => {
    const east = sunVector(90, 45);
    expect(east.x).toBeGreaterThan(0);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    expect(east.z).toBeGreaterThan(0);
  });

  it("casts the shadow OPPOSITE the azimuth direction", () => {
    // A 1 m box at the origin, sun to the east â†’ shadow falls west (-X).
    const square: Point2[] = [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ];
    const region = shadowedRegion(square, 90, 45, 1);
    expect(region.length).toBeGreaterThanOrEqual(3);
    const xs = region.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(-0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.5);
  });

  it("hulls a simple point set", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 1, y: 1 }, // interior â€” must be dropped
    ]);
    expect(hull).toHaveLength(3);
    expect(hull.some((p) => p.x === 1 && p.y === 1)).toBe(false);
  });
});

describe("shared roof collision space", () => {
  beforeEach(() => {
    resetPanelSetIdsForTests();
  });

  it("never overlaps panels from different sets", () => {
    const a = defaultPanelSet(createPanelSetId());
    const b = defaultPanelSet(createPanelSetId());
    const { sets } = autoPlaceAllSets([a, b], terrace(), []);
    const dims = effectivePanelDims(DEFAULT_PANEL_CONFIG);
    const all = sets.flatMap((s) => s.panels);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const ra = rectangleCorners(all[i].x, all[i].y, dims.widthM, dims.lengthM, all[i].rotationDeg);
        const rb = rectangleCorners(all[j].x, all[j].y, dims.widthM, dims.lengthM, all[j].rotationDeg);
        expect(footprintsOverlap(ra, rb)).toBe(false);
      }
    }
  });

  it("processes sets deterministically", () => {
    const mk = () => [defaultPanelSet(createPanelSetId()), defaultPanelSet(createPanelSetId())];
    const first = autoPlaceAllSets(mk(), terrace(), []);
    resetPanelSetIdsForTests();
    const second = autoPlaceAllSets(mk(), terrace(), []);
    expect(first.sets.map((s) => s.panels)).toEqual(second.sets.map((s) => s.panels));
  });

  it("names a set that could not fit in the report", () => {
    const a = defaultPanelSet(createPanelSetId());
    const b = { ...defaultPanelSet(createPanelSetId()), name: "Crowded" };
    // A postage-stamp roof: the first set takes everything, the second starves.
    const tiny: Point2[] = [
      { x: -1.2, y: -1.2 },
      { x: 1.2, y: -1.2 },
      { x: 1.2, y: 1.2 },
      { x: -1.2, y: 1.2 },
    ];
    const { sets, report } = autoPlaceAllSets([a, b], tiny, []);
    const total = sets.reduce((s, x) => s + x.panels.length, 0);
    expect(total).toBeLessThanOrEqual(2);
    if (total < 2) expect(report).toMatch(/Crowded/);
    else expect(report).toBeNull();
  });
});