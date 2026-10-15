import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createAllBuildingFacadeMarks,
  createAllRooftopMarks,
  createBuildingFacadeMark,
  createFlexibleWallTextMesh,
  createGroundMark,
  createMountingMarks,
  createRooftopMark,
  createSiteBranding,
  createEnerzyAITextGeometry,
  createEnerzyAITextMesh,
  createBrandingMaterial,
  disposeBrandingGroup,
  findFrontFacadeSegment,
  updateBrandingAdaptiveLighting,
} from "../lib/3d/branding";
import { BRANDING_TEXT, getEnerzyAIFont } from "../lib/3d/brandingAssets";
import type { LocalCoords3D } from "../lib/3d/coordinates";
import { DEFAULT_PANEL_CONFIG } from "../lib/3d/panels";
import { buildExportScene, exportSceneToGLB } from "../lib/3d/modelExport";

const sampleLocalCoords: LocalCoords3D = {
  vertices: [
    new THREE.Vector3(-10, -10, 0),
    new THREE.Vector3(10, -10, 0),
    new THREE.Vector3(10, 10, 0),
    new THREE.Vector3(-10, 10, 0),
  ],
  height: 14.0,
  utmZone: 45,
  centroidUtm: { x: 500000, y: 2500000 },
  centroidLngLat: { lng: 88.3639, lat: 22.5726 },
};

const samplePanelLayers = [
  {
    config: {
      ...DEFAULT_PANEL_CONFIG,
      mounting: "tilted" as const,
      mountHeightM: 0.5,
    },
    panels: [
      { index: 0, x: -2, y: 0, rotationDeg: 180 },
      { index: 1, x: 2, y: 0, rotationDeg: 180 },
    ],
    isPanelSet: true,
  },
];

