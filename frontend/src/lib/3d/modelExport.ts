/**
 * 3D Model Export Pipeline (GLB Format)
 *
 * Gathers the complete currently assembled 3D building model, rooftop,
 * placed obstacles, solar panels, and mounting structures into an isolated
 * Three.js scene graph, and serializes it as a standalone binary GLB (.glb) file.
 *
 * Key Principles:
 * - Isolation: Clones geometries and materials into a dedicated export group,
 *   never mutating the active live scene or viewport helpers.
 * - Meaningful Hierarchy: Organizes meshes under 'Building', 'Parapet',
 *   'Obstacles' (e.g. 'Obstacle_WaterTank_01'), 'SolarPanels' (e.g. 'SolarPanel_001'),
 *   and 'MountingStructures' (e.g. 'MountingStructure_ground_fixed_01').
 * - High Compatibility: Unrolls instanced panel matrices into named individual meshes
 *   sharing geometry buffers, ensuring universal compatibility across Blender,
 *   AutoCAD, Revit, SketchUp, Windows 3D Viewer, and macOS QuickLook.
 * - Pure Client-side: Works 100% in-browser without server upload or third-party paid APIs.
 */

import * as THREE from "three";
import type { LocalCoords3D } from "./coordinates";
import {
  createBuildingMeshes,
  createDesignBuildingMaterial,
  createDesignRoofMaterial,
  disposeBuildingMeshes,
  type ParapetOptions,
} from "./geometry";
import {
  createObstacleMesh,
} from "./obstacleMeshes";
import type {
  Obstacle,
  ObstacleType,
} from "./obstacles";
import {
  createPanelGroup,
  disposePanelGroup,
} from "./panelMeshes";
import type { InstallationType, PanelLayoutConfig } from "./panels";
import type { PlacedSetPanel } from "./panelSets";
import { createTreeMesh } from "./treeMeshes";
import type { Tree } from "./treeTypes";

export interface BuildExportSceneOptions {
  localCoords: LocalCoords3D;
  installationType?: InstallationType;
  parapet?: ParapetOptions | null;
  obstacles?: Obstacle[];
  panelLayers?: Array<{
    config: PanelLayoutConfig;
    panels: PlacedSetPanel[];
    isPanelSet?: boolean;
  }> | null;
  trees?: Tree[];
  /** Optional live scene mesh references to reuse active rendered meshes */
  liveScene?: {
    building?: THREE.Mesh | null;
    parapet?: THREE.Group | null;
    obstacleGroup?: THREE.Group | null;
    panelGroups?: THREE.Group[];
    treeGroup?: THREE.Group | null;
    usableAreaBoundary?: THREE.Group | null;
  };
}

export interface ExportSolarInstallationOptions extends BuildExportSceneOptions {
  filename?: string;
  siteName?: string;
}

export interface ExportResult {
  buffer: ArrayBuffer;
  byteLength: number;
  filename: string;
  objectCount: number;
  stats: {
    buildings: number;
    obstacles: number;
    solarPanels: number;
    mountingStructures: number;
    trees: number;
  };
}

/**
 * Format obstacle type into a PascalCase label for 3D node naming.
 */
export function formatObstacleType(type: ObstacleType | string): string {
  switch (type) {
    case "water-tank":
      return "WaterTank";
    case "hvac":
      return "HVAC";
    case "staircase-room":
      return "StaircaseRoom";
    case "lift-room":
      return "LiftRoom";
    case "ac_unit":
    case "ac-unit":
      return "ACUnit";
    case "building":
      return "NearbyBuilding";
    case "custom":
      return "CustomObstacle";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_](\w)/g, (_: string, c: string) => c.toUpperCase());
  }
}

/**
 * Build an isolated Three.js export scene representing the complete assembled model.
 */
