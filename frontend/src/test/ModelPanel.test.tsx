/**
 * Tests for the Model stage panel: building-height step → 3D viewport.
 *
 * The Three.js renderer is stubbed (jsdom has no WebGL) but the real scene,
 * camera and extrusion code runs, so these tests exercise the actual state
 * flow: terrace polygon + height → local 3D coordinates → viewport.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelPanel } from "../components/analysis/ModelPanel";
import type { LngLat, PolygonMetrics } from "../lib/geo";
import type { Obstacle } from "../lib/3d/obstacles";

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
    buildingHeight: null as number | null,
    onSetHeight: vi.fn(),
    onContinue: vi.fn(),
    backendReady: true,
    ...overrides,
  };
  return { ...render(<ModelPanel {...props} />), props };
}

describe("ModelPanel", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("asks for the building height while none is set", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Building height" })).toBeInTheDocument();
    expect(screen.getByLabelText("Building height (metres)")).toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("switches to the 3D viewport once a valid height is entered", async () => {
    const { props, rerender } = renderPanel();

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "17.2");
    await userEvent.click(screen.getByRole("button", { name: /Create 3D Building/i }));

    // The parent stores the height and re-renders the panel with it.
    expect(props.onSetHeight).toHaveBeenCalledWith(17.2);
    rerender(<ModelPanel {...props} buildingHeight={17.2} />);

    expect(screen.getByRole("heading", { name: "3D Building Model" })).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeInTheDocument();
  });

  it("stacks footer actions by default and rows them in the enlarged view", () => {
    const { rerender, props } = renderPanel({ buildingHeight: 17.2 });

    const footer = document.querySelector(".viewer-footer");
    expect(footer).toBeInTheDocument();
    expect(footer).not.toHaveClass("viewer-footer--expanded");
    // Help text and the three actions share the footer without competing.
    expect(footer!.querySelector(".viewer-help")).toBeInTheDocument();
    expect(footer!.querySelectorAll(".viewer-actions .btn")).toHaveLength(3);

    rerender(
      <ModelPanel
        {...props}
        buildingHeight={17.2}
        designMode
        onExitDesign={() => {}}
      />,
    );
    expect(document.querySelector(".viewer-footer")).toHaveClass(
      "viewer-footer--expanded",
    );
  });

  it("shows the entered height in the viewport summary", () => {
    renderPanel({ buildingHeight: 17.2 });

    expect(screen.getByText(/extruded to 17\.2 m/)).toBeInTheDocument();
    expect(screen.getByText("17.2 m")).toBeInTheDocument();
  });

  it("propagates the height into the 3D scene without changing the footprint", () => {
    const { rerender, props } = renderPanel({ buildingHeight: 8 });
    expect(document.querySelector("canvas")).toBeInTheDocument();

    // Same terrace, new height: the viewport updates with the new readout.
    rerender(<ModelPanel {...props} buildingHeight={24} />);
    expect(screen.getByText("24.0 m")).toBeInTheDocument();
    expect(screen.getByText(/extruded to 24\.0 m/)).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeInTheDocument();
  });

  it("keeps the measured terrace metrics on screen", () => {
    renderPanel({ buildingHeight: 12 });

    expect(screen.getByText("84.5 m²")).toBeInTheDocument();
    expect(screen.getByText("44.2 m")).toBeInTheDocument();
    expect(screen.getByText("12.0 m")).toBeInTheDocument();
  });

  it("returns to the height input from Change height, keeping the current value", async () => {
    renderPanel({ buildingHeight: 17.2 });

    await userEvent.click(screen.getByRole("button", { name: /Change height/i }));

    expect(screen.getByRole("heading", { name: "Building height" })).toBeInTheDocument();
    expect(screen.getByLabelText("Building height (metres)")).toHaveValue(17.2);
  });

  it("hands the confirmed height to the parent", async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /Create 3D Building/i }));

    expect(props.onSetHeight).toHaveBeenCalledWith(10);
  });

  it("locks Continue until the analysis server is ready", async () => {
    const { props, rerender } = renderPanel({ buildingHeight: 17.2, backendReady: false });

    const continueBtn = screen.getByRole("button", { name: /Continue to Validate/i });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByText(/Waiting for analysis server/i)).toBeInTheDocument();

    rerender(<ModelPanel {...props} backendReady />);
    expect(screen.getByRole("button", { name: /Continue to Validate/i })).toBeEnabled();
  });

  it("calls onContinue when moving to validation", async () => {
    const { props } = renderPanel({ buildingHeight: 17.2 });

    await userEvent.click(screen.getByRole("button", { name: /Continue to Validate/i }));

    expect(props.onContinue).toHaveBeenCalled();
  });
});

/* ---------------- Rooftop obstacles (Phase 3) ---------------- */

