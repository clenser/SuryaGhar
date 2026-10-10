/**
 * Tests for building geometry generation (Three.js meshes)
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { createBuildingMeshes, createDesignRoofMaterial, createDesignBuildingMaterial, disposeBuildingMeshes, updateBuildingHeight, setShellTransparent, XRAY_OPACITY } from "../lib/3d/geometry";
import { terraceToLocal3D } from "../lib/3d/coordinates";
import { projectUtm, type LngLat } from "../lib/geo";

// Mock Three.js to avoid WebGL context in tests
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return {
    ...actual,
    WebGLRenderer: vi.fn(() => ({
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      dispose: vi.fn(),
      shadowMap: { enabled: false, type: null, autoUpdate: false },
      toneMapping: null,
      toneMappingExposure: 1,
    })),
  };
});

const TEST_VERTICES: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

describe("createBuildingMeshes", () => {
  let localCoords: ReturnType<typeof terraceToLocal3D>;

  beforeEach(() => {
    localCoords = terraceToLocal3D(TEST_VERTICES, 10);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates building mesh with correct height", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.building).toBeInstanceOf(THREE.Mesh);
    expect(meshes.building.name).toBe("Building");

    // Building geometry should have height reflected in bounding box
    const box = new THREE.Box3().setFromObject(meshes.building);
    expect(box.max.z).toBeCloseTo(10, 1); // Height = 10m
    expect(box.min.z).toBeCloseTo(0, 1); // Bottom at ground level
  });

  it("creates ground plane", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.ground).toBeInstanceOf(THREE.Mesh);
    expect(meshes.ground.name).toBe("GroundPlane");
    // Z-up scene: the ground must stay horizontal (PlaneGeometry normal +Z is
    // already "up" — no Y-up style rotation), otherwise it becomes a vertical
    // wall that can neither catch sunlight nor the building's shadow.
    expect(meshes.ground.rotation.x).toBe(0);
    expect(meshes.ground.position.z).toBe(0);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      meshes.ground.quaternion
    );
    expect(normal.z).toBeCloseTo(1, 5);
  });

  it("creates wireframe edges", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.wireframe).toBeInstanceOf(THREE.LineSegments);
    expect(meshes.wireframe.name).toBe("BuildingWireframe");
  });

  it("assigns roof caps and walls to distinct material groups", () => {
    const wall = createDesignBuildingMaterial();
    const roof = createDesignRoofMaterial();
    const meshes = createBuildingMeshes(localCoords, { wall, roof });
    try {
      const material = meshes.building.material as THREE.Material[];
      expect(Array.isArray(material)).toBe(true);
      // ExtrudeGeometry group 0 = horizontal caps (roof), group 1 = walls.
      expect(material[0]).toBe(roof);
      expect(material[1]).toBe(wall);
      expect(roof.color.getHex()).not.toBe(wall.color.getHex());
      const groups = meshes.building.geometry.groups;
      expect(groups.some((g) => g.materialIndex === 0)).toBe(true);
      expect(groups.some((g) => g.materialIndex === 1)).toBe(true);
    } finally {
      disposeBuildingMeshes(meshes);
    }
  });

  it("sizes an explicit ground plane when requested for shadow reach", () => {    const meshes = createBuildingMeshes(localCoords, undefined, 500);
    try {
      const box = new THREE.Box3().setFromObject(meshes.ground);
      expect(box.max.x - box.min.x).toBeCloseTo(500, 3);
      expect(box.max.y - box.min.y).toBeCloseTo(500, 3);
    } finally {
      disposeBuildingMeshes(meshes);
    }
  });

  it("includes all meshes in the all array", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.all).toHaveLength(3);
    expect(meshes.all).toContain(meshes.building);
    expect(meshes.all).toContain(meshes.ground);
    expect(meshes.all).toContain(meshes.wireframe);
  });

  it("building mesh casts and receives shadows", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.building.castShadow).toBe(true);
    expect(meshes.building.receiveShadow).toBe(true);
  });

  it("ground plane receives shadows", () => {
    const meshes = createBuildingMeshes(localCoords);

    expect(meshes.ground.receiveShadow).toBe(true);
  });

  it("building is centred on the local origin (sub-millimetre)", () => {
    const meshes = createBuildingMeshes(localCoords);
    const box = new THREE.Box3().setFromObject(meshes.building);
    const center = box.getCenter(new THREE.Vector3());

    // The mesh bounding box is an axis-aligned box around a slightly skewed
    // projected footprint, so it can differ from the vertex-average centroid by
    // a hair; what matters is that the model sits on the origin, not metres away.
    expect(Math.abs(center.x)).toBeLessThan(1e-3);
    expect(Math.abs(center.y)).toBeLessThan(1e-3);
  });

  it("preserves the polygon dimensions of the extruded footprint", () => {
    const meshes = createBuildingMeshes(localCoords);
    const localBox = new THREE.Box3().setFromObject(meshes.building);
    const localSize = localBox.getSize(new THREE.Vector3());

    // The same footprint measured directly in UTM metres (authoritative engine).
    const utm = TEST_VERTICES.map(projectUtm);
    const utmBox = new THREE.Box3();
    for (const p of utm) utmBox.expandByPoint(new THREE.Vector3(p.x, p.y, 0));
    const utmSize = utmBox.getSize(new THREE.Vector3());

    // Three.js stores positions in Float32, so footprint dimensions are
    // compared at micrometre-ish precision, not as exact doubles.
    expect(localSize.x).toBeCloseTo(utmSize.x, 4);
    expect(localSize.y).toBeCloseTo(utmSize.y, 4);
  });
});

describe("disposeBuildingMeshes", () => {
  it("disposes geometries and materials", () => {
    const localCoords = terraceToLocal3D(TEST_VERTICES, 10);
    const meshes = createBuildingMeshes(localCoords);

    const disposeGeometrySpy = vi.spyOn(meshes.building.geometry, "dispose");
    const materials = meshes.building.material as THREE.MeshStandardMaterial[];
    const disposeMaterialSpy = vi.spyOn(materials[0], "dispose");

    disposeBuildingMeshes(meshes);

    expect(disposeGeometrySpy).toHaveBeenCalled();
    expect(disposeMaterialSpy).toHaveBeenCalled();
  });
});

describe("updateBuildingHeight", () => {
  it("creates new meshes with updated height", () => {
    const localCoords = terraceToLocal3D(TEST_VERTICES, 10);
    const oldMeshes = createBuildingMeshes(localCoords);

    const newMeshes = updateBuildingHeight(localCoords, 20, oldMeshes);

    expect(newMeshes).not.toBe(oldMeshes);

    const box = new THREE.Box3().setFromObject(newMeshes.building);
    expect(box.max.z).toBeCloseTo(20, 1);
  });
});

describe("Material properties", () => {
  it("building material defaults to the professional navy pair", () => {
    const localCoords = terraceToLocal3D(TEST_VERTICES, 10);
    const meshes = createBuildingMeshes(localCoords);

    const material = meshes.building.material as THREE.MeshStandardMaterial[];
    expect(Array.isArray(material)).toBe(true);
    // Default: one navy instance shared by caps and walls (Color 0x0b1f33).
    expect(material).toHaveLength(2);
    expect(material[0].color.getHex()).toBe(0x0b1f33);
    expect(material[1].color.getHex()).toBe(0x0b1f33);
    expect(material[0].roughness).toBe(0.7);
    expect(material[0].metalness).toBe(0.1);
  });

  it("ground material is an opaque studio grey that reads shadows", () => {
    const localCoords = terraceToLocal3D(TEST_VERTICES, 10);
    const meshes = createBuildingMeshes(localCoords);

    const material = meshes.ground.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0x39424e);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
  });

  it("wireframe uses teal-bright color", () => {
    const localCoords = terraceToLocal3D(TEST_VERTICES, 10);
    const meshes = createBuildingMeshes(localCoords);

    const material = meshes.wireframe.material as THREE.LineBasicMaterial;
    expect(material.color.getHex()).toBe(0x13a8b5); // --color-teal-bright
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.6);
  });
});
describe("setShellTransparent (X-ray mode)", () => {
  it("fades shell materials and restores opaque defaults exactly", () => {
    const wall = createDesignBuildingMaterial();
    const roof = createDesignRoofMaterial();
    const before = [wall.color.getHex(), roof.color.getHex()];
    setShellTransparent([wall, roof], true);
    for (const m of [wall, roof]) {
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBe(XRAY_OPACITY);
      expect(m.depthWrite).toBe(false);
    }
    setShellTransparent([wall, roof], false);
    for (const m of [wall, roof]) {
      expect(m.transparent).toBe(false);
      expect(m.opacity).toBe(1);
      expect(m.depthWrite).toBe(true);
    }
    expect([wall.color.getHex(), roof.color.getHex()]).toEqual(before);
  });

  it("is idempotent in both directions", () => {
    const wall = createDesignBuildingMaterial();
    setShellTransparent([wall], true);
    setShellTransparent([wall], true);
    expect(wall.opacity).toBe(XRAY_OPACITY);
    setShellTransparent([wall], false);
    setShellTransparent([wall], false);
    expect(wall.opacity).toBe(1);
    expect(wall.transparent).toBe(false);
  });

  it("restores non-default original material properties exactly", () => {
    const wall = createDesignBuildingMaterial();
    wall.transparent = true;
    wall.opacity = 0.6;
    wall.depthWrite = false;
    const colorHex = wall.color.getHex();
    const emissiveHex = wall.emissive.getHex();
    setShellTransparent([wall], true);
    expect(wall.opacity).toBe(XRAY_OPACITY);
    expect(wall.side).toBe(THREE.FrontSide);
    setShellTransparent([wall], false);
    expect(wall.transparent).toBe(true);
    expect(wall.opacity).toBe(0.6);
    expect(wall.depthWrite).toBe(false);
    expect(wall.side).toBe(THREE.DoubleSide);
    expect(wall.color.getHex()).toBe(colorHex);
    expect(wall.emissive.getHex()).toBe(emissiveHex);
  });

  it("keeps x-ray opacity in the faint-but-solid 18-22% band", () => {
    // Faint enough to read the satellite ground through the shell, solid
    // enough that the building's volume is still recognisable. Below ~15%
    // the shell reads as empty wireframe.
    expect(XRAY_OPACITY).toBeGreaterThanOrEqual(0.18);
    expect(XRAY_OPACITY).toBeLessThanOrEqual(0.22);
  });
});
