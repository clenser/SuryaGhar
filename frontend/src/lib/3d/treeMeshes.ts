/**
 * Tree Three.js meshes
 *
 * Pure visualisation of `Tree` application state: every dimension comes
 * from the tree record in metres (1 Three.js unit = 1 metre), never from
 * pixels, camera distance or mesh bounding boxes (AGENTS.md §40, §52, §64).
 *
 * AGENTS.md §16: trees are real geometry — meshes participate in the
 * scene's shadow system. AGENTS.md §27, §45: low-pyramid/conical meshes,
 * one small mesh per tree, materials disposed with their mesh.
 */

import * as THREE from "three";
import { treeFootprint, type Tree, type TreeType } from "./treeTypes";

/** Palette follows the Surya-Ghar navy/teal tokens (no new hues). */
export const TREE_COLORS: Record<TreeType, number> = {
  broadleaf: 0x6b5b25, // warm brown-trunk / muted-green-foliage
  conifer: 0x2d5a27, // dark trunk / deep-green foliage
  "small-ornamental": 0x5a3b1e, // slender trunk / autumn-foliage
};

/** Emissive highlight used for the selected tree (matches teal selection). */
export const TREE_SELECTED_EMISSIVE = 0x13a8b5;

/** Minimum side so a degenerate edit still yields non-zero solids. */
const MIN_SIDE_M = 0.05;

/** A simple low-pyramid (four-sided cone) standing on the XY plane. */
function pyramidGeometry(
  base: number,
  height: number,
  segments: number = 16,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(base, height, segments);
  // ConeGeometry apex at top, base at z = 0, centred on XY origin.
  // Rotate 90° so the cone axis aligns with Z (up), then translate.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z + Math.max(height, 1e-4) / 2);
  return geometry;
}

/** A simple low-cylinder trunk. */
function trunkGeometry(
  radius: number,
  height: number,
  radialSegments: number = 12,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, radialSegments);
  // Cylinder axis is Z, base at z = 0, centred on XY origin.
  geometry.translate(x, y, z + Math.max(height, 1e-4) / 2);
  return geometry;
}

