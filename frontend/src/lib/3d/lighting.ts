/**
 * Sun lighting for the 3D scene.
 *
 * Converts solar azimuth/elevation into the scene's light direction and keeps
 * the shadow configuration in one place.
 *
 * Coordinate conventions (AGENTS.md §13/§64, one system only — no second frame):
 *   X = East, Y = North, Z = Up, 1 Three.js unit = 1 metre.
 *
 * The solar convention is the one the backend already reports: azimuth in
 * degrees from true North clockwise (0 = N, 90 = E, 180 = S, 270 = W) and
 * elevation above the horizon. A DirectionalLight shines from `position`
 * towards `target`, so the light is placed along the direction TO the sun —
 * shadows then fall on the far side of objects, never towards the light.
 *
 * AGENTS.md §24/§53: these shadows are visual simulation only. Quantitative
 * shading loss stays with the analytical (pvlib) pipeline.
 */

import * as THREE from "three";
import type { SunState } from "../solar/sunSamples";

const DEG = Math.PI / 180;

/**
 * Distance of the sun light from its target, in metres. Large enough that the
 * shadow camera's depth range stays comfortable for any rooftop the app allows.
 */
export const SUN_DISTANCE = 400;

/**
 * Direct-light intensity with the sun high overhead. `MeshStandardMaterial`
 * divides light intensity by PI, so a Lambertian surface lit by a 1.0
 * directional light only reaches ~32% reflectance. This value sits above 1.0
 * so a white/ivory wall actually reaches near-white at its specular peak,
 * while Neutral tone mapping keeps shaded faces out of the clip.
 */
export const SUN_INTENSITY_NOON = 2.9;

/** Ambient fill while the sun is up: shaded faces stay readable without
 * washing out the directional shadow contrast. Kept low enough that the
 * shadow side of the building and the rooftop stay clearly darker than the
 * lit side, so shadows read with weight rather than as flat grey. */
export const AMBIENT_DAY_INTENSITY = 0.72;

/** Ambient fill at night: dimmed, and clearly not daytime illumination. */
export const AMBIENT_NIGHT_INTENSITY = 0.35;

/** Sky colour for the hemisphere fill: cool daylight from above. */
export const HEMI_SKY_COLOR = 0xdff0ff;
/**
 * Ground colour for the hemisphere fill: a brighter, less saturated bounce
 * than before. The old muddy brown tint pulled the shadow side of the shell
 * towards grey and desaturated the warm white; a light warm grey keeps the
 * downward bounce natural without tinting the walls.
 */
export const HEMI_GROUND_COLOR = 0xb9b0a4;
/** Hemisphere fill in daylight: sky/ground variation so faces separate.
 * Deliberately weaker than the direct sun so shadowed regions keep visible
 * depth instead of lifting to the same tone as lit surfaces. */
export const HEMI_DAY_INTENSITY = 0.95;
/** Hemisphere fill at night: dimmed with everything else. */
export const HEMI_NIGHT_INTENSITY = 0.15;

/** Golden-hour colour (low sun) → daylight colour (high sun). */
export const SUN_COLOR_LOW = 0xffab66;
export const SUN_COLOR_HIGH = 0xfff6e8;

/**
 * Unit vector pointing TOWARDS the sun for an azimuth/elevation pair.
 *
 *   x = sin(az)·cos(el)   (east)
 *   y = cos(az)·cos(el)   (north)
 *   z = sin(el)           (up)
 */
export function sunDirectionVector(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const horizontal = Math.cos(el);
  return new THREE.Vector3(Math.sin(az) * horizontal, Math.cos(az) * horizontal, Math.sin(el));
}

/**
 * Direct sunlight intensity for an elevation: 0 at/below the horizon (night is
 * never lit as if it were day) and rising smoothly to `SUN_INTENSITY_NOON`.
 */
export function sunIntensity(elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  const factor = 0.15 + 0.85 * Math.sin(Math.min(elevationDeg, 90) * DEG);
  return SUN_INTENSITY_NOON * Math.min(1, Math.max(0, factor));
}

function lerpChannel(low: number, high: number, t: number): number {
  return Math.round(low + (high - low) * t);
}

/**
 * Light colour: warm at the horizon, neutral daylight by ~30° elevation.
 * Returned as a hex so tests can assert it without a renderer.
 */
