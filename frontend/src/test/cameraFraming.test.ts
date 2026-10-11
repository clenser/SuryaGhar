/**
 * Default-camera regression tests (correction milestone): the Z-up scene
 * demands a +Z camera up vector â€” with the Three.js +Y default the view
 * rolls 90Â° (ground reads as a vertical slab) and OrbitControls orbits the
 * wrong axis. These tests pin the contract with real cameras/controls
 * (no renderer needed) and deterministic framings.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { enableCtrlDragPan, frameCamera, frameControls, keepCameraOutsideBox } from "../lib/3d/scene";

/**
 * A div OrbitControls can own in jsdom. jsdom elements lack pointer capture,
 * ? the mapping logic under test does not depend on them.
 */
function panContainer(): HTMLDivElement {
  const container = document.createElement("div");
  (container as HTMLDivElement & { setPointerCapture?: (id: number) => void }).setPointerCapture = () => {};
  (container as HTMLDivElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture = () => {};
  return container;
}

function freshCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
  camera.up.set(0, 1, 0); // simulate the Three.js default a bug could restore
  return camera;
}

describe("default camera framing", () => {
  it("uses +Z up so the view is upright in the east/north/up world", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
  });

  it("looks at the building centre from an elevated three-quarter angle", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    // Above the roof, off to the south-east: roof + two walls readable.
    expect(camera.position.z).toBeGreaterThan(20);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const toTarget = new THREE.Vector3(0, 0, 10).sub(camera.position).normalize();
    expect(dir.dot(toTarget)).toBeCloseTo(1, 6);
  });

  it("scales the camera distance with the footprint, never a fixed constant", () => {
    const small = freshCamera();
    const big = freshCamera();
    frameCamera(small, { footprint: 20, height: 5 });
    frameCamera(big, { footprint: 400, height: 60 });
    const dist = (c: THREE.PerspectiveCamera, h: number) =>
      c.position.distanceTo(new THREE.Vector3(0, 0, h / 2));
    expect(dist(big, 60)).toBeGreaterThan(dist(small, 5) * 5);
  });

  it("Reset View restores the identical default (up, position, target)", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const expected = camera.position.clone();
    // Simulate user orbiting away, then resetting.
    camera.position.set(500, -300, 2);
    camera.up.set(0, 1, 0);
    frameCamera(camera, { footprint: 100, height: 20 });
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it("constrains orbit to elevation rotation around up with bounded zoom", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      frameControls(controls, { footprint: 100, height: 20 });
      // Polar axis is +Z (up): horizontal drags orbit the building, vertical
      // drags change elevation â€” never roll, never below the ground plane.
      // The pole itself (0) is the top-down plan view; makeSafe() keeps the
      // camera from ever sitting exactly on the azimuth singularity.
      expect(controls.minPolarAngle).toBe(0);
      expect(controls.maxPolarAngle).toBeLessThan(Math.PI / 2);
      expect(controls.target.toArray()).toEqual([0, 0, 10]);
      expect(controls.minDistance).toBeLessThan(controls.maxDistance);
    } finally {
      controls.dispose();
    }
  });

  it("reaches the exact top-down view without flipping", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      frameControls(controls, { footprint: 100, height: 20 });
      const toDeg = (r: number) => (r * 180) / Math.PI;
      // The pole itself is the top-down plan view: OrbitControls clamps phi
      // with Math.max(minPolarAngle, â€¦) and Spherical.makeSafe() nudges it to
      // EPS, so 0 reaches perpendicular without the azimuth singularity.
      expect(controls.minPolarAngle).toBe(0);
      // Downward drags reach wall-inspection grazing angles but stop above
      // the horizon, so the camera can never pass beneath the ground.
      expect(toDeg(controls.maxPolarAngle)).toBeGreaterThanOrEqual(80);
      expect(toDeg(controls.maxPolarAngle)).toBeLessThanOrEqual(88);
    } finally {
      controls.dispose();
    }
  });

  it("keeps the camera above ground for any building height and zoom", () => {
    // Lowest possible camera height = target height + minDistanceÂ·cos(maxPolar).
    // maxPolar < 90Â° keeps cos positive, so this stays above z = 0 for every
    // height â€” the explicit ground-safety relationship, not a magic constant.
    for (const height of [2, 15, 60, 200]) {
      const camera = freshCamera();
      frameCamera(camera, { footprint: 100, height });
      const controls = new OrbitControls(camera, document.createElement("div"));
      try {
        frameControls(controls, { footprint: 100, height });
        const lowest =
          controls.target.z + controls.minDistance * Math.cos(controls.maxPolarAngle);
        expect(lowest).toBeGreaterThan(0);
      } finally {
        controls.dispose();
      }
    }
  });

  it("leaves azimuth free while the target stays on the building centre", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      frameControls(controls, { footprint: 100, height: 20 });
      expect(controls.minAzimuthAngle).toBe(-Infinity);
      expect(controls.maxAzimuthAngle).toBe(Infinity);
      // OrbitControls.update() never moves the target by itself (pan is
      // disabled for inspection): the site stays fixed under orbit.
      const before = controls.target.clone();
      controls.update();
      expect(controls.target.distanceTo(before)).toBeLessThan(1e-9);
    } finally {
      controls.dispose();
    }
  });

  it("captures the Z-up pole at construction so later updates stay upright", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      // update() must not roll the camera or rewrite its up vector.
      controls.update();
      expect(camera.up.toArray()).toEqual([0, 0, 1]);
      const dir = camera.getWorldDirection(new THREE.Vector3());
      expect(dir.z).toBeLessThan(0); // looking down toward the site, never up
    } finally {
      controls.dispose();
    }
  });
});

