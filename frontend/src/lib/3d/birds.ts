/**
 * Natural Flying Bird Animation for Three.js Solar Rooftop Scene
 *
 * Lightweight procedural bird simulation designed for architectural visualization:
 * - Deterministic, lightweight procedural geometries and materials (reusable, pooled).
 * - Articulated two-segment wings (inner + outer) providing realistic flap, flex, and glide.
 * - Dynamic flight physics: smooth 3D curved paths, coordinated banking into turns,
 *   altitude control, and speed variations.
 * - Occasional natural small flocks (2-3 birds in loose formation).
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
  /** Radius of spawn circle in metres from scene origin (default: 140) */
  arenaRadius?: number;
  /** Minimum altitude above rooftop in metres (default: 18) */
  minAltitudeAboveRoof?: number;
  /** Maximum altitude above rooftop in metres (default: 52) */
  maxAltitudeAboveRoof?: number;
  /** Minimum spawn interval in seconds (default: 3.5) */
  spawnIntervalMin?: number;
  /** Maximum spawn interval in seconds (default: 7.5) */
  spawnIntervalMax?: number;
}

export type BirdFlightMode = "flapping" | "gliding";

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
  spawnBird: (config?: { isLeader?: boolean; leaderIndex?: number; customPosition?: THREE.Vector3 }) => boolean;
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
 * Generates an aerodynamic, low-poly bird fuselage geometry (head, body, tail).
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
    0.0, 0.46, 0.01,
    // 1: Head crown
    0.0, 0.32, 0.08,
    // 2: Throat
    0.0, 0.30, -0.04,
    // 3: Nape / Upper back
    0.0, 0.12, 0.09,
    // 4: Breast
    0.0, 0.14, -0.08,
    // 5: Left flank
    -0.10, 0.08, 0.01,
    // 6: Right flank
    0.10, 0.08, 0.01,
    // 7: Lower back
    0.0, -0.20, 0.06,
    // 8: Belly
    0.0, -0.18, -0.05,
    // 9: Left rump
    -0.08, -0.18, 0.01,
    // 10: Right rump
    0.08, -0.18, 0.01,
    // 11: Tail tip left
    -0.14, -0.56, 0.02,
    // 12: Tail tip center
    0.0, -0.60, 0.02,
    // 13: Tail tip right
    0.14, -0.56, 0.02,
    // 14: Tail root
    0.0, -0.32, 0.03,
  ]);

  // Triangular facets defining the tapered lozenge hull
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
    // Tail wedge
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
    0.0, 0.08, 0.0,
    // 1: root trailing
    0.0, -0.10, 0.0,
    // 2: wrist leading
    -0.42, 0.04, 0.0,
    // 3: wrist trailing
    -0.42, -0.07, 0.0,
  ]);
  leftInner.setAttribute("position", new THREE.BufferAttribute(liVerts, 3));
  leftInner.setIndex([0, 1, 2, 2, 1, 3, 0, 2, 1, 2, 3, 1]);
  leftInner.computeVertexNormals();

  // Left outer wing (wrist to wingtip primaries): extends further along -X
  const leftOuter = new THREE.BufferGeometry();
  const loVerts = new Float32Array([
    // 0: wrist leading
    0.0, 0.04, 0.0,
    // 1: wrist trailing
    0.0, -0.07, 0.0,
    // 2: primary mid
    -0.30, -0.04, 0.01,
    // 3: wingtip point
    -0.56, -0.08, 0.02,
  ]);
  leftOuter.setAttribute("position", new THREE.BufferAttribute(loVerts, 3));
  leftOuter.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  leftOuter.computeVertexNormals();

  // Right inner wing (shoulder to wrist): mirrors along +X
  const rightInner = new THREE.BufferGeometry();
  const riVerts = new Float32Array([
    0.0, 0.08, 0.0,
    0.0, -0.10, 0.0,
    0.42, 0.04, 0.0,
    0.42, -0.07, 0.0,
  ]);
  rightInner.setAttribute("position", new THREE.BufferAttribute(riVerts, 3));
  rightInner.setIndex([0, 2, 1, 2, 3, 1, 0, 1, 2, 2, 1, 3]);
  rightInner.computeVertexNormals();

  // Right outer wing (wrist to wingtip primaries): mirrors along +X
  const rightOuter = new THREE.BufferGeometry();
  const roVerts = new Float32Array([
    0.0, 0.04, 0.0,
    0.0, -0.07, 0.0,
    0.30, -0.04, 0.01,
    0.56, -0.08, 0.02,
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
    // If flying almost vertically (rare), fall back to world East (+X)
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
  const arenaRadius = options.arenaRadius ?? 145;
  const minAltAboveRoof = options.minAltitudeAboveRoof ?? 18;
  const maxAltAboveRoof = options.maxAltitudeAboveRoof ?? 52;
  const spawnIntervalMin = options.spawnIntervalMin ?? 3.5;
  const spawnIntervalMax = options.spawnIntervalMax ?? 7.0;

  // Master root group in scene (decorative layer)
  const masterGroup = new THREE.Group();
  masterGroup.name = "BirdsSimulationGroup";
  scene.add(masterGroup);

  // Shared reusable geometries
  const fuselageGeom = createBirdFuselageGeometry();
  const { leftInner, leftOuter, rightInner, rightOuter } = createWingGeometries();

  // Shared reusable avian materials: subtle matte daylight shading, castShadow=false
  const plumageMaterial = new THREE.MeshLambertMaterial({
    color: 0x333b47,
    side: THREE.DoubleSide,
  });
  const wingtipMaterial = new THREE.MeshLambertMaterial({
    color: 0x222730,
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
    leftShoulder.position.set(-0.09, 0.08, 0.02);
    const liMesh = new THREE.Mesh(leftInner, plumageMaterial);
    liMesh.castShadow = false;
    liMesh.receiveShadow = false;
    leftShoulder.add(liMesh);

    // Left wrist joint: child of left shoulder at tip of inner wing
    const leftWrist = new THREE.Group();
    leftWrist.position.set(-0.42, 0.0, 0.0);
    const loMesh = new THREE.Mesh(leftOuter, wingtipMaterial);
    loMesh.castShadow = false;
    loMesh.receiveShadow = false;
    leftWrist.add(loMesh);
    leftShoulder.add(leftWrist);
    group.add(leftShoulder);

    // Right shoulder joint: attached at right flank
    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.09, 0.08, 0.02);
    const riMesh = new THREE.Mesh(rightInner, plumageMaterial);
    riMesh.castShadow = false;
    riMesh.receiveShadow = false;
    rightShoulder.add(riMesh);

    // Right wrist joint: child of right shoulder at tip of inner wing
    const rightWrist = new THREE.Group();
    rightWrist.position.set(0.42, 0.0, 0.0);
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
      speed: 12.0,
      maxTurnRate: 1.1,
      heading: 0,
      bank: 0,
      targetBank: 0,
      pitch: 0,
      altitude: 35,
      wingPhase: Math.random() * Math.PI * 2,
      wingFrequency: 3.6 + Math.random() * 0.9,
      flapAmplitude: 0.52 + Math.random() * 0.12,
      mode: "flapping",
      modeTimer: 2.5 + Math.random() * 2.0,
      flapDuration: 3.0 + Math.random() * 2.5,
      glideDuration: 1.8 + Math.random() * 2.2,
      flockLeaderIndex: null,
      flockOffset: new THREE.Vector3(),
      scale: 0.9 + Math.random() * 0.25,
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
  let spawnTimer = 1.2; // Initial brief delay before first bird takes flight
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
      // Spawn follower in loose echelon formation relative to leader
      bird.flockLeaderIndex = leader.index;
      const side = Math.random() > 0.5 ? 1 : -1;
      const lateralDist = 3.5 + Math.random() * 3.5;
      const trailingDist = 4.5 + Math.random() * 4.0;
      const verticalDist = (Math.random() - 0.4) * 2.5;
      bird.flockOffset.set(side * lateralDist, -trailingDist, verticalDist);

      bird.position.copy(leader.position).add(bird.flockOffset);
      bird.velocity.copy(leader.velocity);
      bird.speed = leader.speed * (0.98 + Math.random() * 0.04);
      bird.target.copy(leader.target);
      bird.heading = leader.heading;
      bird.bank = leader.bank;
      bird.scale = leader.scale * (0.92 + Math.random() * 0.16);
    } else {
      // Independent lead bird crossing the arena
      bird.flockLeaderIndex = null;
      bird.scale = 0.88 + Math.random() * 0.26;

      if (config?.customPosition) {
        bird.position.copy(config.customPosition);
      } else {
        // Spawn on the outer perimeter circle
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnDist = arenaRadius * (0.92 + Math.random() * 0.16);
        const spawnZ = currentRoofZ + minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
        bird.position.set(Math.cos(spawnAngle) * spawnDist, Math.sin(spawnAngle) * spawnDist, spawnZ);
      }

      // Choose exit point roughly across the sky (offset so path crosses within sight of site)
      const currentAngle = Math.atan2(bird.position.y, bird.position.x);
      const exitAngle = currentAngle + Math.PI + (Math.random() - 0.5) * 0.8;
      const exitDist = arenaRadius * (0.95 + Math.random() * 0.15);
      const exitZ = currentRoofZ + minAltAboveRoof + Math.random() * (maxAltAboveRoof - minAltAboveRoof);
      bird.target.set(Math.cos(exitAngle) * exitDist, Math.sin(exitAngle) * exitDist, exitZ);

      // Initial velocity heading toward target
      _scratchForward.subVectors(bird.target, bird.position);
      bird.heading = Math.atan2(_scratchForward.y, _scratchForward.x);
      bird.speed = 10.5 + Math.random() * 4.5;
      bird.velocity.set(
        Math.cos(bird.heading) * bird.speed,
        Math.sin(bird.heading) * bird.speed,
        (bird.target.z - bird.position.z) * 0.03,
      );
      bird.bank = 0;
    }

    bird.active = true;
    bird.age = 0;
    bird.mode = Math.random() > 0.35 ? "flapping" : "gliding";
    bird.modeTimer = bird.mode === "flapping" ? bird.flapDuration : bird.glideDuration;
    bird.wingPhase = Math.random() * Math.PI * 2;
    bird.wingFrequency = 3.4 + Math.random() * 1.1;

    // Apply scale to root group
    bird.group.scale.setScalar(bird.scale);
    bird.group.position.copy(bird.position);
    bird.group.visible = true;

    return true;
  }

  function spawnFlock(size = 2): void {
    const leaderSpawned = spawnBird();
    if (!leaderSpawned) return;

    // Find the leader we just spawned
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

    // Minimum altitude safety threshold: guaranteed clearance above rooftop
    const minZ = roofZ + minAltAboveRoof;

    // 1. Navigation / Steering
    let targetX = bird.target.x;
    let targetY = bird.target.y;
    let targetZ = Math.max(bird.target.z, minZ);

    if (bird.flockLeaderIndex !== null) {
      const leader = pool[bird.flockLeaderIndex];
      if (leader && leader.active) {
        // Compute follower's target position offset in leader's heading frame
        const cosH = Math.cos(leader.heading);
        const sinH = Math.sin(leader.heading);
        targetX = leader.position.x + bird.flockOffset.x * cosH - bird.flockOffset.y * sinH;
        targetY = leader.position.y + bird.flockOffset.x * sinH + bird.flockOffset.y * cosH;
        targetZ = Math.max(leader.position.z + bird.flockOffset.z, minZ);
      } else {
        // Leader left scene; follower continues independently
        bird.flockLeaderIndex = null;
      }
    }

    const dx = targetX - bird.position.x;
    const dy = targetY - bird.position.y;
    const dz = targetZ - bird.position.z;

    const desiredHeading = Math.atan2(dy, dx);
    const headingDiff = normalizeAngle(desiredHeading - bird.heading);

    // Limit angular turn speed
    const maxTurnStep = bird.maxTurnRate * dt;
    const turnStep = Math.max(-maxTurnStep, Math.min(maxTurnStep, headingDiff));
    bird.heading = normalizeAngle(bird.heading + turnStep);

    // Coordinated aerodynamic banking into turns: bank angle ~ -turnRate * (v / g)
    const turnRate = dt > 0.0001 ? turnStep / dt : 0;
    const targetBank = Math.max(-0.65, Math.min(0.65, -turnRate * (bird.speed / 9.81) * 0.75));
    bird.bank += (targetBank - bird.bank) * Math.min(1.0, dt * 4.5);

    // Vertical climb/descent rate towards target altitude
    const desiredClimbRate = Math.max(-2.5, Math.min(3.2, dz * 0.35));
    bird.velocity.z += (desiredClimbRate - bird.velocity.z) * Math.min(1.0, dt * 2.0);

    // Horizontal velocity from current heading
    bird.velocity.x = Math.cos(bird.heading) * bird.speed;
    bird.velocity.y = Math.sin(bird.heading) * bird.speed;

    // Integrate position
    bird.position.addScaledVector(bird.velocity, dt);

    // Hard ceiling & floor constraints
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
        bird.modeTimer = bird.glideDuration * (0.8 + Math.random() * 0.4);
      } else {
        bird.mode = "flapping";
        bird.modeTimer = bird.flapDuration * (0.8 + Math.random() * 0.4);
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
      const sinPOuter = Math.sin(bird.wingPhase - 0.42);

      // Inner wing flap
      innerAngle = bird.flapAmplitude * sinP;
      // Outer wing flexes with phase lag & higher amplitude
      outerAngle = bird.flapAmplitude * 1.35 * sinPOuter;

      // Subtle fold during upstroke (cosP < 0)
      if (cosP < 0) {
        foldAngle = 0.16 * Math.abs(sinP);
      }

      // Subtle body bobbing
      bodyBob = 0.032 * Math.sin(bird.wingPhase - Math.PI / 2);
    } else {
      // Gliding: dihedral V-angle (approx +6 deg) + gentle air turbulence wobble
      const wobble = 0.03 * Math.sin(bird.age * 2.8 + bird.index);
      innerAngle = 0.10 + wobble;
      outerAngle = 0.04 + wobble * 0.8;
      foldAngle = 0.02;
      bodyBob = 0.012 * Math.sin(bird.age * 1.5);
    }

    // Apply articulated wing rotation (Left wing)
    bird.leftShoulder.rotation.set(0, innerAngle, foldAngle);
    bird.leftWrist.rotation.set(0, outerAngle, 0);

    // Right wing mirrors innerAngle and foldAngle
    bird.rightShoulder.rotation.set(0, -innerAngle, -foldAngle);
    bird.rightWrist.rotation.set(0, -outerAngle, 0);

    // Subtle fuselage body bobbing
    bird.bodyMesh.position.z = bodyBob;

    // 3. Despawn when bird traverses far beyond arena boundary
    const distSq = bird.position.x * bird.position.x + bird.position.y * bird.position.y;
    const despawnDist = arenaRadius + 30;
    if (distSq > despawnDist * despawnDist && bird.age > 4.0) {
      bird.active = false;
      bird.group.visible = false;
    }
  }

  function update(rawDt: number, roofZ: number): void {
    // Guard against large frame spikes (e.g. background tab return)
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

      // 35% chance to spawn a pair or small flock, otherwise single bird
      if (Math.random() < 0.35 && maxActiveBirds - countActiveBirds() >= 2) {
        spawnFlock(2 + (Math.random() > 0.7 ? 1 : 0));
      } else {
        spawnBird();
      }
    }
  }

  function setVisible(visible: boolean): void {
    masterGroup.visible = visible;
  }

  function dispose(): void {
    // Detach and clean up all meshes and geometries
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

  return {
    update,
    setVisible,
    dispose,
    getActiveBirdCount: countActiveBirds,
    spawnBird,
    spawnFlock,
  };
}
