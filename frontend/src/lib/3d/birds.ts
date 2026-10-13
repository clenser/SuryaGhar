/**
 * Natural Flying Bird Animation for Three.js Solar Rooftop Scene
 *
 * Lightweight procedural bird simulation designed for architectural visualization:
 * - Deterministic, lightweight procedural geometries and materials (reusable, pooled).
 * - Articulated two-segment wings (inner + outer) providing realistic flap, flex, and glide.
 * - Dynamic flight physics: smooth 3D curved paths, coordinated banking into turns,
 *   altitude control, and speed variations.
 * - Indian urban raptor / black kite soaring behavior (broad thermals circling above terraces).
 * - Occasional natural small flocks (2-3 birds in loose formation).
 * - Immediate presence on mount: active birds already soaring above the roof so the sky is never empty.
 * - Strict solar-physics isolation: decorative only (castShadow = false, receiveShadow = false).
 * - Guaranteed clearance above building rooftop (minimum altitude clamp above roofZ).
 * - Zero runtime allocations per frame, clean lifecycle disposal.
 */

import * as THREE from "three";

export interface BirdsSimulationOptions {
  /** Maximum number of active birds in the scene (default: 8) */
  maxActiveBirds?: number;
  /** Size of pre-allocated bird object pool (default: 12) */
  poolSize?: number;
  /** Radius of spawn circle in metres from scene origin (default: 65) */
  arenaRadius?: number;
  /** Minimum altitude above rooftop in metres (default: 5.0) */
  minAltitudeAboveRoof?: number;
  /** Maximum altitude above rooftop in metres (default: 14.0) */
  maxAltitudeAboveRoof?: number;
  /** Minimum spawn interval in seconds (default: 2.5) */
  spawnIntervalMin?: number;
  /** Maximum spawn interval in seconds (default: 5.5) */
  spawnIntervalMax?: number;
  /** Whether to spawn initial birds immediately so sky is lively on mount (default: true) */
  initialSpawn?: boolean;
}

export type BirdFlightMode = "flapping" | "gliding";
export type BirdFlightPattern = "soaring" | "crossing";

export interface BirdInstance {
  index: number;
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  maxTurnRate: number;
  heading: number;
  bank: number;
  targetBank: number;
  pitch: number;
  altitude: number;
  wingPhase: number;
  wingFrequency: number;
  flapAmplitude: number;
  mode: BirdFlightMode;
  modeTimer: number;
  flapDuration: number;
  glideDuration: number;
  pattern: BirdFlightPattern;
  patternTimer: number;
  soarCenter: THREE.Vector2;
  soarRadius: number;
  soarAngle: number;
  soarDir: number;
  soarBaseAlt: number;
  flockLeaderIndex: number | null;
  flockOffset: THREE.Vector3;
  scale: number;
  age: number;
  group: THREE.Group;
  leftShoulder: THREE.Group;
  leftWrist: THREE.Group;
  rightShoulder: THREE.Group;
  rightWrist: THREE.Group;
  bodyMesh: THREE.Mesh;
}

export interface BirdsSimulation {
  /** Update flight positions, wing flaps, and spawning. Call inside the rAF loop with delta seconds. */
  update: (dt: number, roofZ: number) => void;
  /** Show or hide all birds */
  setVisible: (visible: boolean) => void;
  /** Clean up all Three.js meshes, geometries, and materials */
  dispose: () => void;
  /** Number of currently active flying birds */
  getActiveBirdCount: () => number;
  /** Spawn a single bird (used internally or for testing) */
  spawnBird: (config?: {
    pattern?: BirdFlightPattern;
    isLeader?: boolean;
    leaderIndex?: number;
    customPosition?: THREE.Vector3;
  }) => boolean;
  /** Spawn a small flock of birds */
  spawnFlock: (size?: number) => void;
}

