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
  PANEL_PART_COLORS,
  PANEL_ROOF_STANDOFF_M,
} from "../lib/3d/panelMeshes";
import { panelTypeDefinition } from "../lib/3d/panels";
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

  it("renders a legRows-by-legCols support grid with a stable footprint", () => {
    const twoByTwo = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 2, 2);
    const twoByThree = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 2, 3);
    // The mid-span pair adds exactly two leg boxes; the footprint is unchanged.
    expect(twoByThree.getAttribute("position").count).toBeGreaterThan(
      twoByTwo.getAttribute("position").count,
    );
    twoByTwo.computeBoundingBox();
    twoByThree.computeBoundingBox();
    for (const key of ["min", "max"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        expect(twoByThree.boundingBox![key][axis]).toBeCloseTo(
          twoByTwo.boundingBox![key][axis],
          6,
        );
      }
    }
    twoByTwo.dispose();
    twoByThree.dispose();
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

/**
 * Number of distinct support-leg positions along `axis`.
 *
 * The merged unit geometry paints every part with one flat colour, so the
 * support-coloured vertices identify the legs, the side rails and the tilt
 * rail. Only the legs reach down to the roof plane, so keeping the lowest
 * slice of the support-coloured vertices isolates them: each leg is a 5 cm
 * square standing on that slice.
 */
function legClusters(geometry: THREE.BufferGeometry, axis: "x" | "y"): number {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color") as THREE.BufferAttribute;
  const support = new THREE.Color(PANEL_PART_COLORS.support);
  const supportPoints: Array<{ x: number; y: number; z: number }> = [];
  let minZ = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(color.getX(i) - support.r) > 1e-4) continue;
    if (Math.abs(color.getY(i) - support.g) > 1e-4) continue;
    if (Math.abs(color.getZ(i) - support.b) > 1e-4) continue;
    const point = { x: position.getX(i), y: position.getY(i), z: position.getZ(i) };
    supportPoints.push(point);
    if (point.z < minZ) minZ = point.z;
  }
  const values = supportPoints
    .filter((point) => point.z <= minZ + 0.1) // the legs stand on the roof
    .map((point) => (axis === "x" ? point.x : point.y));
  values.sort((a, b) => a - b);
  let clusters = 0;
  let last = Number.NaN;
  for (const value of values) {
    // A leg is 5 cm wide, so one leg's own vertices group together.
    if (!Number.isFinite(last) || value - last > 0.06) {
      clusters += 1;
      last = value;
    }
  }
  return clusters;
}

describe("panel unit legs", () => {
  it("puts leg rows along the length axis and leg columns along the width axis", () => {
    // Same axes as the rows x columns lattice: rows stack along the panel
    // length (+Y), columns run along the panel width (+X).
    const threeRows = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 3, 1);
    const oneRow = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 1, 1);
    expect(legClusters(threeRows, "y")).toBe(3);
    expect(legClusters(oneRow, "y")).toBe(1);
    expect(legClusters(threeRows, "x")).toBe(1);

    const threeCols = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 1, 3);
    expect(legClusters(threeCols, "x")).toBe(3);
    expect(legClusters(oneRow, "x")).toBe(1);
    expect(legClusters(threeCols, "y")).toBe(1);

    for (const geometry of [threeRows, oneRow, threeCols]) geometry.dispose();
  });

  it("keeps the 2 x 2 default on the four corners", () => {
    const geometry = createPanelUnitGeometry("panel-550w", "flat", 15, 0.4, 2, 2);
    expect(legClusters(geometry, "x")).toBe(2);
    expect(legClusters(geometry, "y")).toBe(2);
    geometry.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* Support / panel attachment                                          */
/* ------------------------------------------------------------------ */

type Vec3 = { x: number; y: number; z: number };

/** Vertices of one part, identified by the flat colour the part is painted. */
function verticesOfColor(geometry: THREE.BufferGeometry, color: number): Vec3[] {
  const position = geometry.getAttribute("position");
  const attribute = geometry.getAttribute("color") as THREE.BufferAttribute;
  const wanted = new THREE.Color(color);
  const out: Vec3[] = [];
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(attribute.getX(i) - wanted.r) > 1e-4) continue;
    if (Math.abs(attribute.getY(i) - wanted.g) > 1e-4) continue;
    if (Math.abs(attribute.getZ(i) - wanted.b) > 1e-4) continue;
    out.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
  }
  return out;
}

