/**
 * Building Geometry Generation
 *
 * Creates Three.js meshes for the 3D building from local coordinates.
 * Uses ExtrudeGeometry for accurate vertical extrusion of the terrace polygon.
 *
 * AGENTS.md §12: Terrace polygon becomes top face, extruded vertically by building height.
 * AGENTS.md §13: Local coordinates (centroid at origin) used for numerical stability.
 * AGENTS.md §25: Low-poly, realistic proportions.
 * AGENTS.md §64: 1 Three.js unit = 1 metre.
 */

import * as THREE from "three";
import type { LocalCoords3D } from "./coordinates";

export interface BuildingMeshes {
  /** Main building mesh (extruded polygon) */
  building: THREE.Mesh;
  /** Ground plane reference mesh */
  ground: THREE.Mesh;
  /** Wireframe outline for edge clarity */
  wireframe: THREE.LineSegments;
  /** Rooftop parapet wall group, or null when no parapet was requested */
  parapet: THREE.Group | null;
  /** Every object added to the scene, for batch add/disposal */
  all: THREE.Object3D[];
}

/**
 * Create a professional building material.
 * Uses MeshStandardMaterial for PBR rendering with lights.
 * Colors follow Surya-Ghar design tokens (navy/teal palette).
 */
export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x0b1f33,          // --color-navy
    roughness: 0.7,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}

/**
 * Create an architectural design material (M2): bright warm-white exterior for
 * the 3D design workspace, following the reference direction (white building,
 * dark panels, readable shadows). The default navy material is unchanged for
 * existing consumers and tests.
 *
 * Brightness comes from the pipeline (Neutral tone mapping + rebalanced
 * lights), not from a nearer-white albedo — a pure #ffffff base would clip to
 * flat white and lose every architectural highlight. This tone keeps the
 * warm-white cast while leaving headroom above it.
 */
export function createDesignBuildingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xf6f3ec,          // warm white
    roughness: 0.62,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}
/**
 * Create a studio ground material (M2 redesign): opaque neutral grey that
 * reads shadows crisply against the dark studio background. Replaces the
 * old translucent navy reference plane.
 */
export function createGroundMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x39424e,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Create wireframe material for building edges.
 */
export function createWireframeMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: 0x13a8b5,          // --color-teal-bright
    transparent: true,
    opacity: 0.6,
    linewidth: 1,
  });
}

/**
 * Twice the signed area of the footprint (shoelace) — used for winding only.
 */
