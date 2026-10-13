/**
 * Tests for Procedural 3D Clouds and Dynamic Shadow Simulation (clouds.ts)
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createCumulusGeometry,
  createCloudVariants,
  createCloudsSimulation,
} from "../lib/3d/clouds";

describe("3D Cumulus Cloud Geometries", () => {
  it("generates organic multi-puff cumulus geometries with flattened condensation base", () => {
    const variants = createCloudVariants();
    expect(variants.length).toBe(3);

    for (const geom of variants) {
      expect(geom.getAttribute("position")).toBeDefined();
      expect(geom.getAttribute("normal")).toBeDefined();
      expect(geom.getIndex()).toBeDefined();

      geom.computeBoundingBox();
      const box = geom.boundingBox!;
      const size = box.getSize(new THREE.Vector3());

      // Realistic cloud span (width 20m - 60m, height 8m - 20m)
      expect(size.x).toBeGreaterThan(15);
      expect(size.x).toBeLessThan(70);
      expect(size.z).toBeGreaterThan(5);

      geom.dispose();
    }
  });

  it("flattens the lower base of cloud puffs below puff centers", () => {
    const puff = [{ x: 0, y: 0, z: 0, radius: 10 }];
    const geom = createCumulusGeometry(puff);
    geom.computeBoundingBox();

    const box = geom.boundingBox!;
    // Top dome extends upward by full radius (+10)
    expect(box.max.z).toBeCloseTo(10, 0);
    // Bottom base is flattened (closer to -4.5 instead of -10)
    expect(box.min.z).toBeGreaterThan(-6.0);
    expect(box.min.z).toBeLessThan(-2.5);

    geom.dispose();
  });
});

describe("3D Clouds Simulation & Physical Shadow Casting", () => {
  it("initializes cloud clusters that cast physical shadows", () => {
    const scene = new THREE.Scene();
    const sim = createCloudsSimulation(scene, { cloudCount: 5 });

    expect(sim.getCloudCount()).toBe(5);

    const masterGroup = scene.getObjectByName("CloudsSimulationGroup");
    expect(masterGroup).toBeDefined();

    let shadowCastingClouds = 0;
    masterGroup!.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        shadowCastingClouds++;
        // Clouds must cast their own shadows
        expect(child.castShadow).toBe(true);
        expect(child.receiveShadow).toBe(false);
      }
    });

    expect(shadowCastingClouds).toBe(5);

    sim.dispose();
  });

  it("advances cloud positions along wind vector during update()", () => {
    const scene = new THREE.Scene();
    const sim = createCloudsSimulation(scene, {
      cloudCount: 3,
      windSpeed: 5.0,
      windDirectionDeg: 90, // Blowing East (+X)
    });

    const masterGroup = scene.getObjectByName("CloudsSimulationGroup")!;
    const firstCloud = masterGroup.children[0] as THREE.Mesh;
    const initialX = firstCloud.position.x;

    // Step forward 20 frames of 0.1s (2.0s total at 5 m/s East -> +10m in X)
    for (let s = 0; s < 20; s++) {
      sim.update(0.1, 15);
    }

    expect(firstCloud.position.x).toBeGreaterThan(initialX + 5);

    sim.dispose();
  });

  it("adjusts altitude safely above building roof level", () => {
    const scene = new THREE.Scene();
    const sim = createCloudsSimulation(scene, {
      cloudCount: 2,
      minAltitudeAboveRoof: 20,
    });

    const roofZ = 25.0;
    sim.update(0.1, roofZ);

    const masterGroup = scene.getObjectByName("CloudsSimulationGroup")!;
    for (const child of masterGroup.children) {
      // Must maintain altitude above roofZ + minAlt
      expect(child.position.z).toBeGreaterThanOrEqual(roofZ + 15);
    }

    sim.dispose();
  });

  it("toggles visibility cleanly through setVisible()", () => {
    const scene = new THREE.Scene();
    const sim = createCloudsSimulation(scene);
    const masterGroup = scene.getObjectByName("CloudsSimulationGroup")!;

    expect(masterGroup.visible).toBe(true);
    sim.setVisible(false);
    expect(masterGroup.visible).toBe(false);
    sim.setVisible(true);
    expect(masterGroup.visible).toBe(true);

    sim.dispose();
  });

  it("cleans up resources and detaches from scene on dispose()", () => {
    const scene = new THREE.Scene();
    const sim = createCloudsSimulation(scene);

    expect(scene.getObjectByName("CloudsSimulationGroup")).toBeDefined();

    sim.dispose();

    expect(scene.getObjectByName("CloudsSimulationGroup")).toBeUndefined();
  });
});
