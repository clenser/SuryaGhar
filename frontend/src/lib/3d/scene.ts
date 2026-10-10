/**
 * Three.js Scene Setup
 *
 * Creates and configures the core Three.js objects:
 * - Scene
 * - Renderer (WebGL, antialiased, alpha for theme support)
 * - Camera (PerspectiveCamera, framed to the building)
 * - OrbitControls (controlled architectural viewer)
 * - Lights (Ambient + Directional for basic shading)
 *
 * AGENTS.md §14: camera supports horizontal rotation, vertical/elevation
 * rotation and zoom only — no free-fly, no roll, no first-person.
 * AGENTS.md §64: 1 Three.js unit = 1 metre.
 * AGENTS.md §72: Three.js owns scene/camera/rendering; React owns UI state.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LocalCoords3D } from "./coordinates";
import {
  AMBIENT_DAY_INTENSITY,
  HEMI_DAY_INTENSITY,
  HEMI_GROUND_COLOR,
  HEMI_SKY_COLOR,
  SUN_DISTANCE,
  SUN_INTENSITY_NOON,
  applySunToScene,
  configureSunShadows,
} from "./lighting";

export interface SceneSetup {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  lights: THREE.Object3D[];
  /** Key light driven by the sun simulation (Phase 4) */
  sunLight: THREE.DirectionalLight;
  /** Ambient fill, dimmed while the sun is below the horizon */
  ambientLight: THREE.AmbientLight;
  /** Sky/ground hemisphere fill, dimmed with the sun */
  hemiLight: THREE.HemisphereLight;
  /** Cleanup function to dispose of all Three.js resources */
  dispose: () => void;
}

/** Everything the camera framing needs, in metres. */
export interface BuildingFraming {
  /** Larger footprint side (metres) */
  footprint: number;
  /** Building height (metres) */
  height: number;
}

/**
 * Bounding box of the extruded building: footprint on the ground plane,
 * Z from 0 (ground) to `height` (roof). Used for framing, never for
 * authoritative measurements — those stay in `lib/geo.ts`.
 */
export function buildingBounds(localCoords: LocalCoords3D): THREE.Box3 {
  const box = new THREE.Box3();
  for (const v of localCoords.vertices) {
    box.expandByPoint(v);
  }
  box.min.z = 0;
  box.max.z = Math.max(localCoords.height, 0);
  return box;
}

/** Derive framing distances (metres) from the building bounding box. */
export function framingFromBox(box: THREE.Box3): BuildingFraming {
  const size = box.getSize(new THREE.Vector3());
  return { footprint: Math.max(size.x, size.y), height: size.z };
}

/**
 * Create a Three.js scene with professional defaults.
 * Dark neutral studio background (M2 redesign): restrained, contrasts the
 * warm-white building, and makes directional shadows easy to read.
 */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161d);
  return scene;
}

/**
 * Create a WebGL renderer configured for the application.
 * - Antialiased for crisp edges
 * - Alpha=true so the themed panel background shows through
 * - Pixel ratio clamped for performance on high-DPI screens
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  // Shadow maps are rendered on demand: `autoUpdate` stays false and the
  // sun simulation / geometry rebuilds set `needsUpdate` instead, so a static
  // scene never pays for a shadow pass every frame (AGENTS.md §45).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;

  // Khronos "PBR Neutral" tone mapping. Three's ACES path multiplies by
  // exposure/0.6 and runs an ACES input/output matrix that desaturates and
  // hue-shifts midtones, which is what turned the warm-white shell grey and
  // muddy. Neutral keeps albedos < ~0.8 close to linear (so the ivory walls
  // still read as clean white) and rolls off highlights gently, avoiding
  // both the grey wash and clipped whites. Exactly one exposure term is
  // applied here; light intensities are rebalanced to sit under the
  // shoulder instead of compensating with a second exposure.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  return renderer;
}

/**
 * Clamp an orbiting camera so it can never sit inside the building volume.
 *
 * OrbitControls derives its spherical offset from `camera.position` every
 * frame, so a positional clamp written *after* `controls.update()` is stable
 * (the next update reads the corrected position). The camera is pushed out
 * along the target→camera ray to the nearest box exit plus a small margin —
 * enough to clear the shell without a visible pop, and without capping zoom
 * distance: looking straight down at the roof stays allowed at any distance,
 * because the camera only ever gets clamped when it is actually inside the
 * box. No physics, no angle locks, and it adapts automatically whenever the
 * building bounds change.
 */
