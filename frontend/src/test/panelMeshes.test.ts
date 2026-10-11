/**
 * Panel mesh tests (Phase 5): shared unit geometry per mounting type, one
 * InstancedMesh per layout, instance transforms from the panel records, and
 * disposal/regeneration without leaking or duplicating scene objects.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  createPanelGroup,
  createPanelUnitGeometry,
  disposePanelGroup,
} from "../lib/3d/panelMeshes";
import type { PlacedPanel } from "../lib/3d/panelPlacement";
import type { MountingType } from "../lib/3d/panels";

function panels(count: number): PlacedPanel[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    x: i * 2.5,
    y: 0,
    rotationDeg: 180,
  }));
}

describe("createPanelUnitGeometry", () => {
  it("produces merged, colour-painted geometry with no NaN coordinates", () => {
    const geometry = createPanelUnitGeometry("panel-550w", "flat", 15);
    const position = geometry.getAttribute("position");
    expect(position.count).toBeGreaterThan(100); // frame + glass + grid + rails
    expect(geometry.getAttribute("color")).toBeDefined();
    for (let i = 0; i < position.array.length; i++) {
      expect(Number.isFinite(position.array[i])).toBe(true);
    }
    geometry.dispose();
  });

  it("builds a distinct arrangement for each mounting type", () => {
    const arrays: Record<MountingType, number[]> = { flat: [], tilted: [], shed: [] };
    for (const mounting of Object.keys(arrays) as MountingType[]) {
      const geometry = createPanelUnitGeometry("panel-550w", mounting, 20);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      // Geometry sits above the roof plane (z = 0) within a sane height.
      expect(box.min.z).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.z).toBeGreaterThan(0.1);
      expect(box.max.z).toBeLessThan(2);
      arrays[mounting] = Array.from(geometry.getAttribute("position").array);
      geometry.dispose();
    }
    // Flat adds four legs (more vertices than the flush tilted rail), while
    // the shed wedge reuses the vertex budget but occupies different space.
    expect(arrays.flat.length).not.toBe(arrays.tilted.length);
    expect(arrays.shed).not.toEqual(arrays.tilted);
    expect(arrays.flat).not.toEqual(arrays.shed);
  });

  it("scales geometry with the selected panel dimensions", () => {
    const small = createPanelUnitGeometry("panel-450w", "flat", 15);
    const large = createPanelUnitGeometry("panel-600w", "flat", 15);
    small.computeBoundingBox();
    large.computeBoundingBox();
    expect(large.boundingBox!.max.y).toBeGreaterThan(small.boundingBox!.max.y);
    small.dispose();
    large.dispose();
  });

  it("renders four corner legs by default and six with a mid-span pair", () => {
    const four = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 4);
    const six = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 6);
    // Two extra legs add exactly two boxes of vertices; footprint unchanged.
    const fourCount = four.getAttribute("position").count;
    const sixCount = six.getAttribute("position").count;
    expect(sixCount).toBeGreaterThan(fourCount);
    four.computeBoundingBox();
    six.computeBoundingBox();
    expect(six.boundingBox!.min.x).toBeCloseTo(four.boundingBox!.min.x, 6);
    expect(six.boundingBox!.max.x).toBeCloseTo(four.boundingBox!.max.x, 6);
    expect(six.boundingBox!.min.y).toBeCloseTo(four.boundingBox!.min.y, 6);
    expect(six.boundingBox!.max.y).toBeCloseTo(four.boundingBox!.max.y, 6);
    expect(six.boundingBox!.max.z).toBeCloseTo(four.boundingBox!.max.z, 6);
    four.dispose();
    six.dispose();
  });
});

describe("createPanelGroup", () => {
  it("returns an empty group for a zero-panel layout", () => {
    const group = createPanelGroup([], "panel-550w", "flat", 15, 12);
    expect(group.name).toBe("SolarPanels");
    expect(group.children).toHaveLength(0);
  });

  it("renders every panel as one InstancedMesh with record-derived transforms", () => {
    const items = panels(7);
    const group = createPanelGroup(items, "panel-550w", "flat", 15, 10.5);
    expect(group.children).toHaveLength(1); // one draw call for the whole layout

    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.count).toBe(7);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.getMatrixAt(3, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(7.5, 6); // 3 × 2.5 m from the record
    expect(position.z).toBeCloseTo(10.5, 6); // roof height
    // Rotation 180°: the panel's local +Y (length axis) points south.
    const lengthAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    expect(lengthAxis.x).toBeCloseTo(0, 6);
    expect(lengthAxis.y).toBeCloseTo(-1, 6);
  });
});

describe("disposePanelGroup", () => {
  it("disposes the shared geometry and material", () => {
    const group = createPanelGroup(panels(3), "panel-550w", "flat", 15, 0);
    const mesh = group.children[0] as THREE.InstancedMesh;
    const geometrySpy = vi.fn();
    const materialSpy = vi.fn();
    mesh.geometry.addEventListener("dispose", geometrySpy);
    (mesh.material as THREE.Material).addEventListener("dispose", materialSpy);

    disposePanelGroup(group);
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
  });

  it("regenerates without duplicates or cross-disposal", () => {
    const first = createPanelGroup(panels(3), "panel-550w", "flat", 15, 0);
    disposePanelGroup(first);
    expect(first.children).toHaveLength(1); // record kept; scene would drop it

    const second = createPanelGroup(panels(5), "panel-600w", "shed", 20, 0);
    expect(second.children).toHaveLength(1);
    const secondMesh = second.children[0] as THREE.InstancedMesh;
    expect(secondMesh.count).toBe(5);
    expect(secondMesh).not.toBe(first.children[0]);

    // A fresh configuration yields an independent geometry instance.
    const third = createPanelGroup(panels(2), "panel-450w", "tilted", 10, 0);
    const thirdMesh = third.children[0] as THREE.InstancedMesh;
    expect(thirdMesh.geometry).not.toBe(secondMesh.geometry);
    disposePanelGroup(second);
    disposePanelGroup(third);
  });
});
