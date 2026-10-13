/**
 * Tests for Ground-Based Trees (SuryaGhar M3.6).
 *
 * Verifies that:
 * 1. Trees are validated to be on the ground outside the building terrace footprint.
 * 2. Tree meshes are placed at Z = 0 (ground level) rather than on the rooftop.
 * 3. Broadleaf, Conifer, and Small Ornamental variants build distinct trunk and foliage geometry.
 * 4. Selection highlighting (emissive) and disposal clean up properly.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  type Point2,
  type Tree,
  validateTree,
  treeFootprint,
} from "../lib/3d/treeTypes";
import {
  createTreeMesh,
  createTreeGroup,
  applyTreeSelection,
  disposeTreeGroup,
  TREE_SELECTED_EMISSIVE,
} from "../lib/3d/treeMeshes";

const TERRACE: Point2[] = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

function makeTree(overrides: Partial<Tree> = {}): Tree {
  return {
    id: "tree-1",
    type: "broadleaf",
    position: { x: 15, y: 0 }, // 15m east — outside the 10m terrace
    height: 8,
    canopyWidth: 5,
    rotation: 0,
    ...overrides,
  };
}

describe("Ground tree validation", () => {
  it("accepts a tree placed on the ground outside the building terrace with a small gap from wall", () => {
    const tree = makeTree({ position: { x: 12, y: 0 } });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(true);
  });

  it("accepts a tree whose trunk touches the exterior wall with wide canopy overhang", () => {
    // Wall is at x = 10. Trunk at x = 10.1 touches the wall with canopy width 6m overhanging the wall
    const tree = makeTree({ position: { x: 10.1, y: 0 }, canopyWidth: 6 });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(true);
  });

  it("rejects a tree whose trunk is placed inside the building footprint", () => {
    // Inside building (x = 5 is inside [-10, 10])
    const tree = makeTree({ position: { x: 5, y: 0 } });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("outside the building footprint");
    }
  });

  it("accepts trees whose canopies overlap and touch each other", () => {
    // Two trees placed with overlapping canopies (existing centered at 16, candidate at 17, canopies 4m wide)
    const existing = makeTree({ id: "tree-1", position: { x: 16, y: 0 }, canopyWidth: 4 });
    const candidate = makeTree({ id: "tree-2", position: { x: 17, y: 0 }, canopyWidth: 4 });
    const result = validateTree(candidate, TERRACE, [existing]);
    expect(result.valid).toBe(true);
  });

  it("accepts large trees up to the expanded limits (50m height, 35m canopy)", () => {
    const largeTree = makeTree({ position: { x: 25, y: 0 }, height: 45, canopyWidth: 30 });
    const result = validateTree(largeTree, TERRACE, []);
    expect(result.valid).toBe(true);
  });

  it("accepts adjacent trees whose canopies touch along an edge without gap", () => {
    // existing centered at (16, 0) with canopyWidth 4 => x in [14, 18], y in [-2, 2]
    const existing = makeTree({ id: "tree-1", position: { x: 16, y: 0 }, canopyWidth: 4 });
    // candidate centered at (20, 0) with canopyWidth 4 => x in [18, 22], y in [-2, 2]
    // Canopies touch at x = 18 with 0 gap, trunks are 4m apart (> 0.56m)
    const candidate = makeTree({ id: "tree-2", position: { x: 20, y: 0 }, canopyWidth: 4 });
    const result = validateTree(candidate, TERRACE, [existing]);
    expect(result.valid).toBe(true);
  });

  it("rejects trees whose trunks collide with another trunk", () => {
    // Valid dimensions (canopyWidth 0.6m >= MIN 0.5m) but trunks collide (d = 0.2m < r1 + r2)
    const existing = makeTree({ id: "tree-1", position: { x: 15, y: 0 }, canopyWidth: 0.6 });
    const candidate = makeTree({ id: "tree-2", position: { x: 15.2, y: 0 }, canopyWidth: 0.6 });
    const result = validateTree(candidate, TERRACE, [existing]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("collides");
    }
  });

  it("computes symmetric canopy footprint extent", () => {
    const tree = makeTree({ position: { x: 20, y: 10 }, canopyWidth: 6, rotation: 0 });
    const fp = treeFootprint(tree);
    expect(fp).toHaveLength(4);
    // Bounding corners should be centered at (20, 10) with halfWidth 3
    const xs = fp.map((p) => p.x);
    const ys = fp.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(17);
    expect(Math.max(...xs)).toBeCloseTo(23);
    expect(Math.min(...ys)).toBeCloseTo(7);
    expect(Math.max(...ys)).toBeCloseTo(13);
  });
});

describe("Ground tree 3D meshes", () => {
  it("places trees on the ground plane (Z = 0) with distinct trunk and foliage", () => {
    const tree = makeTree({ type: "broadleaf", height: 10, canopyWidth: 6 });
    const group = createTreeMesh(tree, 15); // buildingHeight 15 should NOT lift ground tree
    expect(group.position.z).toBe(0);
    expect(group.position.x).toBe(15);
    expect(group.position.y).toBe(0);

    const trunk = group.children.find((c) => c.name.startsWith("TreeTrunk"));
    const foliage = group.children.find((c) => c.name.startsWith("TreeFoliage"));
    expect(trunk).toBeDefined();
    expect(foliage).toBeDefined();
    expect(trunk).toBeInstanceOf(THREE.Mesh);
    expect(foliage).toBeInstanceOf(THREE.Mesh);
    expect((foliage as THREE.Mesh).geometry).toBeInstanceOf(THREE.DodecahedronGeometry);
  });

  it("creates conifer variant with tiered cones", () => {
    const tree = makeTree({ type: "conifer", height: 12, canopyWidth: 4 });
    const group = createTreeMesh(tree, 20);
    expect(group.position.z).toBe(0);

    const trunk = group.children.find((c) => c.name.startsWith("TreeTrunk"));
    const cones = group.children.filter((c) => c.name.startsWith("TreeCone"));
    expect(trunk).toBeDefined();
    expect(cones.length).toBeGreaterThanOrEqual(2);
    for (const cone of cones) {
      expect((cone as THREE.Mesh).geometry).toBeInstanceOf(THREE.ConeGeometry);
    }
  });

  it("creates small ornamental variant with spreading umbrella canopy", () => {
    const tree = makeTree({ type: "small-ornamental", height: 5, canopyWidth: 3 });
    const group = createTreeMesh(tree, 12);
    expect(group.position.z).toBe(0);

    const foliage = group.children.find((c) => c.name.startsWith("TreeFoliage")) as THREE.Mesh;
    expect(foliage).toBeDefined();
    expect(foliage.geometry).toBeInstanceOf(THREE.SphereGeometry);
    // Spreading canopy is vertically compressed
    expect(foliage.scale.z).toBeLessThan(foliage.scale.x);
  });

  it("applies and clears selection highlighting on ground trees", () => {
    const trees = [
      makeTree({ id: "tree-1", position: { x: 15, y: 0 } }),
      makeTree({ id: "tree-2", position: { x: 25, y: 0 } }),
    ];
    const group = createTreeGroup(trees, 10, { selectedId: "tree-1" });

    // tree-1 should have emissive highlight
    const tree1Obj = group.children.find((c) => c.userData.treeId === "tree-1")!;
    let hasEmissive1 = false;
    tree1Obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() === TREE_SELECTED_EMISSIVE) {
        hasEmissive1 = true;
      }
    });
    expect(hasEmissive1).toBe(true);

    // switch selection to tree-2
    applyTreeSelection(group, "tree-2");
    let hasEmissive2 = false;
    let tree1Cleared = true;
    group.children.find((c) => c.userData.treeId === "tree-2")!.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() === TREE_SELECTED_EMISSIVE) {
        hasEmissive2 = true;
      }
    });
    tree1Obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() !== 0) {
        tree1Cleared = false;
      }
    });
    expect(hasEmissive2).toBe(true);
    expect(tree1Cleared).toBe(true);

    // Clean disposal
    disposeTreeGroup(group);
  });
});

describe("Tree 3D templates and interactive preview", () => {
  it("normalizes a loaded GLTF group to have base at Z = 0 and enable shadow flags", async () => {
    const root = new THREE.Group();
    const geom = new THREE.BoxGeometry(2, 4, 2); // height 4 along Y
    const mat = new THREE.MeshStandardMaterial({ name: "WoodBark" });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 2, 0); // centered at Y = 2
    root.add(mesh);

    // Call normalization
    const { normalizeTreeGLTF } = await import("../lib/3d/treeMeshes");
    const normalized = normalizeTreeGLTF(root);

    expect(normalized.nativeHeight).toBeGreaterThan(0);
    expect(normalized.nativeWidth).toBeGreaterThan(0);

    // Bounds check on normalized.group: base min.z should be 0
    const box = new THREE.Box3().setFromObject(normalized.group);
    expect(box.min.z).toBeCloseTo(0, 1);

    // Meshes inside normalized template must cast and receive shadows
    let shadowsConfigured = false;
    normalized.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        expect((c as THREE.Mesh).castShadow).toBe(true);
        expect((c as THREE.Mesh).receiveShadow).toBe(true);
        shadowsConfigured = true;
      }
    });
    expect(shadowsConfigured).toBe(true);
  });

  it("builds a translucent tree placement preview mesh with isPlacementPreview flag", async () => {
    const { createTreePreviewMesh } = await import("../lib/3d/treeMeshes");
    const preview = createTreePreviewMesh("broadleaf", 7, 4.5, 30);
    expect(preview.name).toBe("TreePlacementPreview");
    expect(preview.userData.isPlacementPreview).toBe(true);

    let translucentCount = 0;
    preview.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        expect(mat.transparent).toBe(true);
        expect(mat.opacity).toBeLessThan(1);
        translucentCount++;
      }
    });
    expect(translucentCount).toBeGreaterThan(0);
  });

  it("points to Stylized Nature MegaKit asset paths with fallback chains", async () => {
    const { TREE_MODEL_URLS, TREE_MODEL_FALLBACK_URLS } = await import("../lib/3d/treeMeshes");
    expect(TREE_MODEL_URLS.broadleaf).toContain("CommonTree_1.gltf");
    expect(TREE_MODEL_URLS.conifer).toContain("Pine_1.gltf");
    expect(TREE_MODEL_URLS["small-ornamental"]).toContain("TwistedTree_1.gltf");

    expect(TREE_MODEL_FALLBACK_URLS.broadleaf.length).toBeGreaterThanOrEqual(1);
    expect(TREE_MODEL_FALLBACK_URLS.conifer.length).toBeGreaterThanOrEqual(1);
    expect(TREE_MODEL_FALLBACK_URLS["small-ornamental"].length).toBeGreaterThanOrEqual(1);
  });
});

