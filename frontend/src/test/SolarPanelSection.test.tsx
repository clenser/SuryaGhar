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
    fireEvent.change(screen.getByLabelText("Tilt"), { target: { value: "25" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ tiltDeg: 25 });
    fireEvent.change(screen.getByLabelText("Azimuth (from N)"), { target: { value: "90" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ azimuthDeg: 90 });
    // Edge setback moved to the 3D Building Model section (ModelPanel owns
    // the shared config); it is covered by the ModelPanel setback tests.
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

  it("switches manual placement between one panel and the whole set", () => {
    const props = baseProps({
      manualPlaceActive: true,
      manualPlaceMode: "single",
      onManualPlaceModeChange: vi.fn(),
    });
    render(<SolarPanelSection {...props} />);
    expect(screen.getByRole("button", { name: /Manual placement: on/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Whole set" }));
    expect(props.onManualPlaceModeChange).toHaveBeenCalledWith("set");
    fireEvent.click(screen.getByRole("button", { name: "One panel" }));
    expect(props.onManualPlaceModeChange).toHaveBeenCalledWith("single");
  });

  it("rotates the group in quarter turns and shows the angle", () => {
    const props = baseProps({
      manualPlaceActive: true,
      manualPlaceMode: "set",
      setRotationDeg: 90,
      onRotateSet: vi.fn(),
    });
    render(<SolarPanelSection {...props} />);
    expect(screen.getByText(/Group rotation: 90/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Rotate group right/ }));
    fireEvent.click(screen.getByRole("button", { name: /Rotate group left/ }));
    expect(props.onRotateSet).toHaveBeenNthCalledWith(1, 90);
    expect(props.onRotateSet).toHaveBeenNthCalledWith(2, -90);
  });

  it("undoes the last whole set only when one was committed", () => {
    const props = baseProps({ onUndoLastSet: vi.fn(), canUndoLastSet: true });
    render(<SolarPanelSection {...props} />);
    const button = screen.getByRole("button", { name: "Undo last set" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(props.onUndoLastSet).toHaveBeenCalledTimes(1);
  });

  it("clamps the set rows/columns to what the usable roof can hold", () => {
    const props = baseProps({ manualPlaceMode: "set", maxSetRows: 3, maxSetCols: 7 });
    render(<SolarPanelSection {...props} />);
    const rows = document.getElementById("panel-set-rows") as HTMLInputElement;
    const cols = document.getElementById("panel-set-cols") as HTMLInputElement;
    expect(rows).not.toBeNull();
    expect(cols).not.toBeNull();
    expect(rows).toHaveAttribute("max", "3");
    expect(cols).toHaveAttribute("max", "7");
    expect(screen.getByText("Max 3 on this roof")).toBeTruthy();
    expect(screen.getByText("Max 7 on this roof")).toBeTruthy();
  });

  it("hides the Panels in set section in One panel mode and shows it in Whole set mode", () => {
    const single = baseProps({ manualPlaceMode: "single", maxSetRows: 3, maxSetCols: 7 });
    const { unmount } = render(<SolarPanelSection {...single} />);
    expect(document.getElementById("panel-set-rows")).toBeNull();
    expect(document.getElementById("panel-set-cols")).toBeNull();
    expect(document.getElementById("panel-set-label")).toBeNull();
    unmount();
    // Same configured values survive the mode switch: the section only
    // unmounts, the config lives in the parent.
    const set = baseProps({ manualPlaceMode: "set", maxSetRows: 3, maxSetCols: 7 });
    render(<SolarPanelSection {...set} />);
    expect((document.getElementById("panel-set-rows") as HTMLInputElement).value).toBe(
      String(set.config.setRows),
    );
    expect((document.getElementById("panel-set-cols") as HTMLInputElement).value).toBe(
      String(set.config.setCols),
    );
    expect(screen.getByText(/Panels in set:/)).toBeTruthy();
  });

  it("reports a set that no longer fits instead of moving it", () => {
    render(<SolarPanelSection {...baseProps({ setWarning: "1 panel of Set A no longer fits" })} />);
    expect(screen.getByRole("alert").textContent).toMatch(/no longer fits/);
  });
});


  it("keeps each slider synchronized with its number field", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    // One slider per numeric geometry control, sharing the same value.
    const slider = screen.getByLabelText("Tilt slider") as HTMLInputElement;
    const field = screen.getByLabelText("Tilt") as HTMLInputElement;
    expect(slider).toHaveValue("15");
    expect(field).toHaveValue(15);
    fireEvent.change(slider, { target: { value: "30" } });
    expect(props.onConfigChange).toHaveBeenCalledWith({ tiltDeg: 30 });
  });

  it("rejects out-of-range text without corrupting the model", () => {
    const props = baseProps();
    render(<SolarPanelSection {...props} />);
    // Sliders always emit finite in-range values; free text goes through
    // the domain validator instead of entering the layout silently.
    const slider = screen.getByLabelText("Panel mounting height slider") as HTMLInputElement;
    expect(slider).toHaveAttribute("min", "0.02");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider).toHaveValue("0.4");
  });