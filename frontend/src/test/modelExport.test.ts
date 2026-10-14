import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  buildExportScene,
  exportSceneToGLB,
  exportSolarInstallation3D,
  formatObstacleType,
} from "../lib/3d/modelExport";
import type { LocalCoords3D } from "../lib/3d/coordinates";
import type { Obstacle } from "../lib/3d/obstacles";
import type { PanelLayoutConfig } from "../lib/3d/panels";
import { DEFAULT_PANEL_CONFIG } from "../lib/3d/panels";
import type { PlacedSetPanel } from "../lib/3d/panelSets";

const sampleLocalCoords: LocalCoords3D = {
  vertices: [
    new THREE.Vector3(-10, -10, 0),
    new THREE.Vector3(10, -10, 0),
    new THREE.Vector3(10, 10, 0),
    new THREE.Vector3(-10, 10, 0),
  ],
  height: 12.0,
  utmZone: 45,
  centroidUtm: { x: 500000, y: 2500000 },
  centroidLngLat: { lng: 88.3639, lat: 22.5726 },
};

const sampleObstacles: Obstacle[] = [
  {
    id: "obs-water-tank-1",
    type: "water-tank",
    position: { x: 2, y: 2 },
    width: 2.0,
    length: 2.5,
    height: 1.8,
    rotation: 0,
  },
  {
    id: "obs-hvac-1",
    type: "hvac",
    position: { x: -4, y: -3 },
    width: 1.5,
    length: 1.5,
    height: 1.2,
    rotation: 45,
  },
];

const samplePanelConfig: PanelLayoutConfig = {
  ...DEFAULT_PANEL_CONFIG,
  mounting: "tilted",
  tiltDeg: 20,
  azimuthDeg: 180,
  setRows: 2,
  setCols: 3,
};

const samplePanels: PlacedSetPanel[] = [
  { index: 0, x: 0, y: 0, rotationDeg: 180, tableRow: 0, tableCol: 0 },
  { index: 1, x: 1.2, y: 0, rotationDeg: 180, tableRow: 0, tableCol: 1 },
  { index: 2, x: 2.4, y: 0, rotationDeg: 180, tableRow: 0, tableCol: 2 },
  { index: 3, x: 0, y: 2.5, rotationDeg: 180, tableRow: 1, tableCol: 0 },
  { index: 4, x: 1.2, y: 2.5, rotationDeg: 180, tableRow: 1, tableCol: 1 },
  { index: 5, x: 2.4, y: 2.5, rotationDeg: 180, tableRow: 1, tableCol: 2 },
];

