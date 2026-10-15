/**
 * Site3DViewer - Main Three.js Canvas Component
 *
 * React wrapper for the Three.js 3D scene. Handles:
 * - Canvas ref and container sizing (the parent owns the frame)
 * - Scene initialization, animation loop and cleanup
 * - Rebuilding the building mesh when the local coordinates change
 * - Rendering the rooftop obstacles held in application state
 * - Click-to-select / click-to-place hit testing on the roof plane
 * - Driving the sun light and its shadows from the shared SunClock (Phase 4)
 * - WebGL availability detection with a readable fallback (AGENTS.md §74)
 *
 * AGENTS.md §14: controlled camera (OrbitControls) — horizontal rotation,
 * vertical/elevation rotation and zoom only; the building stays the target.
 * AGENTS.md §72/§73: React owns UI/state, Three.js owns scene/camera/
 * rendering, and the frame path never triggers React state updates — playback
 * advances the mutable clock here and reports back at ≤5 Hz.
 * Obstacle records never live in Three.js: meshes are rebuilt from props.
 */

import { forwardRef, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Move } from "lucide-react";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LocalCoords3D } from "../../lib/3d/coordinates";
import {
  buildingBounds,
  enableCtrlDragPan,
  frameCamera,
  frameControls,
  framingFromBox,
  keepCameraOutsideBox,
  setupScene,
  updateCameraAspect,
} from "../../lib/3d/scene";
import {
  createBuildingMeshes,
  disposeBuildingMeshes,
  createDesignBuildingMaterial,
  createDesignRoofMaterial,
  setShellTransparent,
  createUsableAreaBoundary,
  disposeUsableAreaBoundary,
  type BuildingMeshes,
  type UsableAreaBoundaryMeshes,
} from "../../lib/3d/geometry";
import { applySunToScene, applyWeatherPreset, shadowCameraExtent } from "../../lib/3d/lighting";
import { pointInPolygon, type Obstacle } from "../../lib/3d/obstacles";
import {
  createPanelGroup,
  createPanelUnitGeometry,
  createSharedPanelSetFrameGeometry,
  disposePanelGroup,
  updatePanelGroupShading,
} from "../../lib/3d/panelMeshes";
import { effectivePanelDims, type InstallationType, type PanelLayoutConfig } from "../../lib/3d/panels";
import type { PlacedPanel } from "../../lib/3d/panelPlacement";
import { setBlockPanels, validatePanelPlacement, validateSetPlacement } from "../../lib/3d/panelSets";
import {
  applyObstacleSelection,
  createFootprintMarkerGroup,
  createObstacleGroup,
  createObstaclePreviewMesh,
  disposeFootprintMarkerGroup,
  disposeObstacleResources,
} from "../../lib/3d/obstacleMeshes";
import {
  createTreeGroup,
  disposeTreeGroup,
  applyTreeSelection,
  createTreePreviewMesh,
  preloadTreeModels,
} from "../../lib/3d/treeMeshes";
import { validateTree, type Tree, type TreeType } from "../../lib/3d/treeTypes";
import { fetchSatelliteGround } from "../../lib/3d/satelliteGround";
import { exportSolarInstallation3D, type ExportResult } from "../../lib/3d/modelExport";
import {
  createSiteBranding,
  updateBrandingAdaptiveLighting,
  disposeBrandingGroup,
} from "../../lib/3d/branding";
import type { LngLat } from "../../lib/geo";
import {
  SUN_UI_TICK_MS,
  advanceSunClock,
  shortestAngleDelta,
  sunStateAt,
  type SunClock,
} from "../../lib/solar";
import type { WeatherPreset } from "../../lib/3d/lighting";
import { buildElectricalTopology } from "../../lib/3d/electricityFlow";
import { createElectricityFlowVisualizer, type ElectricityFlowHandle } from "../../lib/3d/electricityFlowMeshes";
import { createBirdsSimulation, type BirdsSimulation } from "../../lib/3d/birds";
import { createCloudsSimulation, type CloudsSimulation } from "../../lib/3d/clouds";

/**
 * Attributes used for the capability probe. They mirror what Three.js requests,
 * so the context handed to WebGLRenderer already carries `alpha` (transparent
 * canvas → themed panel background) and antialiasing. Three.js r163+ requires
 * WebGL 2, so the probe asks for exactly that.
 */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  depth: true,
  preserveDrawingBuffer: false,
};

/** A press-and-release without movement counts as a click, not a camera drag. */
const CLICK_DRAG_THRESHOLD_PX = 6;

export interface Site3DViewerProps {
  /** Local 3D coordinates for the building (terrace polygon + height) */
  localCoords: LocalCoords3D;
  /**
   * Rooftop obstacles from application state (metres). Re-rendered whenever
   * this array changes — Three.js never becomes the source of truth.
   */
  obstacles?: Obstacle[];
  /** Obstacle currently highlighted in the viewport */
  selectedObstacleId?: string | null;
  /** Obstacle hidden while it is shown as a draft preview */
  hiddenObstacleId?: string | null;
  /** Draft obstacle rendered as a translucent ghost while the editor is open */
  previewObstacle?: Obstacle | null;
  /** Whether the current draft satisfies validation (ghost turns red if not) */
  previewValid?: boolean;
  /**
   * Click-to-select: fires with the obstacle id, or null when empty space is
   * clicked (deselect). Suppressed while a preview is shown.
   */
  onObstacleSelect?: (id: string | null) => void;
  /**
   * Obstacle drag-to-move: when true, pressing on an obstacle mesh starts a
   * move gesture instead of a camera orbit (the editor is open and owns the
   * draft). Disabled during footprint drawing and manual panel placement so
   * one pointer gesture is never claimed by two tools.
   */
  obstacleDragEnabled?: boolean;
  /** Live drag position in local metres, reported on the roof plane. */
  onObstacleDragMove?: (id: string, x: number, y: number) => void;
  /** Fires when the drag gesture ends (commit or revert is the parent's job). */
  onObstacleDragEnd?: (id: string) => void;
  /**
   * Manual panel placement preview: while set, a translucent preview follows
   * the pointer on the roof plane, tinted green/red by the shared placement
   * validator. Null hides it. Requires `insetM` (the parapet clearance) so
   * the preview validates exactly what a commit would validate. In "set"
   * mode the preview shows the whole rows-by-columns group at `rotationDeg`;
   * in "single" mode it shows one panel.
   */
  manualPanelPreview?: {
    config: PanelLayoutConfig;
    insetM: number;
    mode: "single" | "set";
    rotationDeg: number;
  } | null;
  /**
   * Click-to-place: while a preview is shown, clicking the roof plane reports
   * the local-metre position under the cursor for the draft footprint.
   */
  onRoofPlace?: (x: number, y: number) => void;
  /**
   * Footprint-drawing finish (double-click on the roof): the parent closes
   * the drawn polygon the same way the map selection finishes drawing.
   * Only wired while a footprint draft is active.
   */
  onRoofFinish?: () => void;
  /**
   * Interactive footprint drawing (Custom obstacles): absolute local-metre
   * points collected so far, rendered as markers + edges + live cursor edge.
   * Null (or empty with drawing off) shows nothing.
   */
  footprintPoints?: Array<{ x: number; y: number }> | null;
  /** True while footprint drawing captures roof clicks. */
  footprintDrawing?: boolean;
  /**
   * Shared sun clock (Phase 4): precomputed solar samples plus the simulated
   * time and playback flag. The render loop advances it while playing and
   * applies the resulting direction to the scene's key light. Optional so the
   * viewport can still render a static, sun-less scene.
   */
  sun?: SunClock | null;
  /**
   * Solar panel layouts, one entry per panel set: configuration plus the
   * placed panel records from application state. Each entry renders as one
   * InstancedMesh with its OWN configuration, so per-set tilt/height changes
   * update exactly that set's meshes. Rebuilt (old geometry disposed)
   * whenever this array changes.
   */
  panelLayers?: Array<{
    config: PanelLayoutConfig;
    panels: PlacedPanel[];
    isPanelSet?: boolean;
    shadingSeverities?: Array<"none" | "moderate" | "severe">;
    shadingMetrics?: Array<{ annualLossPercent: number; severity?: "none" | "moderate" | "severe"; instantaneousShadeFraction?: number } | null | undefined>;
  }> | null;
  /**
   * Manual panel placement session: while true, a press-and-release click on
   * the roof plane reports through onRoofPlace instead of selecting an
   * obstacle, so consecutive clicks place consecutive panels. Kept separate
   * from manualPanelPreview (the hover mesh) because the click path must also
   * work when the pointer never moved first.
   */
  manualPlaceActive?: boolean;
  /** Optional callback fired once the scene is ready */
  onReady?: () => void;
  /**
   * Rooftop parapet (M2 enhancement): wall height/thickness in metres.
   * Rendered as a separate ring solid on the roof surface.
   */
  parapet?: { heightM: number; thicknessM: number } | null;
  /**
   * Transparency (X-ray) mode: fades the building shell to reveal the roof
   * boundary against interior structures. Reversible via rebuild.
   */
  xray?: boolean;
  /**
   * Weather preset for visual lighting adjustment. Does not affect solar
   * position, shadow camera, or energy calculations. See WeatherPreset type.
   */
  weatherPreset?: WeatherPreset;
  /**
   * Trees from application state (metres). Re-rendered whenever this array
   * changes — Three.js never becomes the source of truth.
   */
  trees?: Tree[];
  /**
   * Tree currently highlighted in the viewport */
  selectedTreeId?: string | null;
  /** Click-to-select: fires with the tree id, or null when empty space is clicked */
  onTreeSelect?: (id: string | null) => void;
  /** Tree placement session: while true, pointer moves show a ground tree preview and clicks place on the ground */
  treePlaceActive?: boolean;
  treePlaceType?: TreeType;
  treePlaceHeight?: number;
  treePlaceCanopyWidth?: number;
  treePlaceRotation?: number;
  /** Click-to-place on ground: reports local-metre ground coordinates (Z = 0) */
  onGroundPlace?: (x: number, y: number) => void;
  /** Cancel active tree placement session */
  onCancelTreePlace?: () => void;
  /**
   * Geographic anchor for the satellite ground texture: the WGS84 terrace
   * ring plus the UTM centroid the local frame was built against. Without
   * it the viewer keeps its neutral studio ground.
   */
  siteAnchor?: { ring: LngLat[]; originUtm: { x: number; y: number } } | null;
  /** Layer visibility toggles (Building, Solar panels, Rooftop obstacles, Ground trees, Satellite ground, Electricity flow) */
  layerVisibility?: {
    building: boolean;
    panels: boolean;
    obstacles: boolean;
    trees: boolean;
    ground: boolean;
    electricityFlow?: boolean;
    birds?: boolean;
    clouds?: boolean;
  };
  /** Whether dragging trees is enabled */
  treeDragEnabled?: boolean;
  /** Live tree drag position in local ground metres */
  onTreeDragMove?: (id: string, x: number, y: number) => void;
  /** Fires when tree drag ends */
  onTreeDragEnd?: (id: string) => void;
  /** Currently active viewport tool */
  activeTool?: string | null;
  /** Delete obstacle callback */
  onDeleteObstacle?: (id: string) => void;
  /** Delete tree callback */
  onDeleteTree?: (id: string) => void;
  /** Selected solar panel instance info */
  selectedPanelInfo?: { setId: string; panelIndex: number; panelId: string } | null;
  /** Callback when a panel is clicked */
  onPanelSelect?: (info: { setId: string; panelIndex: number; panelId: string } | null) => void;
  /** Move solar panel callback */
  onMovePanel?: (setId: string, panelIndex: number, newX: number, newY: number) => void;
  /** Move solar panel start callback */
  onMovePanelStart?: (setId: string, panelIndex: number) => void;
  /** Move solar panel end/commit callback */
  onMovePanelEnd?: (setId: string, panelIndex: number) => void;
  /** Whether the building terrace is selected */
  selectedBuilding?: boolean;
  /** Callback when the building rooftop is clicked */
  onBuildingSelect?: (selected: boolean) => void;
  /** Installation mode: rooftop (default) or ground-mounted (Phase 1). */
  installationType?: InstallationType;
  /** Ground baseline elevation in metres (default 0). */
  groundElevationM?: number;
  /** Additional CSS class for the container */
  className?: string;
  /** Inline style for the container */
  style?: React.CSSProperties;
}

