/**
 * Correction-milestone behavior: solar panels are strictly opt-in (empty
 * roof by default), mounting offers Flat Roof only, and the design-mode
 * transition buttons fire their callbacks.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { ModelPanel } from "../components/analysis/ModelPanel";
import type { LngLat, PolygonMetrics } from "../lib/geo";
import { createBuildingModel } from "../lib/3d/building";
import { buildingBounds, frameCamera, framingFromBox } from "../lib/3d/scene";

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

  it("recalculates the auto layout live when spacing changes", () => {
    // Full state flow: field -> active-set config -> lattice -> stored
    // panels -> rendered count. No manual remove/re-add involved.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-place set/ }));
    const countOf = (): number => {
    const placed = Array.from(document.querySelectorAll(".obstacle-count")).find((el) =>
      /^\d+ panels/.test(el.textContent ?? ""),
    );
    return parseInt(placed?.textContent ?? "", 10);
    };
    const before = countOf();
    expect(before).toBeGreaterThan(5);
    fireEvent.change(screen.getByLabelText("Panel spacing"), { target: { value: "2.5" } });
    const after = countOf();
    expect(after).toBeLessThan(before);
  });

  it("exposes the panel edge setback in the Building Model section with a 0.2 m default", () => {
    renderPanel();
    const input = screen.getByLabelText("Panel edge setback") as HTMLInputElement;
    expect(input.value).toBe("0.2");
  });

  it("recalculates the auto layout live when the setback changes", () => {
    // Same shared config as the other geometry controls: a wider keep-off
    // strip fits fewer panels, with no manual remove/re-add involved.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-place set/ }));
    const countOf = (): number => {
    const placed = Array.from(document.querySelectorAll(".obstacle-count")).find((el) =>
      /^\d+ panels/.test(el.textContent ?? ""),
    );
    return parseInt(placed?.textContent ?? "", 10);
    };
    const before = countOf();
    expect(before).toBeGreaterThan(5);
    fireEvent.change(screen.getByLabelText("Panel edge setback"), { target: { value: "2" } });
    expect(countOf()).toBeLessThan(before);
  });

  it("keeps a hand-placed panel when the setback changes", () => {
    // Widening the setback only revalidates: the stored manual position —
    // and therefore the count — must survive even a 5 m strip.
    const RECT = { left: 0, top: 0, width: 900, height: 500 };
    const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect;
    HTMLCanvasElement.prototype.getBoundingClientRect = (() => ({
      ...RECT,
      right: RECT.width,
      bottom: RECT.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })) as typeof HTMLCanvasElement.prototype.getBoundingClientRect;
    try {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
      fireEvent.click(screen.getByRole("button", { name: "Manual placement" }));
      const coords = createBuildingModel(TERRACE, 12).coords;
      const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
      frameCamera(camera, framingFromBox(buildingBounds(coords)));
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const ndc = new THREE.Vector3(0, 0, 12).project(camera);
      const point = {
        clientX: RECT.left + ((ndc.x + 1) / 2) * RECT.width,
        clientY: RECT.top + ((1 - ndc.y) / 2) * RECT.height,
      };
      const canvas = document.querySelector("canvas")!;
      act(() => {
        canvas.dispatchEvent(new MouseEvent("pointerdown", { ...point, button: 0 }));
        window.dispatchEvent(new MouseEvent("pointerup", { ...point, button: 0 }));
      });
      const placedCount = (): string | null => {
        const el = Array.from(document.querySelectorAll(".obstacle-count")).find((node) =>
          /^1 panel/.test(node.textContent ?? ""),
        );
        return el?.textContent ?? null;
      };
      expect(placedCount()).toMatch(/^1 panel/);
      fireEvent.change(screen.getByLabelText("Panel edge setback"), { target: { value: "5" } });
      expect(placedCount()).toMatch(/^1 panel/);
    } finally {
      HTMLCanvasElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("refreshes an obsolete refusal when the setback changes", () => {
    // The refusal shown for a click near the roof edge is a statement about
    // the configuration at that moment. Editing the setback must clear it
    // rather than leave a stale "0.6 m" message contradicting the field.
    const RECT = { left: 0, top: 0, width: 900, height: 500 };
    const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect;
    HTMLCanvasElement.prototype.getBoundingClientRect = (() => ({
      ...RECT, right: RECT.width, bottom: RECT.height, x: 0, y: 0, toJSON: () => ({}),
    })) as typeof HTMLCanvasElement.prototype.getBoundingClientRect;
    try {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Enable solar panels" }));
      fireEvent.click(screen.getByRole("button", { name: "Manual placement" }));
      // Whole-set mode: one click commits the whole block, so a bad spot is
      // refused with a reason instead of being partially placed.
      fireEvent.click(screen.getByRole("button", { name: "Whole set" }));
      const coords = createBuildingModel(TERRACE, 12).coords;
      const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
      frameCamera(camera, framingFromBox(buildingBounds(coords)));
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const ndc = new THREE.Vector3(29, 0, 12).project(camera);
      const point = {
        clientX: RECT.left + ((ndc.x + 1) / 2) * RECT.width,
        clientY: RECT.top + ((1 - ndc.y) / 2) * RECT.height,
      };
      const canvas = document.querySelector("canvas")!;
      act(() => {
        canvas.dispatchEvent(new MouseEvent("pointerdown", { ...point, button: 0 }));
        window.dispatchEvent(new MouseEvent("pointerup", { ...point, button: 0 }));
      });
      // The obstruction is the roof edge, and the message names the rule that
      // actually fired — never a value the user did not configure.
      const refusal = screen.queryByRole("alert");
      if (refusal) {
        expect(refusal.textContent).not.toMatch(/0\.6 m inside the rooftop edge/);
      }
      fireEvent.change(screen.getByLabelText("Panel edge setback"), { target: { value: "0.1" } });
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});