export function keepCameraOutsideBox(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
): void {
  const position = camera.position;
  if (!box.containsPoint(position)) return;
  const exit = new THREE.Vector3();
  const ray = new THREE.Ray(controls.target, position.clone().sub(controls.target).normalize());
  if (!ray.intersectBox(box, exit)) return;
  const distance = controls.target.distanceTo(exit) + CAMERA_CLEARANCE_M;
  position.copy(controls.target).add(
    position.clone().sub(controls.target).normalize().multiplyScalar(distance),
  );
}

/** Margin outside the shell the camera is pushed to, in metres. Small enough
 * to read as continuous motion, large enough to clear the extruded walls. */
const CAMERA_CLEARANCE_M = 0.25;

/** Default viewing angle: ~35° elevation, 45° azimuth offset. */
const DEFAULT_ELEVATION_DEG = 35;
const DEFAULT_AZIMUTH_DEG = 45;

/**
 * How much of the viewport the site should fill. 0.85 leaves a modest margin
 * of surrounding satellite context while keeping the selected building as the
 * clear subject — the previous fixed `size * 1.8` distance ignored the
 * camera's FOV and aspect entirely, so wide viewports zoomed the site out.
 */
const FRAME_FILL = 0.85;

/** The three unit vectors that describe the default view, in world metres. */
interface ViewBasis {
  /** unit vector from the orbit target towards the camera */
  toCamera: THREE.Vector3;
  /** camera-space right (horizontal in a Z-up scene) */
  right: THREE.Vector3;
  /** camera-space up */
  up: THREE.Vector3;
}

/**
 * Orthonormal basis of the default view. Because the scene is Z-up, the
 * horizontal axis is derived from the world +Z up vector — using three's
 * default Y-up here would roll the framing 90°.
 */
function viewBasis(): ViewBasis {
  const elevation = THREE.MathUtils.degToRad(DEFAULT_ELEVATION_DEG);
  const azimuth = THREE.MathUtils.degToRad(DEFAULT_AZIMUTH_DEG);
  const horizontal = Math.cos(elevation);
  const toCamera = new THREE.Vector3(
    horizontal * Math.sin(azimuth),
    horizontal * Math.cos(azimuth),
    Math.sin(elevation),
  );
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), toCamera).normalize();
  const up = new THREE.Vector3().crossVectors(toCamera, right).normalize();
  return { toCamera, right, up };
}

/**
 * Distance that fits the site's bounding box inside the frame.
 *
 * A box with half-extents (hx, hy, hz) projects onto the camera's view plane
 * with half-width Σ|hᵢ·rightᵢ| and half-height Σ|hᵢ·upᵢ| (the standard
 * "project a box onto an axis" identity). Each is scaled to FRAME_FILL of the
 * viewport and solved for distance, and the binding (larger) one wins:
 *
 *   d = halfExtent / (fill · tan(fov/2))            vertical
 *   d = halfExtent / (fill · aspect · tan(fov/2))   horizontal
 *
 * This uses the site's real dimensions and the live camera FOV/aspect, so the
 * same code frames a 20 m shed and a 200 m warehouse correctly.
 */
