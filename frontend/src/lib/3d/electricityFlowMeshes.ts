/**
 * Electricity Flow Three.js Visualization Mesh & Animation System
 *
 * Implements:
 * 1. Physical 3D cable lines with dark insulation sheath and subtle core accent.
 * 2. Detailed conceptual String Combiner Boxes and Inverter endpoint with cooling vents, status LEDs, and terminals.
 * 3. Moving electricity particles using performant InstancedMesh:
 *    - Depth test enabled and normal depth write to prevent particles showing through opaque panels or obstacles.
 *    - Render order tuned (renderOrder = 1) and small particle radius (0.035m) to avoid z-fighting.
 * 4. Production-driven dynamics:
 *    - Color spectrum: 0 (dark blue/off) -> dim sky blue -> vivid cyan -> bright luminous cyan-white.
 *    - Dynamic speed & pulse intensity scaled with real-time generation factor.
 *    - Zero flow / invisible particles at night (power = 0).
 * 5. Full lifecycle and resource disposal.
 */

import * as THREE from "three";
import type { ElectricalTopology, CableRoute } from "./electricityFlow";
import { samplePointAlongPolyline } from "./electricityFlow";

export interface ElectricityFlowHandle {
  group: THREE.Group;
  update: (deltaSeconds: number) => void;
  updateIntensities: (newTopology: ElectricalTopology) => void;
  updateSunState: (solarAzimuthDeg: number, solarElevationDeg: number, weatherPreset?: "sunny" | "cloudy" | "rainy") => void;
  setFlowActive: (active: boolean) => void;
  dispose: () => void;
}

/**
 * Maps production intensity (0.0 to 1.0) to color:
 * 0.00: off / dark muted navy (generation = 0 at night)
 * 0.01 - 0.25: deep dim blue (#1d4ed8)
 * 0.25 - 0.50: vivid blue (#0284c7)
 * 0.50 - 0.75: bright cyan (#06b6d4)
 * 0.75 - 1.00: luminous cyan-white (#a5f3fc)
 */
export function getFlowParticleColor(intensity: number): THREE.Color {
  const t = Math.max(0, Math.min(1, intensity));
  const color = new THREE.Color();
  if (t <= 0.001) {
    color.setRGB(0.05, 0.08, 0.15); // near-black / zero generation
  } else if (t < 0.25) {
    color.setRGB(0.11, 0.31, 0.85); // #1d4ed8
  } else if (t < 0.50) {
    color.setRGB(0.01, 0.52, 0.78); // #0284c7
  } else if (t < 0.75) {
    color.setRGB(0.02, 0.71, 0.83); // #06b6d4
  } else {
    color.setRGB(0.65, 0.95, 0.99); // #a5f3fc
  }
  return color;
}

/**
 * Creates the complete Three.js Electricity Flow visualization group and animation handler.
 */