function signedArea2(vertices: THREE.Vector3[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Create the design roof material (M2): a slightly darker, neutral
 * warm-grey than the walls so the usable rooftop reads as a distinct
 * surface. Deliberately subtle — dark enough to separate roof from walls,
 * light enough that obstacle footprints and solar panels placed on it stay
 * clearly readable.
 */
export function createDesignRoofMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xc9c3b6,          // neutral warm grey
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Create the building mesh by extruding the terrace polygon.
 *
 * @param localCoords - Local 3D coordinates from terraceToLocal3D()
 * @param material - Optional custom material (uses default if not provided).
 *   Pass `{ wall, roof }` to differentiate the extruded walls (ExtrudeGeometry
 *   group 1) from the horizontal caps (group 0, roof on top).
 * @param groundSizeM - Optional ground-plane edge length in metres (defaults
 *   to 1.5× the larger footprint side).
 * @param parapet - Optional rooftop parapet (wall ring + cap) extruded
 *   upward from the roof surface. Null/omitted builds no parapet.
 * @returns BuildingMeshes containing building, ground, wireframe and parapet
 */
export function createBuildingMeshes(
  localCoords: LocalCoords3D,
  material?: THREE.MeshStandardMaterial | { wall: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial },
  groundSizeM?: number,
  parapet?: ParapetOptions | null,
): BuildingMeshes {
  const { vertices, height } = localCoords;

  // Earcut expects a counter-clockwise outer ring; the drawing direction of the
  // user's terrace decides the winding of the projected polygon, so normalise it
  // here. Winding is a rendering detail only — vertex positions are untouched.
  const ring = signedArea2(vertices) < 0 ? [...vertices].reverse() : vertices;

  // Create a Shape from the 2D polygon (X/Y plane at Z=0)
  const shape = new THREE.Shape();
  const first = ring[0];
  shape.moveTo(first.x, first.y);
  for (let i = 1; i < ring.length; i++) {
    const v = ring[i];
    shape.lineTo(v.x, v.y);
  }
  // Shape automatically closes

  // Extrude settings: vertical extrusion along Z (1 Three.js unit = 1 metre)
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  };

  // The extruded solid spans Z = 0 (ground) to Z = height (roof), keeping the
  // exact footprint — no rectangle substitution for irregular terraces.
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  // Compute bounding box for ground plane sizing
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const groundSize = groundSizeM ?? Math.max(
    box.max.x - box.min.x,
    box.max.y - box.min.y
  ) * 1.5; // 50% margin around building

  // Building mesh: ExtrudeGeometry assigns group 0 to the horizontal caps
  // (roof on top) and group 1 to the extruded walls, so a [roof, wall] pair
  // differentiates the surfaces with zero geometry change.
  const wallMat = material === undefined ? createBuildingMaterial() : "wall" in material ? material.wall : material;
  const roofMat = material === undefined ? wallMat : "wall" in material ? material.roof : material;
  const building = new THREE.Mesh(geometry, [roofMat, wallMat]);
  building.castShadow = true;
  building.receiveShadow = true;
  building.name = "Building";

  // Ground plane
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = createGroundMaterial();
  const ground = new THREE.Mesh(groundGeometry, groundMat);
  // Z-up scene (X = east, Y = north, Z = up): THREE.PlaneGeometry already lies
  // in the XY plane with normal +Z, i.e. horizontal. Do NOT rotate it — the
  // Y-up idiom `rotation.x = -Math.PI / 2` would turn it into a vertical
  // north-facing wall that receives no sunlight and no rooftop shadows.
  ground.rotation.x = 0;
  ground.position.z = 0; // At ground level
  ground.receiveShadow = true;
  ground.name = "GroundPlane";

  // Wireframe edges for visual clarity
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const wireframeMat = createWireframeMaterial();
  const wireframe = new THREE.LineSegments(edgesGeometry, wireframeMat);
  wireframe.name = "BuildingWireframe";

  // Rooftop parapet: separate identifiable boundary structure on the roof,
  // never a second solid box. Throws on degenerate insets — callers decide
  // whether that is fatal or a skipped parapet.
  let parapetGroup: THREE.Group | null = null;
  if (parapet) {
    parapetGroup = createParapetMeshes(vertices, height, {
      heightM: parapet.heightM,
      thicknessM: parapet.thicknessM,
    }).group;
  }

  return {
    building,
    ground,
    wireframe,
    parapet: parapetGroup,
    all: parapetGroup ? [building, ground, wireframe, parapetGroup] : [building, ground, wireframe],
  };
}

/**
 * Create a simple ground plane mesh (alternative to the one in createBuildingMeshes).
 * Useful if you want a larger context ground.
 */
export function createGroundPlane(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = createGroundMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  // Z-up: PlaneGeometry is horizontal (normal +Z) without any rotation.
  mesh.rotation.x = 0;
  mesh.position.z = 0;
  mesh.receiveShadow = true;
  mesh.name = "GroundPlane";
  return mesh;
}

/**
 * Dispose of all geometries and materials in the building meshes.
 * Traverses groups (parapet) as well as direct meshes. Call this on
 * component unmount to prevent memory leaks.
 */
export function disposeBuildingMeshes(meshes: BuildingMeshes): void {
  for (const object of meshes.all) disposeObjectTree(object);
}

/**
 * Update building height by recreating the extrusion.
 * Returns new BuildingMeshes (old ones must be disposed by caller).
 */
export function updateBuildingHeight(
  localCoords: LocalCoords3D,
  newHeight: number,
  existingMeshes?: BuildingMeshes,
  material?: THREE.MeshStandardMaterial | { wall: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial },
  groundSizeM?: number
): BuildingMeshes {
  // Dispose old meshes if provided
  if (existingMeshes) {
    disposeBuildingMeshes(existingMeshes);
  }

  // Create new coords with updated height
  const updatedCoords: LocalCoords3D = {
    ...localCoords,
    height: newHeight,
  };

  return createBuildingMeshes(updatedCoords, material, groundSizeM);
}

/* ------------------------------------------------------------------ */
/* Rooftop parapet: a raised boundary wall following the terrace ring. */
/* ------------------------------------------------------------------ */

/** Default parapet height above the roof (m) for projects without one. */
export const DEFAULT_PARAPET_HEIGHT_M = 1.0;
/** Lowest parapet the UI accepts (m) - below this it is a curb, not a wall. */
export const MIN_PARAPET_HEIGHT_M = 0.2;
/** Highest parapet the UI accepts (m). */
export const MAX_PARAPET_HEIGHT_M = 3.0;
/** Default parapet wall thickness (m). */
export const DEFAULT_PARAPET_THICKNESS_M = 0.3;
/**
 * DEFAULT required clear gap between the parapet's INNER face and a
 * solar panel (m). This is the default of the user-configurable
 * "Parapet clearance" field in Stage 2 (3D Building Model): the wall
 * thickness above stays separate, and the panel boundary from the
 * roof edge is thickness + clearance.
 */
export const PARAPET_CLEARANCE_M = 0.2;
/** Lowest panel-to-parapet clearance the UI accepts (m). 0 lets a panel sit flush against the inner face. */
export const MIN_PARAPET_CLEARANCE_M = 0;
/** Highest panel-to-parapet clearance the UI accepts (m). */
export const MAX_PARAPET_CLEARANCE_M = 1;

/**
 * Validate a user-entered parapet height.
 * @returns an error message, or `null` when the height is usable
 */
export function validateParapetHeight(height: unknown): string | null {
  if (typeof height !== "number" || !Number.isFinite(height)) return "Enter a valid number";
  if (height < MIN_PARAPET_HEIGHT_M) return `Parapet height must be at least ${MIN_PARAPET_HEIGHT_M} m`;
  if (height > MAX_PARAPET_HEIGHT_M) return `Parapet height must not exceed ${MAX_PARAPET_HEIGHT_M} m`;
  return null;
}

export interface ParapetOptions {
  /** Wall height above the roof surface (m). */
  heightM: number;
  /** Wall thickness (m). */
  thicknessM: number;
}

interface Line2 {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

/** Intersection of two 2D lines; null when (near-)parallel. */
function intersectLines(a: Line2, b: Line2): { x: number; y: number } | null {
  const denom = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / denom;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Offset a polygon ring inward by `distance` metres (miter joints from
 * adjacent edge-offset intersection). Returns null when the offset
 * degenerates (offset larger than a local feature, parallel edges, or a
 * collapsed/inside-out result) - callers fall back safely instead of
 * rendering a broken ring.
 */
export function offsetPolygonInward(
  points: Array<{ x: number; y: number }>,
  distance: number,
): Array<{ x: number; y: number }> | null {
  const n = points.length;
  if (n < 3 || !(distance > 0)) return null;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area2) < 1e-9) return null;
  const ccw = area2 > 0;

  const lines: Line2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const ux = dx / len;
    const uy = dy / len;
    // Inward normal: left of travel for CCW rings, right for CW rings.
    const nx = ccw ? -uy : uy;
    const ny = ccw ? ux : -ux;
    lines.push({ px: a.x + nx * distance, py: a.y + ny * distance, dx: ux, dy: uy });
  }

  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const joint = intersectLines(lines[(i + n - 1) % n], lines[i]);
    if (!joint || !Number.isFinite(joint.x) || !Number.isFinite(joint.y)) return null;
    // Miter-spike guard: a joint flung far from its vertex means the offset
    // consumed a narrow section - treat the ring as degenerate.
    const v = points[i];
    if (Math.hypot(joint.x - v.x, joint.y - v.y) > distance * 12 + 1) return null;
    out.push(joint);
  }

  // The inset must survive as a strictly smaller ring with the same orientation - otherwise the offset consumed the polygon.
  let inner2 = 0;
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    inner2 += a.x * b.y - b.x * a.y;
  }
  if (inner2 * area2 <= 0 || Math.abs(inner2) >= Math.abs(area2) || Math.abs(inner2) < 1e-6) return null;
  return out;
}