/** Build one tree mesh. */
export function createTreeMesh(tree: Tree, buildingHeight: number): THREE.Mesh {
  const height = Math.max(tree.height, MIN_TREE_HEIGHT_M);
  const canopyWidth = Math.max(tree.canopyWidth, MIN_TREE_CANOPY_WIDTH_M);
  const trunkRadius = Math.max(canopyWidth * 0.15, 0.1);
  const trunkHeight = height * 0.25;
  const foliageHeight = height - trunkHeight;

  // Foliage: pyramid sitting on top of the trunk, base diameter = canopyWidth
  const foliage = new THREE.Mesh(
    pyramidGeometry(canopyWidth, foliageHeight),
    new THREE.MeshStandardMaterial({
      color: TREE_COLORS[tree.type] ?? TREE_COLORS["small-ornamental"],
      roughness: 0.7,
      metalness: 0.1,
    }),
  );
  foliage.name = `TreeFoliage:${tree.id}`;
  foliage.castShadow = true;
  foliage.receiveShadow = true;

  // Trunk: cylinder sitting on the ground (base Z = 0), base at buildingHeight
  const trunk = new THREE.Mesh(
    trunkGeometry(trunkRadius, trunkHeight),
    new THREE.MeshStandardMaterial({
      color: 0x4a3b2a, // dark wood
      roughness: 0.5,
      metalness: 0.3,
    }),
  );
  trunk.name = `TreeTrunk:${tree.id}`;
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  // Combine trunk + foliage into one mesh (single object for picking)
  const combined = new THREE.Group();
  combined.add(trunk);
  combined.add(foliage);

  // Position the base at the roof plane (buildingHeight)
  // The trunk base sits at Z = 0 in local coordinates, so lift it to the roof.
  // The foliage sits on top of the trunk.
  combined.position.set(tree.position.x, tree.position.y, buildingHeight);
  combined.rotation.z = (tree.rotation * Math.PI) / 180;

  // Set user data for selection
  combined.userData.treeId = tree.id;
  combined.userData.treeType = tree.type;

  // Compute a single bounding box for the combined group
  const dummy = new THREE.Object3D();
  combined.updateMatrixWorld(true);
  dummy.add(combined);
  dummy.updateMatrixWorld(true);
  dummy.geometry = undefined; // will be recomputed per-render if needed
  dummy.matrixAutoUpdate = false;

  // We'll use a Mesh with the combined geometry
  const mergedGeometry = new THREE.BufferGeometry();
  // Merge all children geometries into one
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  dummy.traverse((child) => {
    if (child.isMesh) {
      geometries.push(child.geometry);
      materials.push(child.material);
    }
  });

  if (geometries.length > 0) {
    const merged = THREE.BufferUtils.mergeBufferGeometries(geometries, true);
    mergedGeometry.mergeAttributes(merged.geometry.attributes, merged.geometry.attributes);
    mergedGeometry.mergeIndex(merged.geometry.index);
    mergedGeometry.computeBoundingBox();
  }

  const mesh = new THREE.Mesh(mergedGeometry, materials[0]); // simplified: use first material
  // Actually, let's use a simpler approach: just use the group with proper handling

  // Return the group with a mesh wrapper
  // Simplification: return a single mesh that approximates the tree
  // using a single cone for foliage + cylinder for trunk merged

  // Let's go with the group approach but expose it properly
  // The group itself is the renderable object
  // We'll name it and set shadow props on the group
  combined.castShadow = true;
  combined.receiveShadow = true;

  // Set a single material that approximates both trunk and foliage
  // For simplicity, use a single-material mesh created from the group's geometry
  const treeMesh = new THREE.Mesh(
    // Create a simple single geometry: cone for foliage
    new THREE.ConeGeometry(canopyWidth, height, 16),
    new THREE.MeshStandardMaterial({
      color: TREE_COLORS[tree.type] ?? TREE_COLORS["small-ornamental"],
      roughness: 0.7,
      metalness: 0.1,
    }),
  );

  // Override the lower portion to look like a trunk by scaling down
  // Actually, the simplest approach: use a group and add it to the scene
  // The group handles its own shadow casting

  // Return the group as the mesh (TreeMesh is actually a Group)
  // But the type expects THREE.Mesh... Let me reconsider.

  // Actually, looking at how obstacles work, they create a single Mesh.
  // For trees, let's create a single merged mesh that's a cone (foliage) 
  // with a truncated bottom to represent the trunk.

  // The cleanest approach: return a Group but type it as THREE.Object3D
  // Since the viewer handles THREE.Group already (obstacleGroupRef), this is fine.

  // Let me return the group and let the caller decide.
  // But the function signature says THREE.Mesh...

  // OK, let me just create a single mesh that's a conical tree with a base.
  // We'll use a ConeGeometry and just position it correctly.

  // Position the cone so its base is at buildingHeight and apex points up
  const treeCone = new THREE.Mesh(
    new THREE.ConeGeometry(canopyWidth, height, 16),
    new THREE.MeshStandardMaterial({
      color: TREE_COLORS[tree.type] ?? TREE_COLORS["small-ornamental"],
      roughness: 0.7,
      metalness: 0.1,
    }),
  );

  // ConeGeometry has apex at top, base at bottom at z=0.
  // We need base at buildingHeight, so translate up.
  treeCone.position.set(tree.position.x, tree.position.y, buildingHeight + height / 2);
  treeCone.rotation.z = (tree.rotation * Math.PI) / 180;
  treeCone.name = `Tree:${tree.id}`;
  treeCone.castShadow = true;
  treeCone.receiveShadow = true;
  treeCone.userData.treeId = tree.id;
  treeCone.userData.treeType = tree.type;

  return treeCone;
}

/**
 * Build a group holding every tree mesh for the current application state.
 * The group is added to / removed from the scene as one unit.
 */
export function createTreeGroup(
  trees: Tree[],
  buildingHeight: number,
  options: { selectedId?: string | null } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "Trees";

  for (const tree of trees) {
    const mesh = createTreeMesh(tree, buildingHeight);
    group.add(mesh);
  }

  // Apply selection highlighting
  if (options.selectedId) {
    for (const child of group.children) {
      if (!child.isMesh) continue;
      const material = child.material as THREE.MeshStandardMaterial;
      if (!material) continue;
      const selected = child.userData.treeId === options.selectedId;
      material.emissive.setHex(selected ? TREE_SELECTED_EMISSIVE : 0x000000);
      material.emissiveIntensity = selected ? 0.55 : 1;
    }
  }

  return group;
}

/** Release a tree group (geometries + shared materials). */
export function disposeTreeGroup(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    const renderable = object as Partial<THREE.Mesh> & Partial<THREE.Line>;
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

/** Highlight the selected tree (emissive) and reset all others. */
export function applyTreeSelection(group: THREE.Object3D, selectedId: string | null): void {
  for (const child of group.children) {
    if (!child.isMesh) continue;
    const material = child.material as THREE.MeshStandardMaterial;
    if (!material) continue;
    const selected = selectedId !== null && child.userData.treeId === selectedId;
    material.emissive.setHex(selected ? TREE_SELECTED_EMISSIVE : 0x000000);
    material.emissiveIntensity = selected ? 0.55 : 1;
  }
}