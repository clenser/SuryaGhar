/**
 * Tests for Site3DViewer component.
 *
 * jsdom has no WebGL, so the capability probe is stubbed per test; everything
 * else (scene, camera, geometry) is real Three.js code that runs headless.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import * as THREE from "three";
import { Site3DViewer } from "../components/3d/Site3DViewer";
import type { LocalCoords3D } from "../lib/3d/coordinates";
import { buildingBounds, frameCamera, framingFromBox } from "../lib/3d/scene";
import type { Obstacle } from "../lib/3d/obstacles";
import { AMBIENT_NIGHT_INTENSITY, sunDirectionVector } from "../lib/3d/lighting";
import { createSunClock, sampleSolarDay, sunStateAt, type SunClock } from "../lib/solar";

// Renderer/scene instances are created inside the three mock below, so the
// sun tests capture them here (hoisted above the mock factory's hoisting).
const capture = vi.hoisted(() => ({
  renderers: [] as Array<{ shadowMap: { needsUpdate?: boolean } }>,
  lastScene: null as THREE.Scene | null,
}));

// WebGLRenderer is the only Three.js class that needs a real GPU context.
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: null as number | null, autoUpdate: false };
    toneMapping = 0;
    toneMappingExposure = 1;
    constructor() {
      capture.renderers.push(this as unknown as { shadowMap: { needsUpdate?: boolean } });
    }
    setPixelRatio() {}
    setSize() {}
    render(scene: THREE.Scene) {
      capture.lastScene = scene;
    }
    dispose() {}
  }
  return { ...actual, WebGLRenderer };
});

// OrbitControls binds DOM listeners; a stub keeps the test focused on wiring.
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
const originalGetBoundingClientRect = HTMLCanvasElement.prototype.getBoundingClientRect;

// requestAnimationFrame backed by timers, with a real cancellation path so no
// render loop survives a test. Callbacks receive a controllable timestamp so
// the sun playback path sees realistic frame deltas.
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafSeq = 0;
let rafNow = 0;

function installAnimationFrame() {
  rafTimers.clear();
  rafSeq = 0;
  rafNow = 0;
  capture.renderers.length = 0;
  capture.lastScene = null;
  (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: FrameRequestCallback,
  ) => {
    const id = ++rafSeq;
    rafTimers.set(
      id,
      setTimeout(() => {
        rafTimers.delete(id);
        cb(rafNow);
      }, 16),
    );
    return id;
  };
  (globalThis as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => {
    const timer = rafTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      rafTimers.delete(id);
    }
  };
}

/**
 * Advance `count` render frames, each `stepMs` apart in fake time, with a
 * matching timestamp handed to the frame callback.
 */
function stepFrames(count: number, stepMs = 16) {
  act(() => {
    for (let i = 0; i < count; i++) {
      rafNow += stepMs;
      vi.advanceTimersByTime(stepMs);
    }
  });
}

