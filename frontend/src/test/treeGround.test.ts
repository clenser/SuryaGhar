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
  it("accepts a tree placed on the ground outside the building terrace", () => {
    const tree = makeTree({ position: { x: 16, y: 0 } });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(true);
  });

  it("rejects a tree whose center is inside the building terrace", () => {
    const tree = makeTree({ position: { x: 0, y: 0 } });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("outside the building footprint");
    }
  });

  it("rejects a tree whose canopy overlaps the building footprint", () => {
    // Center at 11m east, but canopy width 5m extends into [8.5m, 13.5m], overlapping the 10m wall
    const tree = makeTree({ position: { x: 11, y: 0 }, canopyWidth: 5 });
    const result = validateTree(tree, TERRACE, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("outside the building footprint");
    }
  });

  it("rejects trees that overlap with existing trees", () => {
    const existing = makeTree({ id: "tree-1", position: { x: 16, y: 0 }, canopyWidth: 4 });
    const candidate = makeTree({ id: "tree-2", position: { x: 17, y: 0 }, canopyWidth: 4 });
    const result = validateTree(candidate, TERRACE, [existing]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("overlaps");
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
