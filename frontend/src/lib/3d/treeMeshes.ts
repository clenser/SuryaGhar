/**
 * Tree Three.js meshes
 *
 * Visualisation of `Tree` application state: every dimension comes
 * from the tree record in metres (1 Three.js unit = 1 metre).
 *
 * Supports real 3D GLTF models (Kenney CC0 assets) with automatic normalization,
 * scaling, ground positioning (Z = 0), and shadow casting/receiving, with seamless
 * procedural fallbacks for offline and testing environments.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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

/** Template cache holding parsed & normalized GLTF tree templates. */
const treeTemplateCache = new Map<TreeType, { group: THREE.Group; nativeHeight: number; nativeWidth: number }>();
let gltfLoaderInstance: GLTFLoader | null = null;

function getGLTFLoader(): GLTFLoader {
  if (!gltfLoaderInstance) {
    gltfLoaderInstance = new GLTFLoader();
  }
  return gltfLoaderInstance;
}

/** Map of tree types to their GLB file paths. */
export const TREE_MODEL_URLS: Record<TreeType, string> = {
  broadleaf: "/models/trees/broadleaf.glb",
  conifer: "/models/trees/conifer.glb",
  "small-ornamental": "/models/trees/small-ornamental.glb",
};

/**
 * Register a normalized template directly (useful for tests or custom injection).
 */
export function registerTreeTemplate(type: TreeType, group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const nativeHeight = Math.max(0.1, size.z);
  const nativeWidth = Math.max(0.1, Math.max(size.x, size.y));
  treeTemplateCache.set(type, { group, nativeHeight, nativeWidth });
}

/**
 * Normalize a parsed GLTF tree scene:
 * - Rotates X by +90 deg so GLTF's Y-up becomes SuryaGhar's Z-up.
 * - Translates along Z so the base of the trunk sits at Z = 0.
 * - Center X and Y at origin (0, 0).
 * - Enables castShadow and receiveShadow on all child meshes.
 */
export function normalizeTreeGLTF(scene: THREE.Group): { group: THREE.Group; nativeHeight: number; nativeWidth: number } {
  const container = new THREE.Group();
  container.name = "TreeTemplate";

  // Re-orient from GLTF Y-up to local Z-up
  scene.rotation.x = Math.PI / 2;
  scene.updateMatrixWorld(true);

  // Measure oriented bounding box
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Shift so base touches Z = 0 and centroid is at (0, 0)
  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  const minZ = box.min.z;
  scene.position.set(-centerX, -centerY, -minZ);
  scene.updateMatrixWorld(true);

  // Tag meshes for shadows, materials, and identification
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
    }
  });

  container.add(scene);
  container.updateMatrixWorld(true);

  const nativeHeight = Math.max(0.1, size.z);
  const nativeWidth = Math.max(0.1, Math.max(size.x, size.y));

  return { group: container, nativeHeight, nativeWidth };
}

/**
 * Asynchronously load a tree model by category.
 */
export async function loadTreeModel(type: TreeType): Promise<THREE.Group> {
  const cached = treeTemplateCache.get(type);
  if (cached) return cached.group;

  const url = TREE_MODEL_URLS[type];
  const loader = getGLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const normalized = normalizeTreeGLTF(gltf.scene);
        treeTemplateCache.set(type, normalized);
        resolve(normalized.group);
      },
      undefined,
      (err) => {
        console.warn(`[treeMeshes] Failed to load GLB model for ${type}:`, err);
        reject(err);
      },
    );
  });
}

/**
 * Preload all tree categories into the template cache.
 */
export async function preloadTreeModels(): Promise<void> {
  const types: TreeType[] = ["broadleaf", "conifer", "small-ornamental"];
  await Promise.allSettled(types.map((t) => loadTreeModel(t)));
}

/**
 * Create a procedural fallback tree mesh when GLTF is unavailable (e.g. in tests).
 */
export function createProceduralTreeMesh(tree: Tree): THREE.Group {
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

  // 2. Foliage variant
  if (tree.type === "broadleaf") {
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
    foliageMesh.scale.set(1, 1, 0.55);
    foliageMesh.castShadow = true;
    foliageMesh.receiveShadow = true;
    foliageMesh.userData.treeId = tree.id;
    group.add(foliageMesh);
  }

  return group;
}

/** Build one tree mesh group resting on the ground plane (Z = 0). */
export function createTreeMesh(tree: Tree, _buildingHeight = 0): THREE.Group {
  const height = Math.max(tree.height, MIN_TREE_HEIGHT_M);
  const canopyWidth = Math.max(tree.canopyWidth, MIN_TREE_CANOPY_WIDTH_M);

  const cached = treeTemplateCache.get(tree.type);
  if (!cached) {
    // Seamless procedural fallback
    return createProceduralTreeMesh(tree);
  }

  const group = new THREE.Group();
  group.name = `Tree:${tree.id}`;
  group.position.set(tree.position.x, tree.position.y, 0); // Ground plane Z = 0
  group.rotation.z = (tree.rotation * Math.PI) / 180;
  group.userData.treeId = tree.id;
  group.userData.treeType = tree.type;

  // Clone template hierarchy and materials
  const instance = cached.group.clone(true);
  const scaleZ = height / cached.nativeHeight;
  const scaleXY = canopyWidth / cached.nativeWidth;
  instance.scale.set(scaleXY, scaleXY, scaleZ);

  instance.traverse((obj) => {
    obj.userData.treeId = tree.id;
    obj.userData.treeType = tree.type;
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
      // Naming for raycast and tests
      const matName = (mesh.material as THREE.Material)?.name || "";
      if (matName.includes("Bark") || matName.includes("wood")) {
        mesh.name = `TreeTrunk:${tree.id}`;
      } else {
        mesh.name = `TreeFoliage:${tree.id}`;
      }
    }
  });

  group.add(instance);
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

/** Create a translucent preview mesh for interactive tree placement. */
export function createTreePreviewMesh(
  type: TreeType,
  height: number,
  canopyWidth: number,
  rotationDeg = 0,
): THREE.Group {
  const tree: Tree = {
    id: "preview",
    type,
    position: { x: 0, y: 0 },
    height,
    canopyWidth,
    rotation: rotationDeg,
  };
  const mesh = createTreeMesh(tree, 0);
  mesh.name = "TreePlacementPreview";
  mesh.userData.isPlacementPreview = true;

  // Make materials translucent
  mesh.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.castShadow = false;
      m.receiveShadow = false;
      if (m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.opacity = 0.6;
        mat.depthWrite = false;
        mat.emissive = new THREE.Color(0x1f9d55);
        mat.emissiveIntensity = 0.45;
        m.material = mat;
      }
    }
  });

  return mesh;
}