describe("3D Model Export Pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatObstacleType", () => {
    it("converts obstacle types to readable PascalCase labels", () => {
      expect(formatObstacleType("water-tank")).toBe("WaterTank");
      expect(formatObstacleType("hvac")).toBe("HVAC");
      expect(formatObstacleType("staircase-room")).toBe("StaircaseRoom");
      expect(formatObstacleType("lift-room")).toBe("LiftRoom");
      expect(formatObstacleType("ac-unit")).toBe("ACUnit");
      expect(formatObstacleType("ac_unit")).toBe("ACUnit");
      expect(formatObstacleType("building")).toBe("NearbyBuilding");
      expect(formatObstacleType("custom")).toBe("CustomObstacle");
    });
  });

  describe("buildExportScene", () => {
    it("assembles complete rooftop scene with building, parapet, obstacles, and panels", () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        parapet: { heightM: 1.0, thicknessM: 0.2 },
        obstacles: sampleObstacles,
        panelLayers: [
          {
            config: samplePanelConfig,
            panels: samplePanels,
            isPanelSet: true,
          },
        ],
      });

      expect(scene).toBeInstanceOf(THREE.Group);
      expect(scene.name).toBe("SuryaGhar_SolarInstallation");

      // Verify Building
      const building = scene.getObjectByName("Building") as THREE.Mesh;
      expect(building).toBeDefined();
      expect(building.isMesh).toBe(true);

      // Verify Parapet
      const parapet = scene.getObjectByName("Parapet");
      expect(parapet).toBeDefined();

      // Verify Obstacles
      const obstaclesGroup = scene.getObjectByName("Obstacles");
      expect(obstaclesGroup).toBeDefined();
      expect(obstaclesGroup?.children.length).toBe(2);

      const waterTank = scene.getObjectByName("Obstacle_WaterTank_01") as THREE.Mesh;
      expect(waterTank).toBeDefined();
      expect(waterTank.userData.obstacleId).toBe("obs-water-tank-1");
      expect(waterTank.userData.widthM).toBe(2.0);

      const hvac = scene.getObjectByName("Obstacle_HVAC_02") as THREE.Mesh;
      expect(hvac).toBeDefined();
      expect(hvac.userData.obstacleId).toBe("obs-hvac-1");

      // Verify Solar Panels
      const panelsGroup = scene.getObjectByName("SolarPanels");
      expect(panelsGroup).toBeDefined();
      expect(panelsGroup?.children.length).toBe(6);

      const panel1 = scene.getObjectByName("SolarPanel_001") as THREE.Mesh;
      expect(panel1).toBeDefined();
      expect(panel1.isMesh).toBe(true);
      expect(panel1.userData.panelTypeId).toBe(samplePanelConfig.panelTypeId);
      expect(panel1.userData.tiltDeg).toBe(20);

      // Verify Mounting Structures
      const mountingGroup = scene.getObjectByName("MountingStructures");
      expect(mountingGroup).toBeDefined();
      expect(mountingGroup?.children.length).toBeGreaterThan(0);
      expect(mountingGroup?.children[0].name).toContain("MountingStructure_tilted");
    });

    it("assembles ground mount scene with plot boundary and ground mounting systems", () => {
      const scene = buildExportScene({
        localCoords: { ...sampleLocalCoords, height: 0 },
        installationType: "ground",
        panelLayers: [
          {
            config: {
              ...samplePanelConfig,
              installationType: "ground",
              mounting: "ground_fixed",
              mountHeightM: 0.8,
            },
            panels: samplePanels,
            isPanelSet: true,
          },
        ],
      });

      // No extruded building walls on ground sites
      expect(scene.getObjectByName("Building")).toBeUndefined();

      // Ground site boundary curb
      const plotBoundary = scene.getObjectByName("GroundPlot_Boundary");
      expect(plotBoundary).toBeDefined();

      // Solar Panels
      const panels = scene.getObjectByName("SolarPanels");
      expect(panels).toBeDefined();
      expect(panels?.children.length).toBe(6);

      // Ground mounting structures
      const mounting = scene.getObjectByName("MountingStructures");
      expect(mounting).toBeDefined();
      expect(mounting?.children[0].name).toContain("MountingStructure_ground_fixed");
    });

    it("excludes UI helpers, wireframes, and temporary diagnostics", () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        obstacles: sampleObstacles,
      });

      scene.traverse((obj) => {
        expect((obj as THREE.Line).isLine).toBeFalsy();
        expect((obj as THREE.LineSegments).isLineSegments).toBeFalsy();
        expect(obj.name).not.toContain("Wireframe");
        expect(obj.name).not.toContain("Heatmap");
        expect(obj.name).not.toContain("Compass");
        expect(obj.name).not.toContain("Gizmo");
      });
    });
  });

  describe("exportSceneToGLB and GLTFLoader round-trip", () => {
    it("generates a valid binary GLB ArrayBuffer with proper header", async () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        obstacles: sampleObstacles,
        panelLayers: [
          {
            config: samplePanelConfig,
            panels: samplePanels.slice(0, 2),
            isPanelSet: true,
          },
        ],
      });

      const buffer = await exportSceneToGLB(scene, { binary: true });

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(500);

      // Verify GLB magic header (0x46546C67 = "glTF" in little-endian)
      const dataView = new DataView(buffer);
      const magic = dataView.getUint32(0, true);
      expect(magic).toBe(0x46546c67);

      // Verify glTF version 2
      const version = dataView.getUint32(4, true);
      expect(version).toBe(2);

      // Verify total file length in header matches buffer byteLength
      const totalLength = dataView.getUint32(8, true);
      expect(totalLength).toBe(buffer.byteLength);
    });

    it("loads back through GLTFLoader preserving component hierarchy and node names", async () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        obstacles: sampleObstacles,
        panelLayers: [
          {
            config: samplePanelConfig,
            panels: samplePanels.slice(0, 2),
            isPanelSet: true,
          },
        ],
      });

      const buffer = await exportSceneToGLB(scene, { binary: true });

      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(buffer, "", resolve, reject);
      });

      expect(gltf).toBeDefined();
      expect(gltf.scene).toBeDefined();

      const exportedNames: string[] = [];
      gltf.scene.traverse((node: THREE.Object3D) => {
        if (node.name) exportedNames.push(node.name);
      });

      expect(exportedNames).toContain("Building");
      expect(exportedNames).toContain("Obstacle_WaterTank_01");
      expect(exportedNames).toContain("Obstacle_HVAC_02");
      expect(exportedNames).toContain("SolarPanel_001");
      expect(exportedNames).toContain("SolarPanel_002");
    });
  });

  describe("exportSolarInstallation3D", () => {
    it("exports scene, computes stats, and triggers browser download", async () => {
      const createObjectURLMock = vi.fn(() => "blob:mock-url");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      const result = await exportSolarInstallation3D({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        obstacles: sampleObstacles,
        panelLayers: [
          {
            config: samplePanelConfig,
            panels: samplePanels,
            isPanelSet: true,
          },
        ],
        siteName: "Rooftop Demo",
      });

      expect(result.filename).toBe("surya-ghar-rooftop_demo-solar-installation.glb");
      expect(result.byteLength).toBeGreaterThan(0);
      expect(result.stats.buildings).toBe(1);
      expect(result.stats.obstacles).toBe(2);
      expect(result.stats.solarPanels).toBe(6);
      expect(result.stats.mountingStructures).toBeGreaterThan(0);
      expect(result.objectCount).toBeGreaterThanOrEqual(9);

      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it("restores solid opacity when exporting from live scene in X-ray mode", () => {
      const liveGeom = new THREE.BoxGeometry(10, 10, 10);
      const transparentMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
      });
      const liveMesh = new THREE.Mesh(liveGeom, transparentMat);

      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        liveScene: {
          building: liveMesh,
        },
      });

      const building = scene.getObjectByName("Building") as THREE.Mesh;
      expect(building).toBeDefined();
      const exportMat = building.material as THREE.MeshStandardMaterial;
      expect(exportMat.transparent).toBe(false);
      expect(exportMat.opacity).toBe(1.0);
    });

    it("includes trees in export while stripping wireframe/helper children", () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        trees: [
          {
            id: "tree-1",
            type: "broadleaf",
            position: { x: 15, y: 15 },
            height: 6.0,
            canopyWidth: 4.0,
            rotation: 0,
          },
        ],
      });

      const treesGroup = scene.getObjectByName("Trees");
      expect(treesGroup).toBeDefined();
      expect(treesGroup?.children.length).toBe(1);

      const tree = scene.getObjectByName("Tree_broadleaf_01");
      expect(tree).toBeDefined();

      // Ensure no lines exist in tree
      tree?.traverse((child) => {
        expect((child as THREE.Line).isLine).toBeFalsy();
      });
    });
  });
});