function stubWebGL(available: boolean) {
  HTMLCanvasElement.prototype.getContext = ((type: string) =>
    available && type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
}

const MOCK_LOCAL_COORDS: LocalCoords3D = {
  vertices: [
    { x: -10, y: -10, z: 0 } as LocalCoords3D["vertices"][number],
    { x: 10, y: -10, z: 0 } as LocalCoords3D["vertices"][number],
    { x: 10, y: 10, z: 0 } as LocalCoords3D["vertices"][number],
    { x: -10, y: 10, z: 0 } as LocalCoords3D["vertices"][number],
  ],
  height: 10,
  utmZone: 45,
  centroidUtm: { x: 326500, y: 2512345 },
  centroidLngLat: { lng: 88.3642, lat: 22.57285 },
};

describe("Site3DViewer", () => {
  beforeEach(() => {
    installAnimationFrame();
    stubWebGL(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    rafTimers.clear();
    vi.useRealTimers();
  });

  it("renders the canvas inside its container", () => {
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    const container = document.querySelector(".site-3d-viewer");
    expect(container).toBeInTheDocument();
    expect(container!.querySelector("canvas")).toBeInTheDocument();
  });

  it("hides the loading placeholder once the scene is initialized", () => {
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    expect(screen.queryByText("Loading 3D view…")).not.toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeInTheDocument();
  });

  it("calls onReady callback", () => {
    const onReady = vi.fn();
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} onReady={onReady} />);

    expect(onReady).toHaveBeenCalled();
  });

  it("renders error fallback when WebGL unavailable", () => {
    stubWebGL(false);

    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    expect(screen.getByText(/WebGL is not supported/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("keeps rendering after localCoords change", () => {
    const { rerender } = render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    const newCoords: LocalCoords3D = { ...MOCK_LOCAL_COORDS, height: 20 };
    rerender(<Site3DViewer localCoords={newCoords} />);

    expect(screen.queryByText("Loading 3D view…")).not.toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cleans up on unmount", () => {
    const { unmount } = render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    unmount();

    // No render loop may survive the component.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(rafTimers.size).toBe(0);
  });

  it("has correct ARIA label on canvas", () => {
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);

    const canvas = document.querySelector("canvas");
    expect(canvas).toHaveAttribute(
      "aria-label",
      "3D building model. Drag to rotate, scroll/pinch to zoom, click to select an obstacle.",
    );
  });
});

describe("Site3DViewer sun simulation", () => {
  const SAMPLES = sampleSolarDay({
    latitude: 22.5726,
    longitude: 88.3639,
    date: "2026-03-21",
    timezone: "Asia/Kolkata",
  });

  function makeClock(overrides: Partial<SunClock> = {}): SunClock {
    return Object.assign(createSunClock(SAMPLES, 12 * 60, 60), overrides);
  }

  function light(): THREE.DirectionalLight {
    expect(capture.lastScene).not.toBeNull();
    let found: THREE.DirectionalLight | undefined;
    capture.lastScene!.traverse((object) => {
      const candidate = object as THREE.DirectionalLight;
      if (candidate.isDirectionalLight) found = candidate;
    });
    expect(found).toBeDefined();
    return found!;
  }

  function ambientLight(): THREE.AmbientLight {
    expect(capture.lastScene).not.toBeNull();
    let found: THREE.AmbientLight | undefined;
    capture.lastScene!.traverse((object) => {
      const candidate = object as THREE.AmbientLight;
      if (candidate.isAmbientLight) found = candidate;
    });
    expect(found).toBeDefined();
    return found!;
  }

  function renderer() {
    expect(capture.renderers.length).toBeGreaterThan(0);
    return capture.renderers[capture.renderers.length - 1];
  }

  beforeEach(() => {
    installAnimationFrame();
    stubWebGL(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    rafTimers.clear();
    vi.useRealTimers();
  });

  it("points the key light along the computed sun direction", () => {
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={makeClock()} />);
    stepFrames(1);

    const sun = light();
    const state = sunStateAt(SAMPLES, 12 * 60);
    const expected = sunDirectionVector(state.azimuthDeg, state.elevationDeg);
    const offset = sun.position.clone().sub(sun.target.position).normalize();

    expect(offset.x).toBeCloseTo(expected.x, 5);
    expect(offset.y).toBeCloseTo(expected.y, 5);
    expect(offset.z).toBeCloseTo(expected.z, 5);
    expect(sun.position.z).toBeGreaterThan(sun.target.position.z); // light comes from above
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.camera.right).toBeGreaterThan(0); // shadow camera sized
    expect(sun.intensity).toBeGreaterThan(0);
    expect(ambientLight().intensity).toBeGreaterThan(AMBIENT_NIGHT_INTENSITY);
  });

  it("refreshes the shadow map only when the sun or scene changed", () => {
    const clock = makeClock({ timeMinutes: 9 * 60 });
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={clock} />);
    stepFrames(2);

    const target = renderer();
    target.shadowMap.needsUpdate = false;
    stepFrames(3); // static sun → no redundant shadow pass
    expect(target.shadowMap.needsUpdate).toBe(false);

    clock.timeMinutes = 16 * 60; // scrubbing the time moves the sun
    stepFrames(1);
    expect(target.shadowMap.needsUpdate).toBe(true);
  });

  it("follows the simulated time as it is scrubbed", () => {
    const clock = makeClock({ timeMinutes: 9 * 60 }); // morning
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={clock} />);
    stepFrames(1);
    const morning = light().position
      .clone()
      .sub(light().target.position)
      .normalize();

    clock.timeMinutes = 16 * 60; // afternoon
    stepFrames(1);
    const afternoon = light().position
      .clone()
      .sub(light().target.position)
      .normalize();

    expect(morning.x).toBeGreaterThan(0); // east of the site
    expect(afternoon.x).toBeLessThan(0); // west of the site
    // The two positions are genuinely different states of the same day.
    expect(morning.angleTo(afternoon)).toBeGreaterThan(Math.PI / 6);
  });

  it("turns the direct light off at night and dims the fill", () => {
    render(
      <Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={makeClock({ timeMinutes: 60 })} />,
    );
    stepFrames(1);

    expect(light().intensity).toBe(0);
    expect(ambientLight().intensity).toBe(AMBIENT_NIGHT_INTENSITY);
  });

  it("advances playback in the loop and reports to React at a bounded rate", () => {
    const clock = makeClock({ playing: true, timeMinutes: 12 * 60 });
    const onTick = vi.fn();
    clock.onTick = onTick;

    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={clock} />);
    stepFrames(12); // 192 ms of simulated real time
    expect(clock.timeMinutes).toBeGreaterThan(12 * 60); // advanced from samples
    expect(onTick).not.toHaveBeenCalled(); // below the 200 ms UI throttle

    stepFrames(1); // 208 ms → first report, and only one
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenLastCalledWith(clock.timeMinutes);

    stepFrames(13); // still reporting at ≤5 Hz, never per frame
    expect(onTick).toHaveBeenCalledTimes(2);
    // ~400 ms of playback at 60 sim-min/s ≈ +24 min from the noon start.
    expect(clock.timeMinutes).toBeGreaterThan(12 * 60 + 20);
    expect(clock.timeMinutes).toBeLessThan(12 * 60 + 30);
  });

  it("stops playback at 24:00 and reports the end exactly once", () => {
    const clock = makeClock({ playing: true, timeMinutes: 1440 - 1 });
    const onEnd = vi.fn();
    clock.onEnd = onEnd;

    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={clock} />);
    stepFrames(4);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(clock.playing).toBe(false);
    expect(clock.timeMinutes).toBe(1440);

    stepFrames(30);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(clock.timeMinutes).toBe(1440);
  });

  it("keeps exactly one loop while playing and stops it on unmount", () => {
    const clock = makeClock({ playing: true });
    const { unmount } = render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} sun={clock} />);
    stepFrames(3);
    expect(rafTimers.size).toBe(1);

    const frozenAt = clock.timeMinutes;
    unmount();
    stepFrames(10);

    expect(rafTimers.size).toBe(0); // no loop survives the component
    expect(clock.timeMinutes).toBe(frozenAt); // and nothing keeps advancing the clock
  });

  it("renders a static scene when no simulation is attached", () => {
    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} />);
    stepFrames(2);

    const sun = light();
    expect(sun.intensity).toBeGreaterThan(0); // default pose keeps the scene readable
    expect(capture.renderers.length).toBeGreaterThan(0);
  });
});