export interface Site3DViewerHandle {
  /** Reset the camera to the default framing of the building */
  resetCamera: () => void;
  /** Export the complete currently assembled 3D scene as an isolated GLB binary */
  exportGLB: (filename?: string) => Promise<ExportResult>;
}

/**
 * The container fills its parent, so the surrounding layout (for example
 * `.stage-3d-viewport`) owns the size, border and responsive aspect ratio.
 */
export const Site3DViewer = forwardRef<Site3DViewerHandle, Site3DViewerProps>(
  function Site3DViewer(
    {
      localCoords,
      obstacles = [],
      selectedObstacleId = null,
      hiddenObstacleId = null,
      previewObstacle = null,
      previewValid = true,
      onObstacleSelect,
      obstacleDragEnabled = false,
      onObstacleDragMove,
      onObstacleDragEnd,
      manualPanelPreview = null,
      onRoofPlace,
      onRoofFinish,
      footprintPoints = null,
      footprintDrawing = false,
      sun = null,
      panelLayers = null,
      manualPlaceActive = false,
      siteAnchor = null,
      parapet = null,
      xray = false,
      onReady,
      className = "",
      style,
      trees = [],
      selectedTreeId = null,
      onTreeSelect,
      treePlaceActive = false,
      treePlaceType = "broadleaf",
      treePlaceHeight = 8,
      treePlaceCanopyWidth = 5,
      treePlaceRotation = 0,
      onGroundPlace,
      onCancelTreePlace,
      weatherPreset = "sunny",
      layerVisibility,
      treeDragEnabled = false,
      onTreeDragMove,
      onTreeDragEnd,
      activeTool = null,
      onDeleteObstacle,
      onDeleteTree,
      selectedPanelInfo: _selectedPanelInfo = null,
      onPanelSelect,
      onMovePanel,
      onMovePanelStart,
      onMovePanelEnd,
      selectedBuilding: _selectedBuilding = false,
      onBuildingSelect,
      installationType = "rooftop",
      groundElevationM = 0,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const meshesRef = useRef<BuildingMeshes | null>(null);
    const lightsRef = useRef<THREE.Object3D[]>([]);
    const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
    const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
    const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
    const obstacleGroupRef = useRef<THREE.Group | null>(null);
    const treeGroupRef = useRef<THREE.Group | null>(null);
    const panelGroupRef = useRef<THREE.Group[]>([]);
    const previewMeshRef = useRef<THREE.Mesh | null>(null);
    /** Translucent panel shown while manual placement is active. */
    const panelPreviewMeshRef = useRef<THREE.Object3D | null>(null);
    /** Translucent tree shown while ground tree placement is active. */
    const treePreviewMeshRef = useRef<THREE.Group | null>(null);
    const texturedGroundRef = useRef<{ mesh: THREE.Mesh; texture: THREE.CanvasTexture } | null>(null);
    /** Translucent usable-area boundary mesh for ground-mounted solar (Phase 2). */
    const usableAreaBoundaryRef = useRef<UsableAreaBoundaryMeshes | null>(null);
    /** enerzyAI subtle geometry-based 3D branding group */
    const brandingGroupRef = useRef<THREE.Group | null>(null);
    /**
     * Building volume in local metres, for camera containment. Rebuilt with
     * the mesh so a height or footprint change is picked up without a manual
     * refresh. Kept as a ref (not state) so the render loop reads it without
     * triggering a React re-render.
     */
    const buildingBoxRef = useRef<THREE.Box3>(new THREE.Box3());
    /** Teardown for the Ctrl+left-drag pan wrapper, or null before init. */
    const ctrlPanCleanupRef = useRef<(() => void) | null>(null);
    /** Falling rain streaks in Rainy preset. */
    const rainRef = useRef<{
      lines: THREE.LineSegments;
      geom: THREE.BufferGeometry;
      mat: THREE.LineBasicMaterial;
      positions: Float32Array;
      speeds: Float32Array;
      lengths: Float32Array;
      maxHeight: number;
      dropCount: number;
      span: number;
    } | null>(null);
    const weatherPresetRef = useRef<WeatherPreset>(weatherPreset);
    weatherPresetRef.current = weatherPreset;
    const electricityFlowRef = useRef<ElectricityFlowHandle | null>(null);
    const birdsRef = useRef<BirdsSimulation | null>(null);
    const cloudsRef = useRef<CloudsSimulation | null>(null);
    const obstaclesRef = useRef(obstacles);
    obstaclesRef.current = obstacles;
    const treesRef = useRef(trees);
    treesRef.current = trees;
    const parapetRef = useRef(parapet);
    parapetRef.current = parapet;
    const parapetHeightRef = useRef(parapet?.heightM ?? 0);
    parapetHeightRef.current = parapet?.heightM ?? 0;
    const panelLayersRef = useRef(panelLayers);
    panelLayersRef.current = panelLayers;
    const layerVisibilityRef = useRef(layerVisibility);
    layerVisibilityRef.current = layerVisibility;

    // Latest values for effects that must run exactly once per mount.
    const localCoordsRef = useRef(localCoords);
    localCoordsRef.current = localCoords;
    const sunRef = useRef<SunClock | null>(sun);
    sunRef.current = sun;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onObstacleSelectRef = useRef(onObstacleSelect);
    onObstacleSelectRef.current = onObstacleSelect;
    const onTreeSelectRef = useRef(onTreeSelect);
    onTreeSelectRef.current = onTreeSelect;
    const treePlaceActiveRef = useRef(treePlaceActive);
    treePlaceActiveRef.current = treePlaceActive;
    const onGroundPlaceRef = useRef(onGroundPlace);
    onGroundPlaceRef.current = onGroundPlace;
    const onCancelTreePlaceRef = useRef(onCancelTreePlace);
    onCancelTreePlaceRef.current = onCancelTreePlace;
    const obstacleDragEnabledRef = useRef(obstacleDragEnabled);
    obstacleDragEnabledRef.current = obstacleDragEnabled;
    const onObstacleDragMoveRef = useRef(onObstacleDragMove);
    onObstacleDragMoveRef.current = onObstacleDragMove;
    const onObstacleDragEndRef = useRef(onObstacleDragEnd);
    onObstacleDragEndRef.current = onObstacleDragEnd;
    const manualPanelPreviewRef = useRef(manualPanelPreview);
    manualPanelPreviewRef.current = manualPanelPreview;
    const manualPlaceActiveRef = useRef(manualPlaceActive);
    manualPlaceActiveRef.current = manualPlaceActive;
    const onRoofPlaceRef = useRef(onRoofPlace);
    onRoofPlaceRef.current = onRoofPlace;
    const onRoofFinishRef = useRef(onRoofFinish);
    onRoofFinishRef.current = onRoofFinish;
    const previewActiveRef = useRef(previewObstacle !== null);
    previewActiveRef.current = previewObstacle !== null;
    const treeDragEnabledRef = useRef(treeDragEnabled);
    treeDragEnabledRef.current = treeDragEnabled;
    const onTreeDragMoveRef = useRef(onTreeDragMove);
    onTreeDragMoveRef.current = onTreeDragMove;
    const onTreeDragEndRef = useRef(onTreeDragEnd);
    onTreeDragEndRef.current = onTreeDragEnd;
    const activeToolRef = useRef(activeTool);
    activeToolRef.current = activeTool;
    const onDeleteObstacleRef = useRef(onDeleteObstacle);
    onDeleteObstacleRef.current = onDeleteObstacle;
    const onDeleteTreeRef = useRef(onDeleteTree);
    onDeleteTreeRef.current = onDeleteTree;
    const onPanelSelectRef = useRef(onPanelSelect);
    onPanelSelectRef.current = onPanelSelect;
    const onBuildingSelectRef = useRef(onBuildingSelect);
    onBuildingSelectRef.current = onBuildingSelect;
    const onMovePanelRef = useRef(onMovePanel);
    onMovePanelRef.current = onMovePanel;
    const onMovePanelStartRef = useRef(onMovePanelStart);
    onMovePanelStartRef.current = onMovePanelStart;
    const onMovePanelEndRef = useRef(onMovePanelEnd);
    onMovePanelEndRef.current = onMovePanelEnd;
    const [movingBanner, setMovingBanner] = useState<string | null>(null);

    /**
     * The renderer renders shadow maps on demand (`autoUpdate` is false), so
     * geometry and sun changes request exactly one refresh — a static scene
     * never pays for a shadow pass (AGENTS.md §45).
     */
    const requestShadowUpdate = () => {
      const renderer = rendererRef.current;
      if (renderer) renderer.shadowMap.needsUpdate = true;
    };

    const disposeTexturedGround = () => {
      const entry = texturedGroundRef.current;
      if (!entry) return;
      sceneRef.current?.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      entry.texture.dispose();
      texturedGroundRef.current = null;
    };

    const [webglError, setWebglError] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize the Three.js scene exactly once per mount.
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        // Explicit capability probe: jsdom, locked-down browsers and devices
        // without WebGL return null here, and we can explain the situation
        // instead of rendering an empty black box (AGENTS.md §74).
        const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
        if (!gl) {
          setWebglError(
            "WebGL is not supported in this browser. Please use a modern browser to view the 3D model.",
          );
          return;
        }

        const setup = setupScene(canvas, localCoordsRef.current);
        sceneRef.current = setup.scene;
        rendererRef.current = setup.renderer;
        cameraRef.current = setup.camera;
        controlsRef.current = setup.controls;
        // Ctrl + left drag pans the view centre. Bound on the CONTAINER in the
        // capture phase so the mapping swap lands before OrbitControls (which
        // listens on the canvas) reads it. Cleaned up on unmount.
        ctrlPanCleanupRef.current = enableCtrlDragPan(setup.controls, container);
        lightsRef.current = setup.lights;
        sunLightRef.current = setup.sunLight;
        ambientLightRef.current = setup.ambientLight;
        hemiLightRef.current = setup.hemiLight;
        // First shadow pass happens on the first rendered frame.
        setup.renderer.shadowMap.needsUpdate = true;

        // Initialize natural flying birds simulation in sky
        const birds = createBirdsSimulation(setup.scene);
        const isRainyInit = weatherPresetRef.current === "rainy";
        birds.setVisible(!isRainyInit && Boolean(layerVisibilityRef.current?.birds));
        birdsRef.current = birds;

        // Initialize dynamic 3D clouds with physical shadow casting
        const clouds = createCloudsSimulation(setup.scene);
        clouds.setWeatherPreset(weatherPresetRef.current);
        clouds.setVisible(!isRainyInit && Boolean(layerVisibilityRef.current?.clouds));
        cloudsRef.current = clouds;

        setIsInitialized(true);
        preloadTreeModels().catch(() => {});
        onReadyRef.current?.();
      } catch (err) {
        console.error("[Site3DViewer] Initialization failed:", err);
        setWebglError("Failed to initialize 3D view. Your device may not support WebGL.");
      }

      return () => {
        // Detach the Ctrl+left-drag pan wrapper first so no listener can fire
        // against a torn-down camera.
        if (ctrlPanCleanupRef.current) {
          ctrlPanCleanupRef.current();
          ctrlPanCleanupRef.current = null;
        }
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        if (treePreviewMeshRef.current) {
          sceneRef.current?.remove(treePreviewMeshRef.current);
          disposeTreeGroup(treePreviewMeshRef.current);
          treePreviewMeshRef.current = null;
        }
        if (meshesRef.current) {
          // Detach before disposing, exactly like the rebuild path: a mesh
          // that is only disposed stays parented and keeps rendering.
          for (const object of meshesRef.current.all) sceneRef.current?.remove(object);
          disposeBuildingMeshes(meshesRef.current);
          meshesRef.current = null;
        }
        if (usableAreaBoundaryRef.current) {
          sceneRef.current?.remove(usableAreaBoundaryRef.current.group);
          disposeUsableAreaBoundary(usableAreaBoundaryRef.current);
          usableAreaBoundaryRef.current = null;
        }
        if (obstacleGroupRef.current) {
          disposeObstacleResources(obstacleGroupRef.current);
          sceneRef.current?.remove(obstacleGroupRef.current);
          obstacleGroupRef.current = null;
        }
        if (treeGroupRef.current) {
          disposeTreeGroup(treeGroupRef.current);
          sceneRef.current?.remove(treeGroupRef.current);
          treeGroupRef.current = null;
        }
        if (previewMeshRef.current) {
          disposeObstacleResources(previewMeshRef.current);
          sceneRef.current?.remove(previewMeshRef.current);
          previewMeshRef.current = null;
        }
        for (const group of panelGroupRef.current) {
          disposePanelGroup(group);
          sceneRef.current?.remove(group);
        }
        panelGroupRef.current = [];
        if (electricityFlowRef.current) {
          sceneRef.current?.remove(electricityFlowRef.current.group);
          electricityFlowRef.current.dispose();
          electricityFlowRef.current = null;
        }
        if (birdsRef.current) {
          birdsRef.current.dispose();
          birdsRef.current = null;
        }
        if (cloudsRef.current) {
          cloudsRef.current.dispose();
          cloudsRef.current = null;
        }
        disposeTexturedGround();
        if (brandingGroupRef.current) {
          sceneRef.current?.remove(brandingGroupRef.current);
          disposeBrandingGroup(brandingGroupRef.current);
          brandingGroupRef.current = null;
        }
        if (rainRef.current) {
          sceneRef.current?.remove(rainRef.current.lines);
          rainRef.current.geom.dispose();
          rainRef.current.mat.dispose();
          rainRef.current = null;
        }
        for (const light of lightsRef.current) {
          sceneRef.current?.remove(light);
        }
        lightsRef.current = [];
        sunLightRef.current = null;
        ambientLightRef.current = null;
        hemiLightRef.current = null;
        sunRef.current = null;
        controlsRef.current?.dispose();
        controlsRef.current = null;
        rendererRef.current?.dispose();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        setIsInitialized(false);
      };
    }, []);

    // Build (or rebuild) the building mesh whenever the local coordinates
    // change — e.g. the user edited the terrace or changed the building height.
    // Warm-white walls + ivory roof (ExtrudeGeometry groups: caps = roof,
    // walls = sides); the ground plane is sized to contain the shadow reach
    // so long low-sun shadows stay on a receiving surface. X-ray mode fades
    // just the shell (transparent + no depth write) so roof boundaries stay
    // readable against interior structures; toggling rebuilds only meshes.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      try {
        if (meshesRef.current) {
          // Detach BEFORE disposing. `disposeBuildingMeshes` only frees GPU
          // resources: the old meshes stay parented to the scene and Three.js
          // silently recreates their program on the next frame, so every
          // rebuild left a fully opaque duplicate of the building and its
          // ground plane in front of the new shell. That ghost was drawn in
          // the opaque pass, then the x-ray shell blended over it — reading
          // as an unchanged, opaque building. Removing from the scene first
          // leaves exactly one shell to render.
          for (const object of meshesRef.current.all) sceneRef.current.remove(object);
          disposeBuildingMeshes(meshesRef.current);
          meshesRef.current = null;
        }
        const framing = framingFromBox(buildingBounds(localCoords));
        const groundSizeM = Math.max(
          framing.footprint * 1.5,
          shadowCameraExtent(framing.footprint, framing.height) * 2,
        );
        const wall = createDesignBuildingMaterial();
        const roof = createDesignRoofMaterial();
        const meshes = createBuildingMeshes(
          localCoords,
          { wall, roof },
          groundSizeM,
          parapet,
        );
        if (xray) {
          // Fade the whole shell — walls, roof AND parapet — so the roof
          // boundary reads against interior structures instead of hiding
          // behind an opaque parapet ring. Wireframe, obstacles and ground
          // stay solid as reference points.
          const shell: THREE.Material[] = [wall, roof];
          meshes.parapet?.traverse((child) => {
            const material = (child as Partial<THREE.Mesh>).material;
            if (Array.isArray(material)) shell.push(...material);
            else if (material) shell.push(material);
          });
          setShellTransparent(shell, true);
          // X-ray must not darken the ground beneath the footprint or clutter
          // the roof: a transparent shell still writes a full-strength shadow
          // into the depth map, which then reads THROUGH the faded walls as a
          // dark building-shaped patch on the satellite ground, and the faded
          // parapet ring stripes the roof the same way. Disabling casting on
          // the building AND the parapet removes exactly those artifacts;
          // obstacles and panels keep casting, so real external shadows stay
          // visible. Fresh objects per rebuild: Solid mode restores casting
          // automatically with no restore step.
          meshes.building.castShadow = false;
          meshes.parapet?.traverse((child) => {
            const mesh = child as Partial<THREE.Mesh>;
            if (mesh.isMesh) mesh.castShadow = false;
          });
          // Transparent shell renders after opaque interior content so
          // obstacles and inner faces read through it instead of z-fighting.
          // Fresh objects per rebuild: Solid mode needs no restore step.
          meshes.building.renderOrder = 2;
          meshes.parapet?.traverse((child) => {
            child.renderOrder = 2;
          });
          // Edges draw last so the footprint outline and vertical corner
          // lines stay crisp on top of the faded shell — close edges would
          // otherwise be re-tinted towards invisible by the transparent pass.
          meshes.wireframe.renderOrder = 3;
        }
        meshesRef.current = meshes;
        // Volume the camera may never enter. Taken from the same
        // buildingBounds() the framing uses, so containment and framing can
        // never disagree about where the building is.
        buildingBoxRef.current = buildingBounds(localCoords);
        // Exclusivity with the satellite texture: a rebuild creates a fresh
        // visible grey plane, which would bury an active textured ground
        // (and z-fight it). Exactly one ground is ever visible.
        meshes.ground.visible = !texturedGroundRef.current;
        for (const mesh of meshes.all) {
          sceneRef.current.add(mesh);
        }

        if (usableAreaBoundaryRef.current) {
          sceneRef.current.remove(usableAreaBoundaryRef.current.group);
          disposeUsableAreaBoundary(usableAreaBoundaryRef.current);
          usableAreaBoundaryRef.current = null;
        }

        const isGround = installationType === "ground";
        if (isGround) {
          // Suppress building extrusion, edges, and parapet in ground-mounted mode
          meshes.building.visible = false;
          meshes.building.castShadow = false;
          meshes.wireframe.visible = false;
          if (meshes.parapet) {
            meshes.parapet.visible = false;
            meshes.parapet.traverse((child) => {
              const m = child as Partial<THREE.Mesh>;
              if (m.isMesh) m.castShadow = false;
            });
          }

          // Create translucent usable-area boundary in 3D (Phase 2)
          // Follows exact polygon footprint, subtle +0.03m vertical offset eliminates z-fighting
          const boundary = createUsableAreaBoundary(localCoords.vertices, groundElevationM ?? 0);
          usableAreaBoundaryRef.current = boundary;
          sceneRef.current.add(boundary.group);
        }

        requestShadowUpdate();
        // Update distance bounds for the new building dimensions without
        // resetting the user's orbit camera target or orientation.
        if (controlsRef.current) {
          const framing = framingFromBox(buildingBounds(localCoords));
          const size = Math.max(framing.footprint, framing.height, 1);
          controlsRef.current.minDistance = Math.max(size * 0.15, 2);
          controlsRef.current.maxDistance = Math.max(size * 12, 100);
        }
      } catch (err) {
        console.error("[Site3DViewer] Mesh update failed:", err);
      }
    }, [localCoords, isInitialized, parapet, xray, installationType, groundElevationM]);

    // Satellite ground context: real site imagery under the model, aligned
    // to the local frame. Failure resolves to null and the neutral studio
    // ground stays — a missing texture never breaks the scene.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current || !siteAnchor || siteAnchor.ring.length < 3) return;
      const scene = sceneRef.current;
      let cancelled = false;

      fetchSatelliteGround({
        ring: siteAnchor.ring,
        originUtm: siteAnchor.originUtm,
      }).then((ground) => {
        if (cancelled || !ground || !sceneRef.current) return;
        disposeTexturedGround();
        // Contrast/brightness grade for the satellite imagery. Real tiles are
        // mid-dark and low-saturation, so a modest exposure lift plus mild
        // saturation makes roads, vegetation and rooftops read under daylight.
        // Only the ground texture carries this: nothing else is re-tinted and
        // the building keeps its own lighting.
        const graded = document.createElement("canvas");
        graded.width = ground.canvas.width;
        graded.height = ground.canvas.height;
        {
          const gctx = graded.getContext("2d");
          if (gctx) {
            gctx.drawImage(ground.canvas, 0, 0);
            const imageData = gctx.getImageData(0, 0, graded.width, graded.height);
            const data = imageData.data;
            const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i] / 255;
              const g = data[i + 1] / 255;
              const b = data[i + 2] / 255;
              // Contrast enhancement with S-curve curve preserving deep blacks
              // and rich asphalt/roads while boosting midtones and foliage saturation cleanly.
              const contrast = 1.18;
              const cr = Math.min(1, Math.max(0, (r - 0.5) * contrast + 0.5));
              const cg = Math.min(1, Math.max(0, (g - 0.5) * contrast + 0.5));
              const cb = Math.min(1, Math.max(0, (b - 0.5) * contrast + 0.5));
              const mean = (cr + cg + cb) / 3;
              data[i] = round(mean + (cr - mean) * 1.22);
              data[i + 1] = round(mean + (cg - mean) * 1.22);
              data[i + 2] = round(mean + (cb - mean) * 1.22);
            }
            gctx.putImageData(imageData, 0, 0);
          }
        }

        const texture = new THREE.CanvasTexture(graded);
        texture.colorSpace = THREE.SRGBColorSpace;
        const maxAniso = rendererRef.current?.capabilities.getMaxAnisotropy() ?? 1;
        texture.anisotropy = Math.min(8, maxAniso);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(ground.sizeM.width, ground.sizeM.height),
          new THREE.MeshStandardMaterial({
            map: texture,
            color: 0xf0f2f5,
            roughness: 0.88,
            metalness: 0,
          }),
        );
        // Z-up: PlaneGeometry is already horizontal; sit just below the
        // reference plane to avoid coplanar flicker at the building base.
        mesh.rotation.x = 0;
        mesh.position.set(ground.centerM.x, ground.centerM.y, -0.05);
        mesh.receiveShadow = true;
        mesh.name = "SatelliteGround";
        scene.add(mesh);
        texturedGroundRef.current = { mesh, texture };
        if (meshesRef.current) meshesRef.current.ground.visible = false;
        requestShadowUpdate();
      });

      return () => {
        cancelled = true;
        disposeTexturedGround();
        if (meshesRef.current) meshesRef.current.ground.visible = true;
      };
    }, [siteAnchor, localCoords, isInitialized]);

    // Rebuild the obstacle layer from application state (React is the source
    // of truth — meshes are a projection of props, never the reverse).
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;

      let group: THREE.Group;
      try {
        group = createObstacleGroup(obstacles, localCoords.height, { hiddenId: hiddenObstacleId });
      } catch (err) {
        console.error("[Site3DViewer] Obstacle update failed:", err);
        return;
      }

      obstacleGroupRef.current = group;
      scene.add(group);
      requestShadowUpdate();

      return () => {
        scene.remove(group);
        disposeObstacleResources(group);
        if (obstacleGroupRef.current === group) obstacleGroupRef.current = null;
      };
    }, [obstacles, hiddenObstacleId, localCoords, isInitialized]);

    // Build the tree layer from application state (React is the source of truth).
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;

      let group: THREE.Group;
      try {
        group = createTreeGroup(trees, localCoords.height, { selectedId: selectedTreeId });
      } catch (err) {
        console.error("[Site3DViewer] Tree update failed:", err);
        return;
      }

      treeGroupRef.current = group;
      scene.add(group);
      requestShadowUpdate();

      return () => {
        scene.remove(group);
        disposeTreeGroup(group);
        if (treeGroupRef.current === group) treeGroupRef.current = null;
      };
    }, [trees, selectedTreeId, localCoords, isInitialized]);

    // Highlight the selected obstacle without rebuilding the whole layer.
    useEffect(() => {
      if (!obstacleGroupRef.current) return;
      applyObstacleSelection(obstacleGroupRef.current, selectedObstacleId);
    }, [selectedObstacleId, obstacles, isInitialized]);

    // Highlight the selected tree without rebuilding the whole layer.
    useEffect(() => {
      if (!treeGroupRef.current) return;
      applyTreeSelection(treeGroupRef.current, selectedTreeId);
    }, [selectedTreeId, trees, isInitialized]);

    // Apply layer visibility controls (Building, Panels, Obstacles, Trees, Ground)
    useEffect(() => {
      if (!isInitialized) return;
      if (meshesRef.current) {
        const isGround = installationType === "ground";
        const showBuilding = !isGround && layerVisibility?.building !== false;
        meshesRef.current.building.visible = showBuilding;
        if (meshesRef.current.parapet) meshesRef.current.parapet.visible = showBuilding;
        if (meshesRef.current.wireframe) meshesRef.current.wireframe.visible = showBuilding;
        if (usableAreaBoundaryRef.current) {
          usableAreaBoundaryRef.current.group.visible = isGround && layerVisibility?.building !== false;
        }
        if (!texturedGroundRef.current) {
          meshesRef.current.ground.visible = layerVisibility?.ground !== false;
        }
      }
      if (panelGroupRef.current) {
        for (const g of panelGroupRef.current) {
          g.visible = layerVisibility?.panels !== false;
        }
      }
      if (obstacleGroupRef.current) {
        obstacleGroupRef.current.visible = layerVisibility?.obstacles !== false;
      }
      if (treeGroupRef.current) {
        treeGroupRef.current.visible = layerVisibility?.trees !== false;
      }
      if (texturedGroundRef.current?.mesh) {
        texturedGroundRef.current.mesh.visible = layerVisibility?.ground !== false;
      }
      const isRainyCurr = weatherPresetRef.current === "rainy";
      if (birdsRef.current) {
        birdsRef.current.setVisible(!isRainyCurr && Boolean(layerVisibility?.birds));
      }
      if (cloudsRef.current) {
        cloudsRef.current.setVisible(!isRainyCurr && Boolean(layerVisibility?.clouds));
      }
      requestShadowUpdate();
    }, [layerVisibility, isInitialized, installationType]);

    // Weather effects:
    // 1. Falling rain streaks & wet surface response in Rainy preset.
    // 2. Coordinated birds, procedural 3D cloud shadows, and sky ambiance response.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;
      const isRainy = weatherPreset === "rainy";

      // 1. Weather preset control for birds and clouds:
      // In rain: birds and clouds both disappear completely.
      // In sunny: birds present, clouds appear rarely with subtle localized shadows.
      // In cloudy: birds present, clouds active with a mix of darker little and lighter cloud shadows.
      if (birdsRef.current) {
        birdsRef.current.setVisible(!isRainy && Boolean(layerVisibilityRef.current?.birds));
      }
      if (cloudsRef.current) {
        cloudsRef.current.setWeatherPreset(weatherPreset);
        cloudsRef.current.setVisible(!isRainy && Boolean(layerVisibilityRef.current?.clouds));
      }

      // 2. Sky background mood adjustment:
      if (weatherPreset === "cloudy") {
        scene.background = new THREE.Color(0x19202a);
      } else if (isRainy) {
        scene.background = new THREE.Color(0x13171d);
      } else {
        scene.background = new THREE.Color(0x11161d);
      }

      // Handle wet surface response on building roof & panel materials
      if (meshesRef.current) {
        const mat = meshesRef.current.building.material;
        if (Array.isArray(mat) && mat[0]) {
          const roofMat = mat[0] as THREE.MeshStandardMaterial;
          if (roofMat && roofMat.isMeshStandardMaterial) {
            roofMat.roughness = isRainy ? 0.22 : 0.5;
            roofMat.metalness = isRainy ? 0.08 : 0.0;
          }
        }
      }
      for (const group of panelGroupRef.current) {
        group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (m && m.isMeshStandardMaterial) {
              m.roughness = isRainy ? 0.16 : 0.28;
            }
          }
        });
      }

      if (weatherPreset !== "rainy") {
        if (rainRef.current) {
          scene.remove(rainRef.current.lines);
          rainRef.current.geom.dispose();
          rainRef.current.mat.dispose();
          rainRef.current = null;
          requestShadowUpdate();
        }
        return;
      }

      // Rain streaks around building bounds: 1200 streaks with varied speed, length, and slight lateral drift
      const dropCount = 1200;
      const maxCoord = localCoords.vertices.reduce((m, v) => Math.max(m, Math.abs(v.x), Math.abs(v.y)), 15);
      const span = Math.max(70, maxCoord * 3.5);
      const maxHeight = Math.max(40, localCoords.height + 25);
      const positions = new Float32Array(dropCount * 2 * 3);
      const speeds = new Float32Array(dropCount);
      const lengths = new Float32Array(dropCount);

      const buildingRing = localCoords.vertices.map((v) => ({ x: v.x, y: v.y }));
      const roofZ = localCoords.height;

      for (let i = 0; i < dropCount; i++) {
        const x = (Math.random() - 0.5) * span;
        const y = (Math.random() - 0.5) * span;
        const isOverBuilding = pointInPolygon({ x, y }, buildingRing);
        const minZ = isOverBuilding ? roofZ : 0;
        const z = minZ + Math.random() * (maxHeight - minZ);
        const len = 1.2 + Math.random() * 1.2; // 1.2m to 2.4m streak
        lengths[i] = len;
        speeds[i] = 26 + Math.random() * 12; // 26 - 38 m/s speed

        // Top vertex of streak
        positions[i * 6 + 0] = x;
        positions[i * 6 + 1] = y;
        positions[i * 6 + 2] = z;
        // Bottom vertex of streak (pointing downward along -Z with slight wind tilt)
        positions[i * 6 + 3] = x - 0.12;
        positions[i * 6 + 4] = y - 0.08;
        positions[i * 6 + 5] = Math.max(minZ, z - len);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: 0xa8c8e8,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });

      const lines = new THREE.LineSegments(geom, mat);
      // Disable raycasting completely so it never intercepts clicks or panel placement
      lines.raycast = () => {};
      lines.name = "RainStreaks";

      scene.add(lines);
      rainRef.current = { lines, geom, mat, positions, speeds, lengths, maxHeight, dropCount, span };
      requestShadowUpdate();

      return () => {
        if (rainRef.current) {
          scene.remove(rainRef.current.lines);
          rainRef.current.geom.dispose();
          rainRef.current.mat.dispose();
          rainRef.current = null;
        }
      };
    }, [weatherPreset, isInitialized, localCoords.height, localCoords.vertices]);

    // Solar panel layers: one InstancedMesh per panel set, each rendered with
    // its own configuration, rebuilt from application state. The effect
    // Track active panel layer fingerprint to distinguish geometry changes from color updates
    const lastPanelFingerprintRef = useRef<string | null>(null);

    // Solar panel layers: one InstancedMesh per panel set, each rendered with
    // its own configuration. When only shading metrics / severities change (e.g. sun angle changes),
    // update instance colors in-place to preserve smooth camera performance without mesh churn.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current || !panelLayers) return;
      const scene = sceneRef.current;

      // Fingerprint configuration and panel positions to detect structural/geometric changes
      const currentFingerprint = JSON.stringify(
        panelLayers.map((l) => ({
          config: l.config,
          isPanelSet: l.isPanelSet,
          count: l.panels.length,
          panels: l.panels,
          roofZ: localCoords.height,
        })),
      );

      // Fast in-place shading update if geometry hasn't changed and groups exist
      if (
        lastPanelFingerprintRef.current === currentFingerprint &&
        panelGroupRef.current.length === panelLayers.length
      ) {
        let allUpdated = true;
        for (let i = 0; i < panelLayers.length; i++) {
          const layer = panelLayers[i];
          const group = panelGroupRef.current[i];
          const ok = updatePanelGroupShading(
            group,
            layer.panels,
            layer.shadingSeverities,
            layer.shadingMetrics,
          );
          if (!ok) {
            allUpdated = false;
            break;
          }
        }
        if (allUpdated) {
          return;
        }
      }

      lastPanelFingerprintRef.current = currentFingerprint;

      // Clean up previous groups before rebuilding
      for (const group of panelGroupRef.current) {
        scene.remove(group);
        disposePanelGroup(group);
      }
      panelGroupRef.current = [];

      const groups: THREE.Group[] = [];
      try {
        for (const layer of panelLayers) {
          const isLayerSet = layer.isPanelSet ?? (layer.config.setRows > 1 || layer.config.setCols > 1);
          const group = createPanelGroup(
            layer.panels,
            layer.config.panelTypeId,
            layer.config.mounting,
            layer.config.tiltDeg,
            localCoords.height,
            layer.config.mountHeightM,
            layer.config.legRows,
            layer.config.legCols,
            layer.shadingSeverities,
            layer.shadingMetrics,
            { isPanelSet: isLayerSet, config: layer.config },
          );
          groups.push(group);
          scene.add(group);
        }
      } catch (err) {
        for (const group of groups) {
          scene.remove(group);
          disposePanelGroup(group);
        }
        console.error("[Site3DViewer] Panel update failed:", err);
        return;
      }

      panelGroupRef.current = groups;
      requestShadowUpdate();

      return () => {
        for (const group of groups) {
          scene.remove(group);
          disposePanelGroup(group);
        }
        if (panelGroupRef.current === groups) panelGroupRef.current = [];
      };
    }, [panelLayers, localCoords, isInitialized]);

    const lastFlowFingerprintRef = useRef<string | null>(null);

    // Electricity wiring & flow layer: cable conduits, string combiner junction boxes,
    // and inverter remain permanently mounted whenever panels exist.
    // Animated flow particles are toggled on/off via setFlowActive without rebuilding topology.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;

      if (!panelLayers || panelLayers.length === 0 || layerVisibility?.panels === false) {
        if (electricityFlowRef.current) {
          scene.remove(electricityFlowRef.current.group);
          electricityFlowRef.current.dispose();
          electricityFlowRef.current = null;
        }
        lastFlowFingerprintRef.current = null;
        return;
      }

      // Check structural geometry fingerprint (panels, counts, roof coords)
      const currentFlowFingerprint = JSON.stringify(
        panelLayers.map((l) => ({
          config: l.config,
          count: l.panels.length,
          first: l.panels[0],
          last: l.panels[l.panels.length - 1],
          roofZ: localCoords.height,
        })),
      );

      // If topology already exists and panel geometry has not changed, don't tear down routing
      if (lastFlowFingerprintRef.current === currentFlowFingerprint && electricityFlowRef.current) {
        return;
      }

      lastFlowFingerprintRef.current = currentFlowFingerprint;

      // Tear down existing visualizer before rebuilding
      if (electricityFlowRef.current) {
        scene.remove(electricityFlowRef.current.group);
        electricityFlowRef.current.dispose();
        electricityFlowRef.current = null;
      }

      const terraceRing = localCoords.vertices.map((v) => ({ x: v.x, y: v.y }));
      const flowData = panelLayers.map((l) => ({
        config: l.config,
        panels: l.panels,
        shadingMetrics: l.shadingMetrics,
      }));

      const sun = sunRef.current;
      const sunState = sun ? sunStateAt(sun.samples, sun.timeMinutes) : null;
      const solarAzimuthDeg = sunState ? sunState.azimuthDeg : 180;
      const solarElevationDeg = sunState ? (sunState.night ? 0 : sunState.elevationDeg) : 45;
      const weatherPreset = weatherPresetRef.current ?? "sunny";

      const topology = buildElectricalTopology({
        panelLayers: flowData,
        roofZ: localCoords.height,
        terraceRing,
        solarAzimuthDeg,
        solarElevationDeg,
        weatherPreset,
        obstacles: obstaclesRef.current,
        trees: treesRef.current,
        parapetHeightM: parapetHeightRef.current,
        parapetThicknessM: parapetRef.current?.thicknessM ?? 0.3,
      });

      const isFlowActive = Boolean(layerVisibility?.electricityFlow);
      const handle = createElectricityFlowVisualizer(topology, isFlowActive);
      electricityFlowRef.current = handle;
      scene.add(handle.group);

      return () => {
        if (electricityFlowRef.current === handle) {
          scene.remove(handle.group);
          handle.dispose();
          electricityFlowRef.current = null;
        }
      };
    }, [panelLayers, localCoords, isInitialized, layerVisibility?.panels]);

    // Fast toggle for flow animation without tearing down static cable routing:
    useEffect(() => {
      if (electricityFlowRef.current) {
        electricityFlowRef.current.setFlowActive(Boolean(layerVisibility?.electricityFlow));
      }
    }, [layerVisibility?.electricityFlow]);

    // enerzyAI 3D Scene Branding: building facade wordmark, rooftop paver mark,
    // ground entrance mark, and mounting structure manufacturer badges.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;

      if (brandingGroupRef.current) {
        scene.remove(brandingGroupRef.current);
        disposeBrandingGroup(brandingGroupRef.current);
        brandingGroupRef.current = null;
      }

      const sun = sunRef.current;
      const sunState = sun ? sunStateAt(sun.samples, sun.timeMinutes) : null;
      const isNight = Boolean(sunState ? (sunState.night || (sunState.elevationDeg ?? 0) <= 0) : false);

      const brandingGroup = createSiteBranding({
        localCoords,
        buildingHeight: localCoords.height,
        installationType,
        isNight,
        panelLayers,
      });

      brandingGroupRef.current = brandingGroup;
      scene.add(brandingGroup);

      return () => {
        if (brandingGroupRef.current) {
          scene.remove(brandingGroupRef.current);
          disposeBrandingGroup(brandingGroupRef.current);
          brandingGroupRef.current = null;
        }
      };
    }, [localCoords, installationType, panelLayers, isInitialized]);

    // Manual panel placement preview: a translucent panel follows the pointer
    // on the roof plane, tinted green/red by the SAME validator a commit uses.
    //
    // The preview tracks the pointer inside this effect (no React state per
    // mousemove — AGENTS.md §73); only validation tinting changes. Geometry is
    // built from the active set's real config, so the preview matches the
    // committed panel in footprint, rotation, tilt, mounting height and style.
    // It is suppressed while footprint drawing or an obstacle draft owns the
    // pointer (§11 priority).
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera) return;

      // Disposal collects each distinct geometry/material once: set-mode
      // meshes share one of each, and double-dispose would be wasteful noise.
      const disposePreview = () => {
        const root = panelPreviewMeshRef.current;
        if (!root) return;
        scene.remove(root);
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        root.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (mesh.geometry) geometries.add(mesh.geometry);
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => materials.add(m));
          else if (material) materials.add(material);
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        panelPreviewMeshRef.current = null;
      };
      disposePreview();

      const preview = manualPanelPreview;
      if (!preview) return;
      // Drawing and obstacle drafts own the pointer first.
      if (footprintDrawing || previewObstacle) {
        canvas.style.cursor = "";
        return () => {};
      }

      const config = preview.config;
      // The parent computes the effective rotation (azimuth plus any manual
      // group rotation) so preview and commit can never disagree about it.
      const rotation = preview.rotationDeg;
      const roofZ = localCoords.height;
      let root: THREE.Object3D;
      let material: THREE.MeshStandardMaterial;
      try {
        const isSet = preview.mode === "set" && (config.setRows > 1 || config.setCols > 1);
        const geometry = createPanelUnitGeometry(
          config.panelTypeId,
          config.mounting,
          config.tiltDeg,
          config.mountHeightM,
          config.legRows,
          config.legCols,
          isSet,
        );
        material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          roughness: 0.45,
          metalness: 0.45,
          emissive: new THREE.Color(0x1f9d55),
          emissiveIntensity: 0.55,
        });
        const makePanelMesh = (): THREE.Mesh => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.rotation.z = (rotation * Math.PI) / 180;
          return mesh;
        };
        if (preview.mode === "set") {
          // One shared geometry + material across the whole group: the block
          // previews exactly what a commit would place, at a fraction of the
          // resource cost of per-panel meshes.
          const group = new THREE.Group();
          group.name = "PanelSetPreview";
          const count = Math.max(1, config.setRows * config.setCols);
          for (let i = 0; i < count; i++) group.add(makePanelMesh());
          if (isSet) {
            const frameGeom = createSharedPanelSetFrameGeometry(config);
            const frameMesh = new THREE.Mesh(frameGeom, material);
            frameMesh.name = "PanelSetFramePreview";
            frameMesh.castShadow = false;
            frameMesh.receiveShadow = false;
            frameMesh.rotation.z = (rotation * Math.PI) / 180;
            group.add(frameMesh);
          }
          root = group;
        } else {
          const mesh = makePanelMesh();
          mesh.name = "PanelPreview";
          root = mesh;
        }
      } catch (err) {
        console.error("[Site3DViewer] Panel preview failed:", err);
        return () => {};
      }
      root.visible = false;
      panelPreviewMeshRef.current = root;
      scene.add(root);
      canvas.style.cursor = "crosshair";

      const VALID_EMISSIVE = 0x1f9d55;
      const INVALID_EMISSIVE = 0xd94b4b;

      const terraceRing = localCoords.vertices.map((v) => ({ x: v.x, y: v.y }));
      const raycaster = new THREE.Raycaster();
      const roofPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -roofZ);
      const onMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        camera.updateMatrixWorld(true);
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = new THREE.Vector3();
        // The mathematical roof plane - never an obstacle top - so a preview
        // over an obstacle validates against the roof below it and shows red.
        if (!raycaster.ray.intersectPlane(roofPlane, hit)) {
          root.visible = false;
          return;
        }
        // Validate the WHOLE rotated footprint, not just the cursor point,
        // against every set's panels so cross-set collisions show red too.
        // In set mode the cursor anchors the BLOCK CENTRE and every panel of
        // the candidate group is validated atomically, exactly as a commit
        // would validate it.
        const peers = (panelLayers ?? []).flatMap((layer) => {
          const d = effectivePanelDims(layer.config);
          return layer.panels.map((p) => (
            { x: p.x, y: p.y, rotationDeg: p.rotationDeg, width: d.widthM, length: d.lengthM }
          ));
        });
        const context = {
          terrace: terraceRing,
          obstacles,
          parapetInsetM: preview.insetM,
          peers,
        };
        if (preview.mode === "set") {
          const group = root as THREE.Group;
          const block = setBlockPanels(config, hit.x, hit.y, rotation);
          const count = Math.max(1, config.setRows * config.setCols);
          for (let i = 0; i < count; i++) {
            (group.children[i] as THREE.Mesh).position.set(block[i].x, block[i].y, roofZ);
          }
          if (group.children.length > count) {
            (group.children[count] as THREE.Mesh).position.set(hit.x, hit.y, roofZ);
          }
          root.visible = true;
          const result = validateSetPlacement(hit.x, hit.y, rotation, config, context);
          material.emissive.setHex(result.valid ? VALID_EMISSIVE : INVALID_EMISSIVE);
        } else {
          const mesh = root as THREE.Mesh;
          mesh.position.set(hit.x, hit.y, roofZ);
          root.visible = true;
          const result = validatePanelPlacement(hit.x, hit.y, rotation, config, context);
          material.emissive.setHex(result.valid ? VALID_EMISSIVE : INVALID_EMISSIVE);
        }
      };
      const onLeave = () => {
        root.visible = false;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      return () => {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.style.cursor = "";
        disposePreview();
      };
    }, [manualPanelPreview, panelLayers, obstacles, localCoords, footprintDrawing, previewObstacle, isInitialized]);

    // Translucent tree preview while interactive tree placement is active.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current || !treePlaceActive) return;
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera) return;

      const disposePreview = () => {
        if (treePreviewMeshRef.current) {
          scene.remove(treePreviewMeshRef.current);
          disposeTreeGroup(treePreviewMeshRef.current);
          treePreviewMeshRef.current = null;
        }
      };
      disposePreview();

      let root: THREE.Group;
      try {
        root = createTreePreviewMesh(
          treePlaceType,
          treePlaceHeight,
          treePlaceCanopyWidth,
          treePlaceRotation,
        );
      } catch (err) {
        console.error("[Site3DViewer] Tree preview creation failed:", err);
        return () => {};
      }

      root.visible = false;
      treePreviewMeshRef.current = root;
      scene.add(root);
      canvas.style.cursor = "crosshair";

      const VALID_EMISSIVE = 0x1f9d55;
      const INVALID_EMISSIVE = 0xd94b4b;

      const terraceRing = localCoords.vertices.map((v) => ({ x: v.x, y: v.y }));
      const raycaster = new THREE.Raycaster();
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

      const onMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        camera.updateMatrixWorld(true);
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
          root.visible = false;
          return;
        }

        root.position.set(hit.x, hit.y, 0);
        root.visible = true;

        const candidateTree: Tree = {
          id: "preview",
          type: treePlaceType,
          position: { x: hit.x, y: hit.y },
          height: treePlaceHeight,
          canopyWidth: treePlaceCanopyWidth,
          rotation: treePlaceRotation,
        };

        const result = validateTree(candidateTree, terraceRing, trees ?? []);
        const emissiveColor = result.valid ? VALID_EMISSIVE : INVALID_EMISSIVE;

        root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (mat && mat.emissive) {
              mat.emissive.setHex(emissiveColor);
              mat.emissiveIntensity = 0.55;
            }
          }
        });
      };

      const onLeave = () => {
        root.visible = false;
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onCancelTreePlaceRef.current?.();
        }
      };

      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      window.addEventListener("keydown", onKeyDown);

      return () => {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("keydown", onKeyDown);
        canvas.style.cursor = "";
        disposePreview();
      };
    }, [
      treePlaceActive,
      treePlaceType,
      treePlaceHeight,
      treePlaceCanopyWidth,
      treePlaceRotation,
      trees,
      localCoords,
      isInitialized,
    ]);

    // Translucent draft preview while the obstacle editor holds a draft.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current) return;
      const scene = sceneRef.current;

      if (previewMeshRef.current) {
        scene.remove(previewMeshRef.current);
        disposeObstacleResources(previewMeshRef.current);
        previewMeshRef.current = null;
      }
      if (!previewObstacle) return;

      try {
        const mesh = createObstaclePreviewMesh(previewObstacle, localCoords.height, previewValid);
        previewMeshRef.current = mesh;
        scene.add(mesh);
        requestShadowUpdate();
      } catch (err) {
        console.error("[Site3DViewer] Obstacle preview failed:", err);
      }

      return () => {
        if (previewMeshRef.current) {
          scene.remove(previewMeshRef.current);
          disposeObstacleResources(previewMeshRef.current);
          previewMeshRef.current = null;
        }
      };
    }, [previewObstacle, previewValid, localCoords, isInitialized]);

    // Footprint-drawing overlay: vertex markers, connecting edges and a
    // live cursor edge, all on the roof plane. The overlay (not React state)
    // tracks the pointer so orbiting stays smooth; points arrive through the
    // existing onRoofPlace path. Cleanup removes listeners, restores the
    // cursor and disposes every marker resource.
    useEffect(() => {
      if (!isInitialized || !sceneRef.current || !footprintDrawing) return;
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera) return;

      const box = new THREE.Box3();
      for (const v of localCoordsRef.current.vertices) box.expandByPoint(v);
      const sizeVec = box.getSize(new THREE.Vector3());
      const size = Math.max(sizeVec.x, sizeVec.y, 1);
      const handle = createFootprintMarkerGroup(
        footprintPoints ?? [],
        localCoordsRef.current.height,
        size,
      );
      // A fresh session starts with no live edge, even if a previous session
      // ended with the cursor over the canvas: the handle is new, but the
      // invariant is stated explicitly rather than relying on the constructor.
      handle.setLivePoint(null);
      scene.add(handle.group);
      canvas.style.cursor = "crosshair";

      const raycaster = new THREE.Raycaster();
      const roofPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -localCoordsRef.current.height);
      const onMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        camera.updateMatrixWorld(true);
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = new THREE.Vector3();
        handle.setLivePoint(raycaster.ray.intersectPlane(roofPlane, hit) ? { x: hit.x, y: hit.y } : null);
      };
      const onLeave = () => handle.setLivePoint(null);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      return () => {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.style.cursor = "";
        // Kill the live edge before removing the group, so no visible cursor
        // edge can survive the end of a drawing session for any reason.
        handle.setLivePoint(null);
        scene.remove(handle.group);
        disposeFootprintMarkerGroup(handle);
      };
    }, [footprintDrawing, footprintPoints, localCoords, isInitialized]);

    // Drag-to-move for obstacles (on roof) and trees (on ground).
    // Priority: footprint drawing and manual panel placement win over dragging,
    // and Ctrl/Meta gesture always stays a camera pan. While dragging, OrbitControls
    // is frozen so the gesture moves the object instead of orbiting.
    useEffect(() => {
      if (!isInitialized) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const toNdc = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
      };

      const pickObstacle = (ndc: THREE.Vector2): string | null => {
        const camera = cameraRef.current;
        const group = obstacleGroupRef.current;
        if (!camera || !group) return null;
        camera.updateMatrixWorld(true);
        group.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const targets: THREE.Object3D[] = [];
        for (const child of group.children) {
          if ((child as THREE.Mesh).isMesh) targets.push(child);
        }
        if (targets.length === 0) return null;
        const hits = raycaster.intersectObjects(targets, false);
        return hits.length ? ((hits[0].object.userData.obstacleId as string | undefined) ?? null) : null;
      };

      const pickTree = (ndc: THREE.Vector2): string | null => {
        const camera = cameraRef.current;
        const group = treeGroupRef.current;
        if (!camera || !group) return null;
        camera.updateMatrixWorld(true);
        group.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const targets: THREE.Object3D[] = [];
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) targets.push(child);
        });
        if (targets.length === 0) return null;
        const hits = raycaster.intersectObjects(targets, false);
        if (!hits.length) return null;
        const hitObj = hits[0].object;
        return (hitObj.userData.treeId ?? hitObj.parent?.userData.treeId) as string | null;
      };

      const pickPanel = (ndc: THREE.Vector2): { setId: string; panelIndex: number; panelId: string; x: number; y: number } | null => {
        const camera = cameraRef.current;
        const panelGroups = panelGroupRef.current;
        if (!camera || !panelGroups || panelGroups.length === 0) return null;
        camera.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const panelTargets: THREE.Object3D[] = [];
        for (const pGroup of panelGroups) {
          pGroup.updateMatrixWorld(true);
          pGroup.traverse((child) => {
            if ((child as THREE.InstancedMesh).isInstancedMesh || (child as THREE.Mesh).isMesh) {
              panelTargets.push(child);
            }
          });
        }
        if (panelTargets.length === 0) return null;
        const pHits = raycaster.intersectObjects(panelTargets, false);
        if (pHits.length === 0) return null;
        const hit = pHits[0];
        const hitMesh = hit.object;
        let layerIdx = 0;
        for (let i = 0; i < panelGroups.length; i++) {
          let cur: THREE.Object3D | null = hitMesh;
          let found = false;
          while (cur) {
            if (cur === panelGroups[i]) {
              found = true;
              break;
            }
            cur = cur.parent;
          }
          if (found) {
            layerIdx = i;
            break;
          }
        }
        const layer = panelLayersRef.current ? panelLayersRef.current[layerIdx] : null;
        const instanceIdx = hit.instanceId ?? 0;
        const setId = (layer as any)?.setId ?? (layer?.config ? `panel-set-${layerIdx + 1}` : "panel-set-1");
        const panelObj = layer?.panels[instanceIdx];
        const panelId = (panelObj as any)?.id ?? `p-${instanceIdx}`;
        return {
          setId,
          panelIndex: instanceIdx,
          panelId,
          x: panelObj?.x ?? 0,
          y: panelObj?.y ?? 0,
        };
      };

      const roofHit = (ndc: THREE.Vector2): { x: number; y: number } | null => {
        const camera = cameraRef.current;
        if (!camera) return null;
        camera.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -localCoordsRef.current.height);
        const hit = new THREE.Vector3();
        return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null;
      };

      const groundHit = (ndc: THREE.Vector2): { x: number; y: number } | null => {
        const camera = cameraRef.current;
        if (!camera) return null;
        camera.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const hit = new THREE.Vector3();
        return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null;
      };

      interface MovingEntity {
        type: "obstacle" | "tree" | "panel";
        id: string;
        setId?: string;
        panelIndex?: number;
        origX: number;
        origY: number;
        currentX: number;
        currentY: number;
      }
      let movingEntity: MovingEntity | null = null;

      const cancelMove = () => {
        if (!movingEntity) return;
        const cur = movingEntity;
        if (cur.type === "obstacle") {
          onObstacleDragMoveRef.current?.(cur.id, cur.origX, cur.origY);
          onObstacleDragEndRef.current?.(cur.id);
        } else if (cur.type === "tree") {
          onTreeDragMoveRef.current?.(cur.id, cur.origX, cur.origY);
          onTreeDragEndRef.current?.(cur.id);
        } else if (cur.type === "panel") {
          onMovePanelRef.current?.(cur.setId!, cur.panelIndex!, cur.origX, cur.origY);
          onMovePanelEndRef.current?.(cur.setId!, cur.panelIndex!);
        }
        movingEntity = null;
        setMovingBanner(null);
        if (controlsRef.current) controlsRef.current.enabled = true;
        canvas.style.cursor = "grab";
      };

      const commitMove = (ndc?: THREE.Vector2 | null) => {
        if (!movingEntity) return;
        const cur = movingEntity;
        let placeX = cur.currentX;
        let placeY = cur.currentY;
        if (ndc) {
          const hit = cur.type === "tree" ? groundHit(ndc) : (roofHit(ndc) || groundHit(ndc));
          if (hit) {
            placeX = hit.x;
            placeY = hit.y;
          }
        }
        if (cur.type === "obstacle") {
          onObstacleDragMoveRef.current?.(cur.id, placeX, placeY);
          onObstacleDragEndRef.current?.(cur.id);
        } else if (cur.type === "tree") {
          onTreeDragMoveRef.current?.(cur.id, placeX, placeY);
          onTreeDragEndRef.current?.(cur.id);
        } else if (cur.type === "panel") {
          onMovePanelRef.current?.(cur.setId!, cur.panelIndex!, placeX, placeY);
          onMovePanelEndRef.current?.(cur.setId!, cur.panelIndex!);
        }
        movingEntity = null;
        setMovingBanner(null);
        if (controlsRef.current) controlsRef.current.enabled = true;
        canvas.style.cursor = "grab";
      };

      const handleContextMenu = (event: MouseEvent) => {
        if (activeToolRef.current === "move") {
          event.preventDefault();
        }
      };

      const handleDown = (event: PointerEvent) => {
        if (event.ctrlKey || event.metaKey) return;
        if (activeToolRef.current !== "move") return;
        if (manualPanelPreviewRef.current) return;
        if (previewActiveRef.current || onRoofFinishRef.current) return;

        const ndc = toNdc(event);
        if (!ndc) return;

        // Right-click: pick up object/panel or cancel moving
        if (event.button === 2) {
          event.preventDefault();
          event.stopPropagation();

          if (movingEntity) {
            cancelMove();
            return;
          }

          // Pick up obstacle
          const obsId = pickObstacle(ndc);
          if (obsId) {
            const obs = obstaclesRef.current?.find((o) => o.id === obsId);
            const ox = obs?.position.x ?? 0;
            const oy = obs?.position.y ?? 0;
            movingEntity = {
              type: "obstacle",
              id: obsId,
              origX: ox,
              origY: oy,
              currentX: ox,
              currentY: oy,
            };
            setMovingBanner(`Moving obstacle "${obs?.type ?? obsId}". Left-click to place, Right-click or Esc to cancel.`);
            if (controlsRef.current) controlsRef.current.enabled = false;
            canvas.style.cursor = "grabbing";
            return;
          }

          // Pick up tree
          const tId = pickTree(ndc);
          if (tId) {
            const tr = treesRef.current?.find((t) => t.id === tId);
            const tx = tr?.position.x ?? 0;
            const ty = tr?.position.y ?? 0;
            movingEntity = {
              type: "tree",
              id: tId,
              origX: tx,
              origY: ty,
              currentX: tx,
              currentY: ty,
            };
            setMovingBanner("Moving tree. Left-click to place, Right-click or Esc to cancel.");
            if (controlsRef.current) controlsRef.current.enabled = false;
            canvas.style.cursor = "grabbing";
            return;
          }

          // Pick up solar panel
          const pHit = pickPanel(ndc);
          if (pHit) {
            movingEntity = {
              type: "panel",
              id: pHit.panelId,
              setId: pHit.setId,
              panelIndex: pHit.panelIndex,
              origX: pHit.x,
              origY: pHit.y,
              currentX: pHit.x,
              currentY: pHit.y,
            };
            onMovePanelStartRef.current?.(pHit.setId, pHit.panelIndex);
            setMovingBanner(`Moving connected solar structure. Left-click to place, Right-click or Esc to cancel.`);
            if (controlsRef.current) controlsRef.current.enabled = false;
            canvas.style.cursor = "grabbing";
            return;
          }
          return;
        }

        // Left-click while moving commits the new position
        if (event.button === 0 && movingEntity) {
          event.preventDefault();
          event.stopPropagation();
          commitMove(ndc);
          return;
        }
      };

      const handleMove = (event: PointerEvent) => {
        if (!movingEntity) return;
        const ndc = toNdc(event);
        if (!ndc) return;
        const cur = movingEntity;

        if (cur.type === "obstacle" || cur.type === "panel") {
          const hit = roofHit(ndc) || groundHit(ndc);
          if (hit) {
            cur.currentX = hit.x;
            cur.currentY = hit.y;
            if (cur.type === "obstacle") {
              onObstacleDragMoveRef.current?.(cur.id, hit.x, hit.y);
            } else {
              onMovePanelRef.current?.(cur.setId!, cur.panelIndex!, hit.x, hit.y);
            }
          }
        } else if (cur.type === "tree") {
          const hit = groundHit(ndc);
          if (hit) {
            cur.currentX = hit.x;
            cur.currentY = hit.y;
            onTreeDragMoveRef.current?.(cur.id, hit.x, hit.y);
          }
        }
      };

      const handleWindowPointerUp = (event: PointerEvent) => {
        if (event.button === 0 && movingEntity) {
          event.preventDefault();
          event.stopPropagation();
          const ndc = toNdc(event);
          commitMove(ndc);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && movingEntity) {
          cancelMove();
        }
      };

      canvas.addEventListener("contextmenu", handleContextMenu);
      canvas.addEventListener("pointerdown", handleDown, true);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleWindowPointerUp, true);
      window.addEventListener("keydown", handleKeyDown);

      return () => {
        canvas.removeEventListener("contextmenu", handleContextMenu);
        canvas.removeEventListener("pointerdown", handleDown, true);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleWindowPointerUp, true);
        window.removeEventListener("keydown", handleKeyDown);
        if (movingEntity) {
          cancelMove();
        }
      };
    }, [isInitialized]);

    // Update cursor feedback based on active tool
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (activeTool === "move") {
        canvas.style.cursor = "grab";
      } else if (activeTool === "delete") {
        canvas.style.cursor = "crosshair";
      } else if (activeTool === "select") {
        canvas.style.cursor = "default";
      } else if (!footprintDrawing && !manualPlaceActive && !treePlaceActive) {
        canvas.style.cursor = "";
      }
    }, [activeTool, footprintDrawing, manualPlaceActive, treePlaceActive]);

    // Pointer interaction: a click (press + release without movement) either
    // places the draft footprint on the roof plane or picks an obstacle.
    // Dragging past the threshold is a camera orbit and selects nothing.
    useEffect(() => {
      if (!isInitialized) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      let press: { x: number; y: number; button: number } | null = null;

      const handleDown = (event: PointerEvent) => {
        press = { x: event.clientX, y: event.clientY, button: event.button };
      };

      const handleUp = (event: PointerEvent) => {
        const start = press;
        press = null;
        if (!start || start.button !== 0) return;
        // A Ctrl/Meta gesture is a camera pan by contract, never a click: skip
        // placement and selection entirely so panning cannot place a panel,
        // pick an obstacle or deselect the current one.
        if (event.ctrlKey || event.metaKey) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DRAG_THRESHOLD_PX) {
          return; // camera orbit
        }

        const camera = cameraRef.current;
        const rect = canvas.getBoundingClientRect();
        if (!camera || rect.width <= 0 || rect.height <= 0) return;

        // Three's renderer refreshes camera matrices every frame; the pointer
        // path must not depend on that, so update them before raycasting.
        camera.updateMatrixWorld(true);

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );

        if (previewActiveRef.current || onRoofFinishRef.current) {
          // Draft mode: intersect the horizontal roof plane at building height.
          const roofZ = localCoordsRef.current.height;
          const hit = new THREE.Vector3();
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -roofZ);
          if (raycaster.ray.intersectPlane(plane, hit)) {
            onRoofPlaceRef.current?.(hit.x, hit.y);
          }
          return;
        }

        if (manualPlaceActiveRef.current) {
          // Manual panel session: the same roof-plane click commits a panel
          // through onRoofPlace (the parent validates and reports). Returning
          // here keeps the click from also selecting/deselecting obstacles,
          // so consecutive clicks place consecutive panels.
          const roofZ = localCoordsRef.current.height;
          const hit = new THREE.Vector3();
          const roofPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -roofZ);
          if (raycaster.ray.intersectPlane(roofPlane, hit)) {
            onRoofPlaceRef.current?.(hit.x, hit.y);
          }
          return;
        }

        if (treePlaceActiveRef.current) {
          // Interactive ground tree session: click commits tree position at Z = 0
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
          const hit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(groundPlane, hit)) {
            onGroundPlaceRef.current?.(hit.x, hit.y);
          }
          return;
        }

        const group = obstacleGroupRef.current;
        const targets: THREE.Object3D[] = [];
        if (group) {
          group.updateMatrixWorld(true);
          for (const child of group.children) {
            if ((child as THREE.Mesh).isMesh) targets.push(child);
          }
        }
        const hits = targets.length ? raycaster.intersectObjects(targets, false) : [];
        const id = hits.length ? (hits[0].object.userData.obstacleId as string | undefined) : undefined;

        const treeGroup = treeGroupRef.current;
        const treeTargets: THREE.Object3D[] = [];
        if (treeGroup) {
          treeGroup.updateMatrixWorld(true);
          treeGroup.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) treeTargets.push(child);
          });
        }
        const treeHits = treeTargets.length ? raycaster.intersectObjects(treeTargets, false) : [];
        const treeId = treeHits.length
          ? ((treeHits[0].object.userData.treeId ?? treeHits[0].object.parent?.userData.treeId) as string | undefined)
          : undefined;

        // Raycast solar panels
        const panelGroups = panelGroupRef.current;
        let panelHitInfo: { setId: string; panelIndex: number; panelId: string } | null = null;
        if (panelGroups && panelGroups.length > 0) {
          const panelTargets: THREE.Object3D[] = [];
          for (const pGroup of panelGroups) {
            pGroup.updateMatrixWorld(true);
            pGroup.traverse((child) => {
              if ((child as THREE.InstancedMesh).isInstancedMesh || (child as THREE.Mesh).isMesh) {
                panelTargets.push(child);
              }
            });
          }
          if (panelTargets.length > 0) {
            const pHits = raycaster.intersectObjects(panelTargets, false);
            if (pHits.length > 0) {
              const hit = pHits[0];
              const hitMesh = hit.object;
              let layerIdx = 0;
              for (let i = 0; i < panelGroups.length; i++) {
                let cur: THREE.Object3D | null = hitMesh;
                let found = false;
                while (cur) {
                  if (cur === panelGroups[i]) {
                    found = true;
                    break;
                  }
                  cur = cur.parent;
                }
                if (found) {
                  layerIdx = i;
                  break;
                }
              }
              const layer = panelLayersRef.current ? panelLayersRef.current[layerIdx] : null;
              const instanceIdx = hit.instanceId ?? 0;
              const setId = (layer as any)?.setId ?? (layer?.config ? `panel-set-${layerIdx + 1}` : "panel-set-1");
              const panelObj = layer?.panels[instanceIdx];
              const panelId = (panelObj as any)?.id ?? `p-${instanceIdx}`;
              panelHitInfo = {
                setId,
                panelIndex: instanceIdx,
                panelId,
              };
            }
          }
        }

        // Raycast building / terrace
        let buildingClicked = false;
        if (meshesRef.current?.building) {
          const bHits = raycaster.intersectObject(meshesRef.current.building, false);
          if (bHits.length > 0) {
            buildingClicked = true;
          }
        }

        if (activeToolRef.current === "move") return;

        if (id) {
          if (activeToolRef.current === "delete") {
            onDeleteObstacleRef.current?.(id);
          } else {
            onObstacleSelectRef.current?.(id);
            onTreeSelectRef.current?.(null);
            onPanelSelectRef.current?.(null);
            onBuildingSelectRef.current?.(false);
          }
        } else if (treeId) {
          if (activeToolRef.current === "delete") {
            onDeleteTreeRef.current?.(treeId);
          } else {
            onTreeSelectRef.current?.(treeId);
            onObstacleSelectRef.current?.(null);
            onPanelSelectRef.current?.(null);
            onBuildingSelectRef.current?.(false);
          }
        } else if (panelHitInfo) {
          onPanelSelectRef.current?.(panelHitInfo);
          onObstacleSelectRef.current?.(null);
          onTreeSelectRef.current?.(null);
          onBuildingSelectRef.current?.(false);
        } else if (buildingClicked) {
          onBuildingSelectRef.current?.(true);
          onObstacleSelectRef.current?.(null);
          onTreeSelectRef.current?.(null);
          onPanelSelectRef.current?.(null);
        } else {
          onObstacleSelectRef.current?.(null);
          onTreeSelectRef.current?.(null);
          onPanelSelectRef.current?.(null);
          onBuildingSelectRef.current?.(false);
        }
      };

      canvas.addEventListener("pointerdown", handleDown);
      window.addEventListener("pointerup", handleUp);
      const handleDoubleClick = () => {
        // Draft mode only: mirrors the map selection's double-click finish.
        // Gated on either signal so finishing works from the very first
        // point, before any preview exists to mark draft mode.
        if (previewActiveRef.current || onRoofFinishRef.current) onRoofFinishRef.current?.();
      };
      canvas.addEventListener("dblclick", handleDoubleClick);
      return () => {
        canvas.removeEventListener("pointerdown", handleDown);
        window.removeEventListener("pointerup", handleUp);
        canvas.removeEventListener("dblclick", handleDoubleClick);
      };
    }, [isInitialized]);

    // Render loop: Three.js drives it, React stays out of the frame path
    // (AGENTS.md §73). Damping needs controls.update() every frame.
    useEffect(() => {
      if (!isInitialized || !rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) {
        return;
      }

      // Loop-local bookkeeping: the clock is shared, this bookkeeping is not.
      let lastFrame: number | null = null;
      let lastTick = 0;
      let applied: {
        azimuthDeg: number;
        elevationDeg: number;
        night: boolean;
        weatherPreset: WeatherPreset;
      } | null = null;
      /**
       * Sun step, once per frame:
       * 1. advance the shared clock while playing (bounded, ends at 24:00);
       * 2. report to React at most every SUN_UI_TICK_MS — never per frame;
       * 3. apply the interpolated position to the light and refresh the
       *    shadow map only when the direction, day/night state or weather changed.
       */
      const syncSun = (now: number, currentPreset: WeatherPreset = "sunny") => {
        const renderer = rendererRef.current;
        const sun = sunRef.current;
        const sunLight = sunLightRef.current;
        const ambient = ambientLightRef.current;
        const hemi = hemiLightRef.current;
        if (!renderer || !sun || !sunLight || !ambient) return;

        if (sun.playing) {
          const delta = lastFrame === null ? 0 : Math.min(Math.max((now - lastFrame) / 1000, 0), 0.25);
          if (advanceSunClock(sun, delta)) {
            sun.onEnd?.(); // reached 24:00: the clock stopped itself
          }
          if (now - lastTick >= SUN_UI_TICK_MS) {
            lastTick = now;
            sun.onTick?.(sun.timeMinutes);
          }
        }
        lastFrame = now;

        const state = sunStateAt(sun.samples, sun.timeMinutes);
        const changed =
          !applied ||
          applied.night !== state.night ||
          applied.weatherPreset !== currentPreset ||
          (!state.night &&
            (Math.abs(shortestAngleDelta(applied.azimuthDeg, state.azimuthDeg)) > 0.05 ||
              Math.abs(applied.elevationDeg - state.elevationDeg) > 0.05));
        if (!changed) return;

        applied = {
          azimuthDeg: state.azimuthDeg,
          elevationDeg: state.elevationDeg,
          night: state.night,
          weatherPreset: currentPreset,
        };
        applySunToScene(sunLight, ambient, state, hemi);
        applyWeatherPreset(sunLight, ambient, hemi, currentPreset, state);
        if (brandingGroupRef.current) {
          updateBrandingAdaptiveLighting(brandingGroupRef.current, state.night);
        }
        renderer.shadowMap.needsUpdate = true;
      };

      let lastRainTime: number | null = null;
      let lastFlowTime: number | null = null;
      let lastBirdsTime: number | null = null;
      let lastCloudsTime: number | null = null;
      let lastFlowIntensityCheck = 0;
      let lastAppliedSunState: { azimuthDeg: number; elevationDeg: number; weatherPreset: string } | null = null;

      const animate = (now: number) => {
        animationFrameRef.current = requestAnimationFrame(animate);
        controlsRef.current?.update();
        // Containment runs after update(): OrbitControls rebuilds its offset
        // from camera.position each frame, so a clamp applied here persists
        // through the next frame instead of being overwritten.
        const controls = controlsRef.current;
        if (controls) keepCameraOutsideBox(cameraRef.current!, controls, buildingBoxRef.current);
        const activePreset = weatherPresetRef.current ?? "sunny";
        syncSun(now, activePreset);

        // Advance rain simulation if active
        if (rainRef.current) {
          const dt = lastRainTime === null ? 0.016 : Math.min(Math.max((now - lastRainTime) / 1000, 0), 0.1);
          lastRainTime = now;
          const { geom, positions, speeds, lengths, maxHeight, dropCount, span } = rainRef.current;
          const windX = -2.2;
          const windY = -1.4;
          const buildingRing = localCoordsRef.current.vertices.map((v) => ({ x: v.x, y: v.y }));
          const roofZ = localCoordsRef.current.height;

          for (let i = 0; i < dropCount; i++) {
            const idx = i * 6;
            const speed = speeds[i];
            const len = lengths[i];

            let topZ = positions[idx + 2] - speed * dt;
            let topX = positions[idx + 0] + windX * dt;
            let topY = positions[idx + 1] + windY * dt;

            const isOverBuilding = pointInPolygon({ x: topX, y: topY }, buildingRing);
            const minZ = isOverBuilding ? roofZ : 0;

            if (topZ < minZ) {
              topZ = maxHeight + Math.random() * 4;
              topX = (Math.random() - 0.5) * span;
              topY = (Math.random() - 0.5) * span;
            }

            positions[idx + 0] = topX;
            positions[idx + 1] = topY;
            positions[idx + 2] = topZ;

            // Slanted bottom along wind vector
            positions[idx + 3] = topX + windX * (len / speed);
            positions[idx + 4] = topY + windY * (len / speed);
            positions[idx + 5] = Math.max(minZ, topZ - len);
          }
          geom.attributes.position.needsUpdate = true;
        } else {
          lastRainTime = null;
        }

        // Advance animated electricity flow particles along cable routes
        // Advance animated electricity flow particles along cable routes when layer is visible
        if (electricityFlowRef.current) {
          const isFlowActive = Boolean(layerVisibilityRef.current?.electricityFlow);
          if (isFlowActive) {
            const dt = lastFlowTime === null ? 0.016 : Math.min(Math.max((now - lastFlowTime) / 1000, 0.001), 0.1);
            electricityFlowRef.current.update(dt);
          }

          // Dynamically sync flow particle intensities to sun angle and weather (throttled to ~5-10Hz)
          // Uses fast scalar sun scaling without rebuilding topology or running pathfinding in rAF
          if (now - lastFlowIntensityCheck >= 150) {
            lastFlowIntensityCheck = now;
            const currentSun = sunRef.current;
            const sState = currentSun ? sunStateAt(currentSun.samples, currentSun.timeMinutes) : null;
            const curAz = sState ? sState.azimuthDeg : 180;
            const curEl = sState && !sState.night ? sState.elevationDeg : 0;
            const curPreset = weatherPresetRef.current ?? "sunny";

            const sunMoved =
              lastAppliedSunState === null ||
              Math.abs(lastAppliedSunState.azimuthDeg - curAz) > 0.5 ||
              Math.abs(lastAppliedSunState.elevationDeg - curEl) > 0.5 ||
              lastAppliedSunState.weatherPreset !== curPreset;

            if (sunMoved) {
              lastAppliedSunState = { azimuthDeg: curAz, elevationDeg: curEl, weatherPreset: curPreset };
              electricityFlowRef.current.updateSunState(curAz, curEl, curPreset);
            }
          }
        }
        lastFlowTime = now;

        // Advance natural flying bird animation in sky when layer is active
        const isBirdsActive = Boolean(layerVisibilityRef.current?.birds);
        if (birdsRef.current && isBirdsActive) {
          const dt = lastBirdsTime === null ? 0.016 : Math.min(Math.max((now - lastBirdsTime) / 1000, 0.001), 0.1);
          const roofZ = localCoordsRef.current ? localCoordsRef.current.height : 12;
          birdsRef.current.update(dt, roofZ);
        }
        lastBirdsTime = now;

        // Advance dynamic 3D clouds animation in sky when layer is active
        const isCloudsActive = Boolean(layerVisibilityRef.current?.clouds);
        if (cloudsRef.current && isCloudsActive) {
          const dt = lastCloudsTime === null ? 0.016 : Math.min(Math.max((now - lastCloudsTime) / 1000, 0.001), 0.1);
          const roofZ = localCoordsRef.current ? localCoordsRef.current.height : 12;
          cloudsRef.current.update(dt, roofZ);
        }
        lastCloudsTime = now;

        // When moving dynamic shadow casters (flying birds, drifting clouds) or sun playback are active,
        // continuously refresh shadow maps so their moving shadows project onto the roof and ground
        const dynamicShadows =
          (isBirdsActive && birdsRef.current) ||
          (isCloudsActive && cloudsRef.current) ||
          sunRef.current?.playing;
        if (dynamicShadows && rendererRef.current) {
          rendererRef.current.shadowMap.needsUpdate = true;
        }

        rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
      };

      // Start through rAF so every timestamp comes from the same clock —
      // deltas between frames stay valid whatever the host provides.
      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }, [isInitialized]);

    // Keep the viewport and projection in step with its container.
    useEffect(() => {
      if (!isInitialized) return;
      const container = containerRef.current;
      if (!container) return;

      const handleResize = () => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        const el = containerRef.current;
        if (!renderer || !camera || !el) return;
        const width = el.clientWidth;
        const height = el.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setSize(width, height, false);
        updateCameraAspect(camera, width, height);
      };

      handleResize();
      const rafId = requestAnimationFrame(handleResize);
      const timerId = setTimeout(handleResize, 80);

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      window.addEventListener("resize", handleResize);

      return () => {
        cancelAnimationFrame(rafId);
        clearTimeout(timerId);
        resizeObserver.disconnect();
        window.removeEventListener("resize", handleResize);
      };
    }, [isInitialized, className]);

    // Imperative handle for parents that want to re-frame the camera.
    useEffect(() => {
      if (!ref) return;
      const handle: Site3DViewerHandle = {
        resetCamera: () => {
          if (!cameraRef.current || !controlsRef.current) return;
          const framing = framingFromBox(buildingBounds(localCoordsRef.current));
          frameCamera(cameraRef.current, framing);
          frameControls(controlsRef.current, framing);
          controlsRef.current.update();
        },
        exportGLB: async (filename?: string) => {
          return exportSolarInstallation3D({
            localCoords: localCoordsRef.current,
            installationType,
            parapet,
            obstacles,
            panelLayers,
            trees,
            filename,
            liveScene: {
              building: meshesRef.current?.building,
              parapet: meshesRef.current?.parapet,
              obstacleGroup: obstacleGroupRef.current,
              panelGroups: panelGroupRef.current,
              treeGroup: treeGroupRef.current,
              usableAreaBoundary: usableAreaBoundaryRef.current?.group,
              brandingGroup: brandingGroupRef.current,
            },
          });
        },
      };
      if (typeof ref === "function") ref(handle);
      else if (ref && typeof ref === "object") ref.current = handle;
      return () => {
        if (typeof ref === "function") ref(null);
        else if (ref && typeof ref === "object") ref.current = null;
      };
    }, [ref, installationType, parapet, obstacles, panelLayers, trees]);

    if (webglError) {
      return (
        <div
          ref={containerRef}
          className={`site-3d-viewer site-3d-viewer--error ${className}`}
          style={style}
          role="alert"
        >
          <div className="site-3d-viewer__message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
              <line x1="6" y1="9" x2="18" y2="9" strokeDasharray="4 4" />
            </svg>
            <p>{webglError}</p>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className={`site-3d-viewer ${className}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          ...style,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="3D building model. Drag to rotate, scroll/pinch to zoom, click to select an obstacle."
        />
        {movingBanner && (
          <div
            style={{
              position: "absolute",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(15, 23, 42, 0.94)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 500,
              zIndex: 30,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              pointerEvents: "none",
            }}
          >
            <Move size={16} />
            <span>{movingBanner}</span>
          </div>
        )}
        {!isInitialized && (
          <div className="site-3d-viewer__loading">Loading 3D view…</div>
        )}
      </div>
    );
  },
);
