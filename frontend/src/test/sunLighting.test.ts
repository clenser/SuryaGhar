/**
 * Sun lighting tests: solar azimuth/elevation → Three.js light direction,
 * intensity/colour ramp, night handling and shadow-camera configuration.
 *
 * Coordinate convention under test (AGENTS.md §13/§64): X = East, Y = North,
 * Z = Up, one unit = one metre, and the light is placed along the direction
 * TO the sun so shadows fall on the far side of objects.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AMBIENT_DAY_INTENSITY,
  AMBIENT_NIGHT_INTENSITY,
  HEMI_DAY_INTENSITY,
  HEMI_NIGHT_INTENSITY,
  SUN_COLOR_HIGH,
  SUN_COLOR_LOW,
  SUN_DISTANCE,
  SUN_INTENSITY_NOON,
  applySunToScene,
  configureSunShadows,
  shadowCameraExtent,
  sunColorHex,
  sunDirectionVector,
  sunIntensity,
} from "../lib/3d/lighting";
import { createLights } from "../lib/3d/scene";

function directionFor(azimuthDeg: number, elevationDeg: number) {
  return sunDirectionVector(azimuthDeg, elevationDeg);
}

describe("sunDirectionVector", () => {
  it("points at the four cardinal directions", () => {
    // `+ 0` normalises -0 (from rounding a tiny negative) so toEqual sees 0.
    const rounded = (direction: THREE.Vector3) => direction.toArray().map((v) => Math.round(v) + 0);
    expect(rounded(directionFor(0, 0))).toEqual([0, 1, 0]); // North
    expect(rounded(directionFor(90, 0))).toEqual([1, 0, 0]); // East
    expect(rounded(directionFor(180, 0))).toEqual([0, -1, 0]); // South
    expect(rounded(directionFor(270, 0))).toEqual([-1, 0, 0]); // West
  });

  it("points straight up at the zenith and stays in the northern sky at low azimuths", () => {
    const zenith = directionFor(0, 90);
    expect(zenith.z).toBeCloseTo(1, 9);
    expect(Math.hypot(zenith.x, zenith.y)).toBeCloseTo(0, 9);

    const northEast = directionFor(45, 0);
    expect(northEast.x).toBeCloseTo(Math.SQRT1_2, 9); // east component
    expect(northEast.y).toBeCloseTo(Math.SQRT1_2, 9); // north component
  });

  it("stays a unit vector for every elevation", () => {
    for (const elevation of [1, 15, 45, 75, 89]) {
      for (const azimuth of [0, 90, 200, 359]) {
        const direction = directionFor(azimuth, elevation);
        expect(direction.length()).toBeCloseTo(1, 9);
        expect(direction.z).toBeGreaterThan(0);
      }
    }
  });

  it("rises over the eastern horizon for an eastern azimuth", () => {
    const rising = directionFor(90, 10);
    expect(rising.x).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 9);
    expect(rising.z).toBeGreaterThan(0);
  });
});

describe("sunIntensity", () => {
  it("is zero at and below the horizon so night is never lit like day", () => {
    expect(sunIntensity(0)).toBe(0);
    expect(sunIntensity(-0.1)).toBe(0);
    expect(sunIntensity(-45)).toBe(0);
  });

  it("rises with the sun and peaks at the noon value", () => {
    expect(sunIntensity(45)).toBeGreaterThan(0);
    expect(sunIntensity(45)).toBeLessThan(SUN_INTENSITY_NOON);
    expect(sunIntensity(90)).toBeCloseTo(SUN_INTENSITY_NOON, 6);

    let previous = -1;
    for (const elevation of [1, 5, 15, 30, 60, 90]) {
      const value = sunIntensity(elevation);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe("sunColorHex", () => {
  it("is warm at the horizon and neutral overhead", () => {
    expect(sunColorHex(0)).toBe(SUN_COLOR_LOW);
    expect(sunColorHex(30)).toBe(SUN_COLOR_HIGH);
    expect(sunColorHex(90)).toBe(SUN_COLOR_HIGH);

    // In between, every channel stays within the warm → neutral ramp.
    const channel = (hex: number, shift: number) => (hex >> shift) & 255;
    const mid = sunColorHex(15);
    expect(mid).not.toBe(SUN_COLOR_LOW);
    expect(mid).not.toBe(SUN_COLOR_HIGH);
    for (const shift of [16, 8, 0]) {
      expect(channel(mid, shift)).toBeGreaterThanOrEqual(channel(SUN_COLOR_LOW, shift));
      expect(channel(mid, shift)).toBeLessThanOrEqual(channel(SUN_COLOR_HIGH, shift));
    }
  });
});

describe("shadow camera configuration", () => {
  it("sizes the ortho box from the footprint and height with a floor", () => {
    expect(shadowCameraExtent(2, 2)).toBe(40);
    expect(shadowCameraExtent(26.7, 17.2)).toBe(40); // 30.7 + 8.6 < 40 floor
    expect(shadowCameraExtent(60, 10)).toBeCloseTo(74, 6);
  });

  it("applies the bounds and refreshes the projection matrix", () => {
    const light = new THREE.DirectionalLight(0xffffff, 1);
    const extent = configureSunShadows(light, 60, 10);

    expect(light.shadow.camera.left).toBe(-extent);
    expect(light.shadow.camera.right).toBe(extent);
    expect(light.shadow.camera.top).toBe(extent);
    expect(light.shadow.camera.bottom).toBe(-extent);
    expect(light.shadow.camera.near).toBeGreaterThan(0);
    expect(light.shadow.camera.far).toBeGreaterThan(light.shadow.camera.near);
    expect(light.shadow.mapSize.width).toBe(2048);
    expect(light.shadow.mapSize.height).toBe(2048);

    // Orthographic projection: x scale = 2 / (right − left) = 1 / extent.
    expect(light.shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(1 / extent, 9);
  });

  it("keeps the contact bias sub-texel so shadows meet obstacle bases", () => {
    // Verified against the three.js shader (`shadowCoord.z += shadowBias`,
    // lit iff z + bias <= stored depth): a negative bias shrinks shadows, so
    // its magnitude must stay well under one texel of world depth or the
    // shadow edge retreats from the caster base as a bright seam. These are
    // configuration bounds only - they cannot prove the visual result.
    const light = new THREE.DirectionalLight(0xffffff, 1);
    const extent = configureSunShadows(light, 60, 10);
    const span = light.shadow.camera.far - light.shadow.camera.near;
    const texelWorld = (2 * extent) / light.shadow.mapSize.width;

    expect(light.shadow.normalBias).toBe(0);
    expect(light.shadow.bias).toBeLessThan(0);
    expect(Math.abs(light.shadow.bias)).toBeLessThanOrEqual((texelWorld / span) * 1.01);
    // Scale-invariant: the same assertion holds for a tiny and a huge site.
    const small = new THREE.DirectionalLight(0xffffff, 1);
    const smallExtent = configureSunShadows(small, 5, 3);
    const smallSpan = small.shadow.camera.far - small.shadow.camera.near;
    const smallTexel = (2 * smallExtent) / small.shadow.mapSize.width;
    expect(Math.abs(small.shadow.bias)).toBeCloseTo((smallTexel / smallSpan) * 0.5, 12);
  });

  it("creates a shadow-casting key light sized to the building", () => {
    const { objects, sun, ambient, hemi } = createLights(17.2, 26.7);
    expect(objects).toHaveLength(4);
    expect(objects[0]).toBe(ambient);
    expect(objects).toContain(hemi);
    expect(objects).toContain(sun);
    expect(objects).toContain(sun.target);

    expect(sun.castShadow).toBe(true);
    expect(sun.userData.sunDistance).toBe(SUN_DISTANCE);
    expect(sun.target.position.z).toBeCloseTo(8.6, 6);
    expect(ambient.intensity).toBe(AMBIENT_DAY_INTENSITY);
    expect(hemi.intensity).toBe(HEMI_DAY_INTENSITY);
    // Default pose: sun up (elevation 45°) so the scene is lit before the
    // simulation takes over on the first frame.
    expect(sun.intensity).toBeGreaterThan(0);
    expect(sun.position.z).toBeGreaterThan(sun.target.position.z);
  });
});

describe("applySunToScene", () => {
  it("places the light along the direction to the sun", () => {
    const { sun, ambient } = createLights(17.2, 26.7);
    applySunToScene(sun, ambient, { azimuthDeg: 90, elevationDeg: 45, night: false });

    const offset = sun.position.clone().sub(sun.target.position);
    expect(offset.length()).toBeCloseTo(SUN_DISTANCE, 6);

    const unit = offset.normalize();
    expect(unit.x).toBeCloseTo(Math.SQRT1_2, 6); // east
    expect(unit.y).toBeCloseTo(0, 6);
    expect(unit.z).toBeCloseTo(Math.SQRT1_2, 6); // up → shadows fall west

    expect(sun.intensity).toBeCloseTo(sunIntensity(45), 9);
    expect(ambient.intensity).toBe(AMBIENT_DAY_INTENSITY);
  });

  it("follows azimuth around the compass", () => {
    const { sun, ambient } = createLights(17.2, 26.7);

    applySunToScene(sun, ambient, { azimuthDeg: 0, elevationDeg: 30, night: false });
    const north = sun.position.clone().sub(sun.target.position).normalize();
    // y = cos(azimuth)·cos(elevation) — due north, lifted 30° above the horizon.
    expect(north.y).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 6);
    expect(north.z).toBeCloseTo(Math.sin((30 * Math.PI) / 180), 6);
    expect(Math.abs(north.x)).toBeLessThan(1e-6);

    applySunToScene(sun, ambient, { azimuthDeg: 270, elevationDeg: 30, night: false });
    const west = sun.position.clone().sub(sun.target.position).normalize();
    expect(west.x).toBeCloseTo(-Math.cos((30 * Math.PI) / 180), 6);
    expect(Math.abs(west.y)).toBeLessThan(1e-6);
  });

  it("switches the direct light off and dims the fill at night", () => {
    const { sun, ambient } = createLights(17.2, 26.7);
    applySunToScene(sun, ambient, { azimuthDeg: 0, elevationDeg: -12, night: true });

    expect(sun.intensity).toBe(0);
    expect(ambient.intensity).toBe(AMBIENT_NIGHT_INTENSITY);
    expect(ambient.intensity).toBeLessThan(AMBIENT_DAY_INTENSITY);
  });

  it("treats a sun exactly on the horizon as night", () => {
    const { sun, ambient } = createLights(17.2, 26.7);
    applySunToScene(sun, ambient, { azimuthDeg: 90, elevationDeg: 0, night: false });
    expect(sun.intensity).toBe(0);
    expect(ambient.intensity).toBe(AMBIENT_NIGHT_INTENSITY);
  });

  it("drives the hemisphere fill with the day/night state", () => {
    const { sun, ambient, hemi } = createLights(17.2, 26.7);
    applySunToScene(sun, ambient, { azimuthDeg: 135, elevationDeg: 45, night: false }, hemi);
    expect(hemi.intensity).toBe(HEMI_DAY_INTENSITY);
    applySunToScene(sun, ambient, { azimuthDeg: 0, elevationDeg: -12, night: true }, hemi);
    expect(hemi.intensity).toBe(HEMI_NIGHT_INTENSITY);
    expect(hemi.intensity).toBeLessThan(HEMI_DAY_INTENSITY);
  });

  it("leaves existing callers working when no hemisphere is passed", () => {
    const { sun, ambient } = createLights(17.2, 26.7);
    applySunToScene(sun, ambient, { azimuthDeg: 135, elevationDeg: 45, night: false });
    expect(sun.intensity).toBeGreaterThan(0);
    expect(ambient.intensity).toBe(AMBIENT_DAY_INTENSITY);
  });
});