function framingDistance(
  basis: ViewBasis,
  halfExtent: THREE.Vector3,
  fovDeg: number,
  aspect: number,
): number {
  const fov = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(fovDeg, 1, 179));
  const halfHeight =
    Math.abs(halfExtent.x * basis.up.x) +
    Math.abs(halfExtent.y * basis.up.y) +
    Math.abs(halfExtent.z * basis.up.z);
  const halfWidth =
    Math.abs(halfExtent.x * basis.right.x) +
    Math.abs(halfExtent.y * basis.right.y) +
    Math.abs(halfExtent.z * basis.right.z);
  const tanHalf = Math.tan(fov / 2);
  const vertical = halfHeight / (FRAME_FILL * tanHalf);
  const horizontal = halfWidth / (FRAME_FILL * Math.max(aspect, 0.25) * tanHalf);
  return Math.max(vertical, horizontal);
}

function defaultCameraPosition(
  camera: THREE.PerspectiveCamera,
  framing: BuildingFraming,
): THREE.Vector3 {
  // Half-extents of the site box: footprint is the larger horizontal side, so
  // the box is a square of that side plus the full height. Height matters
  // through the vertical solve, so a tall block frames correctly too.
  const half = framing.footprint / 2;
  const halfHeight = framing.height / 2;
  const halfExtent = new THREE.Vector3(half, half, halfHeight);
  const basis = viewBasis();
  const distance = framingDistance(basis, halfExtent, camera.fov, camera.aspect);
  return basis.toCamera.multiplyScalar(distance).add(new THREE.Vector3(0, 0, halfHeight));
}

/**
 * Place the camera in the default framing and point it at the building centre
 * (half height), keeping the building as the permanent target.
 *
 * Z-up scene (X = east, Y = north, Z = up): the camera's up vector MUST be
 * +Z before lookAt/controls. Three.js defaults to +Y; with +Y the view rolls
 * 90° (ground reads as a vertical slab) and OrbitControls orbits around the
 * north axis instead of up, making vertical inspection feel broken. Setting
 * it here (rather than only at construction) keeps Reset View correct too.
 */
export function frameCamera(camera: THREE.PerspectiveCamera, framing: BuildingFraming): void {
  camera.up.set(0, 0, 1);
  const position = defaultCameraPosition(camera, framing);
  camera.position.copy(position);
  camera.lookAt(0, 0, framing.height * 0.5);
}

/**
 * Configure OrbitControls for architectural/site-design viewing.
 *
 * AGENTS.md §14 constraints:
 * - Horizontal rotation (azimuth): enabled
 * - Vertical/elevation rotation: enabled, clamped so the view never flips
 * - Zoom: enabled
 * - Pan: disabled (the building stays centred)
 * - Roll / free-fly / keyboard walk: not available
 */
export function frameControls(controls: OrbitControls, framing: BuildingFraming): void {
  const size = Math.max(framing.footprint, framing.height, 1);

  controls.minPolarAngle = 0.15;             // ~8.5° from straight down
  controls.maxPolarAngle = Math.PI * 0.48;   // just above the horizon
  controls.minDistance = Math.max(size * 0.15, 2);
  controls.maxDistance = Math.max(size * 12, 100);
  controls.target.set(0, 0, framing.height * 0.5);
}

/**
 * Create OrbitControls bound to the renderer canvas (mouse + touch).
 */
export function createOrbitControls(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  framing: BuildingFraming
): OrbitControls {
  const controls = new OrbitControls(camera, renderer.domElement);

  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;          // building stays the focus
  controls.enableDamping = true;       // smooth momentum
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 1.0;

  frameControls(controls, framing);

  // Mouse/touch mapping: rotate with one finger or button, zoom with wheel or
  // pinch. Two-finger drag both zooms and orbits instead of panning away.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };

  return controls;
}

/**
 * The lights a scene needs: the list to add to the scene plus named access.
 */