export function buildExportScene(options: BuildExportSceneOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = "SuryaGhar_SolarInstallation";

  const isGround = options.installationType === "ground";

  // 1. Main Building / Parapet / Ground plot
  if (!isGround) {
    if (options.liveScene?.building) {
      const src = options.liveScene.building;
      const geom = src.geometry.clone();
      let mat: THREE.Material | THREE.Material[];
      if (Array.isArray(src.material)) {
        mat = src.material.map((m) => {
          const cloned = m.clone() as THREE.MeshStandardMaterial;
          cloned.transparent = false;
          cloned.opacity = 1.0;
          return cloned;
        });
      } else {
        const cloned = src.material.clone() as THREE.MeshStandardMaterial;
        cloned.transparent = false;
        cloned.opacity = 1.0;
        mat = cloned;
      }
      const bMesh = new THREE.Mesh(geom, mat);
      bMesh.name = "Building";
      bMesh.position.copy(src.position);
      bMesh.rotation.copy(src.rotation);
      bMesh.scale.copy(src.scale);
      root.add(bMesh);

      // Parapet from live scene
      if (options.liveScene.parapet && options.liveScene.parapet.children.length > 0) {
        const parapetGroup = new THREE.Group();
        parapetGroup.name = "Parapet";
        options.liveScene.parapet.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            const pMesh = new THREE.Mesh(
              m.geometry.clone(),
              Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(),
            );
            pMesh.name = m.name || "ParapetWall";
            pMesh.position.copy(m.position);
            pMesh.rotation.copy(m.rotation);
            pMesh.scale.copy(m.scale);
            parapetGroup.add(pMesh);
          }
        });
        if (parapetGroup.children.length > 0) root.add(parapetGroup);
      }
    } else {
      // Build fresh building & parapet meshes
      const wallMat = createDesignBuildingMaterial();
      const roofMat = createDesignRoofMaterial();
      wallMat.name = "WallMaterial";
      roofMat.name = "RoofMaterial";
      const meshes = createBuildingMeshes(
        options.localCoords,
        { wall: wallMat, roof: roofMat },
        undefined,
        options.parapet,
      );
      const bMesh = new THREE.Mesh(meshes.building.geometry.clone(), [roofMat.clone(), wallMat.clone()]);
      bMesh.name = "Building";
      root.add(bMesh);

      if (meshes.parapet && meshes.parapet.children.length > 0) {
        const parapetGroup = new THREE.Group();
        parapetGroup.name = "Parapet";
        meshes.parapet.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            const pMesh = new THREE.Mesh(
              m.geometry.clone(),
              Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(),
            );
            pMesh.name = m.name || "ParapetWall";
            pMesh.position.copy(m.position);
            pMesh.rotation.copy(m.rotation);
            pMesh.scale.copy(m.scale);
            parapetGroup.add(pMesh);
          }
        });
        if (parapetGroup.children.length > 0) root.add(parapetGroup);
      }
      disposeBuildingMeshes(meshes);
    }
  } else {
    // Ground site: represent the usable land plot boundary as an architectural curb
    const vertices = options.localCoords.vertices;
    if (vertices && vertices.length >= 3) {
      const shape = new THREE.Shape();
      shape.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) shape.lineTo(vertices[i].x, vertices[i].y);
      const plotGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      const plotMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.9,
        metalness: 0.05,
        name: "GroundPlot_Material",
      });
      const plotMesh = new THREE.Mesh(plotGeom, plotMat);
      plotMesh.name = "GroundPlot_Boundary";
      root.add(plotMesh);
    }
  }

  // 2. Obstacles
  const obstacles = options.obstacles ?? [];
  if (obstacles.length > 0) {
    const obstaclesGroup = new THREE.Group();
    obstaclesGroup.name = "Obstacles";

    let obsIdx = 1;
    for (const obs of obstacles) {
      const mesh = createObstacleMesh(obs, options.localCoords.height);
      const clonedMesh = new THREE.Mesh(
        mesh.geometry.clone(),
        Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone(),
      );
      clonedMesh.position.copy(mesh.position);
      clonedMesh.rotation.copy(mesh.rotation);
      clonedMesh.scale.copy(mesh.scale);
      clonedMesh.name = `Obstacle_${formatObstacleType(obs.type)}_${String(obsIdx++).padStart(2, "0")}`;
      clonedMesh.userData = {
        obstacleId: obs.id,
        obstacleType: obs.type,
        widthM: obs.width,
        lengthM: obs.length,
        heightM: obs.height,
      };
      obstaclesGroup.add(clonedMesh);

      // Clean up temporary mesh
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
    }
    if (obstaclesGroup.children.length > 0) {
      root.add(obstaclesGroup);
    }
  }

  // 3. Solar Panels and Mounting Structures
  const panelLayers = options.panelLayers ?? [];
  const panelsGroup = new THREE.Group();
  panelsGroup.name = "SolarPanels";
  const mountingGroup = new THREE.Group();
  mountingGroup.name = "MountingStructures";

  let globalPanelIdx = 1;
  let globalFrameIdx = 1;

  const extractFromPanelGroup = (group: THREE.Group, config: PanelLayoutConfig) => {
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (const child of group.children) {
      const instMesh = child as THREE.InstancedMesh;
      if (!instMesh.isInstancedMesh) continue;

      if (
        instMesh.name === "SolarPanelInstances" ||
        instMesh.name === "SolarPanelStandaloneInstances"
      ) {
        // Individual panels: share cloned geometry & material for efficiency and low GLB size
        const panelGeom = instMesh.geometry.clone();
        const panelMat = Array.isArray(instMesh.material)
          ? instMesh.material.map((m) => m.clone())
          : instMesh.material.clone();
        for (let i = 0; i < instMesh.count; i++) {
          instMesh.getMatrixAt(i, matrix);
          matrix.decompose(pos, quat, scale);
          const pMesh = new THREE.Mesh(panelGeom, panelMat);
          pMesh.name = `SolarPanel_${String(globalPanelIdx++).padStart(3, "0")}`;
          pMesh.position.copy(pos);
          pMesh.quaternion.copy(quat);
          pMesh.scale.copy(scale);
          pMesh.userData = {
            panelIndex: i,
            panelTypeId: config.panelTypeId,
            tiltDeg: config.tiltDeg,
            azimuthDeg: config.azimuthDeg,
            mounting: config.mounting,
          };
          panelsGroup.add(pMesh);
        }
      } else if (instMesh.name.startsWith("SolarPanelSharedFrame")) {
        // Shared mounting frames
        const frameGeom = instMesh.geometry.clone();
        const frameMat = Array.isArray(instMesh.material)
          ? instMesh.material.map((m) => m.clone())
          : instMesh.material.clone();
        for (let t = 0; t < instMesh.count; t++) {
          instMesh.getMatrixAt(t, matrix);
          matrix.decompose(pos, quat, scale);
          const fMesh = new THREE.Mesh(frameGeom, frameMat);
          fMesh.name = `MountingStructure_${config.mounting}_${String(globalFrameIdx++).padStart(2, "0")}`;
          fMesh.position.copy(pos);
          fMesh.quaternion.copy(quat);
          fMesh.scale.copy(scale);
          fMesh.userData = {
            tableIndex: t,
            mounting: config.mounting,
            setRows: config.setRows,
            setCols: config.setCols,
          };
          mountingGroup.add(fMesh);
        }
      }
    }
  };

  if (options.liveScene?.panelGroups && options.liveScene.panelGroups.length > 0) {
    for (let i = 0; i < options.liveScene.panelGroups.length; i++) {
      const group = options.liveScene.panelGroups[i];
      const cfg = panelLayers[i]?.config ?? options.panelLayers?.[0]?.config;
      if (cfg) {
        extractFromPanelGroup(group, cfg);
      }
    }
  } else if (panelLayers.length > 0) {
    for (const layer of panelLayers) {
      const isSet = layer.isPanelSet ?? (layer.config.setRows > 1 || layer.config.setCols > 1);
      const tempGroup = createPanelGroup(
        layer.panels,
        layer.config.panelTypeId,
        layer.config.mounting,
        layer.config.tiltDeg,
        options.localCoords.height,
        layer.config.mountHeightM,
        layer.config.legRows,
        layer.config.legCols,
        undefined,
        undefined,
        { isPanelSet: isSet, config: layer.config },
      );
      extractFromPanelGroup(tempGroup, layer.config);
      disposePanelGroup(tempGroup);
    }
  }

  if (panelsGroup.children.length > 0) {
    root.add(panelsGroup);
  }
  if (mountingGroup.children.length > 0) {
    root.add(mountingGroup);
  }

  // 4. Trees
  const trees = options.trees ?? [];
  if (trees.length > 0) {
    const treesGroup = new THREE.Group();
    treesGroup.name = "Trees";
    let treeIdx = 1;
    for (const tree of trees) {
      const treeObj = createTreeMesh(tree, options.localCoords.height);
      treeObj.name = `Tree_${tree.type}_${String(treeIdx++).padStart(2, "0")}`;
      treeObj.userData = {
        treeId: tree.id,
        treeType: tree.type,
        heightM: tree.height,
        canopyWidthM: tree.canopyWidth,
      };
      // Strip any line/wireframe children
      const toRemove: THREE.Object3D[] = [];
      treeObj.traverse((c) => {
        if ((c as THREE.Line).isLine || (c as THREE.LineSegments).isLineSegments) {
          toRemove.push(c);
        }
      });
      for (const r of toRemove) r.parent?.remove(r);
      treesGroup.add(treeObj);
    }
    if (treesGroup.children.length > 0) {
      root.add(treesGroup);
    }
  }

  return root;
}

