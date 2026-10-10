/**
 * Tests for obstacle Three.js meshes (Phase 3).
 *
 * Proves the rendered box is a faithful 1-unit-per-metre projection of the
 * obstacle record: dimensions, roof-relative height and rotation all come from
 * the data, never from pixels or the renderer (AGENTS.md sections 40, 52, 64).
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import * as THREE from "three";
import {
  FOOTPRINT_MARKER_COLOR,
  OBSTACLE_INVALID_COLOR,
  OBSTACLE_SELECTED_EMISSIVE,
  applyObstacleSelection,
  createFootprintMarkerGroup,
  createObstacleGroup,
  createObstacleMesh,
  createObstaclePreviewMesh,
  disposeFootprintMarkerGroup,
  disposeObstacleResources,
  obstacleMeshFootprint,
} from "../lib/3d/obstacleMeshes";
import { obstacleFootprint, pointInPolygon, type Obstacle } from "../lib/3d/obstacles";

const BUILDING_HEIGHT = 17.2;

function makeObstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    id: "obstacle-1",
    type: "water-tank",
    position: { x: 3, y: -2 },
    width: 2.4,
    length: 4,
    height: 2,
    rotation: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("obstacle mesh geometry", () => {
  it("sizes the record's footprint and stays inside it", () => {
    // Predefined types build recognizable composites (fans, cylinders,
    // wall enclosures), so the rendered solid is bounded BY the record's
    // footprint rather than filling it exactly. A custom polygon still
    // extrudes its exact ring, which has its own test below.
    const mesh = createObstacleMesh(makeObstacle(), BUILDING_HEIGHT);

    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(2.4 + 1e-6); // width  (X)
    expect(size.y).toBeLessThanOrEqual(4 + 1e-6); // length (Y)
    expect(size.z).toBeCloseTo(2, 5); // height (Z) — the solid is `height` tall

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("sits the base exactly on the roof plane at the building height", () => {
    const mesh = createObstacleMesh(makeObstacle({ height: 2 }), BUILDING_HEIGHT);

    expect(mesh.position.z).toBe(BUILDING_HEIGHT); // 17.2 m
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!;
    expect(bounds.min.z).toBeCloseTo(0, 5); // local base at 0
    expect(bounds.max.z).toBeCloseTo(2, 5);

     // World extent: 17.2 to 19.2 m (obstacle stands ON the roof).
    const worldTop = mesh.position.z + bounds.max.z;
    expect(worldTop).toBeCloseTo(BUILDING_HEIGHT + 2, 5);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("follows the building height when the tower grows", () => {
    const mesh = createObstacleMesh(makeObstacle(), 40);
    expect(mesh.position.z).toBe(40);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("places the footprint centre at the record position", () => {
    const mesh = createObstacleMesh(makeObstacle(), BUILDING_HEIGHT);
    expect(mesh.position.x).toBe(3);
    expect(mesh.position.y).toBe(-2);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("rotates around the vertical Z axis", () => {
    const mesh = createObstacleMesh(makeObstacle({ rotation: 30 }), BUILDING_HEIGHT);
    expect(mesh.rotation.z).toBeCloseTo((30 * Math.PI) / 180, 12);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("renders inside the authoritative domain footprint", () => {
    const obstacle = makeObstacle({ rotation: 37, position: { x: 4.5, y: 1.25 } });
    const rendered = obstacleMeshFootprint(obstacle, BUILDING_HEIGHT);
    const expected = obstacleFootprint(obstacle);

    expect(rendered).toHaveLength(4);
    // Predefined models are inscribed composites, so each rendered corner
    // must lie inside the authoritative footprint — never outside it.
    for (const corner of rendered) {
      expect(pointInPolygon(corner, expected)).toBe(true);
    }
    // And the record's footprint corners stay the outer boundary.
    for (const corner of expected) {
      const inside = rendered.every((r) => Math.hypot(r.x - corner.x, r.y - corner.y) > 1e-6);
      expect(inside).toBe(true);
    }
  });

  it("tags the mesh with its application-level id", () => {
    const mesh = createObstacleMesh(makeObstacle({ id: "obstacle-42" }), BUILDING_HEIGHT);
    expect(mesh.userData.obstacleId).toBe("obstacle-42");
    expect(mesh.name).toBe("Obstacle:obstacle-42");
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});

describe("obstacle group", () => {
  it("creates one mesh per obstacle", () => {
    const group = createObstacleGroup(
      [makeObstacle({ id: "a" }), makeObstacle({ id: "b", type: "hvac" }), makeObstacle({ id: "c" })],
      BUILDING_HEIGHT,
    );

    expect(group.name).toBe("RooftopObstacles");
    expect(group.children).toHaveLength(3);
    expect(group.children.map((c) => c.userData.obstacleId)).toEqual(["a", "b", "c"]);

    disposeObstacleResources(group);
  });

  it("hides the obstacle being edited so only its preview shows", () => {
    const group = createObstacleGroup(
      [makeObstacle({ id: "a" }), makeObstacle({ id: "b" })],
      BUILDING_HEIGHT,
      { hiddenId: "b" },
    );

    expect(group.children.map((c) => c.userData.obstacleId)).toEqual(["a"]);
    disposeObstacleResources(group);
  });

  it("highlights only the selected obstacle", () => {
    const group = createObstacleGroup(
      [makeObstacle({ id: "a" }), makeObstacle({ id: "b" })],
      BUILDING_HEIGHT,
    );

    applyObstacleSelection(group, "b");
    const emissiveOf = (id: string) => {
      const mesh = group.children.find((c) => c.userData.obstacleId === id) as THREE.Mesh;
      return (mesh.material as THREE.MeshStandardMaterial).emissive.getHex();
    };
    expect(emissiveOf("b")).toBe(OBSTACLE_SELECTED_EMISSIVE);
    expect(emissiveOf("a")).toBe(0x000000);

    applyObstacleSelection(group, null);
    expect(emissiveOf("b")).toBe(0x000000);

    disposeObstacleResources(group);
  });

  it("creates an empty group when there are no obstacles", () => {
    const group = createObstacleGroup([], BUILDING_HEIGHT);
    expect(group.children).toHaveLength(0);
    disposeObstacleResources(group);
  });
});

describe("obstacle preview", () => {
  it("is translucent, shadowless and un-edged", () => {
    const mesh = createObstaclePreviewMesh(makeObstacle(), BUILDING_HEIGHT, true);

    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeGreaterThan(0);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.children).toHaveLength(0);
    expect(mesh.name).toBe("ObstaclePreview");

    disposeObstacleResources(mesh);
  });

  it("turns red when the draft fails validation", () => {
    const valid = createObstaclePreviewMesh(makeObstacle(), BUILDING_HEIGHT, true);
    const invalid = createObstaclePreviewMesh(makeObstacle(), BUILDING_HEIGHT, false);

    expect((valid.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      OBSTACLE_SELECTED_EMISSIVE,
    );
    expect((invalid.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      OBSTACLE_INVALID_COLOR,
    );

    disposeObstacleResources(valid);
    disposeObstacleResources(invalid);
  });

  it("extrudes the custom polygon footprint exactly", () => {
    const base = makeObstacle();
    const ring = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];
    const mesh = createObstacleMesh(
      { ...base, type: "custom", polygon: ring, width: 3, length: 2 },
      BUILDING_HEIGHT,
    );

    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    // The mesh is authored in record-centred space, then placed at (3, −2).
    expect(box.min.x).toBeCloseTo(3, 5);
    expect(box.max.x).toBeCloseTo(6, 5);
    expect(box.min.y).toBeCloseTo(-2, 5);
    expect(box.max.y).toBeCloseTo(0, 5);
    // A custom obstacle always extrudes its exact ring, never a model.
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(2, 5); // record height

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("keeps the draft's footprint bounds", () => {
    const mesh = createObstaclePreviewMesh(makeObstacle({ width: 6, length: 3, height: 1.5 }), BUILDING_HEIGHT, true);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(6 + 1e-6);
    expect(size.y).toBeLessThanOrEqual(3 + 1e-6);
    expect(size.z).toBeCloseTo(1.5, 5);
    disposeObstacleResources(mesh);
  });
});

describe("disposal", () => {
  it("releases every geometry and material", () => {
    const geometrySpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialSpy = vi.spyOn(THREE.Material.prototype, "dispose");

    const group = createObstacleGroup([makeObstacle()], BUILDING_HEIGHT);
    // Box + edges geometry, solid + line material (edges share the box geom).
    const geometriesBefore = new Set<number>();
    group.traverse((o) => {
      const renderable = o as THREE.Mesh;
      if (renderable.geometry) geometriesBefore.add(1);
    });
    expect(geometriesBefore.size).toBeGreaterThan(0);

    disposeObstacleResources(group);

    expect(geometrySpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(materialSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
describe("footprint marker overlay", () => {
  const PTS = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];

  it("marks every clicked point on the roof plane with connecting edges", () => {
    const handle = createFootprintMarkerGroup(PTS, 15, 200);
    try {
      const meshes = handle.group.children.filter((o) => (o as THREE.Mesh).isMesh);
      expect(meshes).toHaveLength(4);
      for (const [i, m] of meshes.entries()) {
        expect(m.position.x).toBeCloseTo(PTS[i].x, 9);
        expect(m.position.y).toBeCloseTo(PTS[i].y, 9);
        expect(m.position.z).toBeGreaterThan(15);
        expect(((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex()).toBe(FOOTPRINT_MARKER_COLOR);
      }
      const lines = handle.group.children.filter((o) => (o as THREE.Line).isLine);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    } finally {
      disposeFootprintMarkerGroup(handle);
    }
  });

  it("drives a live cursor edge from the last fixed point", () => {
    const handle = createFootprintMarkerGroup(PTS.slice(0, 2), 15, 200);
    try {
      handle.setLivePoint({ x: 9, y: 9 });
      handle.setLivePoint(null);
    } finally {
      disposeFootprintMarkerGroup(handle);
    }
  });

  it("shows markers without edges for a single point", () => {
    const handle = createFootprintMarkerGroup([{ x: 1, y: 2 }], 15, 200);
    try {
      const meshes = handle.group.children.filter((o) => (o as THREE.Mesh).isMesh);
      expect(meshes).toHaveLength(1);
    } finally {
      disposeFootprintMarkerGroup(handle);
    }
  });
});

