/**
 * SolarPanelSection tests (Phase 5): rating and mounting selectors, geometry
 * controls, recalculate action, capacity readout and the zero-panel warning.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SolarPanelSection } from "../components/3d/SolarPanelSection";
import { DEFAULT_PANEL_CONFIG, type PanelLayoutConfig } from "../lib/3d/panels";

type Overrides = Partial<Parameters<typeof SolarPanelSection>[0]>;

function baseProps(overrides: Overrides = {}) {
  const config: PanelLayoutConfig = DEFAULT_PANEL_CONFIG;
  return {
    config,
    onConfigChange: vi.fn<(patch: Partial<PanelLayoutConfig>) => void>(),
    onRecalculate: vi.fn(),
    panelCount: 42,
    capacityKw: 23.1,
    warning: null as string | null,
    ...overrides,
  };
}

describe("SolarPanelSection", () => {
  it("offers all three ratings but Flat Roof as the only mounting type", () => {
    render(<SolarPanelSection {...baseProps()} />);
    for (const label of ["450 W", "550 W", "600 W"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(label) }).length).toBe(1);
    }
    expect(screen.getAllByRole("button", { name: /^Flat Roof/ }).length).toBe(1);
    expect(screen.queryByRole("button", { name: /^Tilted Roof/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Shed/ })).toBeNull();
  });

  it("shows the count, per-panel rating and total capacity", () => {
    render(<SolarPanelSection {...baseProps({ capacityKw: 23.1 })} />);
    expect(screen.getByRole("output").textContent).toMatch(/42 × 550 W/);
    expect(screen.getByRole("output").textContent).toMatch(/23\.10 kWp/);
  });

  it("emits a partial config patch when a rating is picked", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^450 W/ }));
    expect(props.onConfigChange).toHaveBeenCalledWith({ panelTypeId: "panel-450w" });
  });

  it("keeps Flat Roof selected when its (only) mounting button is pressed", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^Flat Roof/ }));
    expect(props.onConfigChange).toHaveBeenCalledWith({ mounting: "flat" });
  });

  it("emits numeric patches from the geometry fields", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    fireEvent.change(screen.getByLabelText(/Tilt/), { target: { value: "25" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ tiltDeg: 25 });
    fireEvent.change(screen.getByLabelText(/Azimuth/), { target: { value: "90" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ azimuthDeg: 90 });
    fireEvent.change(screen.getByLabelText(/setback/i), { target: { value: "0.8" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ setbackM: 0.8 });
  });

  it("calls the recalculate action", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Recalculate/ }));
    expect(props.onRecalculate).toHaveBeenCalledTimes(1);
  });

  it("surfaces the zero-panel warning", () => {
    render(
      <SolarPanelSection
        {...baseProps({ panelCount: 0, capacityKw: 0, warning: "Roof is too small" })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Roof is too small/);
    expect(screen.getByRole("output").textContent).toMatch(/0 × 550 W|0.00 kWp/);
  });
});
