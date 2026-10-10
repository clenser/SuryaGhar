/**
 * Obstacle Three.js meshes
 *
 * Pure visualisation of `Obstacle` application state: every dimension comes
 * from the obstacle record in metres (1 Three.js unit = 1 metre), never from
 * pixels, camera distance or mesh bounding boxes (AGENTS.md §40, §52, §64).
 *
 * AGENTS.md §16: obstacles are real geometry (boxes) — later phases will use
 * the same records for clearance, shadow and shading analysis.
 * AGENTS.md §27, §45: low-poly boxes, one small mesh + edge outline per
 * obstacle, materials disposed with their mesh.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { obstacleFootprint, type Obstacle, type ObstacleType } from "./obstacles";

/** Palette follows the Surya-Ghar navy/teal tokens (no new hues). */
export const OBSTACLE_COLORS: Record<ObstacleType, number> = {
  hvac: 0x7b8794, // slate grey
  "water-tank": 0x1f7a8c, // teal-blue
  "staircase-room": 0x3d4f63, // slate navy
  "lift-room": 0x2c3e50, // navy
  custom: 0x6f7f92, // neutral steel
};

/** Teal highlight used for the selected obstacle (matches wireframe teal). */
export const OBSTACLE_SELECTED_EMISSIVE = 0x13a8b5;
/** Red used for an invalid draft footprint. */
export const OBSTACLE_INVALID_COLOR = 0xd94b4b;

/**
 * Solid obstacle material (MeshStandardMaterial, same PBR style as building).
 */
export function createObstacleMaterial(type: ObstacleType): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: OBSTACLE_COLORS[type] ?? OBSTACLE_COLORS.custom,
    roughness: 0.6,
    metalness: 0.15,
  });
}

/**
 * Build one obstacle mesh.
 *
 * Rectangular obstacles use a box; drawn-polygon obstacles extrude their
 * footprint ring exactly like the building extrusion (proven Shape path).
 * Either way the solid spans roofZ → roofZ + height with the footprint's
 * dimensions and shape preserved.
 *
 * The box is `width` (X) × `length` (Y) × `height` (Z) in metres, translated so
 * its base sits at local Z = 0, then placed at the footprint centre with its
 * base at the roof plane (`buildingHeight`) and rotated around Z.
 * Example: height 17.2 m + obstacle 2.0 m → occupies Z 17.2 → 19.2 m.
 */
/* ------------------------------------------------------------------ */
/* Predefined obstacle models.                                          */
/*                                                                      */
/* Each type gets a recognizable low-poly composite built from Three.js */
/* primitives and merged into ONE geometry, so the obstacle stays a     */
/* single Mesh: raycast picking, selection emissive, per-type colour,    */
/* disposal and X-ray path all keep working unchanged. Every model is   */
/* authored in local metres with its base on the roof plane (z = 0) and */
/* its centroid at the XY origin, then placed by the existing           */
/* position / rotation code.                                             */
/* ------------------------------------------------------------------ */

/** Minimum side so a degenerate edit (0.1 m) still yields non-zero solids. */
const MIN_SIDE_M = 0.05;

/** Flattened (base at z = 0) box centred on the XY origin. */
function slab(w: number, d: number, h: number, x = 0, y = 0, z = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(Math.max(w, 1e-4), Math.max(d, 1e-4), Math.max(h, 1e-4));
  g.translate(x, y, z + Math.max(h, 1e-4) / 2);
  return g;
}

/** Low-poly vertical cylinder (axis Z), base at z = 0. */
function disc(r: number, h: number, segments = 16, x = 0, y = 0, z = 0): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r, r, Math.max(h, 1e-4), segments);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z + Math.max(h, 1e-4) / 2);
  return g;
}

/**
 * AC / HVAC: squat cabinet with a raised grille plate carrying a circular
 * fan recess and louvred vents. Stacked so the top lands exactly on `h`.
 */
function buildHvacModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const side = Math.min(w, d);
  const body = h * 0.7;               // cabinet
  const rim = h * 0.08;               // raised grille rim
  const plate = Math.max(h - body - rim, 0.01); // grille plate fills the rest

  const parts: THREE.BufferGeometry[] = [
    slab(w, d, body),
    slab(side * 0.98, side * 0.98, plate, 0, 0, body),
  ];
  // Raised rim separating the grille plate from the cabinet.
  parts.push(slab(side * 0.98, Math.max(rim * 0.25, 0.015), rim, 0, 0, body + plate));

  // Circular fan recess, visible from above.
  const rFan = side * 0.24;
  parts.push(disc(rFan, plate * 0.6, 18, 0, 0, body + plate));
  // Four gussets so the circle reads from an angle too.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    parts.push(
      disc(Math.max(plate * 0.18, 0.01), plate * 0.9, 8,
        Math.cos(a) * rFan, Math.sin(a) * rFan, body + plate),
    );
  }

  // Louvred vents: three short slats on the long face, inside the cabinet.
  for (let i = 0; i < 3; i++) {
    const y = -d / 2 + (d * (i + 1)) / 4;
    parts.push(slab(w * 0.8, Math.max(h * 0.05, 0.02), body * 0.5, 0, y, body * 0.25));
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry;
}

