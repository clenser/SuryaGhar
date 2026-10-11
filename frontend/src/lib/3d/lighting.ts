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

/** Weather preset adjustments (applied on top of the solar calculation).
 *  These modify light intensities/colors only — solar position, shadow
 *  camera, and energy calculations are completely unchanged. */
export type WeatherPreset = "sunny" | "cloudy" | "rainy";

/** Base adjustment factors for each preset. */
const WEATHER_ADJUSTMENTS: Record<WeatherPreset, {
  sunIntensityFactor: number;
  ambientIntensityFactor: number;
  hemiIntensityFactor: number;
  sunColorShift: number; // -1..1, negative = cooler, positive = warmer
}> = {
  sunny: {
    sunIntensityFactor: 1.0,
    ambientIntensityFactor: 1.0,
    hemiIntensityFactor: 1.0,
    sunColorShift: 0,
  },
  cloudy: {
    sunIntensityFactor: 0.7,
    ambientIntensityFactor: 1.15,
    hemiIntensityFactor: 1.05,
    sunColorShift: -0.15,
  },
  rainy: {
    sunIntensityFactor: 0.65,
    ambientIntensityFactor: 1.2,
    hemiIntensityFactor: 1.1,
    sunColorShift: -0.25,
  },
};

/** Apply a weather preset adjustment to the scene lights.
 *  This is called after applySunToScene() and only modifies existing light
 *  properties (intensity, color) — it does NOT create new lights, move the
 *  sun, or alter shadow camera settings. The solar position (azimuth/elevation)
 *  and all analytical calculations remain unchanged.
 */
export function applyWeatherPreset(
  sun: THREE.DirectionalLight,
  ambient: THREE.AmbientLight,
  hemi: THREE.HemisphereLight | null,
  preset: WeatherPreset,
): void {
  const adj = WEATHER_ADJUSTMENTS[preset] || WEATHER_ADJUSTMENTS.sunny;

  // Adjust sun directional light intensity (multiplies the elevation-dependent
  // intensity set by applySunToScene(), preserving sun position behavior).
  sun.intensity *= adj.sunIntensityFactor;

  // Adjust sun color via a subtle shift in the hex value.
  // We shift the existing color toward cooler/warmter by modulating channels.
  // The sun's color was set by applySunToScene() using sunColorHex(); we
  // apply an additional shift here so the change is on top of the solar-driven
  // color rather than replacing it.
  const currentR = (sun.color.getHex() >> 16) & 255;
  const currentG = (sun.color.getHex() >> 8) & 255;
  const currentB = sun.color.getHex() & 255;
  const shift = adj.sunColorShift; // -1 = very cool, 1 = very warm
  // Clamp shift to reasonable range and apply as a channel delta
  const delta = Math.max(-1, Math.min(1, shift)) * 30; // ~30 units per shift unit
  const newR = Math.max(0, Math.min(255, currentR + delta));
  const newG = Math.max(0, Math.min(255, currentG + delta * 0.8));
  const newB = Math.max(0, Math.min(255, currentB + delta * 0.6));
  sun.color.setRGB(newR / 255, newG / 255, newB / 255);

  // Adjust ambient fill intensity
  ambient.intensity = AMBIENT_DAY_INTENSITY * adj.ambientIntensityFactor;

  // Adjust hemisphere fill intensity and optionally its color for "rainy"
  if (hemi) {
    hemi.intensity = HEMI_DAY_INTENSITY * adj.hemiIntensityFactor;
    // For rainy: slight cooler shift on the hemisphere too
    if (preset === "rainy") {
      const currentHR = (hemi.color.getHex() >> 16) & 255;
      const currentHG = (hemi.color.getHex() >> 8) & 255;
      const currentHB = hemi.color.getHex() & 255;
      const rainShift = -0.1; // mild cooler bias
      const r2 = Math.max(0, Math.min(255, currentHR + Math.round(rainShift * 80)));
      const g2 = Math.max(0, Math.min(255, currentHG + Math.round(rainShift * 60)));
      const b2 = Math.max(0, Math.min(255, currentHB + Math.round(rainShift * 40)));
      hemi.color.setRGB(r2 / 255, g2 / 255, b2 / 255);
    }
  }
}

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

  // Shadow contact. Verified against the three.js shader
  // (`shadowCoord.z += shadowBias`, lit iff `z + bias <= stored depth`):
  // a NEGATIVE bias therefore shrinks every shadow, pulling the shadow edge
  // back from the caster base by roughly bias * depthSpan in world units.
  // The previous constant (-0.0005 over a ~160 m depth span) offset the edge
  // by ~8 cm - a full texel or two of bright seam that reads as a floating
  // obstacle. `normalBias` stays 0: any positive value lifts the receiver
  // sample off the roof and retreats the edge the same way.
  //
  // The replacement is scale-invariant: half a world-space texel expressed in
  // normalized depth units, so the contact offset stays ~1-2 cm no matter how
  // the ortho box or map size changes. Small enough to keep the shadow glued
  // to the base, still non-zero so flat Receiver planes do not speckle.
  shadow.normalBias = 0;
  const texelWorld = (2 * extent) / shadow.mapSize.width;
  const depthSpan = shadow.camera.far - shadow.camera.near;
  shadow.bias = depthSpan > 0 ? (-0.5 * texelWorld) / depthSpan : -0.00005;
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
