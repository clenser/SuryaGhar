import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapToolbar } from "../components/map/MapToolbar";

const BASE = {
  mode: "idle" as const,
  hasVertices: false,
  measureOn: true,
  onSelect: () => {},
  onEdit: () => {},
  onClear: () => {},
  onMeasure: () => {},
};

describe("MapToolbar", () => {
  it("wires every tool to its handler", async () => {
    const handlers = { onSelect: vi.fn(), onEdit: vi.fn(), onClear: vi.fn(), onMeasure: vi.fn() };
    render(<MapToolbar {...BASE} mode="confirmed" hasVertices onMeasure={handlers.onMeasure} onSelect={handlers.onSelect} onEdit={handlers.onEdit} onClear={handlers.onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onMeasure).toHaveBeenCalledTimes(1);
  });

  it("disables drawing-state and empty-state actions appropriately", () => {
    const { unmount } = render(<MapToolbar {...BASE} mode="drawing" />);
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Measure" })).toBeEnabled();
    unmount();
    render(<MapToolbar {...BASE} mode="idle" hasVertices={false} />);
    expect(screen.getByRole("button", { name: "Select" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("reflects the active tool and measure toggle state", () => {
    render(<MapToolbar {...BASE} mode="editing" hasVertices measureOn={false} />);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Measure" })).toHaveAttribute("aria-pressed", "false");
  });
});