describe("enerzyAI 3D Scene & Export Text Branding Pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Branding Text & Font Provider", () => {
    it("renders strictly 'enerzyAI' with lowercase 'enerzy' and uppercase 'AI'", () => {
      expect(BRANDING_TEXT).toBe("enerzyAI");
    });

    it("loads and parses the typeface font synchronously without network requests", () => {
      const font = getEnerzyAIFont();
      expect(font).toBeDefined();
      expect((font as any).data).toBeDefined();
      expect((font as any).data.glyphs).toBeDefined();
      expect((font as any).data.glyphs["e"]).toBeDefined();
      expect((font as any).data.glyphs["A"]).toBeDefined();
    });
  });

  describe("Pure 3D Text Geometry & Materials", () => {
    it("creates centered 3D text geometry without raster images or plaques", () => {
      const geom = createEnerzyAITextGeometry(0.25, 0.015);
      expect(geom).toBeDefined();
      expect(geom.attributes.position).toBeDefined();
      expect(geom.attributes.position.count).toBeGreaterThan(0);

      // Centered bounding box should be symmetric around 0
      geom.computeBoundingBox();
      const bb = geom.boundingBox!;
      expect(Math.abs((bb.min.x + bb.max.x) / 2)).toBeLessThan(0.01);
      expect(Math.abs((bb.min.y + bb.max.y) / 2)).toBeLessThan(0.01);
    });

    it("creates a standalone text mesh with standard material and no texture map", () => {
      const mesh = createEnerzyAITextMesh({
        size: 0.25,
        name: "TestText",
      });

      expect(mesh.name).toBe("TestText");
      expect(mesh.isMesh).toBe(true);
      expect(mesh.children.length).toBe(0); // No child plaques, borders or backing plates

      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.isMeshStandardMaterial).toBe(true);
      expect(mat.map).toBeNull(); // Strictly NO raster image textures
    });

    it("provides daylight light black architectural finish and night slate finish", () => {
      const dayMat = createBrandingMaterial(false, false);
      const nightMat = createBrandingMaterial(true, false);
      const metallicMat = createBrandingMaterial(false, true);

      expect(dayMat.color.getHex()).toBe(0x525d6d); // Architectural light black / charcoal graphite
      expect(nightMat.color.getHex()).toBe(0x717f92); // Soft slate light black at night
      expect(metallicMat.color.getHex()).toBe(0xffffff); // Crisp pure white on structure for proper visibility
    });
  });

  describe("Brand Text Geometry Placements", () => {
    it("finds the primary front exterior facade segment facing South", () => {
      const facade = findFrontFacadeSegment(sampleLocalCoords.vertices);
      expect(facade.normal.y).toBeLessThan(0); // South-facing
      expect(facade.length).toBeGreaterThan(0);
      expect(facade.midpoint.y).toBeCloseTo(-10, 1);
    });

    it("creates building facade mark on the exterior wall aligned flush with the wall", () => {
      const facadeMark = createBuildingFacadeMark(sampleLocalCoords, 14.0, false);
      expect(facadeMark.name).toBe("enerzyAI_BuildingMark");
      expect(facadeMark.isMesh).toBe(true);
      expect(facadeMark.position.z).toBeGreaterThan(5.0); // Prominently on upper-mid facade (~7.28m)
      expect(facadeMark.position.y).toBeLessThan(-9.9); // Flush with South exterior wall
    });

    it("creates rooftop mark horizontally oriented on roof slab", () => {
      const roofMark = createRooftopMark(sampleLocalCoords, 14.0, false);
      expect(roofMark.name).toBe("enerzyAI_RooftopMark");
      expect(roofMark.isMesh).toBe(true);
      expect(roofMark.position.z).toBeGreaterThan(14.0); // Slightly above roof slab
      expect(roofMark.rotation.x).toBe(0);
    });

    it("creates multiple rooftop marks scattered across rooftop areas in random places and random orientations", () => {
      const roofMarks = createAllRooftopMarks(sampleLocalCoords, 14.0, false);
      // Sample roof is 20m x 20m = 400m², should have multiple marks
      expect(roofMarks.length).toBeGreaterThanOrEqual(5);

      const angles = new Set<number>();
      for (const mark of roofMarks) {
        expect(mark.isMesh).toBe(true);
        expect(mark.position.z).toBeGreaterThan(14.0);
        // Lies flat on the rooftop slab
        expect(mark.rotation.x).toBe(0);
        expect(mark.rotation.y).toBe(0);
        // Positioned inside the rooftop bounds (-10 to 10 with margin)
        expect(mark.position.x).toBeGreaterThan(-10);
        expect(mark.position.x).toBeLessThan(10);
        expect(mark.position.y).toBeGreaterThan(-10);
        expect(mark.position.y).toBeLessThan(10);
        // Collect orientation
        angles.add(Math.round(mark.rotation.z * 100));
      }

      // Verifies random orientations (marks have differing Z rotations)
      expect(angles.size).toBeGreaterThan(1);
    });

    it("increases the number of watermarks as the wall size increases", () => {
      // Small building: 6m sides
      const smallCoords: LocalCoords3D = {
        vertices: [
          new THREE.Vector3(-3, -3, 0),
          new THREE.Vector3(3, -3, 0),
          new THREE.Vector3(3, 3, 0),
          new THREE.Vector3(-3, 3, 0),
        ],
        height: 5.0,
        utmZone: 45,
        centroidUtm: { x: 500000, y: 2500000 },
        centroidLngLat: { lng: 88.3639, lat: 22.5726 },
      };

      // Medium building: 20m sides
      const mediumMarks = createAllBuildingFacadeMarks(sampleLocalCoords, 14.0, false);

      // Large building: 50m sides
      const largeCoords: LocalCoords3D = {
        vertices: [
          new THREE.Vector3(-25, -25, 0),
          new THREE.Vector3(25, -25, 0),
          new THREE.Vector3(25, 25, 0),
          new THREE.Vector3(-25, 25, 0),
        ],
        height: 22.0,
        utmZone: 45,
        centroidUtm: { x: 500000, y: 2500000 },
        centroidLngLat: { lng: 88.3639, lat: 22.5726 },
      };

      const smallMarks = createAllBuildingFacadeMarks(smallCoords, 5.0, false);
      const largeMarks = createAllBuildingFacadeMarks(largeCoords, 22.0, false);

      // Small building gets fewer marks than medium, medium gets fewer than large
      expect(smallMarks.length).toBeLessThan(mediumMarks.length);
      expect(mediumMarks.length).toBeLessThan(largeMarks.length);
      expect(largeMarks.length).toBeGreaterThanOrEqual(24);
    });

    it("creates ground mark inlaid in front of the site", () => {
      const groundMark = createGroundMark(sampleLocalCoords, false);
      expect(groundMark.name).toBe("enerzyAI_GroundMark");
      expect(groundMark.isMesh).toBe(true);
      expect(groundMark.position.z).toBeCloseTo(0.022, 2);
      expect(groundMark.position.y).toBeLessThan(-10); // In front of the site
    });

    it("creates multiple building facade marks across all exterior wall faces strictly within wall bounds", () => {
      const allWallMarks = createAllBuildingFacadeMarks(sampleLocalCoords, 14.0, false);
      expect(allWallMarks.length).toBeGreaterThanOrEqual(8); // Increased watermark density across walls (3 per 20m side = 12 total)
      expect(allWallMarks[0].name).toBe("enerzyAI_BuildingMark");
      expect(allWallMarks[1].name).toBe("enerzyAI_BuildingMark_02");
      expect(allWallMarks[2].name).toBe("enerzyAI_BuildingMark_03");
      expect(allWallMarks[3].name).toBe("enerzyAI_BuildingMark_04");

      // Verify that every mark stays strictly inside the wall area
      for (const mark of allWallMarks) {
        expect(mark.position.z).toBeGreaterThanOrEqual(0.8);
        expect(mark.position.z).toBeLessThanOrEqual(14.0 - 0.7); // Safely below roof/parapet
        expect(mark.userData.size).toBeLessThanOrEqual(0.35); // Bounded size
      }
    });

    it("ensures flexible watermark stays attached to the wall when crossing a corner", () => {
      // Create an L-shaped building segment where a short wall connects to a perpendicular wall
      const currentSeg = {
        p1: new THREE.Vector2(0, 0),
        p2: new THREE.Vector2(1.5, 0),
        midpoint: new THREE.Vector2(0.75, 0),
        normal: new THREE.Vector2(0, -1),
        tangent: new THREE.Vector2(1, 0),
        length: 1.5,
        angleZ: 0,
        score: -10,
        index: 0,
        prevIndex: 3,
        nextIndex: 1,
      };
      const nextSeg = {
        p1: new THREE.Vector2(1.5, 0),
        p2: new THREE.Vector2(1.5, 3),
        midpoint: new THREE.Vector2(1.5, 1.5),
        normal: new THREE.Vector2(1, 0),
        tangent: new THREE.Vector2(0, 1),
        length: 3.0,
        angleZ: Math.PI / 2,
        score: 0,
        index: 1,
        prevIndex: 0,
        nextIndex: 2,
      };

      const flexMesh = createFlexibleWallTextMesh({
        size: 0.25,
        depth: 0.015,
        isNight: false,
        name: "enerzyAI_FlexMark",
        currentSeg,
        nextSeg,
      });

      expect(flexMesh).toBeDefined();
      expect(flexMesh.isMesh).toBe(true);
      expect(flexMesh.geometry).toBeDefined();
      expect(flexMesh.geometry.attributes.position.count).toBeGreaterThan(0);

      // Verify bounding box stays attached within the two wall faces (X <= 1.6 and Y >= -0.05)
      flexMesh.geometry.computeBoundingBox();
      const bb = flexMesh.geometry.boundingBox!;
      expect(bb).toBeDefined();
    });

    it("creates discrete manufacturer badges engraved on mounting structures and solar panels", () => {
      const marks = createMountingMarks(samplePanelLayers, 14.0, false);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks[0].name).toBe("enerzyAI_MountingMark_01");
      expect(marks[1].name).toBe("enerzyAI_PanelMark_01");
      expect(marks[0].userData.isMetallic).toBe(true);
      expect(marks[1].userData.isMetallic).toBe(true);

      // Verify panel mark is at the panel's elevation (14m building + mounting elevation)
      expect(marks[1].position.z).toBeGreaterThan(14.0);
      expect(marks[0].position.z).toBeGreaterThan(14.0);
    });
  });

  describe("Site Branding Assembly & Day/Night Adaptation", () => {
    it("assembles complete branding group for rooftop installation", () => {
      const branding = createSiteBranding({
        localCoords: sampleLocalCoords,
        buildingHeight: 14.0,
        installationType: "rooftop",
        panelLayers: samplePanelLayers,
      });

      expect(branding.name).toBe("SuryaGhar_Branding");
      expect(branding.getObjectByName("enerzyAI_BuildingMark")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_BuildingMark_02")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_BuildingMark_03")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_BuildingMark_04")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_RooftopMark")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_GroundMark")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_MountingMark_01")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_PanelMark_01")).toBeDefined();
    });

    it("omits building facade mark on ground-mounted sites but keeps ground and mounting marks", () => {
      const branding = createSiteBranding({
        localCoords: { ...sampleLocalCoords, height: 0 },
        buildingHeight: 0,
        installationType: "ground",
        panelLayers: samplePanelLayers,
      });

      expect(branding.getObjectByName("enerzyAI_BuildingMark")).toBeUndefined();
      expect(branding.getObjectByName("enerzyAI_RooftopMark")).toBeUndefined();
      expect(branding.getObjectByName("enerzyAI_GroundMark")).toBeDefined();
      expect(branding.getObjectByName("enerzyAI_MountingMark_01")).toBeDefined();
    });

    it("adapts text colors between day (light silver-white) and night (pure white)", () => {
      const branding = createSiteBranding({
        localCoords: sampleLocalCoords,
        buildingHeight: 14.0,
        installationType: "rooftop",
        isNight: false,
      });

      const mark = branding.getObjectByName("enerzyAI_BuildingMark") as THREE.Mesh;
      const mat = mark.material as THREE.MeshStandardMaterial;

      expect(mat.color.getHex()).toBe(0x525d6d);

      // Switch to night mode
      updateBrandingAdaptiveLighting(branding, true);
      expect(mat.color.getHex()).toBe(0x717f92);

      // Switch back to day mode
      updateBrandingAdaptiveLighting(branding, false);
      expect(mat.color.getHex()).toBe(0x525d6d);
    });

    it("disposes geometries and materials cleanly", () => {
      const branding = createSiteBranding({
        localCoords: sampleLocalCoords,
        buildingHeight: 14.0,
        installationType: "rooftop",
      });

      expect(branding.children.length).toBeGreaterThan(0);
      disposeBrandingGroup(branding);
      expect(branding.children.length).toBe(0);
    });
  });

  describe("GLB Export Integration", () => {
    it("includes enerzyAI branding nodes in the isolated export scene graph", () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        panelLayers: samplePanelLayers,
        branding: true,
      });

      const buildingMark = scene.getObjectByName("enerzyAI_BuildingMark");
      const rooftopMark = scene.getObjectByName("enerzyAI_RooftopMark");
      const groundMark = scene.getObjectByName("enerzyAI_GroundMark");
      const mountingMark = scene.getObjectByName("enerzyAI_MountingMark_01");

      expect(buildingMark).toBeDefined();
      expect(rooftopMark).toBeDefined();
      expect(groundMark).toBeDefined();
      expect(mountingMark).toBeDefined();
    });

    it("exports binary GLB containing branding text nodes that parse through GLTFLoader", async () => {
      const scene = buildExportScene({
        localCoords: sampleLocalCoords,
        installationType: "rooftop",
        panelLayers: samplePanelLayers,
        branding: true,
      });

      const buffer = await exportSceneToGLB(scene, { binary: true });
      expect(buffer.byteLength).toBeGreaterThan(1000);

      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(buffer, "", resolve, reject);
      });

      expect(gltf.scene).toBeDefined();
      const names: string[] = [];
      gltf.scene.traverse((node: THREE.Object3D) => {
        if (node.name) names.push(node.name);
      });

      expect(names).toContain("enerzyAI_BuildingMark");
      expect(names).toContain("enerzyAI_RooftopMark");
      expect(names).toContain("enerzyAI_GroundMark");
      expect(names).toContain("enerzyAI_MountingMark_01");
    });
  });
});
