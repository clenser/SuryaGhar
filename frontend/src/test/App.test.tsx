import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetBackendStatusForTests } from "../services/backendStatus";

export const googleMapSpy = {
  panTo: vi.fn(),
  setZoom: vi.fn(),
  fitBounds: vi.fn(),
  setHeading: vi.fn(),
  setTilt: vi.fn(),
};

// Bind spy to Map prototype
if (typeof window !== "undefined" && window.google?.maps?.Map) {
  const origPanTo = window.google.maps.Map.prototype.panTo;
  window.google.maps.Map.prototype.panTo = function (...args: unknown[]) {
    googleMapSpy.panTo(...args);
    return origPanTo.apply(this, args as never);
  };
  const origSetZoom = window.google.maps.Map.prototype.setZoom;
  window.google.maps.Map.prototype.setZoom = function (...args: unknown[]) {
    googleMapSpy.setZoom(...args);
    return origSetZoom.apply(this, args as never);
  };
  const origFitBounds = window.google.maps.Map.prototype.fitBounds;
  window.google.maps.Map.prototype.fitBounds = function (...args: unknown[]) {
    googleMapSpy.fitBounds(...args);
    return origFitBounds.apply(this, args as never);
  };
}


import App from "../App";

describe("App workspace", () => {
  beforeEach(() => {
    Object.values(googleMapSpy).forEach((v) => typeof v === "function" && "mockClear" in v && (v as unknown as { mockClear: () => void }).mockClear());
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

  it("includes the 3D building stage in the workflow, locked until an area is confirmed", () => {
    render(<App />);
    const tabs = screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label") ?? "");
    expect(tabs.some((label) => label.startsWith("Model"))).toBe(true);
    expect(screen.getByRole("tab", { name: /^Model/ })).toBeDisabled();
    // Later stages are unchanged: Validate still follows Model.
    expect(tabs.some((label) => label.startsWith("Validate"))).toBe(true);
  });

  it("mounts the mobile bottom-sheet handle in the partially expanded state", () => {
    render(<App />);
    const panel = document.querySelector(".stage-panel") as HTMLElement;
    expect(panel).toHaveAttribute("data-sheet", "partial");
    const handle = screen.getByRole("button", { name: "Expand results panel" });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".stage-panel__body")).toBeTruthy();
  });

  it("offers a theme toggle in the header that switches to dark", async () => {
    render(<App />);
    const btn = screen.getByRole("button", { name: "Switch to dark theme" });
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("suryaghar-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows a Reset action in the sidebar", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Reset analysis" })).toBeInTheDocument();
  });

  it("fires exactly one backend wake request on mount", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ready" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const wakeCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) => String(url).endsWith("/api/ready"));
    expect(wakeCalls).toHaveLength(1);
    await screen.findByText("API Online");
  });

  it("stays starting while the readiness probe reports starting", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      // First the backend is still initializing (direct /ready form), then it
      // becomes ready. Retry-After keeps the starting state observable.
      return calls === 1
        ? new Response(JSON.stringify({ status: "starting" }), { status: 503, headers: { "Retry-After": "1" } })
        : new Response(JSON.stringify({ status: "ready" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByText("Starting analysis server…")).toBeInTheDocument();
    expect(screen.queryByText("API Online")).toBeNull();
    expect(await screen.findByText("API Online")).toBeInTheDocument();
    expect((fetchMock.mock.calls as unknown[][]).every(([url]) => String(url).endsWith("/api/ready"))).toBe(true);
  });

  it("fires exactly one wake request under StrictMode double-mount", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ready" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let any duplicate settle, then count.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const wakeCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) => String(url).endsWith("/api/ready"));
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
    expect(googleMapSpy.panTo).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("Kalna");
    expect(document.querySelector(".onboarding")).toBeNull();
  });
});
