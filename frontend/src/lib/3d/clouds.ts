/**
 * Procedural 3D Clouds and Dynamic Cloud Shadows for Three.js
 *
 * Provides realistic 3D volumetric-looking cumulus clouds and real-time moving shadows:
 * - Multi-puff organic cumulus cloud geometries with flat condensation bases and billowing domes.
 * - Reusable, shared low-poly geometries and materials (zero per-frame allocations).
 * - Physical shadow casting (castShadow = true) matching the real sun azimuth and elevation.
 * - Realistic wind drift physics, subtle thermal bobbing, and boundary wrapping.
 * - Clean lifecycle management, scene detachment, and resource disposal.
 */

import * as THREE from "three";

export interface CloudsSimulationOptions {
  /** Total number of cloud clusters in the sky (default: 6) */
  cloudCount?: number;
  /** Wind drift speed in metres per second (default: 3.2) */
  windSpeed?: number;
  /** Wind direction angle in degrees (clockwise from North, default: 60) */
  windDirectionDeg?: number;
  /** Radius of sky boundary in metres (default: 80) */
  arenaRadius?: number;
  /** Minimum altitude above rooftop in metres (default: 18) */
  minAltitudeAboveRoof?: number;
  /** Maximum altitude above rooftop in metres (default: 32) */
  maxAltitudeAboveRoof?: number;
}

export interface CloudInstance {
  index: number;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  baseAltitude: number;
  scale: number;
  rotationSpeed: number;
  bobPhase: number;
  bobSpeed: number;
  variant: number;
}

export interface CloudsSimulation {
  /** Update cloud positions, gentle morphing, and boundary wrapping. Call inside rAF with delta seconds. */
  update: (dt: number, roofZ: number) => void;
  /** Show or hide all clouds and their shadows */
  setVisible: (visible: boolean) => void;
  /** Update wind parameters */
  setWind: (speed: number, directionDeg: number) => void;
  /** Total number of clouds */
  getCloudCount: () => number;
  /** Clean up all Three.js meshes, geometries, and materials */
  dispose: () => void;
}

interface PuffDef {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * Builds a single organic cumulus cloud geometry by merging overlapping sphere puffs
 * with flattened condensation bases and billowy domes.
 */
export function createCumulusGeometry(puffs: PuffDef[]): THREE.BufferGeometry {
  const allVertices: number[] = [];
  const allIndices: number[] = [];
  let vertexOffset = 0;

  const latBands = 8;
  const lonBands = 12;

  for (const puff of puffs) {
    for (let lat = 0; lat <= latBands; lat++) {
      const theta = (lat * Math.PI) / latBands;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let lon = 0; lon <= lonBands; lon++) {
        const phi = (lon * 2 * Math.PI) / lonBands;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        const x = puff.x + puff.radius * sinTheta * cosPhi;
        const y = puff.y + puff.radius * sinTheta * sinPhi;
        // Flatten bottom base of cloud below puff center (cumulus condensation level)
        let zOffset = puff.radius * cosTheta;
        if (zOffset < 0) {
          zOffset *= 0.40;
        }
        const z = puff.z + zOffset;

        allVertices.push(x, y, z);
      }
    }

    // Grid triangles
    for (let lat = 0; lat < latBands; lat++) {
      for (let lon = 0; lon < lonBands; lon++) {
        const first = vertexOffset + lat * (lonBands + 1) + lon;
        const second = first + lonBands + 1;

        allIndices.push(first, second, first + 1);
        allIndices.push(second, second + 1, first + 1);
      }
    }

    vertexOffset += (latBands + 1) * (lonBands + 1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(allVertices, 3));
  geom.setIndex(allIndices);
  geom.computeVertexNormals();

  return geom;
}

/**
 * Generates 3 distinctive organic cumulus cloud geometry variants.
 */
export function createCloudVariants(): THREE.BufferGeometry[] {
  // Variant 0: Medium Billowing Cumulus
  const v0Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 8.5 },
    { x: -6.5, y: -1.0, z: -0.5, radius: 6.8 },
    { x: 7.2, y: 1.2, z: -0.5, radius: 7.2 },
    { x: 1.0, y: 0.5, z: 3.5, radius: 6.2 },
    { x: -4.0, y: 0.8, z: 2.8, radius: 5.4 },
    { x: 4.8, y: -0.6, z: 2.4, radius: 5.6 },
    { x: 2.0, y: 4.5, z: -0.8, radius: 5.2 },
    { x: -2.2, y: -4.2, z: -0.8, radius: 5.0 },
  ];

  // Variant 1: Elongated Cloud Bank
  const v1Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 9.5 },
    { x: -10.0, y: 1.5, z: -0.6, radius: 7.8 },
    { x: 10.5, y: -1.2, z: -0.6, radius: 8.0 },
    { x: -17.5, y: 2.2, z: -1.2, radius: 5.8 },
    { x: 18.0, y: -2.0, z: -1.2, radius: 6.0 },
    { x: -4.5, y: 0.5, z: 3.8, radius: 6.8 },
    { x: 5.0, y: -0.5, z: 3.6, radius: 7.0 },
    { x: 0, y: 4.5, z: -0.6, radius: 5.5 },
    { x: -8.0, y: -4.0, z: -0.6, radius: 5.2 },
    { x: 8.5, y: 4.0, z: -0.6, radius: 5.4 },
  ];

  // Variant 2: Compact Puffy Cumulus
  const v2Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 7.5 },
    { x: -5.0, y: 0.5, z: -0.4, radius: 5.8 },
    { x: 5.2, y: -0.4, z: -0.4, radius: 6.0 },
    { x: 0.5, y: 0.2, z: 3.0, radius: 5.2 },
    { x: 1.5, y: 3.5, z: -0.5, radius: 4.8 },
    { x: -1.5, y: -3.5, z: -0.5, radius: 4.6 },
  ];

  return [
    createCumulusGeometry(v0Puffs),
    createCumulusGeometry(v1Puffs),
    createCumulusGeometry(v2Puffs),
  ];
}