const OBSTACLE: Obstacle = {
  id: "obstacle-1",
  type: "water-tank",
  position: { x: 4, y: -3 },
  width: 2.5,
  length: 2.5,
  height: 2,
  rotation: 0,
};

describe("ModelPanel obstacles", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("shows an empty rooftop state until an obstacle is added", () => {
    renderPanel({ buildingHeight: 17.2 });

    expect(screen.getByRole("heading", { level: 3, name: "Rooftop obstacles" })).toBeInTheDocument();
    expect(screen.getByText("None on the roof yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add obstacle" })).toBeInTheDocument();
  });

  it("adds an obstacle from the compact form", async () => {
    const onAddObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [], onAddObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    expect(screen.getByLabelText("Length")).toHaveValue("2.5");
    expect(screen.getByLabelText("Height")).toHaveValue("2");

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));

    expect(onAddObstacle).toHaveBeenCalledTimes(1);
    const added = onAddObstacle.mock.calls[0][0];
    expect(added).toMatchObject({
      type: "water-tank",
      width: 2.5,
      length: 2.5,
      height: 2,
      rotation: 0,
      position: { x: 0, y: 0 },
    });
    expect(added.id).toMatch(/^obstacle-\d+$/);
    expect(screen.queryByLabelText("Length")).not.toBeInTheDocument();
  });

  it("refuses to add an invalid obstacle and reports why", async () => {
    const onAddObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [], onAddObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    const width = screen.getByLabelText("Width");
    await userEvent.clear(width);
    await userEvent.type(width, "0");
    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Width must be greater than 0");
    expect(onAddObstacle).not.toHaveBeenCalled();
  });

  it("refuses an obstacle that would hang off the roof", async () => {
    const onAddObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [], onAddObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    // Position is placed in the 3D view now (no manual fields), so an
    // oversized footprint is what pushes the obstacle off the roof.
    // The test roof is ~61 m wide but only ~55 m deep: a 59 m length
    // (valid dimension, under the 60 m cap) hangs off the north/south
    // edges while a 59 m width would still fit east-west.
    const length = screen.getByLabelText("Length");
    await userEvent.clear(length);
    await userEvent.type(length, "59");
    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/beyond the rooftop boundary/);
    expect(onAddObstacle).not.toHaveBeenCalled();
  });

  it("closes the editor on cancel without adding anything", async () => {
    const onAddObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [], onAddObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    expect(screen.getByLabelText("Length")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.queryByLabelText("Length")).not.toBeInTheDocument();
    expect(onAddObstacle).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add obstacle" })).toBeInTheDocument();
  });

  it("lists every obstacle with its metric description", () => {
    renderPanel({
      buildingHeight: 17.2,
      obstacles: [
        OBSTACLE,
        { ...OBSTACLE, id: "obstacle-2", type: "hvac", width: 1, length: 1.4, height: 0.9, position: { x: -6, y: 5 } },
      ],
    });

    expect(screen.getByText("2 obstacles on the roof")).toBeInTheDocument();
    expect(screen.getByText("Water Tank")).toBeInTheDocument();
    expect(screen.getByText("AC / HVAC")).toBeInTheDocument();
    expect(screen.getByText(/2\.5 × 2\.5 × 2 m/)).toBeInTheDocument();
    expect(screen.getByText(/1\.4 × 1 × 0\.9 m/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Delete / })).toHaveLength(2);
  });

  it("edits an obstacle's height through the form", async () => {
    const onUpdateObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [OBSTACLE], onUpdateObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Height")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();

    const height = screen.getByLabelText("Height");
    await userEvent.clear(height);
    await userEvent.type(height, "5.5");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onUpdateObstacle).toHaveBeenCalledTimes(1);
    expect(onUpdateObstacle.mock.calls[0][0]).toMatchObject({
      id: "obstacle-1",
      height: 5.5,
      width: 2.5,
      position: { x: 4, y: -3 },
    });
  });

  it("keeps the roof position when the category changes", async () => {
    const onAddObstacle = vi.fn<(obstacle: Obstacle) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [], onAddObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    // Manual position fields are gone: placement happens in the 3D view,
    // so the draft starts at the roof centre and the category change
    // must preserve that placed position while reloading the preset.
    expect(screen.queryByLabelText("Position east")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Obstacle type"), "lift-room");

    // Preset footprint reloaded ...
    expect(screen.getByLabelText("Length")).toHaveValue("3");
    expect(screen.getByLabelText("Height")).toHaveValue("3");

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    expect(onAddObstacle.mock.calls[0][0]).toMatchObject({
      type: "lift-room",
      position: { x: 0, y: 0 },
    });
  });

  it("deletes an obstacle", async () => {
    const onRemoveObstacle = vi.fn<(id: string) => void>();
    renderPanel({ buildingHeight: 17.2, obstacles: [OBSTACLE], onRemoveObstacle });

    await userEvent.click(screen.getByRole("button", { name: "Delete Water Tank" }));

    expect(onRemoveObstacle).toHaveBeenCalledWith("obstacle-1");
  });

  it("flags an obstacle that no longer fits the roof", () => {
    renderPanel({
      buildingHeight: 17.2,
      obstacles: [{ ...OBSTACLE, position: { x: 250, y: 0 } }],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/beyond the rooftop boundary/);
    expect(document.querySelector(".obstacle-item.is-invalid")).toBeInTheDocument();
  });

  it("reports a single obstacle in the singular", () => {
    renderPanel({ buildingHeight: 17.2, obstacles: [OBSTACLE] });

    expect(screen.getByText("1 obstacle on the roof")).toBeInTheDocument();
  });
});

