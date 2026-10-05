import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapControls } from "../components/map/MapControls";

const base = {
  bearing: 0,
  pitch: 0,
  layersOpen: false,
  terrainOn: false,
  buildingsOn: false,
  onLocate: () => {},
  onZoomIn: () => {},
  onZoomOut: () => {},
  onResetNorth: () => {},
  onTogglePitch: () => {},
  onToggleTerrain: () => {},
  onToggleLayers: () => {},
};

describe("MapControls", () => {
  it("wires every button to its handler", async () => {
    const handlers = { onLocate: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onTogglePitch: vi.fn(), onToggleTerrain: vi.fn(), onToggleLayers: vi.fn() };
    render(<MapControls {...base} {...handlers} />);
    await userEvent.click(screen.getByRole("button", { name: "Current position" }));
    expect(handlers.onLocate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Toggle 3D perspective" }));
    await userEvent.click(screen.getByRole("button", { name: "Toggle terrain relief" }));
    await userEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onTogglePitch).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleTerrain).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleLayers).toHaveBeenCalledTimes(1);
  });

  it("reports active state with aria-pressed, not colour alone", () => {
    render(<MapControls {...base} pitch={55} terrainOn />);
    expect(screen.getByRole("button", { name: "Toggle 3D perspective" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Toggle terrain relief" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disables north reset when the map is already facing north", () => {
    render(<MapControls {...base} bearing={0} />);
    expect(screen.getByRole("button", { name: "Map is facing north" })).toBeDisabled();
  });

  it("enables north reset after rotation", async () => {
    const onResetNorth = vi.fn();
    render(<MapControls {...base} bearing={37} onResetNorth={onResetNorth} />);
    const btn = screen.getByRole("button", { name: "Reset map to north" });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onResetNorth).toHaveBeenCalled();
  });
});