/** Parapet wall + cap material: a coordinated architectural shade. Matched
 * to the design wall tone so the parapet ring reads as the same building.
 *
 * Slightly darker than the usable roof so the roof's boundary is legible
 * from every angle. */
export function createParapetMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xa9a294,
    roughness: 0.62,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/** Parapet cap/edge material: a lighter neutral shade so the top edge of the
 * parapet ring stays clearly distinct from both the darker wall below it and
 * the roof it bounds. */
export function createParapetCapMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xe8e3d7,
    roughness: 0.48,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Apply or clear X-ray transparency on shell materials (walls, roof,
 * parapet). Only the shell fades — wireframe, obstacles, ground and panels
 * stay opaque so the scene keeps its reference points. Reversible: disabling
 * restores the exact opaque defaults. Idempotent.
 */
export const XRAY_OPACITY = 0.22;

interface ShellOriginal {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  side: THREE.Side;
}

function shellOriginalOf(std: THREE.MeshStandardMaterial): ShellOriginal | null {
  const saved = (std.userData as Record<string, unknown>).__xrayOriginal;
  if (
    saved &&
    typeof saved === "object" &&
    typeof (saved as ShellOriginal).opacity === "number" &&
    typeof (saved as ShellOriginal).transparent === "boolean" &&
    typeof (saved as ShellOriginal).depthWrite === "boolean" &&
    typeof (saved as ShellOriginal).side === "number"
  ) {
    return saved as ShellOriginal;
  }
  return null;
}

