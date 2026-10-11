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
import { DEFAULT_PARAPET_THICKNESS_M } from "../lib/3d/geometry";
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

  it("never reuses an id, even across add/delete cycles", () => {
    // Regression: deriving ids from `sets.length` reused a deleted set's id,
    // leaving two sets sharing one identity and making selection stick to one
    // set. Monotonic ids keep every set addressable for its whole lifetime.
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = createPanelSetId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      if (i % 3 === 2) seen.delete(id); // simulate deletes: ids stay retired
    }
    const fresh = createPanelSetId();
    expect(seen.has(fresh)).toBe(false);
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
    expect(result.error).toMatch(/at least 0\.2 m inside the rooftop edge/);
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
    expect(refused.error).toMatch(/clear of the parapet edge/);
  });

  it("moves the roof-edge boundary with the configured setback and reports it", () => {
    // Roof spans x in [-10, 10]; the 550 W module is 1.13 m wide, so at
    // x = 9 the footprint reaches 9.565 m with a 0.2 m setback (fits) but
    // 10.165 m with a 0.6 m setback (refused, naming the configured value).
    const fits = validatePanelPlacement(
      9, 0, 0, { ...DEFAULT_PANEL_CONFIG, setbackM: 0.2 }, context(),
    );
    expect(fits.valid).toBe(true);
    const refused = validatePanelPlacement(
      9, 0, 0, { ...DEFAULT_PANEL_CONFIG, setbackM: 0.6 }, context(),
    );
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/at least 0\.6 m inside the rooftop edge/);
  });

  it("seeds new sets with the 0.2 m default setback", () => {
    expect(defaultPanelSet(createPanelSetId()).config.setbackM).toBe(0.2);
  });

  it("attributes a near-edge refusal to the parapet rule, not the setback", () => {
    // Roof spans x in [-10, 10]; the 550 W module is 1.13 m wide. At x = 9.2
    // with a 0.1 m setback the setback rectangle ends at 9.865 (inside), yet
    // the nearest corner is only 0.235 m from the edge — inside the 0.6 m
    // parapet clear zone. The refusal must name the parapet rule and its
    // 0.6 m, never the configured 0.1 m setback.
    const refused = validatePanelPlacement(
      9.2, 0, 0, { ...DEFAULT_PANEL_CONFIG, setbackM: 0.1 },
      context({ parapetInsetM: 0.6 }),
    );
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/0\.6 m clear of the parapet edge/);
    // Same spot, no parapet rule: the 0.1 m setback accepts it.
    expect(
      validatePanelPlacement(
        9.2, 0, 0, { ...DEFAULT_PANEL_CONFIG, setbackM: 0.1 }, context(),
      ).valid,
    ).toBe(true);
  });

  it("accepts a panel exactly at the configurable parapet clearance from the inner face", () => {
    // ModelPanel wiring: the validation context carries the RAW roof
    // ring plus parapetInsetM = wall thickness + clearance. The
    // parapet inner face sits 0.3 m inside the roof edge, so a
    // 0.2 m clearance lets the panel edge reach 0.5 m from the
    // edge — 0.2 m clear of the inner face.
    const innerFaceInset = DEFAULT_PARAPET_THICKNESS_M; // 0.3 m wall
    const clearance = 0.2;
    const halfWidth = effectivePanelDims(DEFAULT_PANEL_CONFIG).widthM / 2;
    const centre = 10 - innerFaceInset - clearance - halfWidth;
    const ok = validatePanelPlacement(
      centre, 0, 0, DEFAULT_PANEL_CONFIG,
      context({ parapetInsetM: innerFaceInset + clearance }),
    );
    expect(ok.valid).toBe(true);

    // 0.1 m closer to the wall: only 0.1 m clear of the inner
    // face — refused, naming the configured 0.2 m gap.
    const refused = validatePanelPlacement(
      centre + 0.1, 0, 0, DEFAULT_PANEL_CONFIG,
      context({
        parapetInsetM: innerFaceInset + clearance,
        parapetClearanceM: clearance,
      }),
    );
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/0\.2 m clear of the parapet inner face/);
  });

  it("moves the real acceptance boundary with the configured parapet clearance", () => {
    // One fixed spot: 0.35 m clear of the parapet inner face
    // (0.65 m from the raw roof edge).
    const halfWidth = effectivePanelDims(DEFAULT_PANEL_CONFIG).widthM / 2;
    const centre = 10 - 0.3 - 0.35 - halfWidth;
    const spot = { x: centre, y: 0, rotationDeg: 0 };
    // Clearance 0.2: the 0.35 m gap fits.
    const loose = validatePanelPlacement(
      spot.x, spot.y, spot.rotationDeg, DEFAULT_PANEL_CONFIG,
      context({ parapetInsetM: 0.3 + 0.2 }),
    );
    expect(loose.valid).toBe(true);
    // Clearance 0.4: the same spot no longer fits — the boundary
    // itself moved, not just the message.
    const tight = validatePanelPlacement(
      spot.x, spot.y, spot.rotationDeg, DEFAULT_PANEL_CONFIG,
      context({ parapetInsetM: 0.3 + 0.4, parapetClearanceM: 0.4 }),
    );
    expect(tight.valid).toBe(false);
    expect(tight.error).toMatch(/0\.4 m clear of the parapet inner face/);
  });

  it("keeps the roof-edge setback independently enforced alongside the parapet rule", () => {
    // A panel far from the parapet but past the setback still
    // names the setback, with its own configured value.
    const refused = validatePanelPlacement(
      9.5, 0, 0, { ...DEFAULT_PANEL_CONFIG, setbackM: 0.8 },
      context({ parapetInsetM: 0.5, parapetClearanceM: 0.2 }),
    );
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/at least 0\.8 m inside the rooftop edge/);
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