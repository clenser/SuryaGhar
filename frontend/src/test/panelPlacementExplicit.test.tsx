import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelPanel } from "../components/analysis/ModelPanel";
import type { LngLat, PolygonMetrics } from "../lib/geo";

const RECT_TERRACE: LngLat[] = [
  { lng: 88.3630, lat: 22.5720 },
  { lng: 88.3635, lat: 22.5720 },
  { lng: 88.3635, lat: 22.5725 },
  { lng: 88.3630, lat: 22.5725 },
];

const METRICS: PolygonMetrics = {
  areaM2: 500,
  perimeterM: 90,
  centroid: { lng: 88.36325, lat: 22.57225 },
  valid: true,
  issue: null,
};

function renderModelPanel(overrides: Partial<Parameters<typeof ModelPanel>[0]> = {}) {
  const props = {
    vertices: RECT_TERRACE,
    metrics: METRICS,
    siteCountry: "India",
    buildingHeight: 12,
    onSetHeight: vi.fn(),
    onContinue: vi.fn(),
    backendReady: true,
    ...overrides,
  };
  return render(<ModelPanel {...props} />);
}

describe("Feature 2 — Explicit User-Controlled Solar Panel Placement", () => {
  it("enabling solar panels does NOT automatically populate the roof", () => {
    renderModelPanel();

    const enableBtn = screen.getByRole("button", { name: "Enable solar panels" });
    expect(enableBtn).toBeInTheDocument();

    fireEvent.click(enableBtn);

    // Initial state after enabling: 0 panels placed
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();

    // Prominently presents explicit placement choices
    const prompt = screen.getByRole("region", { name: "Solar panel placement options" });
    expect(prompt).toBeInTheDocument();

    const autoPlaceBtn = screen.getByRole("button", { name: "Auto-Place Panels" });
    const manualPlaceBtn = screen.getByRole("button", { name: "Add Panel Manually" });
    expect(autoPlaceBtn).toBeInTheDocument();
    expect(manualPlaceBtn).toBeInTheDocument();
  });

  it("activating manual placement toggles mode without populating panels", () => {
    renderModelPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));

    const manualBtn = screen.getByRole("button", { name: "Add Panel Manually" });
    fireEvent.click(manualBtn);

    // Mode is active, but roof still has 0 panels
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();
  });

  it("explicitly clicking Auto-Place Panels places modules within usable roof area", () => {
    renderModelPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));

    const autoPlaceBtn = screen.getByRole("button", { name: "Auto-Place Panels" });
    fireEvent.click(autoPlaceBtn);

    // Panels are now populated
    const countEl = Array.from(document.querySelectorAll(".obstacle-count")).find((el) =>
      /^\d+ panels/.test(el.textContent ?? ""),
    );
    expect(countEl).toBeDefined();
    const count = parseInt(countEl?.textContent ?? "0", 10);
    expect(count).toBeGreaterThan(0);
  });

  it("warns user and requires confirmation before replacing an existing layout", () => {
    renderModelPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));

    // Initial explicit auto-place
    fireEvent.click(screen.getByRole("button", { name: "Auto-Place Panels" }));

    const getCount = (): number => {
      const el = Array.from(document.querySelectorAll(".obstacle-count")).find((node) =>
        /^\d+ panels/.test(node.textContent ?? ""),
      );
      return parseInt(el?.textContent ?? "0", 10);
    };

    const initialCount = getCount();
    expect(initialCount).toBeGreaterThan(0);

    // User clicks Auto-place set again
    const autoPlaceSetBtn = screen.getByRole("button", { name: "Auto-place set" });
    fireEvent.click(autoPlaceSetBtn);

    // Confirmation dialog must appear
    const dialog = screen.getByRole("dialog", { name: "Replace Existing Layout?" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Any custom layout adjustments will be overwritten/i)).toBeInTheDocument();

    // Clicking Cancel must dismiss dialog and preserve layout unchanged
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole("dialog", { name: "Replace Existing Layout?" })).toBeNull();
    expect(getCount()).toBe(initialCount);

    // Clicking Confirm Auto-Place proceeds with replacement
    fireEvent.click(autoPlaceSetBtn);
    expect(screen.getByRole("dialog", { name: "Replace Existing Layout?" })).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: "Confirm Auto-Place" });
    fireEvent.click(confirmBtn);
    expect(screen.queryByRole("dialog", { name: "Replace Existing Layout?" })).toBeNull();
    expect(getCount()).toBeGreaterThan(0);
  });

  it("disabling and re-enabling solar panels preserves placed layout without resetting or duplicating", () => {
    renderModelPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));

    // Place panels
    fireEvent.click(screen.getByRole("button", { name: "Auto-Place Panels" }));

    const getCount = (): number => {
      const el = Array.from(document.querySelectorAll(".obstacle-count")).find((node) =>
        /^\d+ panels/.test(node.textContent ?? ""),
      );
      return parseInt(el?.textContent ?? "0", 10);
    };

    const countBeforeDisable = getCount();
    expect(countBeforeDisable).toBeGreaterThan(0);

    // Disable panels
    fireEvent.click(screen.getByRole("button", { name: "Remove solar panels" }));
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();

    // Re-enable: layout is preserved
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    expect(getCount()).toBe(countBeforeDisable);
  });

  it("changing configuration sliders prior to placement does NOT automatically place panels", () => {
    renderModelPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();

    // Adjust tilt slider
    const tiltSlider = screen.getByLabelText(/Tilt slider/i);
    fireEvent.input(tiltSlider, { target: { value: "25" } });

    // Roof must still have 0 panels
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto-Place Panels" })).toBeInTheDocument();
  });
});