export function createElectricityFlowVisualizer(
  topology: ElectricalTopology,
  initialFlowActive: boolean = false,
): ElectricityFlowHandle {
  const group = new THREE.Group();
  group.name = "ElectricityFlowVisualization";
  group.visible = initialFlowActive;

  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Cable Conduit Lines
  // Outer dark jacket (slate-800, opaque, with depth test)
  const cableMat = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    linewidth: 1,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
  disposables.push(cableMat);

  // Subtle core accent for main DC collection trunk
  const mainTrunkMat = new THREE.LineBasicMaterial({
    color: 0x0284c7,
    linewidth: 1,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    depthWrite: false,
  });
  disposables.push(mainTrunkMat);

  for (const route of topology.routes) {
    if (route.points.length < 2) continue;
    const geom = new THREE.BufferGeometry().setFromPoints(route.points);
    disposables.push(geom);

    const mat = route.type === "main-dc" ? mainTrunkMat : cableMat;
    const line = new THREE.Line(geom, mat);
    line.name = `CableLine_${route.id}`;
    line.raycast = () => {};
    group.add(line);
  }

  // 2. String Combiner Boxes & Main Junction Enclosure
  const boxGeom = new THREE.BoxGeometry(0.22, 0.18, 0.10);
  disposables.push(boxGeom);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x334155, // industrial dark slate
    roughness: 0.35,
    metalness: 0.65,
  });
  disposables.push(boxMat);

  for (const pos of topology.combinerPositions) {
    const box = new THREE.Mesh(boxGeom, boxMat);
    box.position.copy(pos);
    box.name = "StringCombinerBox";
    box.raycast = () => {};
    group.add(box);
  }

  // Main DC Collection Junction Box
  const mainJunctionGeom = new THREE.BoxGeometry(0.32, 0.26, 0.14);
  disposables.push(mainJunctionGeom);
  const mainJunctionMesh = new THREE.Mesh(mainJunctionGeom, boxMat);
  mainJunctionMesh.position.copy(topology.mainJunctionPosition);
  mainJunctionMesh.name = "MainDCJunctionBox";
  mainJunctionMesh.raycast = () => {};
  group.add(mainJunctionMesh);

  // 3. Realistic Conceptual Solar Inverter
  // Distinct enclosure proportions (0.48m W x 0.32m D x 0.65m H) with cooling vents and status LED
  const invBodyGeom = new THREE.BoxGeometry(0.48, 0.32, 0.65);
  disposables.push(invBodyGeom);
  const invBodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a, // dark matte chassis
    roughness: 0.40,
    metalness: 0.70,
  });
  disposables.push(invBodyMat);

  const inverterGroup = new THREE.Group();
  inverterGroup.name = "ConceptualInverterEndpoint";
  inverterGroup.position.copy(topology.endpointPosition);

  const inverterBody = new THREE.Mesh(invBodyGeom, invBodyMat);
  inverterBody.raycast = () => {};
  inverterGroup.add(inverterBody);

  // Status LED: glowing green when producing, dim amber when low/standby
  const ledGeom = new THREE.SphereGeometry(0.02, 8, 8);
  disposables.push(ledGeom);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  disposables.push(ledMat);
  const ledMesh = new THREE.Mesh(ledGeom, ledMat);
  ledMesh.position.set(0.16, -0.17, 0.18);
  inverterGroup.add(ledMesh);

  group.add(inverterGroup);

  // 4. Animated Flow Particles (InstancedMesh)
  interface ParticleTracker {
    route: CableRoute;
    distance: number;
    baseSpeed: number;
    intensity: number;
  }

  const trackers: ParticleTracker[] = [];
  const PARTICLES_PER_METER = 0.75;

  for (const route of topology.routes) {
    if (route.totalLength <= 0.1) continue;
    const count = Math.max(2, Math.round(route.totalLength * PARTICLES_PER_METER));
    const spacing = route.totalLength / count;
    const baseSpeed = route.type === "main-dc" ? 1.8 : route.type === "combiner-trunk" ? 1.4 : 1.1;

    for (let i = 0; i < count; i++) {
      trackers.push({
        route,
        distance: i * spacing,
        baseSpeed,
        intensity: route.flowIntensity,
      });
    }
  }

  const particleCount = trackers.length;
  let particleMesh: THREE.InstancedMesh | null = null;

  if (particleCount > 0) {
    // Compact spherical geometry (radius 0.055m, 6 segments)
    const pGeom = new THREE.SphereGeometry(0.055, 6, 6);
    disposables.push(pGeom);

    // Standard depthTest = true and normal depthWrite = false, renderOrder = 1
    // to strictly respect scene depth (occluded by panel underside & obstacles)
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    disposables.push(pMat);

    particleMesh = new THREE.InstancedMesh(pGeom, pMat, particleCount);
    particleMesh.name = "ElectricityFlowParticles";
    particleMesh.renderOrder = 1;
    particleMesh.raycast = () => {};

    const dummy = new THREE.Object3D();
    for (let i = 0; i < particleCount; i++) {
      const trk = trackers[i];
      const pos = samplePointAlongPolyline(
        trk.route.points,
        trk.route.cumulativeDistances,
        trk.route.totalLength,
        trk.distance,
      );
      dummy.position.copy(pos);
      const isProducing = trk.intensity > 0.001;
      dummy.scale.set(isProducing ? 1 : 0, isProducing ? 1 : 0, isProducing ? 1 : 0);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
      particleMesh.setColorAt(i, getFlowParticleColor(trk.intensity));
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) {
      particleMesh.instanceColor.needsUpdate = true;
    }
    particleMesh.visible = initialFlowActive;
    group.add(particleMesh);
  }

  let flowActive = initialFlowActive;
  const setFlowActive = (active: boolean) => {
    flowActive = active;
    group.visible = active;
    if (particleMesh) {
      particleMesh.visible = active;
    }
  };

  const dummyMatrix = new THREE.Object3D();

  const update = (deltaSeconds: number) => {
    if (!flowActive || !particleMesh || particleCount === 0) return;
    const dt = Math.max(0.001, Math.min(0.1, deltaSeconds));

    for (let i = 0; i < particleCount; i++) {
      const trk = trackers[i];
      const speed = trk.baseSpeed * Math.max(0.25, trk.intensity);
      trk.distance = (trk.distance + speed * dt) % trk.route.totalLength;

      samplePointAlongPolyline(
        trk.route.points,
        trk.route.cumulativeDistances,
        trk.route.totalLength,
        trk.distance,
        dummyMatrix.position,
      );

      // Hide particle completely if power is zero (night-time)
      if (trk.intensity <= 0.001) {
        dummyMatrix.scale.set(0, 0, 0);
      } else {
        const pulse = (0.9 + 0.3 * trk.intensity) * (1.0 + 0.12 * Math.sin(trk.distance * 5));
        dummyMatrix.scale.set(pulse, pulse, pulse);
      }
      dummyMatrix.updateMatrix();

      particleMesh.setMatrixAt(i, dummyMatrix.matrix);
    }

    particleMesh.instanceMatrix.needsUpdate = true;
  };

  const updateIntensities = (newTopology: ElectricalTopology) => {
    if (!particleMesh) return;
    const routeMap = new Map<string, number>();
    for (const r of newTopology.routes) {
      routeMap.set(r.id, r.flowIntensity);
    }

    for (let i = 0; i < trackers.length; i++) {
      const trk = trackers[i];
      const updatedInt = routeMap.get(trk.route.id) ?? trk.route.flowIntensity;
      trk.intensity = updatedInt;
      particleMesh.setColorAt(i, getFlowParticleColor(updatedInt));
    }
    if (particleMesh.instanceColor) {
      particleMesh.instanceColor.needsUpdate = true;
    }
  };

  const updateSunState = (
    _solarAzimuthDeg: number,
    solarElevationDeg: number,
    weatherPreset: "sunny" | "cloudy" | "rainy" = "sunny",
  ) => {
    if (!particleMesh) return;
    // Fast scalar sun scaling for particles when sun moves during animation loop:
    // Avoids running full Dijkstra and polygon clipping every frame.
    const elevRad = Math.max(0, (solarElevationDeg * Math.PI) / 180);
    const sunFactor = Math.sin(elevRad);
    let weatherScale = 1.0;
    if (weatherPreset === "cloudy") weatherScale = 0.55;
    else if (weatherPreset === "rainy") weatherScale = 0.28;

    for (let i = 0; i < trackers.length; i++) {
      const trk = trackers[i];
      // Scale base route flowIntensity with instantaneous sun factor
      const baseIntensity = trk.route.flowIntensity > 0 ? trk.route.flowIntensity : 0.8;
      const updatedInt = solarElevationDeg <= 0 ? 0.0 : Math.max(0, Math.min(1, baseIntensity * sunFactor * weatherScale));
      trk.intensity = updatedInt;
      particleMesh.setColorAt(i, getFlowParticleColor(updatedInt));
    }
    if (particleMesh.instanceColor) {
      particleMesh.instanceColor.needsUpdate = true;
    }
  };

  const dispose = () => {
    group.clear();
    for (const d of disposables) {
      d.dispose();
    }
  };

  return {
    group,
    update,
    updateIntensities,
    updateSunState,
    setFlowActive,
    dispose,
  };
}
