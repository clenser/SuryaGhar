import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mapInstance = {
  on: vi.fn(),
  addControl: vi.fn(),
  remove: vi.fn(),
  getCenter: () => ({ lng: 82.5, lat: 22.5 }),
  getZoom: () => 4.2,
  getBearing: () => 0,
  getPitch: () => 0,
  getLayer: () => undefined,
  getSource: () => undefined,
  setPaintProperty: vi.fn(),
  setLayoutProperty: vi.fn(),
  setTerrain: vi.fn(),
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
};

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      return mapInstance as unknown as FakeMap;
    }
  }
  class FakeControl {}
  return { default: { Map: FakeMap, AttributionControl: FakeControl }, Map: FakeMap, AttributionControl: FakeControl };
});

import App from "../App";

describe("App workspace", () => {
  beforeEach(() => {
    Object.values(mapInstance).forEach((v) => typeof v === "function" && "mockClear" in v && (v as unknown as { mockClear: () => void }).mockClear());
  });

  it("opens to a map-first workspace with the workflow stepper and search", () => {
    render(<App />);
    expect(screen.getByRole("application", { name: /Satellite map of India/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Analysis workflow" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Find a property to begin" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search location" })).toBeInTheDocument();
    expect(document.querySelector(".status-bar")).toBeTruthy();
  });

  it("names the imagery provider and states it is prototype-only in diagnostics", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByText(/Esri World Imagery · prototype/)).toBeInTheDocument();
    expect(screen.getByText(/Native max zoom/)).toBeInTheDocument();
  });

  it("opens the layers panel from the map controls and closes it with Escape", async () => {
    render(<App />);
    const panel = document.getElementById("layer-panel") as HTMLElement;
    expect(panel).not.toHaveClass("is-open");
    await userEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(panel).toHaveClass("is-open");
    await userEvent.keyboard("{Escape}");
    expect(panel).not.toHaveClass("is-open");
  });

  it("toggles terrain from the controls and records it in map state", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle terrain relief" }));
    expect(screen.getByRole("button", { name: "Toggle terrain relief" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps advanced controls hidden until advanced mode is enabled", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(screen.queryByRole("slider", { name: /Satellite opacity/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Advanced mode" }));
    expect(await screen.findByRole("slider", { name: /Satellite opacity/ })).toBeInTheDocument();
  });

  it("header Advanced button opens the panel that contains the diagnostics", async () => {
    render(<App />);
    expect(document.getElementById("layer-panel")).not.toHaveClass("is-open");
    await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(document.getElementById("layer-panel")).toHaveClass("is-open");
    expect(screen.getByRole("heading", { name: "Test sites" })).toBeInTheDocument();
  });

  it("selecting a test site from diagnostics flies the map and shows the place card", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    const testSites = screen.getByRole("heading", { name: "Test sites" }).parentElement as HTMLElement;
    await userEvent.click(within(testSites).getByRole("button", { name: /Kalna/ }));
    expect(mapInstance.flyTo).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Selected location" })).toHaveTextContent("Kalna");
    expect(document.querySelector(".onboarding")).toBeNull();
  });
});