export function sunColorHex(elevationDeg: number): number {
  const t = Math.min(1, Math.max(0, elevationDeg) / 30);
  const low = { r: (SUN_COLOR_LOW >> 16) & 255, g: (SUN_COLOR_LOW >> 8) & 255, b: SUN_COLOR_LOW & 255 };
  const high = { r: (SUN_COLOR_HIGH >> 16) & 255, g: (SUN_COLOR_HIGH >> 8) & 255, b: SUN_COLOR_HIGH & 255 };
  const r = lerpChannel(low.r, high.r, t);
  const g = lerpChannel(low.g, high.g, t);
  const b = lerpChannel(low.b, high.b, t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Half-extent of the shadow camera's ortho box, in metres: it must cover the
 * ground reference plane (footprint × 1.5) and the building from any sun
 * direction, with a floor so tiny roofs still use the map sensibly.
 */
export function shadowCameraExtent(footprint: number, height: number): number {
  return Math.max(40, Math.max(footprint, 1) * 1.15 + Math.max(height, 0) * 0.5);
}

/**
 * Size the shadow camera for a building and refresh its projection matrix.
 * Must be called after changing the bounds — an OrthographicCamera does not
 * recompute its projection on its own.
 */
export function configureSunShadows(
  light: THREE.DirectionalLight,
  footprint: number,
  height: number,
): number {
  const extent = shadowCameraExtent(footprint, height);
  const shadow = light.shadow;
  shadow.camera.left = -extent;
  shadow.camera.right = extent;
  shadow.camera.top = extent;
  shadow.camera.bottom = -extent;
  shadow.camera.near = Math.max(0.1, SUN_DISTANCE - extent * 2);
  shadow.camera.far = SUN_DISTANCE + extent * 2;
  shadow.camera.updateProjectionMatrix();

  // 2048² covers the box at ~2–4 cm per texel for a typical rooftop site —
  // crisp for the desktop design viewport without punishing laptop GPUs.
  // Mobile stays out of the design workspace (gated by layout CSS).
  shadow.mapSize.set(2048, 2048);

  // Shadow contact fix. Both offsets act together on the DEPTH lookup, and
  // together they produce the visible white seam between an obstacle's base
  // and its shadow:
  //  * `normalBias` shifts the sample along the surface NORMAL by 0.02 m.
  //    On a flat roof (normal +Z) that pulls every shadow sample 2 cm
  //    *up away from the roof*, so the shadow edge retreats from the object
  //    base by roughly one texel and leaves a lit rim at the contact line.
  //  * `bias` subtracts a constant from the fragment depth, which further
  //    offsets the result in map units rather than world units.
  // Setting normalBias to 0 removes the uniform push so the shadow meets the
  // base, and a small world-unit `bias` keeps acne away instead. The value is
  // derived from the texel size (2/2^2048 of the ortho box) so it stays
  // correct when the extent or map size changes.
  shadow.normalBias = 0;
  const texel = (2 * extent) / shadow.mapSize.width;
  shadow.bias = -Math.min(Math.max(texel * 1.5, 0.000002), 0.0005);
  return extent;
}

/**
 * Apply a sun state to the scene's two lights.
 *
 * Night (apparent elevation ≤ 0) switches the direct light off entirely and
 * dims the ambient fill, so below-horizon sun is never presented as normal
 * daytime illumination. Callers should refresh the shadow map on transitions.
 */
export function applySunToScene(
  sun: THREE.DirectionalLight,
  ambient: THREE.AmbientLight,
  state: SunState,
  hemi?: THREE.HemisphereLight | null,
): void {
  if (state.night || state.elevationDeg <= 0) {
    sun.intensity = 0;
    ambient.intensity = AMBIENT_NIGHT_INTENSITY;
    if (hemi) hemi.intensity = HEMI_NIGHT_INTENSITY;
    return;
  }

  const distance = typeof sun.userData.sunDistance === "number" ? sun.userData.sunDistance : SUN_DISTANCE;
  const direction = sunDirectionVector(state.azimuthDeg, state.elevationDeg);
  sun.position.copy(sun.target.position).addScaledVector(direction, distance);
  sun.target.updateMatrixWorld();

  sun.intensity = sunIntensity(state.elevationDeg);
  sun.color.setHex(sunColorHex(state.elevationDeg));
  ambient.intensity = AMBIENT_DAY_INTENSITY;
  if (hemi) hemi.intensity = HEMI_DAY_INTENSITY;
}