/**
 * Normalizes an angle to [-PI, +PI].
 */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Generates an aerodynamic, low-poly bird fuselage geometry (head, body, forked tail).
 * Dimensions: ~1.4m length, ~0.26m width.
 * Coordinates in local bird space:
 *   +Y = Forward (head/beak)
 *   +X = Right flank
 *   -X = Left flank
 *   +Z = Dorsal (up)
 */
export function createBirdFuselageGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();

  // Key landmark vertices
  const vertices = new Float32Array([
    // 0: Beak tip
    0.0, 0.60, 0.02,
    // 1: Head crown
    0.0, 0.42, 0.11,
    // 2: Throat
    0.0, 0.40, -0.05,
    // 3: Nape / Upper back
    0.0, 0.16, 0.12,
    // 4: Breast
    0.0, 0.18, -0.11,
    // 5: Left flank
    -0.14, 0.10, 0.02,
    // 6: Right flank
    0.14, 0.10, 0.02,
    // 7: Lower back
    0.0, -0.28, 0.08,
    // 8: Belly
    0.0, -0.25, -0.07,
    // 9: Left rump
    -0.11, -0.24, 0.02,
    // 10: Right rump
    0.11, -0.24, 0.02,
    // 11: Tail tip left (kite notched tail)
    -0.20, -0.78, 0.03,
    // 12: Tail tip center notch
    0.0, -0.72, 0.03,
    // 13: Tail tip right
    0.20, -0.78, 0.03,
    // 14: Tail root
    0.0, -0.42, 0.04,
  ]);

  // Triangular facets defining the tapered hull
  const indices = [
    // Head upper & lower
    0, 1, 6,
    0, 6, 2,
    0, 5, 1,
    0, 2, 5,
    // Throat & Nape
    1, 3, 6,
    1, 5, 3,
    2, 6, 4,
    2, 4, 5,
    // Torso back & belly
    3, 7, 6,
    3, 5, 7,
    6, 7, 10,
    5, 9, 7,
    4, 6, 10,
    4, 10, 8,
    4, 9, 5,
    4, 8, 9,
    7, 8, 10,
    7, 9, 8,
    // Tail wedge & notch
    7, 14, 9,
    7, 10, 14,
    14, 11, 12,
    14, 12, 13,
    // Tail underside
    14, 12, 11,
    14, 13, 12,
  ];

  geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return geom;
}

/**
 * Creates articulated inner and outer wing geometries for left and right wings.
 * Span: inner ~0.55m, outer ~0.72m -> total wingspan ~2.8m.
 * Both inner and outer wings are double-sided planar airfoils.
 */