export function setShellTransparent(materials: THREE.Material[], enabled: boolean): void {
  for (const material of materials) {
    const std = material as THREE.MeshStandardMaterial;
    if (enabled) {
      if (!shellOriginalOf(std)) {
        (std.userData as Record<string, unknown>).__xrayOriginal = {
          opacity: std.opacity,
          transparent: std.transparent,
          depthWrite: std.depthWrite,
          side: std.side,
        } satisfies ShellOriginal;
      }
      std.transparent = true;
      std.opacity = XRAY_OPACITY;
      std.depthWrite = false;
      // The shell is a closed solid rendered DoubleSide: without this the
      // sight line stacks the top cap + interior wall backfaces + bottom
      // cap (~3-4 layers at XRAY_OPACITY each), which reads as opaque.
      // FrontSide leaves exactly one blended layer, so the satellite ground
      // beneath shows through. Restored on Solid (see below).
      std.side = THREE.FrontSide;
    } else {
      const saved = shellOriginalOf(std);
      if (saved) {
        std.transparent = saved.transparent;
        std.opacity = saved.opacity;
        std.depthWrite = saved.depthWrite;
        std.side = saved.side;
        delete (std.userData as Record<string, unknown>).__xrayOriginal;
      } else {
        std.transparent = false;
        std.opacity = 1;
        std.depthWrite = true;
        std.side = THREE.DoubleSide;
      }
    }
    std.needsUpdate = true;
  }
}

export interface ParapetMeshes {
  /** Wall ring group positioned with its base at the roof elevation. */
  group: THREE.Group;
}

/**
 * Release every geometry/material under an object tree (groups included).
 * Single dispose path for building bundles, parapets and ad-hoc groups.
 */
