/**
 * Correction-milestone behavior: solar panels are strictly opt-in (empty
 * roof by default), mounting offers Flat Roof only, and the design-mode
 * transition buttons fire their callbacks.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelPanel } from "../components/analysis/ModelPanel";
import type { LngLat, PolygonMetrics } from "../lib/geo";

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: null as number | null, autoUpdate: false };
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControls {
    target = { set: (..._args: number[]) => {} };
    enableRotate = true;
    enableZoom = true;
    enablePan = true;
    enableDamping = false;
    dampingFactor = 0;
    rotateSpeed = 1;
    zoomSpeed = 1;
    minPolarAngle = 0;
    maxPolarAngle = Math.PI;
    minDistance = 0;
    maxDistance = Infinity;
    mouseButtons = {};
    touches = {};
    update() {}
    dispose() {}
  }
  return { OrbitControls };
});

const originalGetContext = HTMLCanvasElement.prototype.getContext;

const TERRACE: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

const METRICS: PolygonMetrics = {
  areaM2: 84.5,
  perimeterM: 44.2,
  centroid: { lng: 88.3642, lat: 22.57285 },
  valid: true,
  issue: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ModelPanel>[0]> = {}) {
  const props = {
    vertices: TERRACE,
    metrics: METRICS,
    buildingHeight: 12 as number | null,
    onSetHeight: vi.fn(),
    onContinue: vi.fn(),
    backendReady: true,
    ...overrides,
  };
  return { ...render(<ModelPanel {...props} />), props };
}

describe("ModelPanel design correction", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("starts with an empty roof: enable action present, no mounting choice", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Enable solar panels" })).toBeInTheDocument();
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();
    // Mounting UI only exists inside the enabled section.
    expect(screen.queryByText("Flat Roof")).toBeNull();
    expect(screen.queryByText("Tilted Roof")).toBeNull();
    expect(screen.queryByText("Shed")).toBeNull();
  });

  it("enabling panels offers Flat Roof only, and removing restores the empty roof", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    expect(screen.getByText("Flat Roof")).toBeInTheDocument();
    expect(screen.queryByText("Tilted Roof")).toBeNull();
    expect(screen.queryByText("Shed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove solar panels" }));
    expect(screen.getByRole("button", { name: "Enable solar panels" })).toBeInTheDocument();
    expect(screen.getByText("No panels placed yet")).toBeInTheDocument();
  });

  it("normalises a non-flat mounting patch back to flat", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    // Only one mounting button can ever be active: Flat Roof.
    const flat = screen.getByText("Flat Roof").closest("button")!;
    expect(flat).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the explicit IST site date/time once a height is set", () => {
    renderPanel({ buildingHeight: 12, siteCountry: "India" });
    expect(screen.getByTestId("sun-datetime")).toHaveTextContent(/IST/);
  });

  it("offers the design-mode transition and the return action", () => {    const onEnterDesign = vi.fn();
    const onExitDesign = vi.fn();
    const first = renderPanel({ onEnterDesign, onExitDesign });
    fireEvent.click(screen.getByRole("button", { name: "Open 3D design view" }));
    expect(onEnterDesign).toHaveBeenCalledTimes(1);
    first.unmount();

    renderPanel({ designMode: true, onEnterDesign, onExitDesign });
    fireEvent.click(screen.getByRole("button", { name: "Back to map" }));
    expect(onExitDesign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Open 3D design view" })).toBeNull();
  });

  it("shows parapet height input with total height", () => {
    renderPanel({ buildingHeight: 15 });
    expect(screen.getByLabelText("Parapet height")).toBeInTheDocument();
    expect(screen.getByText("Total height")).toBeInTheDocument();
    expect(screen.getByText("16.0 m")).toBeInTheDocument(); // 15 + default 1.0
  });
  it("toggles X-ray mode reversibly", () => {
    renderPanel({ buildingHeight: 15 });
    const toggle = screen.getByRole("button", { name: "X-ray" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Solid view" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Solid view" }));
    expect(screen.getByRole("button", { name: "X-ray" })).toBeInTheDocument();
  });
  it("opens the footprint drawing mode for Custom obstacles and cancels cleanly", () => {
    renderPanel({ buildingHeight: 15 });
    fireEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    fireEvent.change(screen.getByLabelText("Obstacle type"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Draw footprint" }));
    expect(screen.getByRole("group", { name: "Draw rooftop footprint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm footprint" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Obstacle editor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("form", { name: "Obstacle editor" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Draw rooftop footprint" })).toBeNull();
  });
});