/** Least-squares z = a*y + b through `points` (exact for a plane). */
function fitZOverY(points: Vec3[]): { a: number; b: number } {
  const n = points.length;
  let sy = 0;
  let sz = 0;
  let syy = 0;
  let syz = 0;
  for (const point of points) {
    sy += point.y;
    sz += point.z;
    syy += point.y * point.y;
    syz += point.y * point.z;
  }
  const denominator = n * syy - sy * sy;
  if (n === 0) return { a: 0, b: 0 };
  if (Math.abs(denominator) < 1e-12) return { a: 0, b: sz / n };
  const a = (n * syz - sy * sz) / denominator;
  return { a, b: (sz - a * sy) / n };
}

/**
 * The rendered plate's underside plane, MEASURED from the geometry.
 *
 * A rim extrusion is a box, and tilting moves its top-face corners to
 * different (y) positions than its bottom-face corners, so no (x, y)
 * bucket can pair them. The extreme-Y corners of the rim, however, always
 * include a bottom-face corner (they are the lowest vertex at that edge), so
 * the two edges of the plate pin the plane; every other vertex within 2 mm of
 * that line is a bottom-face vertex and refines it. Deliberately not
 * recomputed from the implementation formula, so a regression in that formula
 * fails this test.
 */
function plateUndersidePlane(geometry: THREE.BufferGeometry): { a: number; b: number } {
  const frame = verticesOfColor(geometry, PANEL_PART_COLORS.frame);
  const ys = frame.map((v) => v.y);
  const edgeCorner = (target: "low" | "high"): Vec3 | null => {
    const edge = target === "low" ? Math.max(...ys) : Math.min(...ys);
    let best: Vec3 | null = null;
    for (const vertex of frame) {
      if (Math.abs(vertex.y - edge) > 0.04) continue; // wider than the tilt offset
      if (!best || vertex.z < best.z) best = vertex;
    }
    return best;
  };
  const low = edgeCorner("low");
  const high = edgeCorner("high");
  if (!low || !high) return { a: 0, b: 0 };
  const pinned = fitZOverY([low, high]);
  const onPlane = frame.filter((v) => Math.abs(pinned.a * v.y + pinned.b - v.z) <= 0.002);
  return fitZOverY(onPlane.length >= 2 ? onPlane : [low, high]);
}

/**
 * Height of the leg standing at `position`, read from the geometry.
 *
 * A leg's bottom and top faces share their corner coordinates, so matching
 * the bottom-face vertices by position and taking the highest match isolates
 * THAT leg's own top - sampling an (x, y) window instead would also catch the
 * side rails, which follow the tilted plate a few centimetres away.
 */
function legTopZ(geometry: THREE.BufferGeometry, position: { x: number; y: number }): number {
  const support = verticesOfColor(geometry, PANEL_PART_COLORS.support);
  const feet = support.filter(
    (v) =>
      Math.abs(v.z - PANEL_ROOF_STANDOFF_M) <= 0.002 &&
      Math.abs(v.x - position.x) <= 0.03 &&
      Math.abs(v.y - position.y) <= 0.03,
  );
  expect(feet.length).toBeGreaterThanOrEqual(4); // a leg is a full box
  const tops = support.filter((v) =>
    feet.some((f) => Math.abs(f.x - v.x) < 1e-6 && Math.abs(f.y - v.y) < 1e-6),
  );
  expect(tops.length).toBeGreaterThanOrEqual(4);
  return Math.max(...tops.map((v) => v.z));
}