/* ---------------- Sun simulation (Phase 4) ---------------- */

describe("ModelPanel sun simulation", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("shows date, local time, sun position and playback below the viewport", () => {
    renderPanel({ buildingHeight: 17.2, siteCountry: "India" });

    const section = screen.getByRole("region", { name: "Sun and shadows" });
    expect(section).toBeInTheDocument();

    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date).toHaveAttribute("type", "date");
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // A readable position in the middle of the day, in the site's own zone.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Azimuth/);
    expect(status).not.toHaveTextContent(/Sun position unavailable/);
    expect(screen.getByText(/Asia\/Kolkata \(UTC\+05:30\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play day/i })).toBeInTheDocument();
  });

  it("keeps playing, scrubbing and the 3D viewport on the same simulation", () => {
    renderPanel({ buildingHeight: 17.2, siteCountry: "India" });

    fireEvent.change(screen.getByLabelText(/Local time/), { target: { value: "480" } });
    expect(screen.getAllByText("8:00 AM").length).toBeGreaterThan(0);
    expect(document.querySelector("canvas")).toBeInTheDocument(); // scene still live

    fireEvent.change(screen.getByLabelText(/Local time/), { target: { value: "0" } });
    expect(screen.getByRole("status")).toHaveTextContent(/Night — sun below the horizon/i);
  });

  it("uses the selected place's country for the site clock", () => {
    renderPanel({ buildingHeight: 17.2, siteCountry: "Bangladesh" });

    expect(screen.getByText(/Asia\/Dhaka/)).toBeInTheDocument();
    expect(screen.queryByText(/Asia\/Kolkata/)).not.toBeInTheDocument();
  });

  it("says the position is unavailable instead of faking a sun", () => {
    renderPanel({ buildingHeight: 17.2, metrics: null });

    expect(screen.getByRole("status")).toHaveTextContent(/Sun position unavailable/i);
    expect(screen.getByRole("button", { name: /Play day/i })).toBeDisabled();
  });

  it("keeps the sun section out of the height step", () => {
    renderPanel();

    expect(screen.queryByRole("region", { name: "Sun and shadows" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Building height" })).toBeInTheDocument();
  });
});