/**
 * Export an Object3D / Scene into a binary GLB ArrayBuffer using Three.js GLTFExporter.
 */
export async function exportSceneToGLB(
  root: THREE.Object3D,
  options: { binary?: boolean } = { binary: true },
): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const exporter = new GLTFExporter();

  return new Promise<ArrayBuffer>((resolve, reject) => {
    try {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
          } else {
            const jsonStr = JSON.stringify(result);
            const encoder = new TextEncoder();
            resolve(encoder.encode(jsonStr).buffer);
          }
        },
        (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        {
          binary: options.binary !== false,
          onlyVisible: false,
        },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Trigger local browser download of the GLB model file.
 */
export function downloadGLBFile(
  buffer: ArrayBuffer,
  filename = "surya-ghar-solar-installation.glb",
): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([buffer], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export the complete currently assembled 3D solar installation as a GLB file.
 * Handles building the isolated export representation, binary serialization, and browser download.
 */
export async function exportSolarInstallation3D(
  options: ExportSolarInstallationOptions,
): Promise<ExportResult> {
  const scene = buildExportScene(options);

  let buildings = 0;
  let obstacles = 0;
  let solarPanels = 0;
  let mountingStructures = 0;
  let trees = 0;

  scene.traverse((obj) => {
    if (obj.name === "Building" || obj.name === "GroundPlot_Boundary") buildings++;
    else if (obj.name.startsWith("Obstacle_")) obstacles++;
    else if (obj.name.startsWith("SolarPanel_")) solarPanels++;
    else if (obj.name.startsWith("MountingStructure_")) mountingStructures++;
    else if (obj.name.startsWith("Tree_")) trees++;
  });

  const totalObjects = buildings + obstacles + solarPanels + mountingStructures + trees;

  const rawFilename =
    options.filename ??
    (options.siteName
      ? `surya-ghar-${options.siteName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-solar-installation.glb`
      : "surya-ghar-solar-installation.glb");
  const filename = rawFilename.endsWith(".glb") ? rawFilename : `${rawFilename}.glb`;

  const buffer = await exportSceneToGLB(scene, { binary: true });

  downloadGLBFile(buffer, filename);

  return {
    buffer,
    byteLength: buffer.byteLength,
    filename,
    objectCount: totalObjects,
    stats: {
      buildings,
      obstacles,
      solarPanels,
      mountingStructures,
      trees,
    },
  };
}
