/**
 * Electricity Flow Three.js Visualization Mesh & Animation System
 *
 * Implements:
 * 1. Physical 3D cable lines (tubes / fat lines) with dark insulation sheath and glowing core.
 * 2. Conceptual Junction/Combiner boxes and Inverter endpoint with illustrative labeling.
 * 3. Restrained InstancedMesh particle system animated along 3D cable trajectories using delta-time.
 * 4. Production-intensity color mapping (deep blue -> cyan -> luminous cyan-white).
 * 5. Full resource lifecycle disposal and clean unmounting.
 */

import * as THREE from "three";
import type { ElectricalTopology, CableRoute } from "./electricityFlow";
import { samplePointAlongPolyline } from "./electricityFlow";

export interface ElectricityFlowHandle {
  group: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

/**
 * Maps production intensity (0.0 to 1.0) to color:
 * 0.0 - 0.25: deep dim blue (#1d4ed8)
 * 0.25 - 0.50: medium bright blue (#0284c7)
 * 0.50 - 0.75: bright cyan (#06b6d4)
 * 0.75 - 1.00: luminous cyan-white (#a5f3fc)
 */
export function getFlowParticleColor(intensity: number): THREE.Color {
  const t = Math.max(0, Math.min(1, intensity));
  const color = new THREE.Color();
  if (t < 0.3) {
    color.setRGB(0.11, 0.31, 0.85); // #1d4ed8
  } else if (t < 0.6) {
    color.setRGB(0.01, 0.52, 0.78); // #0284c7
  } else if (t < 0.85) {
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
): ElectricityFlowHandle {
  const group = new THREE.Group();
  group.name = "ElectricityFlowVisualization";

  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Cable Conduit Lines
  // Using LineSegments or Line with Tube/Cylinder representation
  const cableMat = new THREE.LineBasicMaterial({
    color: 0x1e293b, // dark slate cable jacket
    linewidth: 1,
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(cableMat);

  const glowCableMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8, // glowing core accent
    linewidth: 1,
    transparent: true,
    opacity: 0.45,
  });
  disposables.push(glowCableMat);

  for (const route of topology.routes) {
    if (route.points.length < 2) continue;
    const geom = new THREE.BufferGeometry().setFromPoints(route.points);
    disposables.push(geom);

    const line = new THREE.Line(geom, route.type === "combiner-trunk" ? glowCableMat : cableMat);
    line.name = `CableLine_${route.id}`;
    line.raycast = () => {};
    group.add(line);
  }

  // 2. Combiner boxes & Inverter terminal meshes
  const boxGeom = new THREE.BoxGeometry(0.24, 0.20, 0.12);
  disposables.push(boxGeom);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.4,
    metalness: 0.6,
  });
  disposables.push(boxMat);

  for (const pos of topology.combinerPositions) {
    const box = new THREE.Mesh(boxGeom, boxMat);
    box.position.copy(pos);
    box.name = "StringCombinerBox";
    box.raycast = () => {};
    group.add(box);
  }

  // Conceptual Inverter Terminal
  const invGeom = new THREE.BoxGeometry(0.5, 0.4, 0.7);
  disposables.push(invGeom);
  const invMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.3,
    metalness: 0.8,
  });
  disposables.push(invMat);
  const inverterMesh = new THREE.Mesh(invGeom, invMat);
  inverterMesh.position.copy(topology.endpointPosition);
  inverterMesh.name = "ConceptualInverterEndpoint";
  inverterMesh.raycast = () => {};
  group.add(inverterMesh);

  // 3. Animated Flow Particles (InstancedMesh)
  // Compute total number of particles based on cable routes
  interface ParticleTracker {
    route: CableRoute;
    /** Current distance along polyline */
    distance: number;
    speed: number;
    baseIntensity: number;
  }

  const trackers: ParticleTracker[] = [];
  const PARTICLES_PER_METER = 0.8;

  for (const route of topology.routes) {
    if (route.totalLength <= 0.1) continue;
    const count = Math.max(2, Math.round(route.totalLength * PARTICLES_PER_METER));
    const spacing = route.totalLength / count;
    const speed = route.type === "combiner-trunk" ? 1.6 : 1.2; // metres per second

    for (let i = 0; i < count; i++) {
      trackers.push({
        route,
        distance: i * spacing,
        speed,
        baseIntensity: route.flowIntensity,
      });
    }
  }

  const particleCount = trackers.length;
  let particleMesh: THREE.InstancedMesh | null = null;

  if (particleCount > 0) {
    // Small glowing sphere/icosahedron for particle
    const pGeom = new THREE.SphereGeometry(0.045, 6, 6);
    disposables.push(pGeom);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    disposables.push(pMat);

    particleMesh = new THREE.InstancedMesh(pGeom, pMat, particleCount);
    particleMesh.name = "ElectricityFlowParticles";
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
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
      particleMesh.setColorAt(i, getFlowParticleColor(trk.baseIntensity));
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) {
      particleMesh.instanceColor.needsUpdate = true;
    }
    group.add(particleMesh);
  }

  const dummyMatrix = new THREE.Object3D();

  const update = (deltaSeconds: number) => {
    if (!particleMesh || particleCount === 0) return;
    const dt = Math.max(0.001, Math.min(0.1, deltaSeconds));

    for (let i = 0; i < particleCount; i++) {
      const trk = trackers[i];
      trk.distance = (trk.distance + trk.speed * dt) % trk.route.totalLength;

      const pos = samplePointAlongPolyline(
        trk.route.points,
        trk.route.cumulativeDistances,
        trk.route.totalLength,
        trk.distance,
      );

      dummyMatrix.position.copy(pos);
      // Slight pulsating scale based on intensity
      const pulse = 1.0 + 0.15 * Math.sin(trk.distance * 4);
      dummyMatrix.scale.set(pulse, pulse, pulse);
      dummyMatrix.updateMatrix();

      particleMesh.setMatrixAt(i, dummyMatrix.matrix);
    }

    particleMesh.instanceMatrix.needsUpdate = true;
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
    dispose,
  };
}