export function disposeObjectTree(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const renderable = child as Partial<THREE.Mesh> & Partial<THREE.LineSegments>;
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

/**
 * Build the parapet: the outer terrace ring minus the inward-offset inner
 * ring, extruded upward from the roof surface. One Shape-with-hole
 * extrusion gives the outer wall, inner wall and flat top cap in a single
 * solid - no separate segments, so corners join cleanly by construction and
 * concave sections keep working as long as the offset itself is valid.
 *
 * @param ring Local-metre footprint vertices (Z ignored, centroid frame).
 * @param roofZ Roof surface elevation in local metres (building height).
 * @throws when the ring insets degenerately for the requested thickness.
 */
export function createParapetMeshes(
  ring: THREE.Vector3[],
  roofZ: number,
  opts: ParapetOptions,
): ParapetMeshes {
  if (ring.length < 3) throw new Error("Need at least 3 vertices to create a parapet");
  if (!Number.isFinite(opts.heightM) || opts.heightM <= 0) {
    throw new Error("Parapet height must be a positive number of metres");
  }
  if (!Number.isFinite(opts.thicknessM) || opts.thicknessM <= 0) {
    throw new Error("Parapet thickness must be a positive number of metres");
  }
  const plane = ring.map((v) => ({ x: v.x, y: v.y }));
  const inner = offsetPolygonInward(plane, opts.thicknessM);
  if (!inner) {
    throw new Error("Parapet thickness does not fit this footprint (offset degenerated)");
  }

  const outer = signedArea2(ring) < 0 ? [...plane].reverse() : plane;
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  const hole = new THREE.Path();
  hole.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < inner.length; i++) hole.lineTo(inner[i].x, inner[i].y);
  shape.holes.push(hole);

  // ExtrudeGeometry group 0 = horizontal caps (flat top ring), group 1 = the
  // vertical outer/inner walls - subtle tonal separation, one solid.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: opts.heightM,
    bevelEnabled: false,
    steps: 1,
  });
  const mesh = new THREE.Mesh(geometry, [createParapetCapMaterial(), createParapetMaterial()]);
  mesh.position.z = roofZ;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "Parapet";

  const group = new THREE.Group();
  group.name = "ParapetGroup";
  group.add(mesh);

  return { group };
}

export interface UsableAreaBoundaryMeshes {
  group: THREE.Group;
  fillMesh: THREE.Mesh;
  outlineLine: THREE.LineLoop;
}

/**
 * Create a translucent usable-area boundary in 3D (Phase 2).
 * Rendered with a subtle vertical offset (+0.03m / 3cm) above base elevation to prevent
 * z-fighting with the ground plane, lightly tinted transparent fill, and crisp thin outline.
 */
export function createUsableAreaBoundary(
  vertices: THREE.Vector3[],
  baseElevationM: number = 0,
): UsableAreaBoundaryMeshes {
  if (vertices.length < 3) {
    throw new Error("Need at least 3 vertices to create usable area boundary");
  }

  const ring = signedArea2(vertices) < 0 ? [...vertices].reverse() : vertices;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) {
    shape.lineTo(ring[i].x, ring[i].y);
  }
  shape.closePath();

  const fillGeometry = new THREE.ShapeGeometry(shape);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x10b981, // Emerald green tint for solar land boundary
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
  fillMesh.name = "UsableAreaBoundaryFill";
  fillMesh.receiveShadow = false;
  fillMesh.castShadow = false;

  const points = ring.map((v) => new THREE.Vector3(v.x, v.y, 0));
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.70,
    linewidth: 2,
  });
  const outlineLine = new THREE.LineLoop(lineGeometry, lineMaterial);
  outlineLine.name = "UsableAreaBoundaryOutline";

  const group = new THREE.Group();
  group.name = "UsableAreaBoundaryGroup";
  // Subtle vertical offset (3cm) above ground/terrain base to eliminate z-fighting
  group.position.z = baseElevationM + 0.03;
  group.renderOrder = 1;
  group.add(fillMesh);
  group.add(outlineLine);

  return { group, fillMesh, outlineLine };
}

/**
 * Dispose of usable area boundary meshes, geometry, and materials.
 */
export function disposeUsableAreaBoundary(meshes: UsableAreaBoundaryMeshes | null | undefined): void {
  if (!meshes) return;
  meshes.fillMesh.geometry.dispose();
  if (Array.isArray(meshes.fillMesh.material)) {
    meshes.fillMesh.material.forEach((m) => m.dispose());
  } else {
    meshes.fillMesh.material.dispose();
  }
  meshes.outlineLine.geometry.dispose();
  if (Array.isArray(meshes.outlineLine.material)) {
    meshes.outlineLine.material.forEach((m) => m.dispose());
  } else {
    meshes.outlineLine.material.dispose();
  }
}