/**
 * Water Tank: cylindrical body on a low ring footing, a cap ring and a
 * centre boss. Stacked so the top lands exactly on `h`.
 */
function buildWaterTankModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const r = Math.max(Math.min(w, d) * 0.38, 0.02);
  const footing = h * 0.08;
  const cap = h * 0.06;
  const boss = Math.max(h - footing - cap - (h * 0.78), 0.01);
  const body = h - footing - cap - boss;

  const parts: THREE.BufferGeometry[] = [
    // Two footing pads so the tank reads as standing, not sunk.
    slab(Math.min(w, d) * 0.86, Math.min(w, d) * 0.2, footing, 0, r * 0.8),
    slab(Math.min(w, d) * 0.86, Math.min(w, d) * 0.2, footing, 0, -r * 0.8),
    disc(r, body, 20, 0, 0, footing),
    // Cap ring, then a centre boss on top.
    disc(r * 1.04, cap, 20, 0, 0, footing + body),
    disc(r * 0.34, boss, 14, 0, 0, footing + body + cap),
    // Two vertical seam ribs.
    slab(Math.max(w * 0.05, 0.02), Math.max(d * 0.05, 0.02), body, r * 0.96, 0, footing),
    slab(Math.max(w * 0.05, 0.02), Math.max(d * 0.05, 0.02), body, -r * 0.96, 0, footing),
  ];
  return mergeGeometries(parts, false) as THREE.BufferGeometry;
}

/**
 * Staircase Room: four perimeter walls with an open doorway and a separate
 * roof slab, so it reads as an enclosure rather than a solid block.
 */
function buildStaircaseModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const t = Math.min(Math.max(w, d) * 0.09, Math.min(w, d) * 0.4);
  const roof = Math.max(h * 0.14, 0.06);
  const wallTop = Math.max(h - roof, 0.01);

  return mergeGeometries([
    // Walls: the ±Y pair leaves a doorway gap in the middle of +Y.
    slab(w, t, wallTop, 0, -d / 2 + t / 2),
    slab(w * 0.28, t, wallTop, 0, d / 2 - t / 2),
    slab(t, d - 2 * t, wallTop, -w / 2 + t / 2),
    slab(t, d - 2 * t, wallTop, w / 2 - t / 2),
    // Roof slab, flush with the walls — no overhang past the footprint.
    slab(w, d, roof, 0, 0, wallTop),
  ], false) as THREE.BufferGeometry;
}

/**
 * Lift Room: an enclosure whose roof slab sits under a distinct machine
 * housing — a different silhouette from the flat-roofed staircase room.
 */
function buildLiftRoomModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const t = Math.min(Math.max(w, d) * 0.09, Math.min(w, d) * 0.4);
  const slabH = h * 0.14;
  const housH = h * 0.18;
  const wallTop = Math.max(h - slabH - housH, 0.01);
  const housW = Math.min(w * 0.5, w - 2 * t);
  const housD = Math.min(d * 0.5, d - 2 * t);

  return mergeGeometries([
    slab(w, t, wallTop, 0, -d / 2 + t / 2),
    slab(w, t, wallTop, 0, d / 2 - t / 2),
    slab(t, d - 2 * t, wallTop, -w / 2 + t / 2),
    slab(t, d - 2 * t, wallTop, w / 2 - t / 2),
    // Roof slab, flush with the walls.
    slab(w, d, slabH, 0, 0, wallTop),
    // Machine housing raised above the roof — the distinguishing feature.
    slab(housW, housD, housH, 0, 0, wallTop + slabH),
    // Counterweight rib across the housing top.
    slab(Math.max(housW * 0.3, 0.02), Math.max(housD * 0.3, 0.02),
      Math.max(h * 0.06, 0.03), housW * 0.25, 0, wallTop + slabH + housH),
  ], false) as THREE.BufferGeometry;
}

/** Build a predefined-type model, or null when the type has no model. */
function buildPredefinedModel(
  type: ObstacleType,
  w: number,
  d: number,
  h: number,
): THREE.BufferGeometry | null {
  const width = Math.max(w, MIN_SIDE_M);
  const depth = Math.max(d, MIN_SIDE_M);
  const height = Math.max(h, MIN_SIDE_M);
  switch (type) {
    case "hvac":
      return buildHvacModel(width, depth, height);
    case "water-tank":
      return buildWaterTankModel(width, depth, height);
    case "staircase-room":
      return buildStaircaseModel(width, depth, height);
    case "lift-room":
      return buildLiftRoomModel(width, depth, height);
    default:
      return null;
  }
}

