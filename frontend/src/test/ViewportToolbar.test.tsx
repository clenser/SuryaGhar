/**
 * Tests for ViewportToolbar (SuryaGhar M3.6).
 *
 * Verifies that:
 * 1. ViewportToolbar renders horizontally with contextual tools.
 * 2. Sliding collapse toggle updates aria-expanded, button title, and inert state.
 * 3. Back to map button renders when onExitDesign is supplied and fires callback.
 * 4. Existing tool callbacks (X-ray, Reset view, tool change) remain functional.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewportToolbar } from "../components/3d/ViewportToolbar";

describe("ViewportToolbar sliding collapse and actions", () => {
  it("starts expanded with aria-expanded=true and toggles collapsed state", async () => {
    const onToolChange = vi.fn();
    const { container } = render(
      <ViewportToolbar
        activeTool="select"
        onToolChange={onToolChange}
        xrayActive={false}
        onToggleXray={vi.fn()}
        onResetView={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Collapse toolbar/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const track = container.querySelector(".viewport-toolbar__track");
    expect(track).toBeInTheDocument();
    expect(track).not.toHaveAttribute("inert");

    // Click toggle to collapse
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleName("Expand toolbar");
    expect(container.querySelector(".viewport-toolbar")).toHaveClass("is-collapsed");
    expect(track).toHaveAttribute("inert");

    // Click toggle to re-expand
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Collapse toolbar");
    expect(container.querySelector(".viewport-toolbar")).not.toHaveClass("is-collapsed");
    expect(track).not.toHaveAttribute("inert");
  });

  it("renders Back to map action and invokes callback when clicked", async () => {
    const onExitDesign = vi.fn();
    render(
      <ViewportToolbar
        activeTool="select"
        onToolChange={vi.fn()}
        xrayActive={false}
        onToggleXray={vi.fn()}
        onResetView={vi.fn()}
        onExitDesign={onExitDesign}
      />,
    );

    const backBtn = screen.getByRole("button", { name: "Back to map" });
    expect(backBtn).toBeInTheDocument();
    await userEvent.click(backBtn);
    expect(onExitDesign).toHaveBeenCalledTimes(1);
  });

  it("handles tool clicks, X-ray toggle, and Reset view", async () => {
    const onToolChange = vi.fn();
    const onToggleXray = vi.fn();
    const onResetView = vi.fn();

    render(
      <ViewportToolbar
        activeTool="select"
        onToolChange={onToolChange}
        xrayActive={false}
        onToggleXray={onToggleXray}
        onResetView={onResetView}
      />,
    );

    // Click Move tool
    const moveBtn = screen.getByRole("button", { name: /Move/i });
    await userEvent.click(moveBtn);
    expect(onToolChange).toHaveBeenCalledWith("move");

    // Click X-ray
    const xrayBtn = screen.getByRole("button", { name: "Toggle X-ray view" });
    await userEvent.click(xrayBtn);
    expect(onToggleXray).toHaveBeenCalledTimes(1);

    // Click Reset view
    const resetBtn = screen.getByRole("button", { name: "Reset camera to default view" });
    await userEvent.click(resetBtn);
    expect(onResetView).toHaveBeenCalledTimes(1);
  });
});