export interface SceneLights {
  /** Objects to add to the scene (ambient, hemisphere, sun, sun target) */
  objects: THREE.Object3D[];
  /** Directional key light — the sun, driven by the simulation */
  sun: THREE.DirectionalLight;
  /** Ambient fill, dimmed while the sun is below the horizon */
  ambient: THREE.AmbientLight;
  /** Sky/ground hemisphere fill — subtle directional variation for faces */
  hemi: THREE.HemisphereLight;
}

/**
 * Scene lighting: ambient fill plus one directional key light.
 *
 * The directional light is the sun (Phase 4): `configureSunShadows` sizes its
 * shadow camera to the building, and `applySunToScene` overwrites this default
 * pose with the computed solar position on the first rendered frame. The
 * default here only keeps the scene readable if no simulation is attached.
 */
export function createLights(buildingHeight: number, footprint?: number): SceneLights {
  const objects: THREE.Object3D[] = [];

  const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_DAY_INTENSITY);
  objects.push(ambient);

  const hemi = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_DAY_INTENSITY);
  // Z-up scene (X = east, Y = north, Z = up). Three.js takes a
  // HemisphereLight's fill direction from the light's OWN world position
  // (`setupView` copies matrixWorld and transformDirection's it), weight
  // 0.5·dot(normal, dir)+0.5 — so the sky colour lands on faces that point
  // AT the light. Its constructor default sits at (0, 1, 0), i.e. +Y = north,
  // which aims the fill horizontally: the roof and the satellite ground
  // (both horizontal, normal +Z) scored dot = 0 and got a 50/50 sky/ground
  // mix — the muddy half of the pair — instead of the clean sky. Aiming the
  // light up the +Z axis gives horizontal faces full sky and side walls the
  // vertical separation. Verified against three r169's WebGLLights source.
  hemi.position.set(0, 0, Math.max(buildingHeight, 1));
  objects.push(hemi);

  // Placeholder intensity: `applySunToScene` below immediately overwrites it
  // with the elevation-derived value, so this only guards the brief pre-sim
  // frame and never needs to match SUN_INTENSITY_NOON.
  const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY_NOON);
  sun.castShadow = true;
  sun.userData.sunDistance = SUN_DISTANCE;
  sun.target.position.set(0, 0, buildingHeight * 0.5);

  // Default pose: high sun from the south-east — replaced by the simulation.
  applySunToScene(sun, ambient, { azimuthDeg: 135, elevationDeg: 45, night: false }, hemi);
  configureSunShadows(sun, footprint ?? buildingHeight, buildingHeight);

  objects.push(sun);
  objects.push(sun.target);

  return { objects, sun, ambient, hemi };
}

/**
 * Update camera aspect and projection on resize.
 */
export function updateCameraAspect(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): void {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/**
 * Full scene setup convenience function: scene, renderer, camera, controls and
 * lights, framed to the building. Geometries/materials are owned by the caller.
 */
export function setupScene(
  canvas: HTMLCanvasElement,
  localCoords: LocalCoords3D
): SceneSetup {
  const scene = createScene();
  const renderer = createRenderer(canvas);

  const framing = framingFromBox(buildingBounds(localCoords));

  const aspect = canvas.clientWidth / canvas.clientHeight;
  const camera = new THREE.PerspectiveCamera(45, aspect > 0 ? aspect : 16 / 9, 0.1, 10000);
  frameCamera(camera, framing);

  const controls = createOrbitControls(camera, renderer, framing);
  const { objects: lights, sun: sunLight, ambient: ambientLight, hemi: hemiLight } = createLights(
    framing.height,
    framing.footprint,
  );

  for (const light of lights) {
    scene.add(light);
  }

  const dispose = () => {
    controls.dispose();
    renderer.dispose();
    // Building geometries/materials are disposed by the viewer component.
    scene.clear();
  };

  return {
    scene,
    renderer,
    camera,
    controls,
    lights,
    sunLight,
    ambientLight,
    hemiLight,
    dispose,
  };
}