/**
 * Build one obstacle mesh.
 *
 * Drawn-polygon ("Custom") obstacles extrude their exact footprint ring
 * (already rotated around the centroid by obstacleFootprint) — the shape is
 * preserved exactly, never replaced by a predefined model or a rectangle.
 * Predefined types use their recognizable low-poly model instead of a
 * generic box. Either way the solid spans roofZ → roofZ + height with the
 * footprint's dimensions preserved.
 *
 * Example: building 17.2 m + obstacle 2.0 m → occupies Z 17.2 → 19.2 m.
 */
export function createObstacleMesh(
  obstacle: Obstacle,
  buildingHeight: number,
  options: { transparent?: boolean; color?: number; opacity?: number } = {},
): THREE.Mesh {
  // Drawn polygons extrude their absolute footprint ring (already rotated
  // around the centroid by obstacleFootprint); predefined types use models.
  const footprint = obstacleFootprint(obstacle);
  const usePolygon = !!obstacle.polygon && obstacle.polygon.length >= 3;
  let geometry: THREE.BufferGeometry;
  if (usePolygon) {
    const ring = footprint;
    const shape = new THREE.Shape();
    shape.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].y);
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: obstacle.height,
      bevelEnabled: false,
      steps: 1,
    });
  } else {
    const model = buildPredefinedModel(
      obstacle.type,
      obstacle.width,
      obstacle.length,
      obstacle.height,
    );
    geometry = model ?? (() => {
      const box = new THREE.BoxGeometry(obstacle.width, obstacle.length, obstacle.height);
      // BoxGeometry is centred on the origin: lift it so the base is at Z = 0.
      box.translate(0, 0, obstacle.height / 2);
      return box;
    })();
  }

  const material = options.transparent
    ? new THREE.MeshStandardMaterial({
        color: options.color ?? OBSTACLE_COLORS[obstacle.type] ?? OBSTACLE_COLORS.custom,
        roughness: 0.6,
        metalness: 0.15,
        transparent: true,
        opacity: options.opacity ?? 0.45,
        depthWrite: false,
      })
    : createObstacleMaterial(obstacle.type);

  const mesh = new THREE.Mesh(geometry, material);
  if (usePolygon) {
    // Absolute footprint already carries position + rotation: place flat.
    mesh.position.set(0, 0, buildingHeight);
  } else {
    mesh.position.set(obstacle.position.x, obstacle.position.y, buildingHeight);
    mesh.rotation.z = (obstacle.rotation * Math.PI) / 180;
  }
  mesh.name = `Obstacle:${obstacle.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.obstacleId = obstacle.id;

  if (!options.transparent) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x13a8b5,
        transparent: true,
        opacity: 0.45,
      }),
    );
    edges.name = `ObstacleEdges:${obstacle.id}`;
    mesh.add(edges);
  }

  return mesh;
}

/** Options for building the whole obstacle layer. */
export interface ObstacleGroupOptions {
  /** Obstacle highlighted in the viewport */
  selectedId?: string | null;
  /** Obstacle temporarily hidden (the one being edited shows as a preview) */
  hiddenId?: string | null;
}

/**
 * Build a group holding every obstacle mesh for the current application state.
 * The group is added to / removed from the scene as one unit.
 */
export function createObstacleGroup(
  obstacles: Obstacle[],
  buildingHeight: number,
  options: ObstacleGroupOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "RooftopObstacles";

  for (const obstacle of obstacles) {
    if (options.hiddenId && obstacle.id === options.hiddenId) continue;
    group.add(createObstacleMesh(obstacle, buildingHeight));
  }

  applyObstacleSelection(group, options.selectedId ?? null);
  return group;
}

/**
 * Footprint-drawing overlay: vertex markers, connecting edges, a closed
 * outline once three points exist, and a live dashed edge to the cursor.
 * Bright marker colour + emissive-free basic materials read against both the
 * white roof and satellite imagery; lines use polygon offset (not a magic
 * Z lift) so they never z-fight the roof at long camera distances.
 */
export const FOOTPRINT_MARKER_COLOR = 0xff453a;
export const FOOTPRINT_LIVE_COLOR = 0xffb340;

export interface FootprintMarkerGroup {
  group: THREE.Group;
  /** Move the live cursor edge (null hides it). */
  setLivePoint: (point: { x: number; y: number } | null) => void;
}

export function createFootprintMarkerGroup(
  points: Array<{ x: number; y: number }>,
  roofZ: number,
  extentM: number,
): FootprintMarkerGroup {
  const group = new THREE.Group();
  group.name = "FootprintMarkers";

  // Marker size scales with the site so dots stay readable on big roofs
  // without dwarfing small ones.
  const radius = Math.min(1.2, Math.max(0.25, extentM * 0.004));
  const markerGeo = new THREE.SphereGeometry(radius, 12, 8);
  const markerMat = new THREE.MeshBasicMaterial({ color: FOOTPRINT_MARKER_COLOR });
  for (const p of points) {
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(p.x, p.y, roofZ + radius + 0.05);
    group.add(marker);
  }

  const toV3 = (p: { x: number; y: number }, z: number) => new THREE.Vector3(p.x, p.y, z);
  const lineZ = roofZ + 0.05;
  const lineMat = new THREE.LineBasicMaterial({
    color: FOOTPRINT_MARKER_COLOR,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (points.length >= 2) {
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(points.map((p) => toV3(p, lineZ)));
    group.add(new THREE.Line(edgeGeo, lineMat));
  }
  if (points.length >= 3) {
    const loopGeo = new THREE.BufferGeometry().setFromPoints(points.map((p) => toV3(p, lineZ)));
    group.add(new THREE.LineLoop(loopGeo, lineMat));
  }

  const liveGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, lineZ),
    new THREE.Vector3(0, 0, lineZ),
  ]);
  const liveLine = new THREE.Line(
    liveGeo,
    new THREE.LineDashedMaterial({
      color: FOOTPRINT_LIVE_COLOR,
      dashSize: 0.6,
      gapSize: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  liveLine.visible = false;
  liveLine.frustumCulled = false;
  group.add(liveLine);

  const setLivePoint = (point: { x: number; y: number } | null) => {
    if (!point || points.length === 0) {
      liveLine.visible = false;
      return;
    }
    const last = points[points.length - 1];
    const positions = liveGeo.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, last.x, last.y, lineZ);
    positions.setXYZ(1, point.x, point.y, lineZ);
    positions.needsUpdate = true;
    liveLine.computeLineDistances();
    liveLine.visible = true;
  };

  return {
    group,
    setLivePoint,
  };
}

/** Release a footprint marker group (geometries + shared materials). */
export function disposeFootprintMarkerGroup(handle: FootprintMarkerGroup): void {
  handle.group.traverse((object) => {
    const renderable = object as Partial<THREE.Mesh> & Partial<THREE.Line>;
    renderable.geometry?.dispose();
    const material = renderable.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/**
 * Translucent ghost used while a draft obstacle is being defined or edited.
 * Colour turns red when the draft no longer satisfies validation.
 */
export function createObstaclePreviewMesh(
  obstacle: Obstacle,
  buildingHeight: number,
  valid: boolean,
): THREE.Mesh {
  const mesh = createObstacleMesh(obstacle, buildingHeight, {
    transparent: true,
    color: valid ? OBSTACLE_SELECTED_EMISSIVE : OBSTACLE_INVALID_COLOR,
    opacity: valid ? 0.45 : 0.5,
  });
  mesh.name = "ObstaclePreview";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  for (const child of [...mesh.children]) mesh.remove(child);
  return mesh;
}

/** Highlight the selected obstacle (emissive) and reset all others. */
export function applyObstacleSelection(group: THREE.Object3D, selectedId: string | null): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material || !("emissive" in material)) continue;
    const selected = selectedId !== null && mesh.userData.obstacleId === selectedId;
    material.emissive.setHex(selected ? OBSTACLE_SELECTED_EMISSIVE : 0x000000);
    material.emissiveIntensity = selected ? 0.55 : 1;
  }
}

/**
 * World-space footprint of the RENDERED box (bottom face, metres), derived
 * from the mesh geometry + transform. Used by tests to prove the rendered
 * obstacle matches the authoritative `obstacleFootprint` — never the other way
 * round (AGENTS.md §52).
 */
export function obstacleMeshFootprint(obstacle: Obstacle, buildingHeight: number): Array<{ x: number; y: number }> {
  const mesh = createObstacleMesh(obstacle, buildingHeight);
  try {
    mesh.updateMatrixWorld(true);
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!;
    const baseCorners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    ];
    return baseCorners.map((corner) => {
      const world = corner.applyMatrix4(mesh.matrixWorld);
      return { x: world.x, y: world.y };
    });
  } finally {
    disposeObstacleMesh(mesh);
  }
}

/** Dispose every geometry/material reachable from `root`. */
export function disposeObstacleResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    const renderable = object as Partial<THREE.Mesh> & Partial<THREE.LineSegments>;
    if (renderable.geometry) geometries.add(renderable.geometry);
    const material = renderable.material;
    if (Array.isArray(material)) {
      for (const m of material) materials.add(m);
    } else if (material) {
      materials.add(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

/** Dispose a single obstacle mesh (and its children). */
export function disposeObstacleMesh(mesh: THREE.Object3D): void {
  disposeObstacleResources(mesh);
}