/**
 * Creates and initializes the CloudsSimulation in the given Three.js scene.
 */
export function createCloudsSimulation(
  scene: THREE.Scene,
  options: CloudsSimulationOptions = {},
): CloudsSimulation {
  const cloudCount = options.cloudCount ?? 6;
  let windSpeed = options.windSpeed ?? 3.2;
  let windDirectionDeg = options.windDirectionDeg ?? 60;
  const arenaRadius = options.arenaRadius ?? 80;
  const minAltAboveRoof = options.minAltitudeAboveRoof ?? 18;
  const maxAltAboveRoof = options.maxAltitudeAboveRoof ?? 32;

  // Master group in scene
  const masterGroup = new THREE.Group();
  masterGroup.name = "CloudsSimulationGroup";
  scene.add(masterGroup);

  // Shared geometries and materials
  const variants = createCloudVariants();

  // Clean, bright white/silver daylight cloud material that casts real shadows
  const cloudMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x1f2733,
    transparent: true,
    opacity: 0.90,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const clouds: CloudInstance[] = [];

  // Compute wind velocity vector in world metres/sec (+X = East, +Y = North)
  let windVelX = 0;
  let windVelY = 0;

  function updateWindVector() {
    const rad = (windDirectionDeg * Math.PI) / 180;
    // Clockwise from North: 0 = +Y, 90 = +X, 180 = -Y, 270 = -X
    windVelX = Math.sin(rad) * windSpeed;
    windVelY = Math.cos(rad) * windSpeed;
  }
  updateWindVector();

  // Distribute clouds across the sky initially
  let currentRoofZ = 12.0;

  for (let i = 0; i < cloudCount; i++) {
    const variantIdx = i % variants.length;
    const geom = variants[variantIdx];
    const mesh = new THREE.Mesh(geom, cloudMaterial);

    // Physical shadow casting onto ground and roof
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    // Distribute initial positions across arena
    // Ensure cloud 0 and 1 pass right over or near the site
    let initX = 0;
    let initY = 0;

    if (i === 0) {
      initX = -15;
      initY = -10;
    } else if (i === 1) {
      initX = 18;
      initY = 12;
    } else {
      initX = (Math.random() - 0.5) * arenaRadius * 1.6;
      initY = (Math.random() - 0.5) * arenaRadius * 1.6;
    }

    const baseAltitude = minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
    const scale = 0.9 + Math.random() * 0.35;

    mesh.scale.setScalar(scale);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(initX, initY, currentRoofZ + baseAltitude);

    masterGroup.add(mesh);

    clouds.push({
      index: i,
      mesh,
      position: mesh.position,
      baseAltitude,
      scale,
      rotationSpeed: (Math.random() - 0.5) * 0.008,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.15 + Math.random() * 0.15,
      variant: variantIdx,
    });
  }

  function update(rawDt: number, roofZ: number): void {
    const dt = Math.max(0.001, Math.min(rawDt, 0.1));
    currentRoofZ = roofZ;

    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];

      // 1. Advance position along wind vector
      cloud.position.x += windVelX * dt;
      cloud.position.y += windVelY * dt;

      // 2. Subtle thermal altitude bobbing
      cloud.bobPhase += cloud.bobSpeed * dt;
      const targetZ = currentRoofZ + cloud.baseAltitude + Math.sin(cloud.bobPhase) * 1.2;
      cloud.position.z += (targetZ - cloud.position.z) * Math.min(1.0, dt * 2.0);

      // Hard floor guarantee above building roof level
      const minZ = currentRoofZ + minAltAboveRoof;
      if (cloud.position.z < minZ) {
        cloud.position.z = minZ;
      }

      // 3. Very slow organic yaw rotation
      cloud.mesh.rotation.z += cloud.rotationSpeed * dt;

      // 4. Boundary wrapping: when cloud drifts far downwind, wrap to upwind side
      // Project position along wind vector
      const windLen = Math.sqrt(windVelX * windVelX + windVelY * windVelY);
      if (windLen > 0.001) {
        const uX = windVelX / windLen;
        const uY = windVelY / windLen;
        const proj = cloud.position.x * uX + cloud.position.y * uY;

        if (proj > arenaRadius * 1.25) {
          // Wrap back to upwind perimeter
          const perpX = -uY;
          const perpY = uX;
          const lateralOffset = (Math.random() - 0.5) * arenaRadius * 1.4;

          cloud.position.x = -uX * arenaRadius * 1.2 + perpX * lateralOffset;
          cloud.position.y = -uY * arenaRadius * 1.2 + perpY * lateralOffset;
          cloud.baseAltitude = minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
          cloud.mesh.rotation.z = Math.random() * Math.PI * 2;
        }
      }
    }
  }

  function setVisible(visible: boolean): void {
    masterGroup.visible = visible;
  }

  function setWind(speed: number, directionDeg: number): void {
    windSpeed = speed;
    windDirectionDeg = directionDeg;
    updateWindVector();
  }

  function dispose(): void {
    if (masterGroup.parent) {
      masterGroup.parent.remove(masterGroup);
    }
    masterGroup.clear();

    for (const v of variants) {
      v.dispose();
    }
    cloudMaterial.dispose();
  }

  return {
    update,
    setVisible,
    setWind,
    getCloudCount: () => clouds.length,
    dispose,
  };
}
