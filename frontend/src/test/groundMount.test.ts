import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_PANEL_CONFIG,
  DEFAULT_GROUND_PANEL_CONFIG,
  GROUND_MOUNTING_TYPES,
  calculateSolarRowSpacing,
  validatePanelConfig,
  type PanelLayoutConfig,
} from "../lib/3d/panels";
import { groundPolygonToLocal3D } from "../lib/3d/coordinates";
import { createGroundSiteModel } from "../lib/3d/building";
import { createUsableAreaBoundary, disposeUsableAreaBoundary } from "../lib/3d/geometry";
import {
  createGroundFixedMountGeometry,
  createGroundAdjustableMountGeometry,
  createGroundTrackerMountGeometry,
  createGroundElevatedMountGeometry,
  createGroundPoleMountGeometry,
  createPanelUnitGeometry,
} from "../lib/3d/panelMeshes";
import type { LngLat } from "../lib/geo";

describe("Ground-Mounted Solar Installation", () => {
  describe("Domain Configuration & Catalogue", () => {
    it("preserves rooftop as the default installation type", () => {
      expect(DEFAULT_PANEL_CONFIG.installationType).toBe("rooftop");
      expect(DEFAULT_PANEL_CONFIG.mounting).toBe("flat");
    });

    it("provides dedicated defaults for ground-mounted installations", () => {
      expect(DEFAULT_GROUND_PANEL_CONFIG.installationType).toBe("ground");
      expect(DEFAULT_GROUND_PANEL_CONFIG.mounting).toBe("ground_fixed");
      expect(DEFAULT_GROUND_PANEL_CONFIG.tiltDeg).toBe(25);
      expect(DEFAULT_GROUND_PANEL_CONFIG.mountHeightM).toBe(0.6);
      expect(DEFAULT_GROUND_PANEL_CONFIG.rowSpacingM).toBe(1.5);
      expect(DEFAULT_GROUND_PANEL_CONFIG.setbackM).toBe(1.0);
      expect(DEFAULT_GROUND_PANEL_CONFIG.setRows).toBe(2);
      expect(DEFAULT_GROUND_PANEL_CONFIG.setCols).toBe(8);
    });

    it("implements all 5 ground mounting systems as enabled and fully functional", () => {
      const allTypes = [
        "ground_fixed",
        "ground_adjustable",
        "ground_tracker_single",
        "ground_elevated",
        "ground_pole",
      ] as const;
      for (const typeId of allTypes) {
        const item = GROUND_MOUNTING_TYPES.find((t) => t.type === typeId);
        expect(item).toBeDefined();
        expect(item?.disabled).toBe(false);
        expect(item?.badge).toBeUndefined();
      }
    });

    it("validates ground mounting types correctly", () => {
      const validConfig: PanelLayoutConfig = {
        ...DEFAULT_GROUND_PANEL_CONFIG,
      };
      const error = validatePanelConfig(validConfig);
      expect(error).toBeNull();
    });
  });

  describe("calculateSolarRowSpacing (Physics & Latitude)", () => {
    it("calculates positive, finite row spacing based on solar geometry", () => {
      const spacing = calculateSolarRowSpacing(2.28, 25, 22.5);
      expect(Number.isFinite(spacing)).toBe(true);
      expect(spacing).toBeGreaterThan(0.5);
      expect(spacing).toBeLessThan(10.0);
    });

    it("produces wider row spacing for higher tilt angles to prevent inter-row shading", () => {
      const spacingLowTilt = calculateSolarRowSpacing(2.28, 15, 22.5);
      const spacingHighTilt = calculateSolarRowSpacing(2.28, 35, 22.5);
      expect(spacingHighTilt).toBeGreaterThan(spacingLowTilt);
    });

    it("produces wider row spacing for higher latitudes due to lower winter sun elevation", () => {
      const spacingEquator = calculateSolarRowSpacing(2.28, 25, 5.0);
      const spacingNorth = calculateSolarRowSpacing(2.28, 25, 45.0);
      expect(spacingNorth).toBeGreaterThan(spacingEquator);
    });

    it("respects custom solar elevation angle override", () => {
      const spacingSummer = calculateSolarRowSpacing(2.28, 25, 22.5, 60.0);
      const spacingWinter = calculateSolarRowSpacing(2.28, 25, 22.5, 20.0);
      expect(spacingWinter).toBeGreaterThan(spacingSummer);
    });
  });

  describe("Ground Coordinates & Site Model", () => {
    const sampleLandPolygon: LngLat[] = [
      { lng: 88.3639, lat: 22.5726 },
      { lng: 88.3644, lat: 22.5726 },
      { lng: 88.3644, lat: 22.5721 },
      { lng: 88.3639, lat: 22.5721 },
    ];

    it("converts WGS84 land boundary polygon to local coordinates at ground elevation", () => {
      const local = groundPolygonToLocal3D(sampleLandPolygon, 0);
      expect(local.vertices.length).toBe(4);
      expect(local.height).toBe(0);
      for (const v of local.vertices) {
        expect(v.z).toBe(0);
        expect(Number.isFinite(v.x)).toBe(true);
        expect(Number.isFinite(v.y)).toBe(true);
      }
    });

    it("respects non-zero ground elevation parameter", () => {
      const local = groundPolygonToLocal3D(sampleLandPolygon, 5.25);
      for (const v of local.vertices) {
        expect(v.z).toBe(5.25);
      }
    });

    it("throws when ground boundary polygon has fewer than 3 vertices", () => {
      expect(() => groundPolygonToLocal3D(sampleLandPolygon.slice(0, 2))).toThrow(
        /Need at least 3 vertices/,
      );
    });

    it("creates an authoritative ground site model without fictitious building height", () => {
      const model = createGroundSiteModel(sampleLandPolygon);
      expect(model.heightM).toBe(0);
      expect(model.coords.height).toBe(0);
      expect(model.coords.vertices.length).toBe(4);
      expect(model.vertexCount).toBe(4);
      expect(model.extentM.east).toBeGreaterThan(0);
      expect(model.extentM.north).toBeGreaterThan(0);
    });
  });

  describe("Translucent Usable Area Boundary in 3D", () => {
    const boundaryVertices = [
      new THREE.Vector3(-10, -10, 0),
      new THREE.Vector3(10, -10, 0),
      new THREE.Vector3(10, 10, 0),
      new THREE.Vector3(-10, 10, 0),
    ];

    it("creates a subtle translucent surface with slight vertical offset to prevent z-fighting", () => {
      const boundary = createUsableAreaBoundary(boundaryVertices, 0);
      expect(boundary.fillMesh).toBeDefined();
      expect(boundary.outlineLine).toBeDefined();

      expect(boundary.fillMesh.name).toBe("UsableAreaBoundaryFill");
      expect(boundary.outlineLine.name).toBe("UsableAreaBoundaryOutline");

      // Check vertical offset on group
      expect(boundary.group.position.z).toBeCloseTo(0.03, 3);

      const fillMat = boundary.fillMesh.material as THREE.MeshBasicMaterial;
      expect(fillMat.transparent).toBe(true);
      expect(fillMat.depthWrite).toBe(false);

      disposeUsableAreaBoundary(boundary);
    });
  });

  describe("Ground Mounting Structure Geometries (All 5 Types)", () => {
    it("generates connected, finite structural members for ground_fixed mount", () => {
      const geom = createGroundFixedMountGeometry(DEFAULT_GROUND_PANEL_CONFIG);
      expect(geom).toBeDefined();

      const pos = geom.getAttribute("position");
      expect(pos.count).toBeGreaterThan(100);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      expect(bbox.min.z).toBeLessThanOrEqual(0.05);
      expect(bbox.max.z).toBeGreaterThan(DEFAULT_GROUND_PANEL_CONFIG.mountHeightM);

      geom.dispose();
    });

    it("generates connected, finite structural members for ground_adjustable (seasonal) mount", () => {
      const config: PanelLayoutConfig = {
        ...DEFAULT_GROUND_PANEL_CONFIG,
        mounting: "ground_adjustable",
      };
      const geom = createGroundAdjustableMountGeometry(config);
      expect(geom).toBeDefined();

      const pos = geom.getAttribute("position");
      expect(pos.count).toBeGreaterThan(100);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      expect(bbox.min.z).toBeLessThanOrEqual(0.05);
      expect(bbox.max.z).toBeGreaterThan(config.mountHeightM);

      geom.dispose();
    });

    it("generates connected, finite structural members for ground_tracker_single (torque tube) mount", () => {
      const config: PanelLayoutConfig = {
        ...DEFAULT_GROUND_PANEL_CONFIG,
        mounting: "ground_tracker_single",
      };
      const geom = createGroundTrackerMountGeometry(config);
      expect(geom).toBeDefined();

      const pos = geom.getAttribute("position");
      expect(pos.count).toBeGreaterThan(100);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      expect(bbox.min.z).toBeLessThanOrEqual(0.05);
      expect(bbox.max.z).toBeGreaterThan(config.mountHeightM);

      geom.dispose();
    });

    it("generates connected, finite structural members for ground_elevated (agrivoltaic portal) mount", () => {
      const config: PanelLayoutConfig = {
        ...DEFAULT_GROUND_PANEL_CONFIG,
        mounting: "ground_elevated",
        mountHeightM: 2.5,
      };
      const geom = createGroundElevatedMountGeometry(config);
      expect(geom).toBeDefined();

      const pos = geom.getAttribute("position");
      expect(pos.count).toBeGreaterThan(100);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      expect(bbox.min.z).toBeLessThanOrEqual(0.05);
      expect(bbox.max.z).toBeGreaterThan(2.5);

      geom.dispose();
    });

    it("generates connected, finite structural members for ground_pole (mast strongback) mount", () => {
      const config: PanelLayoutConfig = {
        ...DEFAULT_GROUND_PANEL_CONFIG,
        mounting: "ground_pole",
        mountHeightM: 1.8,
      };
      const geom = createGroundPoleMountGeometry(config);
      expect(geom).toBeDefined();

      const pos = geom.getAttribute("position");
      expect(pos.count).toBeGreaterThan(100);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      expect(bbox.min.z).toBeLessThanOrEqual(0.05);
      expect(bbox.max.z).toBeGreaterThan(1.5);

      geom.dispose();
    });

    it("builds single-module standalone units for all 5 ground mount types without error", () => {
      const allGroundTypes = [
        "ground_fixed",
        "ground_adjustable",
        "ground_tracker_single",
        "ground_elevated",
        "ground_pole",
      ] as const;

      for (const mType of allGroundTypes) {
        const geom = createPanelUnitGeometry("panel-550w", mType, 25, 0.6);
        expect(geom).toBeDefined();
        const pos = geom.getAttribute("position");
        expect(pos.count).toBeGreaterThan(50);
        for (let i = 0; i < pos.array.length; i++) {
          expect(Number.isFinite(pos.array[i])).toBe(true);
        }
        geom.dispose();
      }
    });
  });
});
