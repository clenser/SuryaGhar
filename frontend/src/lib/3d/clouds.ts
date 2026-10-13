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
  /** Update weather preset (sunny: rare subtle clouds; cloudy: mixed overcast clouds; rainy: none) */
  setWeatherPreset: (preset: "sunny" | "cloudy" | "rainy") => void;
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
  // Variant 0: Compact Balanced Cumulus (span ~21m, puff radii 3.2m - 4.2m)
  const v0Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 4.2 },
    { x: -4.5, y: -0.8, z: -0.4, radius: 3.4 },
    { x: 4.8, y: 0.9, z: -0.4, radius: 3.6 },
    { x: 0.8, y: 0.4, z: 2.2, radius: 3.5 },
    { x: -2.8, y: 0.6, z: 1.8, radius: 3.0 },
    { x: 3.2, y: -0.5, z: 1.6, radius: 3.1 },
    { x: 1.5, y: 3.0, z: -0.5, radius: 2.9 },
    { x: -1.6, y: -2.8, z: -0.5, radius: 2.8 },
  ];

  // Variant 1: Elongated Cumulus Bank (span ~26m, puff radii 3.0m - 4.5m)
  const v1Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 4.5 },
    { x: -5.5, y: 1.0, z: -0.4, radius: 3.8 },
    { x: 5.8, y: -0.8, z: -0.4, radius: 3.9 },
    { x: -9.5, y: 1.5, z: -0.8, radius: 3.0 },
    { x: 9.8, y: -1.4, z: -0.8, radius: 3.1 },
    { x: -2.8, y: 0.4, z: 2.4, radius: 3.6 },
    { x: 3.2, y: -0.4, z: 2.3, radius: 3.7 },
    { x: 0, y: 3.0, z: -0.4, radius: 3.0 },
    { x: -4.5, y: -2.6, z: -0.4, radius: 2.8 },
    { x: 4.8, y: 2.6, z: -0.4, radius: 2.9 },
  ];

  // Variant 2: Little Puffy Cumulus (span ~17m, puff radii 2.8m - 3.8m)
  const v2Puffs: PuffDef[] = [
    { x: 0, y: 0, z: 0, radius: 3.8 },
    { x: -4.8, y: 0.4, z: -0.3, radius: 3.4 },
    { x: 5.0, y: -0.3, z: -0.3, radius: 3.4 },
    { x: 0.4, y: 0.2, z: 2.2, radius: 3.4 },
    { x: 1.4, y: 2.5, z: -0.4, radius: 2.8 },
    { x: -1.4, y: -2.5, z: -0.4, radius: 2.8 },
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

  // 1. Completely invisible to camera (colorWrite = false, depthWrite = false, transparent = true, opacity = 0)
  const invisibleCloudMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });

  // 2. Custom depth material for DirectionalLight shadow map pass: casts solid physical shadows
  const depthCasterMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
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

  let currentRoofZ = 12.0;

  function spawnCloudUpwind(cloud: { position: THREE.Vector3; baseAltitude: number; mesh: THREE.Mesh }, staggeredIdx = 0): void {
    const windLen = Math.sqrt(windVelX * windVelX + windVelY * windVelY) || 1;
    const uX = windVelX / windLen;
    const uY = windVelY / windLen;
    const perpX = -uY;
    const perpY = uX;

    // Upwind distance outside the visible arena perimeter (staggered so clouds don't arrive in a line)
    const upwindDist = arenaRadius * (1.10 + (Math.random() + staggeredIdx) * 0.35);
    const lateralOffset = (Math.random() - 0.5) * arenaRadius * 1.5;

    cloud.position.x = -uX * upwindDist + perpX * lateralOffset;
    cloud.position.y = -uY * upwindDist + perpY * lateralOffset;
    cloud.baseAltitude = minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
    cloud.position.z = currentRoofZ + cloud.baseAltitude;
    cloud.mesh.rotation.z = Math.random() * Math.PI * 2;
  }

  for (let i = 0; i < cloudCount; i++) {
    const variantIdx = i % variants.length;
    const geom = variants[variantIdx];
    const mesh = new THREE.Mesh(geom, invisibleCloudMaterial);

    // Physical shadow casting onto ground and roof
    mesh.customDepthMaterial = depthCasterMaterial;
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    // Mixed scales: smaller denser puffs (0.75 - 0.90) and slightly broader puffs (1.05 - 1.25)
    const scale = (i % 2 === 0 ? 0.82 : 1.15) + (Math.random() - 0.5) * 0.15;
    mesh.scale.setScalar(scale);

    const baseAltitude = minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
    mesh.position.set(0, 0, currentRoofZ + baseAltitude);

    const cloudInst: CloudInstance = {
      index: i,
      mesh,
      position: mesh.position,
      baseAltitude,
      scale,
      rotationSpeed: (Math.random() - 0.5) * 0.006,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.12 + Math.random() * 0.12,
      variant: variantIdx,
    };

    // Stagger spawn upwind outside map boundary
    spawnCloudUpwind(cloudInst, i * 0.4);

    masterGroup.add(mesh);
    clouds.push(cloudInst);
  }

  // Preset & layer state
  let isLayerVisible = true;
  let currentPreset: "sunny" | "cloudy" | "rainy" = "sunny";

  function applyVisibility(): void {
    if (!isLayerVisible || currentPreset === "rainy") {
      masterGroup.visible = false;
    } else {
      masterGroup.visible = true;
      // In sunny mode: rare subtle clouds (max 2 active)
      // In cloudy mode: all clouds active with full overcast shadow play
      const maxActive = currentPreset === "sunny" ? 2 : clouds.length;
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].mesh.visible = i < maxActive;
      }
    }
  }

  function update(rawDt: number, roofZ: number): void {
    const dt = Math.max(0.001, Math.min(rawDt, 0.1));
    currentRoofZ = roofZ;

    const windLen = Math.sqrt(windVelX * windVelX + windVelY * windVelY);
    const uX = windLen > 0.001 ? windVelX / windLen : 1;
    const uY = windLen > 0.001 ? windVelY / windLen : 0;

    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];

      // 1. Advance position along wind vector
      cloud.position.x += windVelX * dt;
      cloud.position.y += windVelY * dt;

      // 2. Subtle thermal altitude bobbing
      cloud.bobPhase += cloud.bobSpeed * dt;
      const targetZ = currentRoofZ + cloud.baseAltitude + Math.sin(cloud.bobPhase) * 1.0;
      cloud.position.z += (targetZ - cloud.position.z) * Math.min(1.0, dt * 2.0);

      // Hard floor guarantee above building roof level
      const minZ = currentRoofZ + minAltAboveRoof;
      if (cloud.position.z < minZ) {
        cloud.position.z = minZ;
      }

      // 3. Very slow organic yaw rotation
      cloud.mesh.rotation.z += cloud.rotationSpeed * dt;

      // 4. Boundary wrapping: when cloud drifts beyond downwind arena boundary, wrap to upwind side
      if (windLen > 0.001) {
        const proj = cloud.position.x * uX + cloud.position.y * uY;
        if (proj > arenaRadius * 1.35) {
          spawnCloudUpwind(cloud, 0);
        }
      }
    }
  }

  function setVisible(visible: boolean): void {
    isLayerVisible = visible;
    applyVisibility();
  }

  function setWeatherPreset(preset: "sunny" | "cloudy" | "rainy"): void {
    currentPreset = preset;
    applyVisibility();
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
    invisibleCloudMaterial.dispose();
    depthCasterMaterial.dispose();
  }

  return {
    update,
    setVisible,
    setWeatherPreset,
    setWind,
    getCloudCount: () => clouds.length,
    dispose,
  };
}