export function createWingGeometries(): {
  leftInner: THREE.BufferGeometry;
  leftOuter: THREE.BufferGeometry;
  rightInner: THREE.BufferGeometry;
  rightOuter: THREE.BufferGeometry;
} {
  // Left inner wing (shoulder to wrist): extends along -X
  const leftInner = new THREE.BufferGeometry();
  const liVerts = new Float32Array([
    // 0: root leading
    0.0, 0.12, 0.0,
    // 1: root trailing
    0.0, -0.15, 0.0,
    // 2: wrist leading
    -0.55, 0.06, 0.0,
    // 3: wrist trailing
    -0.55, -0.10, 0.0,
  ]);
  leftInner.setAttribute("position", new THREE.BufferAttribute(liVerts, 3));
  leftInner.setIndex([0, 1, 2, 2, 1, 3, 0, 2, 1, 2, 3, 1]);
  leftInner.computeVertexNormals();

  // Left outer wing (wrist to wingtip primaries): extends further along -X
  const leftOuter = new THREE.BufferGeometry();
  const loVerts = new Float32Array([
    // 0: wrist leading
    0.0, 0.06, 0.0,
    // 1: wrist trailing
    0.0, -0.10, 0.0,
    // 2: primary mid
    -0.40, -0.06, 0.01,
    // 3: wingtip point (swept back)
    -0.75, -0.12, 0.03,
  ]);
  leftOuter.setAttribute("position", new THREE.BufferAttribute(loVerts, 3));
  leftOuter.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  leftOuter.computeVertexNormals();

  // Right inner wing (shoulder to wrist): mirrors along +X
  const rightInner = new THREE.BufferGeometry();
  const riVerts = new Float32Array([
    0.0, 0.12, 0.0,
    0.0, -0.15, 0.0,
    0.55, 0.06, 0.0,
    0.55, -0.10, 0.0,
  ]);
  rightInner.setAttribute("position", new THREE.BufferAttribute(riVerts, 3));
  rightInner.setIndex([0, 2, 1, 2, 3, 1, 0, 1, 2, 2, 1, 3]);
  rightInner.computeVertexNormals();

  // Right outer wing (wrist to wingtip primaries): mirrors along +X
  const rightOuter = new THREE.BufferGeometry();
  const roVerts = new Float32Array([
    0.0, 0.06, 0.0,
    0.0, -0.10, 0.0,
    0.40, -0.06, 0.01,
    0.75, -0.12, 0.03,
  ]);
  rightOuter.setAttribute("position", new THREE.BufferAttribute(roVerts, 3));
  rightOuter.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3]);
  rightOuter.computeVertexNormals();

  return { leftInner, leftOuter, rightInner, rightOuter };
}

// Reusable scratch objects to eliminate per-frame allocations
const _scratchForward = new THREE.Vector3();
const _scratchRight0 = new THREE.Vector3();
const _scratchUp0 = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchUp = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();
const _scratchQuat = new THREE.Quaternion();
const _worldUp = new THREE.Vector3(0, 0, 1);

/**
 * Computes an orthonormal orientation matrix for a bird in Z-up world space:
 * - Local +Y points along velocity vector.
 * - Local +Z points dorsal (up), banked by bankAngle around forward vector.
 * - Local +X points along the right wing.
 */
export function computeAvianOrientation(
  velocity: THREE.Vector3,
  bankAngle: number,
  outMatrix: THREE.Matrix4 = _scratchBasisMatrix,
): THREE.Matrix4 {
  const speed = velocity.length();
  if (speed < 0.001) {
    outMatrix.identity();
    return outMatrix;
  }

  // Forward unit vector (Local +Y)
  _scratchForward.copy(velocity).divideScalar(speed);

  // Horizontal right vector: Forward x WorldUp (0, 0, 1)
  _scratchRight0.crossVectors(_scratchForward, _worldUp);
  if (_scratchRight0.lengthSq() < 0.0001) {
    _scratchRight0.set(1, 0, 0);
  } else {
    _scratchRight0.normalize();
  }

  // Unbanked dorsal up vector: Right0 x Forward
  _scratchUp0.crossVectors(_scratchRight0, _scratchForward).normalize();

  // Apply bank roll around Forward axis
  const cosB = Math.cos(bankAngle);
  const sinB = Math.sin(bankAngle);

  // Banked Right (Local +X)
  _scratchRight.copy(_scratchRight0).multiplyScalar(cosB).addScaledVector(_scratchUp0, sinB);
  // Banked Up (Local +Z)
  _scratchUp.copy(_scratchRight0).multiplyScalar(-sinB).addScaledVector(_scratchUp0, cosB);

  // Column basis: X = Right, Y = Forward, Z = Up
  outMatrix.makeBasis(_scratchRight, _scratchForward, _scratchUp);
  return outMatrix;
}

/**
 * Creates and initializes the BirdsSimulation in the given Three.js scene.
 */