describe("Site3DViewer obstacle interaction", () => {
  const RECT = { left: 0, top: 0, width: 900, height: 500 };

  const OBSTACLE: Obstacle = {
    id: "obstacle-7",
    type: "water-tank",
    position: { x: 0, y: 0 },
    width: 14,
    length: 14,
    height: 6,
    rotation: 0,
  };

  beforeEach(() => {
    installAnimationFrame();
    stubWebGL(true);
    vi.useFakeTimers();
    HTMLCanvasElement.prototype.getBoundingClientRect = (() => ({
      ...RECT,
      right: RECT.width,
      bottom: RECT.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })) as typeof HTMLCanvasElement.prototype.getBoundingClientRect;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    rafTimers.clear();
    vi.useRealTimers();
  });

  /** Screen position of a world point, using the same framing as setupScene. */
  function clientPointFor(x: number, y: number, z: number) {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    frameCamera(camera, framingFromBox(buildingBounds(MOCK_LOCAL_COORDS)));
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const ndc = new THREE.Vector3(x, y, z).project(camera);
    return {
      clientX: RECT.left + ((ndc.x + 1) / 2) * RECT.width,
      clientY: RECT.top + ((1 - ndc.y) / 2) * RECT.height,
    };
  }

  function clickAt(point: { clientX: number; clientY: number }, target: EventTarget) {
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { ...point, button: 0 }));
    target.dispatchEvent(new MouseEvent("pointerup", { ...point, button: 0 }));
  }

  function dragTo(from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }) {
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { ...from, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { ...to, button: 0 }));
  }

  it("deselects when empty space is clicked", () => {
    const onObstacleSelect = vi.fn<(id: string | null) => void>();
    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[]}
        onObstacleSelect={onObstacleSelect}
      />,
    );

    clickAt({ clientX: 20, clientY: 20 }, window);

    expect(onObstacleSelect).toHaveBeenCalledWith(null);
  });

  it("selects the obstacle under the cursor", () => {
    const onObstacleSelect = vi.fn<(id: string | null) => void>();
    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[OBSTACLE]}
        onObstacleSelect={onObstacleSelect}
      />,
    );

    // Aim at the middle of the box: roof plane (10 m) + half its height.
    clickAt(clientPointFor(0, 0, MOCK_LOCAL_COORDS.height + OBSTACLE.height / 2), window);

    expect(onObstacleSelect).toHaveBeenCalledWith("obstacle-7");
  });

  it("does not select while the pointer is dragged (camera orbit)", () => {
    const onObstacleSelect = vi.fn<(id: string | null) => void>();
    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[OBSTACLE]}
        onObstacleSelect={onObstacleSelect}
      />,
    );

    dragTo({ clientX: 400, clientY: 250 }, { clientX: 470, clientY: 300 });

    expect(onObstacleSelect).not.toHaveBeenCalled();
  });

  it("places the draft footprint on the roof plane while a preview is shown", () => {
    const onRoofPlace = vi.fn<(x: number, y: number) => void>();
    const onObstacleSelect = vi.fn<(id: string | null) => void>();
    const preview: Obstacle = { ...OBSTACLE, id: "draft", width: 4, length: 4, height: 2 };

    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[OBSTACLE]}
        previewObstacle={preview}
        previewValid
        onRoofPlace={onRoofPlace}
        onObstacleSelect={onObstacleSelect}
      />,
    );

    clickAt(clientPointFor(0, 0, MOCK_LOCAL_COORDS.height), window);

    expect(onRoofPlace).toHaveBeenCalledTimes(1);
    const [x, y] = onRoofPlace.mock.calls[0];
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    // Draft mode never selects an obstacle underneath.
    expect(onObstacleSelect).not.toHaveBeenCalled();
  });

  it("ignores clicks without selection handlers", () => {    render(<Site3DViewer localCoords={MOCK_LOCAL_COORDS} obstacles={[OBSTACLE]} />);

    expect(() => clickAt({ clientX: 450, clientY: 250 }, window)).not.toThrow();
  });
  it("forwards roof clicks while drawing even before any preview exists", () => {
    // Regression: clicks used to require a preview mesh, so the first
    // footprint points could never accumulate.
    const onRoofPlace = vi.fn<(x: number, y: number) => void>();
    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[]}
        onRoofPlace={onRoofPlace}
        onRoofFinish={() => {}}
      />,
    );

    clickAt(clientPointFor(0, 0, MOCK_LOCAL_COORDS.height), window);

    expect(onRoofPlace).toHaveBeenCalledTimes(1);
    const [x, y] = onRoofPlace.mock.calls[0];
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("finishes footprint drawing on double-click", () => {
    const onRoofFinish = vi.fn<() => void>();
    render(
      <Site3DViewer
        localCoords={MOCK_LOCAL_COORDS}
        obstacles={[]}
        onRoofFinish={onRoofFinish}
      />,
    );

    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(new MouseEvent("dblclick"));

    expect(onRoofFinish).toHaveBeenCalledTimes(1);
  });
});
