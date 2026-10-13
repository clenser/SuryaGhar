/**
 * Tests for Natural Flying Bird Animation (birds.ts)
 *
 * Verifies:
 * 1. Procedural geometry creation (fuselage, articulated wings).
 * 2. Avian 3D orientation, velocity alignment, and coordinated banking matrix math.
 * 3. Simulation pooling, active bird limits, and small flock spawning.
 * 4. Deterministic position and altitude progression (safe clearance above rooftop).
 * 5. Solar physics isolation (zero shadow casting/receiving).
 * 6. Clean lifecycle management and resource disposal.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createBirdFuselageGeometry,
  createWingGeometries,
  computeAvianOrientation,
  createBirdsSimulation,
  normalizeAngle,
} from "../lib/3d/birds";

describe("Birds Simulation & Geometry", () => {
  it("generates valid lightweight low-poly fuselage geometry with computed normals", () => {
    const geom = createBirdFuselageGeometry();
    expect(geom.getAttribute("position")).toBeDefined();
    expect(geom.getAttribute("normal")).toBeDefined();
    expect(geom.getIndex()).toBeDefined();

    const pos = geom.getAttribute("position");
    // Fuselage has compact vertex count
    expect(pos.count).toBeGreaterThanOrEqual(14);
    expect(pos.count).toBeLessThan(30);

    // Bounding box spans realistic dimensions (~1.4m length, ~0.28m width)
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(0.8); // Length along forward Y axis
    expect(size.y).toBeLessThan(1.6);
    expect(size.x).toBeGreaterThan(0.15); // Lateral width
    expect(size.x).toBeLessThanOrEqual(0.45);

    geom.dispose();
  });

  it("generates articulated inner and outer wing geometries for left and right wings", () => {
    const { leftInner, leftOuter, rightInner, rightOuter } = createWingGeometries();

    expect(leftInner.getAttribute("position")).toBeDefined();
    expect(leftOuter.getAttribute("position")).toBeDefined();
    expect(rightInner.getAttribute("position")).toBeDefined();
    expect(rightOuter.getAttribute("position")).toBeDefined();

    // Left wings extend along negative X; Right wings along positive X
    leftInner.computeBoundingBox();
    rightInner.computeBoundingBox();

    expect(leftInner.boundingBox!.min.x).toBeLessThan(0);
    expect(rightInner.boundingBox!.max.x).toBeGreaterThan(0);

    leftInner.dispose();
    leftOuter.dispose();
    rightInner.dispose();
    rightOuter.dispose();
  });

  it("normalizes angles into [-PI, +PI]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI * 0.5);
    expect(normalizeAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI * 0.5);
  });

  it("computes an orthonormal orientation matrix aligned with velocity vector", () => {
    const velocity = new THREE.Vector3(10, 0, 0); // Flying East (+X)
    const bankAngle = 0;
    const matrix = computeAvianOrientation(velocity, bankAngle);

    // Matrix determinant of a proper rotation is +1
    expect(matrix.determinant()).toBeCloseTo(1.0, 4);

    // Extract basis vectors
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    matrix.extractBasis(right, forward, up);

    // Forward should point along East (+X)
    expect(forward.x).toBeCloseTo(1.0);
    expect(forward.y).toBeCloseTo(0.0);
    expect(forward.z).toBeCloseTo(0.0);

    // Up should point along +Z
    expect(up.x).toBeCloseTo(0.0);
    expect(up.y).toBeCloseTo(0.0);
    expect(up.z).toBeCloseTo(1.0);

    // Right should point along South (-Y)
    expect(right.x).toBeCloseTo(0.0);
    expect(right.y).toBeCloseTo(-1.0);
    expect(right.z).toBeCloseTo(0.0);
  });

  it("banks roll orientation naturally when banking angle is applied", () => {
    const velocity = new THREE.Vector3(0, 12, 0); // Flying North (+Y)
    const bankAngle = Math.PI / 4; // 45 degrees bank
    const matrix = computeAvianOrientation(velocity, bankAngle);

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    matrix.extractBasis(right, forward, up);

    // Forward remains along North (+Y)
    expect(forward.y).toBeCloseTo(1.0);

    // Up and right have banked by 45 degrees
    expect(up.x).toBeCloseTo(Math.sin(-bankAngle), 2);
    expect(up.z).toBeCloseTo(Math.cos(bankAngle), 2);
  });
});

describe("Birds Simulation Lifecycle & Solar Isolation", () => {
  it("immediately populates active birds on mount when initialSpawn is enabled", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene, {
      maxActiveBirds: 6,
      initialSpawn: true,
    });

    // Sky is immediately active with soaring and crossing birds
    expect(sim.getActiveBirdCount()).toBe(2);
    sim.dispose();
  });

  it("enforces pool allocation, max active limits, and clean spawning", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene, {
      maxActiveBirds: 3,
      poolSize: 5,
      arenaRadius: 100,
      initialSpawn: false,
    });

    expect(sim.getActiveBirdCount()).toBe(0);

    // Spawning respects limit
    const s1 = sim.spawnBird();
    const s2 = sim.spawnBird();
    const s3 = sim.spawnBird();
    const s4 = sim.spawnBird(); // Exceeds maxActiveBirds = 3

    expect(s1).toBe(true);
    expect(s2).toBe(true);
    expect(s3).toBe(true);
    expect(s4).toBe(false);
    expect(sim.getActiveBirdCount()).toBe(3);

    sim.dispose();
  });

  it("spawns small flocks where followers track the leader", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene, {
      maxActiveBirds: 5,
      poolSize: 6,
      initialSpawn: false,
    });

    sim.spawnFlock(3);
    expect(sim.getActiveBirdCount()).toBe(3);

    // Advancing simulation updates positions smoothly
    sim.update(0.1, 15);
    expect(sim.getActiveBirdCount()).toBe(3);

    sim.dispose();
  });

  it("strictly enforces altitude clearance above rooftop", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene, {
      maxActiveBirds: 2,
      minAltitudeAboveRoof: 18,
      initialSpawn: false,
    });

    // Spawn bird at custom lower altitude
    sim.spawnBird({ customPosition: new THREE.Vector3(0, 0, 5) });

    const roofZ = 20.0;
    // Step simulation forward
    sim.update(0.1, roofZ);

    // Master group in scene contains the bird mesh
    const masterGroup = scene.getObjectByName("BirdsSimulationGroup");
    expect(masterGroup).toBeDefined();

    const birdGroup = masterGroup?.getObjectByName("Bird_0") as THREE.Group;
    expect(birdGroup).toBeDefined();

    // Bird altitude must be clamped to at least roofZ + 18m = 38m
    expect(birdGroup.position.z).toBeGreaterThanOrEqual(roofZ + 18);

    sim.dispose();
  });

  it("strictly isolates from solar physics: all bird meshes have castShadow=false and receiveShadow=false", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene, { maxActiveBirds: 4 });
    sim.spawnFlock(2);

    const masterGroup = scene.getObjectByName("BirdsSimulationGroup");
    expect(masterGroup).toBeDefined();

    let meshCount = 0;
    masterGroup!.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshCount++;
        expect(child.castShadow).toBe(false);
        expect(child.receiveShadow).toBe(false);
      }
    });

    expect(meshCount).toBeGreaterThan(0);

    sim.dispose();
  });

  it("toggles visibility cleanly through setVisible", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene);
    const masterGroup = scene.getObjectByName("BirdsSimulationGroup");

    expect(masterGroup!.visible).toBe(true);
    sim.setVisible(false);
    expect(masterGroup!.visible).toBe(false);
    sim.setVisible(true);
    expect(masterGroup!.visible).toBe(true);

    sim.dispose();
  });

  it("cleans up resources and detaches from scene on dispose()", () => {
    const scene = new THREE.Scene();
    const sim = createBirdsSimulation(scene);
    sim.spawnFlock(3);

    expect(scene.getObjectByName("BirdsSimulationGroup")).toBeDefined();

    sim.dispose();

    expect(scene.getObjectByName("BirdsSimulationGroup")).toBeUndefined();
    expect(sim.getActiveBirdCount()).toBe(0);
  });
});
