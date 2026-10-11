/**
 * Panel configuration tests: representative dimensions, rated power, the kWp
 * formula and configuration validation (Phase 5).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONFIG,
  MOUNTING_TYPES,
  PANEL_TYPES,
  effectiveColSpacingM,
  effectiveRowSpacingM,
  formatCapacity,
  panelTypeDefinition,
  totalCapacityKw,
  validatePanelConfig,
} from "../lib/3d/panels";

describe("panel types", () => {
  it("exposes 450 W, 550 W and 600 W with plausible metric dimensions", () => {
    expect(PANEL_TYPES.map((p) => p.watts)).toEqual([450, 550, 600]);
    for (const type of PANEL_TYPES) {
      expect(type.widthM).toBeGreaterThan(0.5);
      expect(type.widthM).toBeLessThan(2);
      expect(type.lengthM).toBeGreaterThan(1);
      expect(type.lengthM).toBeLessThan(3);
      expect(type.thicknessM).toBeGreaterThan(0);
      // Power is an independent field — never derived from the dimensions.
      expect(type.watts).toBeGreaterThan(0);
    }
  });

  it("looks definitions up by id with a safe fallback", () => {
    expect(panelTypeDefinition("panel-450w").watts).toBe(450);
    expect(panelTypeDefinition("panel-600w").watts).toBe(600);
    expect(panelTypeDefinition("nope" as never).watts).toBe(550);
  });

  it("offers exactly three mounting types", () => {
    expect(MOUNTING_TYPES.map((m) => m.type)).toEqual(["flat", "tilted", "shed"]);
    expect(MOUNTING_TYPES.map((m) => m.label)).toEqual([
      "Flat Roof",
      "Tilted Roof",
      "Shed",
    ]);
  });
});

describe("totalCapacityKw", () => {
  it("calculates count × watts / 1000", () => {
    expect(totalCapacityKw(10, 550)).toBeCloseTo(5.5, 10);
    expect(totalCapacityKw(3, 600)).toBeCloseTo(1.8, 10);
    expect(totalCapacityKw(1, 450)).toBeCloseTo(0.45, 10);
    expect(totalCapacityKw(0, 600)).toBe(0);
  });

  it("is linear in the panel count", () => {
    expect(totalCapacityKw(7, 450)).toBeCloseTo(7 * totalCapacityKw(1, 450), 10);
  });

  it("formats as kWp with two decimals", () => {
    expect(formatCapacity(totalCapacityKw(10, 550))).toBe("5.50 kWp");
  });
});

describe("validatePanelConfig", () => {
  it("accepts the default configuration", () => {
    expect(validatePanelConfig(DEFAULT_PANEL_CONFIG)).toBeNull();
  });

  it("rejects out-of-range or non-numeric values", () => {
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, tiltDeg: 90 })).toMatch(/Tilt/);
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, tiltDeg: -5 })).toMatch(/Tilt/);
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, azimuthDeg: -1 })).toMatch(/Azimuth/);
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, spacingM: 12 })).toMatch(/Spacing/);
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, setbackM: 9 })).toMatch(/Setback/);
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, tiltDeg: Number.NaN })).toMatch(
      /valid number/,
    );
  });

  it("accepts boundary values", () => {
    expect(
      validatePanelConfig({
        ...DEFAULT_PANEL_CONFIG,
        tiltDeg: 60,
        azimuthDeg: 360,
        spacingM: 0,
        setbackM: 0,
      }),
    ).toBeNull();
  });

  it("accepts unset frame fields and validates explicit ones", () => {
    // Null row/column gaps follow the shared spacing; null count is uncapped.
    expect(validatePanelConfig(DEFAULT_PANEL_CONFIG)).toBeNull();
    expect(
      validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, rowSpacingM: 0.4, colSpacingM: 0.1 }),
    ).toBeNull();
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, rowSpacingM: 12 })).toMatch(
      /Row spacing/,
    );
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, colSpacingM: -1 })).toMatch(
      /Column spacing/,
    );
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, legCount: 6 })).toBeNull();
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, legCount: 5 as never })).toMatch(
      /legs/,
    );
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, maxPanels: 12 })).toBeNull();
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, maxPanels: 0 })).toMatch(
      /Panel count/,
    );
    expect(validatePanelConfig({ ...DEFAULT_PANEL_CONFIG, maxPanels: 2.5 })).toMatch(
      /whole number/,
    );
  });

  it("resolves effective row/column spacing from the shared spacing", () => {
    expect(effectiveRowSpacingM(DEFAULT_PANEL_CONFIG)).toBe(DEFAULT_PANEL_CONFIG.spacingM);
    expect(effectiveColSpacingM(DEFAULT_PANEL_CONFIG)).toBe(DEFAULT_PANEL_CONFIG.spacingM);
    expect(
      effectiveRowSpacingM({ ...DEFAULT_PANEL_CONFIG, rowSpacingM: 0.9 }),
    ).toBe(0.9);
    expect(
      effectiveColSpacingM({ ...DEFAULT_PANEL_CONFIG, colSpacingM: 0.05 }),
    ).toBe(0.05);
  });
});
