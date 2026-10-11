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

/** Palette follows natural foliage and bark tones. */
export const TREE_COLORS: Record<TreeType, { trunk: number; foliage: number }> = {
  broadleaf: { trunk: 0x5a3d28, foliage: 0x2e6b38 }, // Warm bark / lush broadleaf green
  conifer: { trunk: 0x4a3320, foliage: 0x1b4324 }, // Dark pine trunk / deep evergreen
  "small-ornamental": { trunk: 0x6b4c35, foliage: 0x639b38 }, // Slender trunk / fresh olive-spring green
};

/** Emissive highlight used for the selected tree (matches teal selection). */
export const TREE_SELECTED_EMISSIVE = 0x13a8b5;

/** Build one tree mesh group resting on the ground plane (Z = 0). */
export function createTreeMesh(tree: Tree, _buildingHeight = 0): THREE.Group {
  const height = Math.max(tree.height, MIN_TREE_HEIGHT_M);
  const canopyWidth = Math.max(tree.canopyWidth, MIN_TREE_CANOPY_WIDTH_M);
  const colors = TREE_COLORS[tree.type] ?? TREE_COLORS.broadleaf;

  const group = new THREE.Group();
  group.name = `Tree:${tree.id}`;
  group.position.set(tree.position.x, tree.position.y, 0); // Ground plane Z = 0
  group.rotation.z = (tree.rotation * Math.PI) / 180;
  group.userData.treeId = tree.id;
  group.userData.treeType = tree.type;

  // 1. Trunk (resting on ground Z = 0)
  const trunkRadius = Math.max(
    0.08,
    tree.type === "broadleaf" ? 0.26 : tree.type === "conifer" ? 0.2 : 0.12,
  );
  const trunkHeight =
    tree.type === "broadleaf"
      ? height * 0.35
      : tree.type === "conifer"
        ? height * 0.2
        : height * 0.4;

  const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.85, trunkRadius, trunkHeight, 8);
  trunkGeom.rotateX(Math.PI / 2); // Orient along Z-up
  trunkGeom.translate(0, 0, trunkHeight / 2); // Base at Z = 0, top at Z = trunkHeight

  const trunkMat = new THREE.MeshStandardMaterial({
    color: colors.trunk,
    roughness: 0.9,
    metalness: 0.05,
  });

  const trunkMesh = new THREE.Mesh(trunkGeom, trunkMat);
  trunkMesh.name = `TreeTrunk:${tree.id}`;
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.userData.treeId = tree.id;
  group.add(trunkMesh);

  // 2. Distinct foliage variant
  if (tree.type === "broadleaf") {
    // Broadleaf: rounded dome canopy
    const canopyRadius = canopyWidth / 2;
    const canopyZ = trunkHeight + canopyRadius * 0.75;
    const foliageGeom = new THREE.DodecahedronGeometry(canopyRadius, 1);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: colors.foliage,
      roughness: 0.8,
      metalness: 0.05,
    });
    const foliageMesh = new THREE.Mesh(foliageGeom, foliageMat);
    foliageMesh.name = `TreeFoliage:${tree.id}`;
    foliageMesh.position.set(0, 0, canopyZ);
    foliageMesh.scale.set(1, 1, 0.9);
    foliageMesh.castShadow = true;
    foliageMesh.receiveShadow = true;
    foliageMesh.userData.treeId = tree.id;
    group.add(foliageMesh);
  } else if (tree.type === "conifer") {
    // Conifer: 3 tiered evergreen cones
    const foliageMat = new THREE.MeshStandardMaterial({
      color: colors.foliage,
      roughness: 0.75,
      metalness: 0.05,
    });

    const tiers = [
      { r: canopyWidth * 0.5, h: height * 0.45, baseZ: trunkHeight * 0.75 },
      { r: canopyWidth * 0.38, h: height * 0.4, baseZ: trunkHeight + height * 0.22 },
      { r: canopyWidth * 0.25, h: height * 0.35, baseZ: trunkHeight + height * 0.45 },
    ];

    tiers.forEach((tier, i) => {
      const coneGeom = new THREE.ConeGeometry(tier.r, tier.h, 10);
      coneGeom.rotateX(Math.PI / 2); // Orient along Z-up
      coneGeom.translate(0, 0, tier.h / 2);
      const coneMesh = new THREE.Mesh(coneGeom, foliageMat);
      coneMesh.name = `TreeCone:${tree.id}:${i}`;
      coneMesh.position.set(0, 0, tier.baseZ);
      coneMesh.castShadow = true;
      coneMesh.receiveShadow = true;
      coneMesh.userData.treeId = tree.id;
      group.add(coneMesh);
    });
  } else {
    // Small Ornamental: spreading umbrella / ellipsoidal canopy
    const canopyRadius = canopyWidth / 2;
    const canopyGeom = new THREE.SphereGeometry(canopyRadius, 10, 8);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: colors.foliage,
      roughness: 0.8,
      metalness: 0.05,
    });
    const foliageMesh = new THREE.Mesh(canopyGeom, foliageMat);
    foliageMesh.name = `TreeFoliage:${tree.id}`;
    foliageMesh.position.set(0, 0, trunkHeight + canopyRadius * 0.4);
    foliageMesh.scale.set(1, 1, 0.55); // Spreading horizontal profile
    foliageMesh.castShadow = true;
    foliageMesh.receiveShadow = true;
    foliageMesh.userData.treeId = tree.id;
    group.add(foliageMesh);
  }

  return group;
}

/**
 * Build a group holding every tree mesh for the current application state.
 * The group is added to / removed from the scene as one unit.
 */
export function createTreeGroup(
  trees: Tree[],
  buildingHeight = 0,
  options: { selectedId?: string | null } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "Trees";

  for (const tree of trees) {
    const treeObj = createTreeMesh(tree, buildingHeight);
    group.add(treeObj);
  }

  // Apply selection highlighting
  if (options.selectedId) {
    applyTreeSelection(group, options.selectedId);
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
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material || !material.emissive) return;
    const treeId = (mesh.userData.treeId ?? mesh.parent?.userData.treeId) as string | undefined;
    const selected = selectedId !== null && treeId === selectedId;
    material.emissive.setHex(selected ? TREE_SELECTED_EMISSIVE : 0x000000);
    material.emissiveIntensity = selected ? 0.55 : 1;
  });
}