import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_STORAGE_KEY, resolveInitialTheme, useTheme } from "../hooks/useTheme";
import { useBottomSheet, SHEET_SNAP_PX } from "../hooks/useBottomSheet";
import { ThemeToggle } from "../components/workspace/ThemeToggle";
import { SheetBar } from "../components/workspace/SheetBar";
import { StatusBar } from "../components/workspace/StatusBar";
import type { MapViewState } from "../types";

const view: MapViewState = {
  center: { lat: 22.5726, lng: 88.3639 },
  zoom: 15.5,
  bearing: 0,
  pitch: 0,
};

describe("Theme system", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
  });

  it("index.html applies the persisted theme before React mounts (no FOUC)", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain("suryaghar-theme");
    expect(html).toContain("dataset.theme");
    expect(html.indexOf("suryaghar-theme")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("defaults to light and the toggle switches to dark", async () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(resolveInitialTheme()).toBe("light");

    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists an explicit choice and restores it on a fresh mount", async () => {
    const first = render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    first.unmount();

    expect(resolveInitialTheme()).toBe("dark");
    render(<ThemeToggle />);
    // The effect re-applies data-theme after remount (FOUC script covers paint).
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("falls back to the OS preference only when nothing is stored", () => {
    expect(resolveInitialTheme()).toBe("light");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    expect(resolveInitialTheme()).toBe("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(resolveInitialTheme()).toBe("light");
  });

  it("useTheme toggle round-trips through light and dark", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});

describe("Bottom sheet state machine", () => {
  it("starts partially expanded and cycles collapsed -> partial -> expanded", () => {
    const { result } = renderHook(() => useBottomSheet("partial"));
    expect(result.current.sheet).toBe("partial");
    act(() => result.current.cycle());
    expect(result.current.sheet).toBe("expanded");
    act(() => result.current.cycle());
    expect(result.current.sheet).toBe("collapsed");
    act(() => result.current.cycle());
    expect(result.current.sheet).toBe("partial");
  });

  it("snaps by drag threshold in the right direction", () => {
    const { result } = renderHook(() => useBottomSheet("partial"));
    // Drag up (positive delta) expands.
    act(() => result.current.applyDrag(SHEET_SNAP_PX));
    expect(result.current.sheet).toBe("expanded");
    // Drag down collapses back through partial.
    act(() => result.current.applyDrag(-SHEET_SNAP_PX));
    expect(result.current.sheet).toBe("partial");
    act(() => result.current.applyDrag(-SHEET_SNAP_PX));
    expect(result.current.sheet).toBe("collapsed");
    // Collapsed + drag down stays collapsed; small drags do nothing.
    act(() => result.current.applyDrag(-SHEET_SNAP_PX));
    expect(result.current.sheet).toBe("collapsed");
    act(() => result.current.applyDrag(SHEET_SNAP_PX - 10));
    expect(result.current.sheet).toBe("collapsed");
  });
});

describe("SheetBar handle", () => {
  function Harness() {
    const s = useBottomSheet("partial");
    return (
      <SheetBar
        sheet={s.sheet}
        stageLabel="Select area"
        summary={s.sheet === "expanded" ? "12 panels · 5.04 kWp" : null}
        onCycle={s.cycle}
        onDragEnd={s.applyDrag}
      />
    );
  }

  it("cycles through states via the accessible button (tap/keyboard path)", () => {
    render(<Harness />);
    const handle = screen.getByRole("button", { name: "Expand results panel" });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Select area")).toBeInTheDocument();

    fireEvent.click(handle);
    expect(screen.getByRole("button", { name: "Collapse results panel" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("12 panels · 5.04 kWp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse results panel" }));
    expect(screen.getByRole("button", { name: "Show results panel" })).toHaveAttribute("aria-expanded", "false");
  });

  it("does not double-cycle when a tap synthesises pointerup then click", () => {
    render(<Harness />);
    const handle = screen.getByRole("button", { name: "Expand results panel" });
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerUp(handle, { clientY: 300, pointerId: 1 });
    // pointerUp already cycled partial -> expanded; the follow-up click must not.
    expect(screen.getByRole("button", { name: "Collapse results panel" })).toBeInTheDocument();
  });

  it("snaps on a decisive vertical drag", () => {
    render(<Harness />);
    const handle = screen.getByRole("button", { name: "Expand results panel" });
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientY: 240, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 220, pointerId: 1 });
    expect(screen.getByRole("button", { name: "Collapse results panel" })).toBeInTheDocument();
  });
});

describe("StatusBar mobile chip", () => {
  it("toggles the details row through aria-expanded on the summary button", () => {
    render(<StatusBar view={view} selectedName="Kolkata" />);
    const chip = screen.getByRole("button", { name: /Esri World Imagery/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".status-bar")).toHaveAttribute("data-open", "false");

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".status-bar")).toHaveAttribute("data-open", "true");
    expect(document.getElementById("status-details")).toBeInTheDocument();

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".status-bar")).toHaveAttribute("data-open", "false");
  });
});