/**
 * Documented leg layout: the support grid is laid out in the panel's own
 * frame and then rotates with the panel about X, so a support at local
 * (sx, sy) stands at world (sx, cos*sy - sin*t/2) - see
 * createPanelUnitGeometry.
 */
function legPositions(
  widthM: number,
  lengthM: number,
  thicknessM: number,
  tiltDeg: number,
  legRows: number,
  legCols: number,
) {
  const span = (count: number, size: number, inset: number): number[] => {
    const n = Math.max(1, Math.floor(count));
    if (n <= 1) return [0];
    return Array.from({ length: n }, (_, i) => -(size / 2 - inset) + (i * (size - 2 * inset)) / (n - 1));
  };
  const rad = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs = span(legCols, widthM, 0.14);
  const ys = span(legRows, lengthM, 0.18);
  return ys.flatMap((y) => xs.map((x) => ({ x, y: cos * y - sin * (thicknessM / 2) })));
}

describe("panel support attachment", () => {
  for (const tiltDeg of [0, 15, 30, 45]) {
    it(`welds every leg to the panel underside at ${tiltDeg} deg tilt, at every mounting height`, () => {
      const dims = panelTypeDefinition("panel-550w");
      const feet = legPositions(dims.widthM, dims.lengthM, dims.thicknessM, tiltDeg, 2, 2);
      expect(feet).toHaveLength(4);
      for (const height of [0.02, 0.1, 0.4, 0.8, 2]) {
        const geometry = createPanelUnitGeometry("panel-550w", "flat", tiltDeg, height, 2, 2);
        const plane = plateUndersidePlane(geometry);
        const support = verticesOfColor(geometry, PANEL_PART_COLORS.support);

        for (const foot of feet) {
          // Every leg stands on the roof stand-off plane: no floating feet,
          // no posts starting in mid-air.
          const onRoof = support.filter(
            (v) =>
              Math.abs(v.z - PANEL_ROOF_STANDOFF_M) <= 0.002 &&
              Math.abs(v.x - foot.x) <= 0.03 &&
              Math.abs(v.y - foot.y) <= 0.03,
          );
          expect(onRoof.length).toBeGreaterThanOrEqual(4);
          // Every leg reaches the underside at its OWN (x, y). The plane is
          // measured from the rendered plate, so a tilted-plate mistake
          // (missing 1/cos factors, a fixed leg length) shows up as a gap.
          const top = legTopZ(geometry, foot);
          const underside = plane.a * foot.y + plane.b;
          expect(top).toBeGreaterThanOrEqual(underside - 0.0015);
          expect(top).toBeLessThanOrEqual(underside + 0.0025);
        }

        // The assembly rises with the height: the plate keeps a clearance
        // proportional to the requested mounting height.
        const plateLow = Math.min(
          ...verticesOfColor(geometry, PANEL_PART_COLORS.frame).map((v) => v.z),
        );
        expect(plateLow).toBeGreaterThan(PANEL_ROOF_STANDOFF_M + height - 0.03);
        expect(plateLow).toBeLessThan(PANEL_ROOF_STANDOFF_M + height + 0.03);
        geometry.dispose();
      }
    });
  }

  it("keeps all nine legs attached as the support grid grows", () => {
    const dims = panelTypeDefinition("panel-550w");
    const geometry = createPanelUnitGeometry("panel-550w", "flat", 25, 0.4, 3, 3);
    const plane = plateUndersidePlane(geometry);
    const feet = legPositions(dims.widthM, dims.lengthM, dims.thicknessM, 25, 3, 3);
    expect(feet).toHaveLength(9);
    for (const foot of feet) {
      const top = legTopZ(geometry, foot);
      const underside = plane.a * foot.y + plane.b;
      expect(top).toBeGreaterThanOrEqual(underside - 0.0015);
      expect(top).toBeLessThanOrEqual(underside + 0.0025);
    }
    geometry.dispose();
  });

  it("carries the tilted single rail up to the panel underside", () => {
    for (const height of [0.1, 0.4, 1]) {
      const geometry = createPanelUnitGeometry("panel-550w", "tilted", 20, height, 2, 2);
      const plane = plateUndersidePlane(geometry);
      const support = verticesOfColor(geometry, PANEL_PART_COLORS.support);
      const dims = panelTypeDefinition("panel-550w");
      const rad = (20 * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // The rail is laid out in the panel frame at local -(l/2 - 0.035) and
      // rotates with the plate, so its footprint in world Y spans the local
      // range [-(l/2), -(l/2 - 0.07)].
      const railLocalY = -(dims.lengthM / 2 - 0.035);
      const toWorldY = (localY: number): number => cos * localY - sin * (dims.thicknessM / 2);
      const railWorldY = toWorldY(railLocalY);
      const atRail = support.filter(
        (v) => Math.abs(v.y - railWorldY) <= 0.05 && Math.abs(v.x) <= 0.6,
      );
      expect(atRail.length).toBeGreaterThan(0);
      const top = Math.max(...atRail.map((v) => v.z));
      const undersideAtCentre = plane.a * railWorldY + plane.b;
      const undersideAtHighEdge = plane.a * toWorldY(railLocalY - 0.035) + plane.b;
      // No gap under the raised edge, and no deep burial either.
      expect(top).toBeGreaterThanOrEqual(undersideAtCentre - 0.0015);
      expect(top).toBeLessThanOrEqual(undersideAtHighEdge + 0.003);
      geometry.dispose();
    }
  });
});

describe("panel instance transforms", () => {
  it("positions every instance at its record with a Z-only rotation", () => {
    const panels: PlacedPanel[] = [
      { index: 0, x: 1.25, y: -3.5, rotationDeg: 0 },
      { index: 1, x: 4.75, y: -3.5, rotationDeg: 90 },
      { index: 2, x: 1.25, y: 0.5, rotationDeg: 37 },
    ];
    const roofZ = 12.75;
    const group = createPanelGroup(panels, "panel-550w", "flat", 15, roofZ, 0.4, 2, 2);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(panels.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < panels.length; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      expect(position.x).toBeCloseTo(panels[i].x, 9);
      expect(position.y).toBeCloseTo(panels[i].y, 9);
      // The roof height is carried by the instance, never baked into the
      // geometry, so every panel of a set stands on the same roof plane.
      expect(position.z).toBeCloseTo(roofZ, 6);
      expect(scale.x).toBeCloseTo(1, 6);
      // Rotation about Z only: the tilt lives in the shared unit geometry, so
      // the complete assembly (panel + legs) turns together, exactly once.
      const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
      expect(euler.x).toBeCloseTo(0, 6);
      expect(euler.y).toBeCloseTo(0, 6);
      expect(Math.cos(euler.z)).toBeCloseTo(Math.cos((panels[i].rotationDeg * Math.PI) / 180), 6);
      expect(Math.sin(euler.z)).toBeCloseTo(Math.sin((panels[i].rotationDeg * Math.PI) / 180), 6);
    }
    disposePanelGroup(group);
  });

  it("builds the committed group and the preview from one geometry factory", () => {
    // The preview mesh and the committed instances are created by the same
    // factory with the same arguments, so what the user previews is exactly
    // what gets placed - including the support arrangement.
    const args = ["panel-550w", "flat", 15, 0.4, 2, 3] as const;
    const committed = createPanelUnitGeometry(...args);
    const preview = createPanelUnitGeometry(...args);
    expect(preview.getAttribute("position").count).toBe(
      committed.getAttribute("position").count,
    );
    const a = preview.getAttribute("position").array as Float32Array;
    const b = committed.getAttribute("position").array as Float32Array;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 9);
    committed.dispose();
    preview.dispose();
  });
});
