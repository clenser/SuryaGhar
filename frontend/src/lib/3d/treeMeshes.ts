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
import {
  type Tree,
  type TreeType,
  MIN_TREE_HEIGHT_M,
  MIN_TREE_CANOPY_WIDTH_M,
} from "./treeTypes";

/** Palette follows the Surya-Ghar navy/teal tokens (no new hues). */
export const TREE_COLORS: Record<TreeType, number> = {
  broadleaf: 0x6b5b25, // warm brown-trunk / muted-green-foliage
  conifer: 0x2d5a27, // dark trunk / deep-green foliage
  "small-ornamental": 0x5a3b1e, // slender trunk / autumn-foliage
};

/** Emissive highlight used for the selected tree (matches teal selection). */
export const TREE_SELECTED_EMISSIVE = 0x13a8b5;

/** Build one tree mesh. */
export function createTreeMesh(tree: Tree, buildingHeight: number): THREE.Mesh {
  const height = Math.max(tree.height, MIN_TREE_HEIGHT_M);
  const canopyWidth = Math.max(tree.canopyWidth, MIN_TREE_CANOPY_WIDTH_M);

  // Simple conical tree: foliage cone sitting on the roof plane
  const treeCone = new THREE.Mesh(
    new THREE.ConeGeometry(canopyWidth, height, 16),
    new THREE.MeshStandardMaterial({
      color: TREE_COLORS[tree.type] ?? TREE_COLORS["small-ornamental"],
      roughness: 0.7,
      metalness: 0.1,
    }),
  );

  // ConeGeometry has apex at top, base at bottom at z=0.
  // Position base at buildingHeight.
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
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material) continue;
      const selected = mesh.userData.treeId === options.selectedId;
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
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material) continue;
    const selected = selectedId !== null && mesh.userData.treeId === selectedId;
    material.emissive.setHex(selected ? TREE_SELECTED_EMISSIVE : 0x000000);
    material.emissiveIntensity = selected ? 0.55 : 1;
  }
}