describe("top-down reach and pan", () => {
  it("reaches a perpendicular plan view at the pole", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      frameControls(controls, { footprint: 100, height: 20 });
      // Drive the orbit to the minimum polar angle and step once: the view
      // direction must be straight down within the makeSafe epsilon.
      camera.position.set(0, 0, 200);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 10);
      controls.update();
      const dir = camera.getWorldDirection(new THREE.Vector3());
      expect(dir.x).toBeCloseTo(0, 3);
      expect(dir.y).toBeCloseTo(0, 3);
      expect(dir.z).toBeCloseTo(-1, 3);
    } finally {
      controls.dispose();
    }
  });

  it("swaps left-drag to pan only for a Ctrl gesture and restores it", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const container = panContainer();
    const controls = new OrbitControls(camera, container);
    const cleanup = enableCtrlDragPan(controls, container);
    try {
      expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
      container.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, ctrlKey: true, bubbles: true }),
      );
      expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
      // Ctrl+left down (capture on the container) switches the mapping…
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
      // A plain left drag never touches the mapping.
      container.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      // …and releasing anywhere restores plain rotate.
      );
      expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    } finally {
      cleanup();
      controls.dispose();
    }
  });

  it("cleanup restores the rotate mapping even mid-gesture", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 100, height: 20 });
    const container = panContainer();
    const controls = new OrbitControls(camera, container);
    const cleanup = enableCtrlDragPan(controls, container);
    container.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, ctrlKey: true, bubbles: true }),
    );
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
    cleanup();
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    controls.dispose();
  });

  it("pushes a camera inside the building back outside it", () => {
    const camera = freshCamera();
    frameCamera(camera, { footprint: 20, height: 10 });
    const controls = new OrbitControls(camera, document.createElement("div"));
    try {
      frameControls(controls, { footprint: 20, height: 10 });
      const box = new THREE.Box3(
        new THREE.Vector3(-10, -10, 0),
        new THREE.Vector3(10, 10, 10),
      );
      // Park the camera inside the volume with the target at its centre.
      camera.position.set(2, 0, 5);
      controls.target.set(0, 0, 5);
      keepCameraOutsideBox(camera, controls, box);
      expect(box.containsPoint(camera.position)).toBe(false);
      // A target sitting exactly on the box face still escapes upward.
      camera.position.set(0, 0, 5);
      controls.target.set(0, 0, 10);
      keepCameraOutsideBox(camera, controls, box);
      expect(box.containsPoint(camera.position)).toBe(false);
      // …while a camera already outside is left exactly where it was.
      const outside = new THREE.Vector3(60, 40, 60);
      camera.position.copy(outside);
      keepCameraOutsideBox(camera, controls, box);
      expect(camera.position.distanceTo(outside)).toBeLessThan(1e-9);
    } finally {
      controls.dispose();
    }
  });
});