export function createBirdsSimulation(
  scene: THREE.Scene,
  options: BirdsSimulationOptions = {},
): BirdsSimulation {
  const maxActiveBirds = options.maxActiveBirds ?? 8;
  const poolSize = Math.max(options.poolSize ?? 12, maxActiveBirds);
  // Arena radius ~60m keeps birds in clear viewing frustum above building
  const arenaRadius = options.arenaRadius ?? 60;
  // Clear altitude above roof level: safely clears 2.5m rooftop structures while staying in camera view
  const minAltAboveRoof = options.minAltitudeAboveRoof ?? 5.0;
  const maxAltAboveRoof = options.maxAltitudeAboveRoof ?? 14.0;
  const spawnIntervalMin = options.spawnIntervalMin ?? 2.5;
  const spawnIntervalMax = options.spawnIntervalMax ?? 5.5;

  // Master root group in scene (decorative layer)
  const masterGroup = new THREE.Group();
  masterGroup.name = "BirdsSimulationGroup";
  scene.add(masterGroup);

  // Shared reusable geometries
  const fuselageGeom = createBirdFuselageGeometry();
  const { leftInner, leftOuter, rightInner, rightOuter } = createWingGeometries();

  // Shared reusable avian materials:
  // Warm Indian black kite plumage with subtle emissive fill so birds are always crisp against dark studio background
  const plumageMaterial = new THREE.MeshLambertMaterial({
    color: 0x92806e,
    emissive: 0x241d17,
    side: THREE.DoubleSide,
  });
  const wingtipMaterial = new THREE.MeshLambertMaterial({
    color: 0x3f352b,
    emissive: 0x14100c,
    side: THREE.DoubleSide,
  });

  // Pre-allocate object pool
  const pool: BirdInstance[] = [];

  for (let i = 0; i < poolSize; i++) {
    const group = new THREE.Group();
    group.name = `Bird_${i}`;
    group.visible = false;

    // Body mesh
    const bodyMesh = new THREE.Mesh(fuselageGeom, plumageMaterial);
    bodyMesh.castShadow = false;
    bodyMesh.receiveShadow = false;
    group.add(bodyMesh);

    // Left shoulder joint: attached at left flank
    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.13, 0.10, 0.02);
    const liMesh = new THREE.Mesh(leftInner, plumageMaterial);
    liMesh.castShadow = false;
    liMesh.receiveShadow = false;
    leftShoulder.add(liMesh);

    // Left wrist joint: child of left shoulder at tip of inner wing
    const leftWrist = new THREE.Group();
    leftWrist.position.set(-0.55, 0.0, 0.0);
    const loMesh = new THREE.Mesh(leftOuter, wingtipMaterial);
    loMesh.castShadow = false;
    loMesh.receiveShadow = false;
    leftWrist.add(loMesh);
    leftShoulder.add(leftWrist);
    group.add(leftShoulder);

    // Right shoulder joint: attached at right flank
    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.13, 0.10, 0.02);
    const riMesh = new THREE.Mesh(rightInner, plumageMaterial);
    riMesh.castShadow = false;
    riMesh.receiveShadow = false;
    rightShoulder.add(riMesh);

    // Right wrist joint: child of right shoulder at tip of inner wing
    const rightWrist = new THREE.Group();
    rightWrist.position.set(0.55, 0.0, 0.0);
    const roMesh = new THREE.Mesh(rightOuter, wingtipMaterial);
    roMesh.castShadow = false;
    roMesh.receiveShadow = false;
    rightWrist.add(roMesh);
    rightShoulder.add(rightWrist);
    group.add(rightShoulder);

    masterGroup.add(group);

    pool.push({
      index: i,
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
      speed: 11.5,
      maxTurnRate: 1.2,
      heading: 0,
      bank: 0,
      targetBank: 0,
      pitch: 0,
      altitude: 20,
      wingPhase: Math.random() * Math.PI * 2,
      wingFrequency: 3.5 + Math.random() * 0.8,
      flapAmplitude: 0.50 + Math.random() * 0.10,
      mode: "gliding",
      modeTimer: 3.0 + Math.random() * 3.0,
      flapDuration: 2.2 + Math.random() * 1.5,
      glideDuration: 4.5 + Math.random() * 3.5,
      pattern: "soaring",
      patternTimer: 25.0,
      soarCenter: new THREE.Vector2(),
      soarRadius: 22,
      soarAngle: 0,
      soarDir: 1,
      soarBaseAlt: 7.5,
      flockLeaderIndex: null,
      flockOffset: new THREE.Vector3(),
      scale: 1.05 + Math.random() * 0.2,
      age: 0,
      group,
      leftShoulder,
      leftWrist,
      rightShoulder,
      rightWrist,
      bodyMesh,
    });
  }

  // Spawning management
  let spawnTimer = 2.0;
  let currentRoofZ = 12.0;

  function countActiveBirds(): number {
    let count = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].active) count++;
    }
    return count;
  }

  function getAvailableBird(): BirdInstance | null {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    return null;
  }

  function spawnBird(config?: {
    pattern?: BirdFlightPattern;
    isLeader?: boolean;
    leaderIndex?: number;
    customPosition?: THREE.Vector3;
  }): boolean {
    if (countActiveBirds() >= maxActiveBirds) return false;
    const bird = getAvailableBird();
    if (!bird) return false;

    const isFollower = config?.leaderIndex !== undefined && config.leaderIndex !== null;
    const leader = isFollower ? pool[config!.leaderIndex!] : null;

    if (isFollower && leader && leader.active) {
      // Follower in loose echelon formation relative to leader
      bird.flockLeaderIndex = leader.index;
      const side = Math.random() > 0.5 ? 1 : -1;
      const lateralDist = 3.5 + Math.random() * 3.0;
      const trailingDist = 4.5 + Math.random() * 3.5;
      const verticalDist = (Math.random() - 0.4) * 2.0;
      bird.flockOffset.set(side * lateralDist, -trailingDist, verticalDist);

      bird.position.copy(leader.position).add(bird.flockOffset);
      bird.velocity.copy(leader.velocity);
      bird.speed = leader.speed * (0.98 + Math.random() * 0.04);
      bird.target.copy(leader.target);
      bird.heading = leader.heading;
      bird.bank = leader.bank;
      bird.scale = leader.scale * (0.94 + Math.random() * 0.12);
      bird.pattern = leader.pattern;
      bird.patternTimer = leader.patternTimer;
    } else {
      bird.flockLeaderIndex = null;
      bird.scale = 1.05 + Math.random() * 0.22;

      // 50% soaring kite circling the rooftop, 50% crossing sky
      bird.pattern = config?.pattern ?? (Math.random() > 0.45 ? "soaring" : "crossing");
      bird.patternTimer = bird.pattern === "soaring" ? (20.0 + Math.random() * 20.0) : 100.0;

      if (bird.pattern === "soaring") {
        // Circle centered near site with radius 16m-30m
        bird.soarCenter.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
        bird.soarRadius = 18 + Math.random() * 12;
        bird.soarDir = Math.random() > 0.5 ? 1 : -1;
        bird.soarAngle = Math.random() * Math.PI * 2;
        bird.soarBaseAlt = minAltAboveRoof + 1.5 + Math.random() * (maxAltAboveRoof - minAltAboveRoof - 3.0);
        bird.speed = 10.0 + Math.random() * 2.5;

        if (config?.customPosition) {
          bird.position.copy(config.customPosition);
          bird.soarAngle = Math.atan2(bird.position.y - bird.soarCenter.y, bird.position.x - bird.soarCenter.x);
        } else {
          bird.position.set(
            bird.soarCenter.x + Math.cos(bird.soarAngle) * bird.soarRadius,
            bird.soarCenter.y + Math.sin(bird.soarAngle) * bird.soarRadius,
            currentRoofZ + bird.soarBaseAlt,
          );
        }

        // Tangent heading along circle
        bird.heading = bird.soarAngle + (bird.soarDir > 0 ? Math.PI / 2 : -Math.PI / 2);
        bird.velocity.set(
          Math.cos(bird.heading) * bird.speed,
          Math.sin(bird.heading) * bird.speed,
          0,
        );
        bird.bank = -bird.soarDir * 0.28; // Bank inward into the circle
        bird.mode = "gliding";
        bird.modeTimer = 5.0 + Math.random() * 4.0;
      } else {
        // Crossing trajectory: path traverses directly across sky above building
        if (config?.customPosition) {
          bird.position.copy(config.customPosition);
        } else {
          const spawnAngle = Math.random() * Math.PI * 2;
          const spawnDist = arenaRadius * (0.90 + Math.random() * 0.15);
          const spawnZ = currentRoofZ + minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
          bird.position.set(Math.cos(spawnAngle) * spawnDist, Math.sin(spawnAngle) * spawnDist, spawnZ);
        }

        // Target point passes directly over site (within 10m of center) towards exit
        const exitAngle = Math.atan2(bird.position.y, bird.position.x) + Math.PI + (Math.random() - 0.5) * 0.5;
        const exitDist = arenaRadius * 1.05;
        const exitZ = currentRoofZ + minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
        bird.target.set(Math.cos(exitAngle) * exitDist, Math.sin(exitAngle) * exitDist, exitZ);

        _scratchForward.subVectors(bird.target, bird.position);
        bird.heading = Math.atan2(_scratchForward.y, _scratchForward.x);
        bird.speed = 11.0 + Math.random() * 3.5;
        bird.velocity.set(
          Math.cos(bird.heading) * bird.speed,
          Math.sin(bird.heading) * bird.speed,
          (bird.target.z - bird.position.z) * 0.04,
        );
        bird.bank = 0;
        bird.mode = Math.random() > 0.4 ? "gliding" : "flapping";
        bird.modeTimer = bird.mode === "gliding" ? 4.0 : 2.5;
      }
    }

    bird.active = true;
    bird.age = 0;
    bird.wingPhase = Math.random() * Math.PI * 2;
    bird.wingFrequency = 3.4 + Math.random() * 0.8;

    bird.group.scale.setScalar(bird.scale);
    bird.group.position.copy(bird.position);
    bird.group.visible = true;

    return true;
  }

  function spawnFlock(size = 2): void {
    const leaderSpawned = spawnBird({ pattern: "crossing" });
    if (!leaderSpawned) return;

    let leader: BirdInstance | null = null;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i].active && pool[i].flockLeaderIndex === null) {
        leader = pool[i];
        break;
      }
    }
    if (!leader) return;

    const followerCount = Math.min(size - 1, maxActiveBirds - countActiveBirds());
    for (let f = 0; f < followerCount; f++) {
      spawnBird({ leaderIndex: leader.index });
    }
  }

  function updateBird(bird: BirdInstance, dt: number, roofZ: number): void {
    bird.age += dt;

    // Minimum altitude safety threshold: guaranteed clearance above rooftop & obstacles
    const minZ = roofZ + minAltAboveRoof;

    // 1. Navigation & Trajectory Planning
    let targetX = bird.target.x;
    let targetY = bird.target.y;
    let targetZ = Math.max(bird.target.z, minZ);

    if (bird.pattern === "soaring") {
      bird.patternTimer -= dt;
      if (bird.patternTimer <= 0) {
        // Soaring cycle finished: transition smoothly to crossing exit
        bird.pattern = "crossing";
        const exitAngle = bird.heading + (Math.random() - 0.5) * 0.3;
        bird.target.set(Math.cos(exitAngle) * (arenaRadius + 20), Math.sin(exitAngle) * (arenaRadius + 20), bird.position.z);
      } else {
        // Advance along thermal orbit circle
        const angularSpeed = bird.speed / bird.soarRadius;
        bird.soarAngle = normalizeAngle(bird.soarAngle + bird.soarDir * angularSpeed * dt);

        // Aim at point ahead on the circle tangent
        const leadAngle = bird.soarAngle + bird.soarDir * 0.42;
        targetX = bird.soarCenter.x + Math.cos(leadAngle) * bird.soarRadius;
        targetY = bird.soarCenter.y + Math.sin(leadAngle) * bird.soarRadius;
        targetZ = Math.max(minZ, roofZ + bird.soarBaseAlt + Math.sin(bird.age * 0.6) * 1.5);
      }
    } else if (bird.flockLeaderIndex !== null) {
      const leader = pool[bird.flockLeaderIndex];
      if (leader && leader.active) {
        const cosH = Math.cos(leader.heading);
        const sinH = Math.sin(leader.heading);
        targetX = leader.position.x + bird.flockOffset.x * cosH - bird.flockOffset.y * sinH;
        targetY = leader.position.y + bird.flockOffset.x * sinH + bird.flockOffset.y * cosH;
        targetZ = Math.max(leader.position.z + bird.flockOffset.z, minZ);
      } else {
        bird.flockLeaderIndex = null;
      }
    }

    const dx = targetX - bird.position.x;
    const dy = targetY - bird.position.y;
    const dz = targetZ - bird.position.z;

    const desiredHeading = Math.atan2(dy, dx);
    const headingDiff = normalizeAngle(desiredHeading - bird.heading);

    // Limit angular turn speed for smooth flight
    const maxTurnStep = bird.maxTurnRate * dt;
    const turnStep = Math.max(-maxTurnStep, Math.min(maxTurnStep, headingDiff));
    bird.heading = normalizeAngle(bird.heading + turnStep);

    // Coordinated aerodynamic banking: bank angle ~ -turnRate * (v / g)
    const turnRate = dt > 0.0001 ? turnStep / dt : 0;
    const targetBank = Math.max(-0.60, Math.min(0.60, -turnRate * (bird.speed / 9.81) * 0.85));
    bird.bank += (targetBank - bird.bank) * Math.min(1.0, dt * 4.5);

    // Vertical climb/descent rate towards target altitude
    const desiredClimbRate = Math.max(-2.2, Math.min(2.8, dz * 0.4));
    bird.velocity.z += (desiredClimbRate - bird.velocity.z) * Math.min(1.0, dt * 2.0);

    // Horizontal velocity from current heading
    bird.velocity.x = Math.cos(bird.heading) * bird.speed;
    bird.velocity.y = Math.sin(bird.heading) * bird.speed;

    // Integrate position
    bird.position.addScaledVector(bird.velocity, dt);

    // Strict ceiling & floor safety constraints
    if (bird.position.z < minZ) {
      bird.position.z = minZ;
      if (bird.velocity.z < 0) bird.velocity.z = 0;
    }

    // Update 3D orientation & transform
    computeAvianOrientation(bird.velocity, bird.bank, _scratchBasisMatrix);
    _scratchQuat.setFromRotationMatrix(_scratchBasisMatrix);
    bird.group.quaternion.copy(_scratchQuat);
    bird.group.position.copy(bird.position);

    // 2. Wing Flap / Glide Kinematics
    bird.modeTimer -= dt;
    if (bird.modeTimer <= 0) {
      if (bird.mode === "flapping") {
        bird.mode = "gliding";
        // Soaring kites glide much longer than they flap
        bird.modeTimer = bird.pattern === "soaring"
          ? (5.0 + Math.random() * 4.0)
          : bird.glideDuration * (0.8 + Math.random() * 0.4);
      } else {
        bird.mode = "flapping";
        bird.modeTimer = bird.pattern === "soaring"
          ? (1.4 + Math.random() * 1.0)
          : bird.flapDuration * (0.8 + Math.random() * 0.4);
      }
    }

    let innerAngle = 0;
    let outerAngle = 0;
    let foldAngle = 0;
    let bodyBob = 0;

    if (bird.mode === "flapping") {
      bird.wingPhase += dt * bird.wingFrequency * Math.PI * 2;
      const sinP = Math.sin(bird.wingPhase);
      const cosP = Math.cos(bird.wingPhase);
      const sinPOuter = Math.sin(bird.wingPhase - 0.40);

      innerAngle = bird.flapAmplitude * sinP;
      outerAngle = bird.flapAmplitude * 1.35 * sinPOuter;

      if (cosP < 0) {
        foldAngle = 0.16 * Math.abs(sinP);
      }
      bodyBob = 0.035 * Math.sin(bird.wingPhase - Math.PI / 2);
    } else {
      // Gliding: positive dihedral V-angle (approx +7 deg) + air thermal wobble
      const wobble = 0.03 * Math.sin(bird.age * 2.5 + bird.index);
      innerAngle = 0.12 + wobble;
      outerAngle = 0.06 + wobble * 0.8;
      foldAngle = 0.02;
      bodyBob = 0.015 * Math.sin(bird.age * 1.4);
    }

    // Articulated wing rotation (Left wing)
    bird.leftShoulder.rotation.set(0, innerAngle, foldAngle);
    bird.leftWrist.rotation.set(0, outerAngle, 0);

    // Right wing mirrors innerAngle and foldAngle
    bird.rightShoulder.rotation.set(0, -innerAngle, -foldAngle);
    bird.rightWrist.rotation.set(0, -outerAngle, 0);

    // Subtle fuselage body bobbing
    bird.bodyMesh.position.z = bodyBob;

    // 3. Despawn when crossing bird exits far beyond arena boundary
    if (bird.pattern === "crossing") {
      const distSq = bird.position.x * bird.position.x + bird.position.y * bird.position.y;
      const despawnDist = arenaRadius + 20;
      if (distSq > despawnDist * despawnDist && bird.age > 4.0) {
        bird.active = false;
        bird.group.visible = false;
      }
    }
  }

  function update(rawDt: number, roofZ: number): void {
    const dt = Math.max(0.001, Math.min(rawDt, 0.1));
    currentRoofZ = roofZ;

    // Update active birds
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].active) {
        updateBird(pool[i], dt, roofZ);
      }
    }

    // Periodic spawning
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = spawnIntervalMin + Math.random() * (spawnIntervalMax - spawnIntervalMin);

      if (Math.random() < 0.35 && maxActiveBirds - countActiveBirds() >= 2) {
        spawnFlock(2);
      } else {
        spawnBird();
      }
    }
  }

  function setVisible(visible: boolean): void {
    masterGroup.visible = visible;
  }

  function dispose(): void {
    for (let i = 0; i < pool.length; i++) {
      pool[i].active = false;
      pool[i].group.visible = false;
    }

    if (masterGroup.parent) {
      masterGroup.parent.remove(masterGroup);
    }
    masterGroup.clear();

    fuselageGeom.dispose();
    leftInner.dispose();
    leftOuter.dispose();
    rightInner.dispose();
    rightOuter.dispose();
    plumageMaterial.dispose();
    wingtipMaterial.dispose();
  }

  // Initial immediate spawn so sky is lively the instant the 3D scene opens
  if (options.initialSpawn !== false) {
    // 1. A majestic Indian black kite soaring directly above the rooftop
    spawnBird({
      pattern: "soaring",
      customPosition: new THREE.Vector3(-14, 10, currentRoofZ + 6.5),
    });
    // 2. A crossing bird already in flight across the sky
    spawnBird({
      pattern: "crossing",
      customPosition: new THREE.Vector3(16, -18, currentRoofZ + 8.5),
    });
  }

  return {
    update,
    setVisible,
    dispose,
    getActiveBirdCount: countActiveBirds,
    spawnBird,
    spawnFlock,
  };
}
