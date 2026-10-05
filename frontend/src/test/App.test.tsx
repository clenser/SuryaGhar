import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetBackendStatusForTests } from "../services/backendStatus";

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
    resetBackendStatusForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens to a map-first workspace with Kolkata location card and search", () => {
    render(<App />);
    expect(screen.getByRole("application", { name: /Satellite map of India/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Analysis workflow" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("Kolkata");
    expect(screen.getByRole("combobox", { name: "Search location" })).toBeInTheDocument();
    expect(document.querySelector(".status-bar")).toBeTruthy();
  });

  it("shows the backend status in the header, left of Advanced", () => {
    render(<App />);
    const header = screen.getByRole("banner");
    const status = within(header).getByRole("status");
    const advanced = within(header).getByRole("button", { name: /Advanced/ });
    expect(status).toBeInTheDocument();
    expect(status.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Footer keeps map status but no backend indicator.
    const footer = document.querySelector(".status-bar") as HTMLElement;
    expect(within(footer).queryByRole("status")).toBeNull();
  });

  it("names the imagery provider and states it is prototype-only in diagnostics", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByText(/Esri World Imagery · prototype/)).toBeInTheDocument();
    expect(screen.getByText(/Native max zoom/)).toBeInTheDocument();
  });

  it("starts satellite-first with roads and buildings off", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(screen.getByRole("checkbox", { name: "Satellite imagery" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Roads and place names" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "3D buildings" })).not.toBeChecked();
  });

  it("brands the product as Surya-Ghar", () => {
    render(<App />);
    expect(screen.getByText("Surya-Ghar")).toBeInTheDocument();
    expect(screen.queryByText("Solar Site")).toBeNull();
  });

  it("shows a Reset action in the sidebar", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Reset analysis" })).toBeInTheDocument();
  });

  it("fires exactly one backend wake request on mount", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const wakeCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) => String(url).endsWith("/api/health"));
    expect(wakeCalls).toHaveLength(1);
    await screen.findByText("API Online");
  });

  it("fires exactly one wake request under StrictMode double-mount", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let any duplicate settle, then count.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const wakeCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) => String(url).endsWith("/api/health"));
    expect(wakeCalls).toHaveLength(1);
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

  it("selecting a test site from diagnostics flies the map and updates the sidebar location", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    const testSites = screen.getByRole("heading", { name: "Test sites" }).parentElement as HTMLElement;
    await userEvent.click(within(testSites).getByRole("button", { name: /Kalna/ }));
    expect(mapInstance.flyTo).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("Kalna");
    expect(document.querySelector(".onboarding")).toBeNull();
  });
});
