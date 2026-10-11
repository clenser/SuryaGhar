/**
 * ModelPanel - 3D Building Model Stage
 *
 * Stage 2 (Model): asks for the building height, then shows the terrace
 * extruded into a correctly scaled 3D building, plus the rooftop obstacle
 * editor (Phase 3).
 *
 * AGENTS.md §50: stage progression — Model follows Select (confirmed terrace).
 * AGENTS.md §4 / §52: the geographic polygon stays authoritative; everything
 * shown here (area, perimeter, extents, extrusion, obstacle footprints)
 * derives from projected metric geometry, never from screen pixels or the
 * Three.js mesh.
 * AGENTS.md §40 / §72: obstacle records live in application state; the
 * viewport only renders them.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, ArrowRight, Plus, Pencil, Trash2, AlertTriangle, Sun, TreePine, Eye, Moon, Grid3x3, X } from "lucide-react";
import { BACKEND_WAITING_LABEL } from "../../hooks/useBackendStatus";
import type { LngLat, PolygonMetrics } from "../../lib/geo";
import { formatArea } from "../../lib/geo";
import { createBuildingModel } from "../../lib/3d/building";
import {
  DEFAULT_PARAPET_HEIGHT_M,
  DEFAULT_PARAPET_THICKNESS_M,
  MAX_PARAPET_CLEARANCE_M,
  MAX_PARAPET_HEIGHT_M,
  MIN_PARAPET_CLEARANCE_M,
  MIN_PARAPET_HEIGHT_M,
  PARAPET_CLEARANCE_M,
  offsetPolygonInward,
  validateParapetHeight,
} from "../../lib/3d/geometry";
import {
  createObstacleId,
  draftToObstacle,
  emptyObstacleDraft,
  findInvalidObstacles,
  footprintsOverlap,
  formatObstacleDimensions,
  obstacleToDraft,
  obstacleTypeLabel,
  splitPolygon,
  validateFootprint,
  validateObstacle,
  type Obstacle,
  type ObstacleDraft,
  type ObstacleType,
  type Point2,
} from "../../lib/3d/obstacles";
import {
  type Tree,
  type TreeDraft,
  type TreeType,
  TREE_TYPES,
  createTreeId,
  draftToTree,
  emptyTreeDraft,
  formatTreeDimensions,
  treeToDraft,
  treeTypeDefinition,
  treeTypeLabel,
  validateTree,
} from "../../lib/3d/treeTypes";
import { Site3DViewer, type Site3DViewerHandle } from "../3d/Site3DViewer";
import { ObstacleEditor } from "../3d/ObstacleEditor";
import { TreeEditor } from "../3d/TreeEditor";
import { SunControls } from "../3d/SunControls";
import { SolarPanelSection } from "../3d/SolarPanelSection";
import { ViewportToolbar, type ViewportTool } from "../3d/ViewportToolbar";
import { CollapsibleSection } from "../3d/CollapsibleSection";
import { BuildingHeightPanel } from "./BuildingHeightPanel";
import { useSunSimulation } from "../../hooks/useSunSimulation";
import { formatTimezoneLabel, formatSiteDateTime, localWallClockToUtc } from "../../lib/solar";
import type { SunSample } from "../../lib/solar";
import type { PlacedPanel } from "../../lib/3d/panelPlacement";
import { panelRotationForAzimuth, placePanels, rectangleCorners } from "../../lib/3d/panelPlacement";
import {
  autoPlaceAllSets,
  createPanelSetId,
  defaultPanelSet,
  findInvalidPanels,
  maxSetGrid,
  reindexSet,
  totalCapacityKw as totalSetsCapacityKw,
  validatePanelPlacement,
  validateSetPlacement,
  type PanelSet,
} from "../../lib/3d/panelSets";
import { effectivePanelDims } from "../../lib/3d/panels";
import {
  clearSkyFallbackWeather,
  computePanelEnergy,
} from "../../lib/3d/panelEnergy";
import {
  DEFAULT_PANEL_CONFIG,
  PANEL_SETBACK_MAX_M,
  PANEL_SETBACK_MIN_M,
  validatePanelConfig,
  type PanelLayoutConfig,
} from "../../lib/3d/panels";

interface ModelPanelProps {
  vertices: LngLat[];
  metrics: PolygonMetrics | null;
  buildingHeight: number | null;
  onSetHeight: (height: number) => void;
  onContinue: () => void;
  backendReady: boolean;
  /**
   * Selected place's country. Used only to resolve the site's timezone for
   * the sun simulation â€” never to assume a shared offset for every site.
   */
  siteCountry?: string | null;
  /** Rooftop obstacles from application state */
  obstacles?: Obstacle[];
  onAddObstacle?: (obstacle: Obstacle) => void;
  onUpdateObstacle?: (obstacle: Obstacle) => void;
  onRemoveObstacle?: (id: string) => void;
  /** Parapet height above the roof (m); null falls back to the default. */
  parapetHeight?: number | null;
  onSetParapetHeight?: (height: number) => void;
  /**
   * Required clear gap between the parapet inner face and a solar
   * panel (m); null falls back to the default. Separate from the
   * parapet wall thickness and from the panel edge setback.
   */
  parapetClearance?: number | null;
  onSetParapetClearance?: (clearance: number) => void;
  /** 3D design workspace visible (panel is the primary surface) */
  designMode?: boolean;
  /** Deliberate transition into the design workspace (no auto-entry) */
  onEnterDesign?: () => void;
  /** Deliberate return to the full-map workspace */
  onExitDesign?: () => void;
  /** Optional viewport tool state */
  initialActiveTool?: ViewportTool;
}

export function ModelPanel({
  vertices,
  metrics,
  buildingHeight,
  onSetHeight,
  onContinue,
  backendReady,
  siteCountry = null,
  obstacles = [],
  onAddObstacle,
  onUpdateObstacle,
  onRemoveObstacle,
  parapetHeight = null,
  onSetParapetHeight,
  parapetClearance = null,
  onSetParapetClearance,
  designMode = false,
  onEnterDesign,
  onExitDesign,
}: ModelPanelProps) {
  // True while the user is back-editing an existing height.
  const [editingHeight, setEditingHeight] = useState(false);
  // Imperative camera reset for the "return to default view" action.
  const viewerRef = useRef<Site3DViewerHandle | null>(null);

  // Obstacle editor state (application state, never Three.js objects).
  const [obstacleMode, setObstacleMode] = useState<"idle" | "adding" | "editing">("idle");
  const [obstacleDraft, setObstacleDraft] = useState<ObstacleDraft>(() => emptyObstacleDraft());
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [obstacleSubmitted, setObstacleSubmitted] = useState(false);

  // Interactive footprint drawing (Custom obstacles): absolute local-metre
  // points collected from roof clicks. Null means not drawing.
  const [footPoints, setFootPoints] = useState<Point2[] | null>(null);
  const [footError, setFootError] = useState<string | null>(null);
  const drawing = footPoints !== null;

  // Sun simulation (Phase 4): the selected day is sampled once per
  // (site, date, timezone) and shared with the viewport as a mutable clock,
  // so the animation never drives React state per frame.
  const sun = useSunSimulation({
    latitude: metrics?.centroid.lat ?? null,
    longitude: metrics?.centroid.lng ?? null,
    siteCountry,
  });

  // Panel configuration (Phase 5): React state is the source of truth.
  // Placement is derived from (terrace, obstacles, config) so it can never go
  // stale; the revision counter forces an explicit recalculation on demand.
  // Panels are strictly opt-in: a fresh building never auto-populates the
  // roof â€” the user explicitly enables placement first.
  //
  // M3: the configuration lives in PANEL SETS. The first set is seeded from
  // the old single-config defaults so a fresh project behaves exactly as
  // before; more sets add arrays with their own tilt/height/orientation.
  const [panelSets, setPanelSets] = useState<PanelSet[]>(() => [defaultPanelSet(createPanelSetId())]);
  const [activeSetId, setActiveSetId] = useState<string>("panel-set-1");
  /** Weather preset controlling visual lighting only (does not affect energy). */
  const [weatherPreset, setWeatherPreset] = useState<"sunny" | "cloudy" | "rainy">("sunny");
  /**
   * Ground-based trees from application state (metres). Re-rendered whenever this array
   * changes — Three.js never becomes the source of truth.
   */
  const [trees, setTrees] = useState<Tree[]>([]);
  /**
   * Tree currently highlighted in the viewport for selection.
   */
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [treeMode, setTreeMode] = useState<"idle" | "adding" | "editing">("idle");
  const [treeDraft, setTreeDraft] = useState<TreeDraft>(() => emptyTreeDraft("broadleaf"));
  const [treeSubmitted, setTreeSubmitted] = useState(false);
  const [treePlaceActive, setTreePlaceActive] = useState(false);
  const [selectedTreeType, setSelectedTreeType] = useState<TreeType>("broadleaf");
  const [treePlaceHeight, setTreePlaceHeight] = useState(8.0);
  const [treePlaceCanopyWidth, setTreePlaceCanopyWidth] = useState(5.0);
  const [treePlaceRotation, setTreePlaceRotation] = useState(0);
  const [treePlacementStatus, setTreePlacementStatus] = useState<string | null>(null);
  /**
   * Manual-placement mode. While on, a roof click places a panel (validated by
   * the shared validator) instead of being read as an obstacle pick. Turned
   * off automatically when drawing an obstacle or opening the editor, so the
   * two interactions can never fight over the same click.
   */
  const [manualPlaceActive, setManualPlaceActive] = useState(false);
  /**
   * Manual placement granularity. `single` keeps the existing one-panel
   * click workflow untouched; `set` arms the whole-block workflow. Defaults
   * to single so nothing about the current behavior changes unprompted.
   */
  const [manualPlaceMode, setManualPlaceMode] = useState<"single" | "set">("single");
  /**
   * Extra group rotation (degrees, quarter turns) applied on top of the
   * set-azimuth rotation for set placement and its preview. Cycled by an
   * explicit Rotate control, never implicitly.
   */
  const [setExtraRotation, setSetExtraRotation] = useState(0);
  /** Indices of the most recently committed manual set, for set-level undo. */
  const [lastSetCommit, setLastSetCommit] = useState<{ setId: string; indices: number[] } | null>(null);
  const [panelRevision, setPanelRevision] = useState(0);
  const [manualStatus, setManualStatus] = useState<string | null>(null);
  // Active viewport tool (for contextual toolbar)
  const [activeTool, setActiveTool] = useState<ViewportTool | null>("select");
  // Escape cancels the active transient tool: drawing first, then manual
  // panel placement, then the obstacle editor. One listener with cleanup, and
  // it reads current state through refs-safe values because the effect
  // re-subscribes whenever the mode flags change.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (footPoints !== null) {
        cancelDrawing();
      } else if (manualPlaceActive) {
        setManualPlaceActive(false);
      } else if (treePlaceActive) {
        setTreePlaceActive(false);
      } else if (obstacleMode !== "idle") {
        closeObstacleEditor();
      } else if (treeMode !== "idle") {
        closeTreeEditor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [footPoints, manualPlaceActive, treePlaceActive, obstacleMode, treeMode]);
  // Repair an orphaned active-set id (remounts, races): the id must always
  // resolve, otherwise config edits would silently match nothing.
  useEffect(() => {
    if (panelSets.length > 0 && !panelSets.some((s) => s.id === activeSetId)) {
      setActiveSetId(panelSets[0].id);
    }
  }, [panelSets, activeSetId]);
  const [panelsEnabled, setPanelsEnabled] = useState(false);
  // Inspector collapsed state (mobile)
  const [inspectorCollapsed] = useState(false);

  /** The set the inspector is currently editing. */
  const activeSet = panelSets.find((s) => s.id === activeSetId) ?? panelSets[0] ?? null;
  /**
   * Effective rotation for manual set placement and its preview: the set
   * azimuth plus the explicit group rotation, normalised to [0, 360).
   */
  const manualSetRotation = activeSet
    ? (((panelRotationForAzimuth(activeSet.config.azimuthDeg) + setExtraRotation) % 360) + 360) % 360
    : 0;
  const timezoneLabel = useMemo(() => {
    try {
      return formatTimezoneLabel(
        sun.timezone,
        localWallClockToUtc(sun.date, Math.round(sun.timeMinutes), sun.timezone),
      );
    } catch {
      return sun.timezone;
    }
  }, [sun.date, sun.timeMinutes, sun.timezone]);

  const dateTimeLabel = useMemo(() => {
    try {
      return formatSiteDateTime(sun.date, Math.round(sun.timeMinutes), sun.timezone);
    } catch {
      return null;
    }
  }, [sun.date, sun.timeMinutes, sun.timezone]);

  // Terrace polygon + height â†’ local 3D coordinates (metres, centroid at origin).
  const model = useMemo(() => {
    if (buildingHeight === null || vertices.length < 3) return null;
    try {
      return createBuildingModel(vertices, buildingHeight);
    } catch (err) {
      console.error("[ModelPanel] Building model creation failed:", err);
      return null;
    }
  }, [vertices, buildingHeight]);

  // Roof ring in local metres â€” the authoritative boundary for obstacle checks.
  const terraceRing = useMemo(
    () => (model ? model.coords.vertices.map((v) => ({ x: v.x, y: v.y })) : []),
    [model],
  );

  // Parapet: resolved height (explicit value or safe default), local
  // draft for the input, and the usability inset it imposes on the roof.
  // The roof elevation itself never moves: parapet adds upward from the roof surface.
  const parapetHeightM = parapetHeight ?? DEFAULT_PARAPET_HEIGHT_M;
  const [parapetDraft, setParapetDraft] = useState<string | null>(null);
  const parapetError = useMemo(() => {
    if (parapetDraft === null) return null;
    return validateParapetHeight(Number(parapetDraft));
  }, [parapetDraft]);
  const [parapetClearanceDraft, setParapetClearanceDraft] = useState<string | null>(null);
  const parapetClearanceError = useMemo(() => {
    if (parapetClearanceDraft === null) return null;
    const parsed = Number(parapetClearanceDraft);
    if (!Number.isFinite(parsed)) return "Parapet clearance must be a valid number";
    if (parsed < MIN_PARAPET_CLEARANCE_M || parsed > MAX_PARAPET_CLEARANCE_M) {
      return `Parapet clearance must be between ${MIN_PARAPET_CLEARANCE_M} and ${MAX_PARAPET_CLEARANCE_M} m`;
    }
    return null;
  }, [parapetClearanceDraft]);
  /**
   * Resolved panel-to-parapet clearance (m): the user-configured
   * gap kept between the parapet's INNER face and a panel. The
   * wall thickness is a separate physical fact and never folded
   * into this value.
   */
  const parapetClearanceM = parapetClearance ?? PARAPET_CLEARANCE_M;
  /**
   * Panel edge setback: clearance from the roof edge kept by panel placement.
   * Edits the active set's shared configuration (the same value the panel
   * section, preview, commit and auto-place paths all read), so there is one
   * source of truth and stored manual panels are never moved by the edit.
   */
  const [setbackDraft, setSetbackDraft] = useState<string | null>(null);
  const setbackError = useMemo(() => {
    if (setbackDraft === null) return null;
    const parsed = Number(setbackDraft);
    if (!Number.isFinite(parsed)) return "Setback must be a valid number";
    if (parsed < PANEL_SETBACK_MIN_M || parsed > PANEL_SETBACK_MAX_M) {
      return `Setback must be between ${PANEL_SETBACK_MIN_M} and ${PANEL_SETBACK_MAX_M} m`;
    }
    return null;
  }, [setbackDraft]);
  /**
   * Total panel boundary from the RAW roof edge: the physical
   * parapet wall (its inner face sits `DEFAULT_PARAPET_THICKNESS_M`
   * inside the terrace ring — createParapetMeshes builds the wall
   * on that ring) plus the configured clear gap beyond it. Panel
   * placement validates against the RAW terrace ring with this
   * inset, so a panel corner exactly `parapetClearanceM` clear of
   * the inner face is accepted — the wall and the gap never
   * double-count.
   */
  const parapetInsetM = DEFAULT_PARAPET_THICKNESS_M + parapetClearanceM;

  /**
   * Contact boundary for OBSTACLES: the inner face of the parapet wall.
   * Obstacles may sit flush against this (fused to the parapet); the
   * panel clearance above stays reserved for panels, so loosening the
   * panel gap does not silently let obstacles eat into the wall.
   */
  const parapetContactM = DEFAULT_PARAPET_THICKNESS_M;

  // Inner usable roof ring for the auto-placement lattice and the
  // roof-derived set limits: the raw footprint inset by wall + panel
  // clearance. Falls back to the raw terrace when the offset
  // degenerates (narrow sections), so placement never crashes.
  const usableRing = useMemo(() => {
    if (terraceRing.length < 3) return terraceRing;
    return offsetPolygonInward(terraceRing, parapetInsetM) ?? terraceRing;
  }, [terraceRing, parapetInsetM]);

  /**
   * Live re-validation of the active set's stored panels. A relevant change
   * (spacing, tilt, an obstacle, a reshaped terrace, the parapet
   * clearance) can invalidate a set that was placed by hand; nothing is
   * moved automatically - the reason is reported and the user repositions
   * or recalculates deliberately (AGENTS.md 37, 51).
   *
   * Validation runs against the RAW terrace ring: the setback rule
   * measures from the roof edge and the parapet rule measures the
   * configured gap from the parapet inner face — two independent
   * rules over the same boundary.
   */
  const activeSetProblems = useMemo(() => {
    if (!activeSet || activeSet.panels.length === 0) return null;
    const invalid = findInvalidPanels(activeSet, {
      terrace: terraceRing,
      obstacles,
      parapetInsetM,
      parapetClearanceM,
    });
    if (invalid.length === 0) return null;
    return `${invalid.length} panel${invalid.length === 1 ? "" : "s"} of ${activeSet.name} no longer ${
      invalid.length === 1 ? "fits" : "fit"
    } the roof, an obstacle, or the parapet clearance. Reposition or recalculate.`;
  }, [activeSet, terraceRing, obstacles, parapetInsetM, parapetClearanceM]);

  /**
   * Roof-derived upper bounds for the set rows/columns.
   *
   * Guides the steppers so the user cannot request a group that obviously
   * cannot fit. Approximate by design (usable-ring bounding box plus the
   * configured spacing) - the polygon-level validator still has the final
   * word on irregular roofs, and rejection always comes with a reason.
   */
  const setLimits = useMemo(() => {
    if (!activeSet || usableRing.length < 3) return { maxRows: null, maxCols: null };
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const ring of usableRing) {
      if (ring.x < minX) minX = ring.x;
      if (ring.x > maxX) maxX = ring.x;
      if (ring.y < minY) minY = ring.y;
      if (ring.y > maxY) maxY = ring.y;
    }
    const limits = maxSetGrid(activeSet.config, maxX - minX, maxY - minY);
    return { maxRows: limits.maxRows, maxCols: limits.maxCols };
  }, [activeSet, usableRing]);

  // Transparency (X-ray) mode: see the roof boundary against interior
  // structures. Mutates materials in place via rebuild â€” no scene reset.
  const [xray, setXray] = useState(false);

  // Stable parapet descriptor: a fresh literal every render would rebuild
  // the building meshes on each parent render.
  const parapetModel = useMemo(
    () => ({ heightM: parapetHeightM, thicknessM: DEFAULT_PARAPET_THICKNESS_M }),
    [parapetHeightM],
  );

  // Geographic anchor for the viewer's satellite ground: stable identity so
  // the texture is fetched once per site (module cache), never per render.
  const siteAnchor = useMemo(
    () =>
      model
        ? { ring: vertices, originUtm: { ...model.coords.centroidUtm } }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model],
  );

  // Deterministic panel placement, derived from the roof, the obstacles and
  // the each set's configuration â€” recomputed when any of them change (the
  // revision counter backs the explicit "Recalculate" action). Disabled by
  // default: an empty configuration produces zero panel meshes, never a full
  // roof. EVERY set is placed with the SAME placePanels lattice, so auto and
  // manual placement share one geometric rule set.
  const placements = useMemo(() => {
    if (!panelsEnabled) return panelSets.map(() => ({ panels: [], reason: null as string | null }));
    return panelSets.map((set) => {
      const error = validatePanelConfig(set.config);
      if (error) return { panels: [], reason: error };
      return placePanels({ terrace: usableRing, obstacles, config: set.config });
    });
  }, [usableRing, obstacles, panelSets, panelRevision, panelsEnabled]);

  // Capacity: count Ã— watts / 1000, across every set.
  const panelCount = panelsEnabled
    ? panelSets.reduce((sum, set) => sum + set.panels.length, 0)
    : 0;
  const capacityKw = panelsEnabled
    ? totalSetsCapacityKw(panelSets)
    : 0;

  // Every placed panel with the set it belongs to, flattened for the energy
  // simulation (which prices every panel with the active set configuration).
  const allPanels = useMemo(() => {
    if (!panelsEnabled) return { config: DEFAULT_PANEL_CONFIG, panels: [] as PlacedPanel[] };
    const first = panelSets[0]?.config ?? DEFAULT_PANEL_CONFIG;
    return {
      config: first,
      panels: panelSets.flatMap((set) =>
        set.panels.map((p) => ({ index: 0, x: p.x, y: p.y, rotationDeg: p.rotationDeg })),
      ),
    };
  }, [panelsEnabled, panelSets]);

  // Per-set viewport layers: each set renders with its OWN configuration, so
  // a slider change updates exactly that set's meshes - tilt, azimuth, height
  // and dimensions flow into geometry - and never touches another set's.
  // Stable shape (null while disabled) so the viewer effect cleans up any
  // previous groups and renders no panels.
  const panelLayers = useMemo(() => {
    if (!panelsEnabled) return null;
    return panelSets.map((set) => ({
      config: set.config,
      panels: set.panels.map(
        (p) => ({ index: 0, x: p.x, y: p.y, rotationDeg: p.rotationDeg }) as PlacedPanel,
      ),
    }));
  }, [panelsEnabled, panelSets]);

  /**
   * One sun sample per clock hour, in local wall-clock order.
   *
   * Derived from the same real solar-position model the 3D viewport uses
   * (`sampleSolarDay`), so the sun direction in the simulation matches the
   * sun the user sees â€” and changing the date in SunControls re-samples both.
   */
  const hourlySun = useMemo(() => {
    if (!sun.samples) return [];
    const byHour = new Map<number, SunSample>();
    for (const sample of sun.samples) {
      const hour = Math.floor(sample.minutes / 60);
      // Keep the sample closest to each hour's midpoint (more representative).
      const existing = byHour.get(hour);
      if (!existing || Math.abs(sample.minutes - (hour * 60 + 30)) < Math.abs(existing.minutes - (hour * 60 + 30))) {
        byHour.set(hour, sample);
      }
    }
    return [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, sample]) => ({ hour, azimuthDeg: sample.azimuthDeg, elevationDeg: sample.elevationDeg }));
  }, [sun.samples]);

  const energy = useMemo(() => {
    if (!panelsEnabled || !activeSet || allPanels.panels.length === 0 || hourlySun.length === 0) return null;
    const simulated = allPanels.panels.map((p) => ({
      x: p.x, y: p.y, rotationDeg: p.rotationDeg, config: activeSet.config,
    }));
    const weather = clearSkyFallbackWeather(
      hourlySun.map((s) => ({ hour: s.hour, solarAzimuthDeg: s.azimuthDeg, solarElevationDeg: s.elevationDeg })),
    );
    return computePanelEnergy(simulated, weather, obstacles, DEFAULT_PARAPET_THICKNESS_M, terraceRing);
  }, [panelsEnabled, activeSet, allPanels.panels, hourlySun, obstacles, terraceRing]);

  // Mounting is Flat Roof only for now: any non-flat patch (stale state,
  // future callers) is normalised back to flat; the engine keeps supporting
  // other types internally for later milestones.
  const handlePanelConfigChange = (patch: Partial<PanelLayoutConfig>) => {
    if (!activeSet) return;
    const { mounting, ...rest } = patch;
    if (rest.setbackM !== undefined) {
      // A refusal message describes the previous configuration; the next
      // hover/click revalidates live against the new one, so the obsolete
      // text must not linger as if it still applied.
      setManualStatus(null);
    }
    const nextConfig = {
      ...activeSet.config,
      ...rest,
      mounting: mounting === undefined ? activeSet.config.mounting : "flat",
    };
    const valid = validatePanelConfig(nextConfig) === null;
    setPanelSets((sets) =>
      sets.map((set) => {
        if (set.id !== activeSetId) return set;
        const updated = {
          ...set,
          // A configuration change applies to every member of the set - the data
          // model deliberately has no per-panel overrides, so this is stated
          // rather than silently diverging.
          config: nextConfig,
        };
        if (!valid) return updated;
        if (set.mode !== "auto" || set.userModified) {
          // Hand-placed panels keep their positions, but azimuth is a
          // set-level facing: rotate the stored panels in place so the
          // slider visibly turns them without moving or deleting any.
          if (rest.azimuthDeg !== undefined && updated.panels.length > 0) {
            const rotation = panelRotationForAzimuth(nextConfig.azimuthDeg);
            return { ...updated, panels: updated.panels.map((x, i) => ({ ...x, index: i, rotationDeg: rotation })) };
          }
          return updated;
        }
        const result = placePanels({ terrace: usableRing, obstacles, config: nextConfig });
        return { ...updated, panels: result.panels };
      }),
    );
  };

  /** Add a new set seeded from the active one (a separate, editable identity). */
  const handleAddSet = () => {
    // Monotonic ids: deriving from `length` would reuse the id of a deleted
    // set and leave two sets sharing one identity (broken selection).
    const nextId = createPanelSetId();
    const seed = activeSet
      ? { ...activeSet.config, panelTypeId: activeSet.config.panelTypeId }
      : DEFAULT_PANEL_CONFIG;
    const createdName = `Panel set ${panelSets.length + 1}`;
    setPanelSets((sets) => [
      ...sets,
      {
        id: nextId,
        name: createdName,
        config: { ...seed },
        mode: "auto" as const,
        panels: [],
        userModified: false,
      },
    ]);
    setActiveSetId(nextId);
  };

  /** Duplicate the active set: same configuration, new identity, empty panels. */
  const handleDuplicateSet = () => {
    if (!activeSet) return;
    const nextId = createPanelSetId();
    setPanelSets((sets) => [
      ...sets,
      {
        ...activeSet,
        id: nextId,
        name: `${activeSet.name} copy`,
        config: { ...activeSet.config },
        // A duplicate starts unplaced: it must be explicitly placed, so the
        // copy never silently overlaps the original.
        panels: [],
        userModified: false,
      },
    ]);
    setActiveSetId(nextId);
  };

  const handleDeleteSet = () => {
    // Computed from current render state, not inside the updater: updaters
    // must stay pure (StrictMode double-invokes them) and the closure id
    // would be stale if a delete raced another set operation.
    const next = panelSets.filter((s) => s.id !== activeSetId);
    const remaining = next.length > 0 ? next : [defaultPanelSet(createPanelSetId())];
    setPanelSets(remaining);
    setActiveSetId(remaining[remaining.length - 1].id);
  };

  /** Auto-place one set, replacing its panels. */
  /**
   * Auto-place ONE set while preserving every other set.
   *
   * The lattice is independent per set, so without extra work the new
   * arrangement could land on another set's panels. Instead every other
   * set's panels are reserved first; only candidates clear of them are kept.
   * A set that no longer fits keeps the feasible subset and the shortfall is
   * named in the warning. Nothing from the other sets moves.
   */
  const handleAutoPlaceSet = () => {
    if (!activeSet) return;
    const dims = effectivePanelDims(activeSet.config);
    const reserved = panelSets
      .filter((s) => s.id !== activeSetId)
      .flatMap((s) => {
        const d = effectivePanelDims(s.config);
        return s.panels.map((x) => ({ x: x.x, y: x.y, rotationDeg: x.rotationDeg, width: d.widthM, length: d.lengthM }));
      });
    const result = placePanels({ terrace: usableRing, obstacles, config: activeSet.config });
    const kept: Array<{ index: number; x: number; y: number; rotationDeg: number }> = [];
    const seen = [...reserved];
    for (const x of result.panels) {
      const rect = rectangleCorners(x.x, x.y, dims.widthM, dims.lengthM, x.rotationDeg);
      if (seen.some((peer) => footprintsOverlap(rect, rectangleCorners(peer.x, peer.y, peer.width, peer.length, peer.rotationDeg)))) continue;
      seen.push({ x: x.x, y: x.y, rotationDeg: x.rotationDeg, width: dims.widthM, length: dims.lengthM });
      kept.push({ index: kept.length, x: x.x, y: x.y, rotationDeg: x.rotationDeg });
    }
    setPanelSets((sets) => sets.map((s) => (s.id !== activeSetId ? s : { ...s, mode: "auto", userModified: false, panels: kept })));
    setPlaceWarning(kept.length < result.panels.length ? `${activeSet.name} placed ${kept.length} of ${result.panels.length} panels: the rest overlap other sets.` : null);
  };

  /**
   * Recalculate the active set from its current configuration.
   *
   * Automatic sets are regenerated immediately (same path as Auto-place
   * set). Manual sets are never moved or deleted here: their stored panels
   * are re-validated against the roof, obstacles and parapet, and any panel
   * that no longer fits is REPORTED in the warning so the user can move or
   * remove it deliberately.
   */
  const handleRecalculate = () => {
    setPanelRevision((revision) => revision + 1);
    if (!activeSet) return;
    if (activeSet.mode === "auto" && !activeSet.userModified) {
      handleAutoPlaceSet();
      return;
    }
    const invalid = findInvalidPanels(activeSet, {
      terrace: terraceRing,
      obstacles,
      parapetInsetM,
      parapetClearanceM,
    });
    setPlaceWarning(
      invalid.length === 0
        ? null
        : `${invalid.length} panel${invalid.length === 1 ? "" : "s"} in ${activeSet.name} no longer ${invalid.length === 1 ? "fits" : "fit"} the roof, an obstacle, or the parapet clearance.`,
    );
  };

  /** Warning from the most recent auto-place-all (a set that could not fit). */
  const [placeWarning, setPlaceWarning] = useState<string | null>(null);

  /**
   * Auto-place every set into ONE shared collision space.
   *
   * utoPlaceAllSets walks the sets in order, reserving each accepted
   * panel so later sets cannot occupy it. Never silently overlaps: an
   * unplaceable set keeps its feasible subset and is named in the warning.
   */
  const handleAutoPlaceAll = () => {
    const { sets, report } = autoPlaceAllSets(panelSets, usableRing, obstacles);
    setPanelSets(sets);
    setPlaceWarning(report);
  };

  /**
   * Manual placement: add a panel at a validated roof position.
   * Uses the shared validator so manual and auto placement agree on the rules.
   */
  const handleManualPlace = (x: number, y: number, rotationDeg: number): string | null => {
    if (!activeSet) return "not ready";
    // Peers span EVERY set with each set's own dimensions, so a manual panel
    // can never land on another set's panels even though the sets were placed
    // independently. Same rule as the preview tint and the auto-place
    // reservation space.
    const peers = panelSets.flatMap((s) => {
      const d = effectivePanelDims(s.config);
      return s.panels.map((p) => ({
        x: p.x, y: p.y, rotationDeg: p.rotationDeg,
        width: d.widthM, length: d.lengthM,
      }));
    });
    const result = validatePanelPlacement(x, y, rotationDeg, activeSet.config, {
      terrace: terraceRing, obstacles, parapetInsetM, parapetClearanceM, peers,
    });
    if (!result.valid) return result.error ?? "blocked";
    setPanelSets((sets) => sets.map((s) => s.id !== activeSetId ? s : {
      ...s,
      mode: "manual",
      userModified: true,
      panels: [...s.panels, { index: s.panels.length, x, y, rotationDeg }],
    }));
    return null;
  };

  /**
   * Roof click handler for the active set, wired to the viewer when manual
   * placement is on. Returns true when the click was consumed so the viewer
   * does not also treat it as an obstacle pick or a camera drag.
   */
  const handleManualRoofClick = (x: number, y: number): boolean => {
    if (!manualPlaceActive || !activeSet) return false;
    if (manualPlaceMode === "set") return handleManualSetClick(x, y);
    // Place the panel at the set's configured azimuth, matching the auto layout.
    const rotation = ((((-activeSet.config.azimuthDeg) % 360) + 360) % 360);
    const refusal = handleManualPlace(x, y, rotation);
    // An invalid preview refuses the commit; the validator's own
    // message names the constraint that actually fired and its
    // configured value, so the refusal is never generic.
    setManualStatus(refusal);
    return refusal === null;
  };

  /**
   * Manual set placement: commit a whole rows-by-columns block at one click.
   * The block is validated atomically against the roof, obstacles and every
   * set's panels; any single failure rejects the entire set with the precise
   * reason, and nothing is committed. Committed indices are remembered so
   * set-level undo can remove exactly this block later.
   */
  const handleManualSetPlace = (x: number, y: number, rotationDeg: number): string | null => {
    if (!activeSet) return "not ready";
    const peers = panelSets.flatMap((s) => {
      const d = effectivePanelDims(s.config);
      return s.panels.map((p) => ({
        x: p.x, y: p.y, rotationDeg: p.rotationDeg,
        width: d.widthM, length: d.lengthM,
      }));
    });
    const result = validateSetPlacement(x, y, rotationDeg, activeSet.config, {
      terrace: terraceRing, obstacles, parapetInsetM, parapetClearanceM, peers,
    });
    if (!result.valid) return result.error;
    const startIndex = activeSet.panels.length;
    const committed = result.panels.map((p, i) => ({ ...p, index: startIndex + i }));
    setPanelSets((sets) => sets.map((s) => s.id !== activeSetId ? s : {
      ...s,
      mode: "manual",
      userModified: true,
      panels: [...s.panels, ...committed],
    }));
    setLastSetCommit({
      setId: activeSetId,
      indices: committed.map((p) => p.index),
    });
    return null;
  };

  /** Click entry for set mode: the cursor anchors the block centre. */
  const handleManualSetClick = (x: number, y: number): boolean => {
    if (!manualPlaceActive || !activeSet) return false;
    const error = handleManualSetPlace(x, y, manualSetRotation);
    setManualStatus(error);
    return error === null;
  };

  /** Remove exactly the most recently committed manual set, if still present. */
  const handleUndoLastSet = () => {
    if (!lastSetCommit) return;
    const { setId, indices } = lastSetCommit;
    const doomed = new Set(indices);
    setPanelSets((sets) => sets.map((s) => {
      if (s.id !== setId) return s;
      const kept = s.panels.filter((p) => !doomed.has(p.index));
      return { ...s, panels: reindexSet(kept), userModified: true };
    }));
    setLastSetCommit(null);
  };

  /** Remove the last panel of the active set (undo for accidental placement). */
  const handleUndoLastPanel = () => {
    setPanelSets((sets) => sets.map((s) => s.id !== activeSetId ? s : {
      ...s,
      panels: s.panels.slice(0, -1),
      userModified: true,
    }));
  };

  // Obstacles that no longer satisfy the rules (e.g. the terrace changed).
  const invalidObstacles = useMemo(
    () => findInvalidObstacles(obstacles, terraceRing, parapetInsetM, parapetContactM),
    [obstacles, terraceRing, parapetInsetM, parapetContactM],
  );
  // Count of obstacles needing review (invalid or outside valid area)
  const validObstacleCount = invalidObstacles.length;

  // Draft candidate + its deterministic validation result (drives the ghost).
  const draftResult = useMemo(() => {
    const candidate = draftToObstacle(obstacleDraft, selectedObstacleId ?? "obstacle-draft");
    const others = obstacles.filter(
      (o) => obstacleMode !== "editing" || o.id !== selectedObstacleId,
    );
    return validateObstacle(candidate, { terrace: terraceRing, others, parapetInsetM, parapetContactM });
  }, [obstacleDraft, selectedObstacleId, obstacles, obstacleMode, terraceRing, parapetInsetM]);

  const treeValidationResult = useMemo(() => {
    const candidate = draftToTree(treeDraft, selectedTreeId ?? "draft");
    return validateTree(candidate, terraceRing, trees);
  }, [treeDraft, terraceRing, trees, selectedTreeId]);

  // Live ghost for the drawn footprint: placed before the no-height early
  // return so hooks run in identical order on every render.
  const drawnTemp = useMemo(() => {
    if (!drawing || footPoints.length < 3) return null;
    try {
      const { centroid, offsets } = splitPolygon(footPoints);
      const height = Number(obstacleDraft.height);
      const draft: ObstacleDraft = {
        ...obstacleDraft,
        type: "custom",
        x: String(centroid.x),
        y: String(centroid.y),
        height: Number.isFinite(height) && height > 0 ? obstacleDraft.height : "1.0",
        polygon: offsets,
      };
      return draftToObstacle(draft, "obstacle-draft");
    } catch {
      return null;
    }
  }, [drawing, footPoints, obstacleDraft]);

  const drawnValid = useMemo(() => {
    if (!drawnTemp) return footPoints !== null && footPoints.length < 3;
    return validateObstacle(drawnTemp, { terrace: terraceRing, others: obstacles, parapetInsetM, parapetContactM }).valid;
  }, [drawnTemp, footPoints, terraceRing, obstacles, parapetInsetM]);

  // No height yet (or the user asked to change it): collect it first.
  if (buildingHeight === null || editingHeight || !model) {
    return (
      <BuildingHeightPanel
        vertices={vertices}
        metrics={metrics}
        initialHeight={buildingHeight ?? undefined}
        onConfirm={(height) => {
          setEditingHeight(false);
          onSetHeight(height);
        }}
        backendReady={backendReady}
      />
    );
  }
  const areaText = metrics ? formatArea(metrics.areaM2) : "â€”";
  const perimeterText = metrics ? `${metrics.perimeterM.toFixed(1)} m` : "â€”";
  const volumeText = metrics ? `${(metrics.areaM2 * model.heightM).toFixed(1)} mÂ³` : "â€”";
  const extentText = `${model.extentM.east.toFixed(1)} m Ã— ${model.extentM.north.toFixed(1)} m`;

  const closeObstacleEditor = () => {
    setObstacleMode("idle");
    setObstacleSubmitted(false);
    setSelectedObstacleId(null);
  };

  const startAddObstacle = () => {
    setSelectedObstacleId(null);
    setObstacleDraft(emptyObstacleDraft());
    setObstacleSubmitted(false);
    setObstacleMode("adding");
  };

  const startEditObstacle = (obstacle: Obstacle) => {
    setSelectedObstacleId(obstacle.id);
    setObstacleDraft(obstacleToDraft(obstacle));
    setObstacleSubmitted(false);
    setObstacleMode("editing");
  };

  // Click-to-select from the viewport (suppressed while a draft is open).
  const handleObstacleSelect = (id: string | null) => {
    if (id === null) {
      setSelectedObstacleId(null);
      if (obstacleMode !== "idle") closeObstacleEditor();
      return;
    }
    const obstacle = obstacles.find((o) => o.id === id);
    if (obstacle) startEditObstacle(obstacle);
  };

  const handleObstacleTypeChange = (type: ObstacleType) => {
    // Reload the category preset footprint but keep the placed position.
    const next = emptyObstacleDraft(type);
    setObstacleDraft({ ...next, x: obstacleDraft.x, y: obstacleDraft.y });
  };

  const handleObstacleSubmit = () => {
    setObstacleSubmitted(true);
    const result = draftResult;
    if (!result.valid) return;
    if (obstacleMode === "adding") {
      onAddObstacle?.({ ...draftToObstacle(obstacleDraft, createObstacleId()) });
    } else if (obstacleMode === "editing") {
      onUpdateObstacle?.(draftToObstacle(obstacleDraft, selectedObstacleId ?? ""));
    }
    closeObstacleEditor();
  };

  const handleDeleteObstacle = (id: string) => {
    onRemoveObstacle?.(id);
    if (selectedObstacleId === id || obstacleMode !== "idle") closeObstacleEditor();
  };

  const startAddTree = () => {
    setTreePlaceActive(true);
    setTreeMode("idle");
    setSelectedTreeId(null);
    setTreePlacementStatus(null);
  };

  const handleGroundPlace = (x: number, y: number) => {
    if (!treePlaceActive) return;
    const treeId = createTreeId();
    const candidate: Tree = {
      id: treeId,
      type: selectedTreeType,
      position: { x, y },
      height: treePlaceHeight,
      canopyWidth: treePlaceCanopyWidth,
      rotation: treePlaceRotation,
    };
    const result = validateTree(candidate, terraceRing, trees);
    if (!result.valid) {
      setTreePlacementStatus(result.error);
      return;
    }
    setTrees((list) => [...list, candidate]);
    setSelectedTreeId(candidate.id);
    setTreePlaceActive(false);
    setTreePlacementStatus(null);
  };

  const startEditTree = (tree: Tree) => {
    setTreeDraft(treeToDraft(tree));
    setSelectedTreeId(tree.id);
    setTreeMode("editing");
    setTreeSubmitted(false);
    setTreePlaceActive(false);
  };

  const closeTreeEditor = () => {
    setTreeMode("idle");
    setTreeSubmitted(false);
  };

  const handleTreeTypeChange = (type: TreeType) => {
    const preset = treeTypeDefinition(type);
    setTreeDraft((d) => ({
      ...d,
      type,
      height: String(preset.defaultHeight),
      canopyWidth: String(preset.defaultCanopyWidth),
    }));
  };

  const handleTreeSubmit = () => {
    setTreeSubmitted(true);
    if (!selectedTreeId) return;
    const candidate = draftToTree(treeDraft, selectedTreeId);
    const result = validateTree(candidate, terraceRing, trees);
    if (!result.valid) return;

    setTrees((list) => list.map((t) => (t.id === selectedTreeId ? candidate : t)));
    setTreeMode("idle");
    setTreeSubmitted(false);
  };

  const handleDeleteTree = (id: string) => {
    setTrees((list) => list.filter((t) => t.id !== id));
    if (selectedTreeId === id) setSelectedTreeId(null);
    if (treeMode === "editing") setTreeMode("idle");
  };


  /**
   * Obstacle drag-to-move (viewer gesture, editor open).
   *
   * Positions are rounded to the centimetre before entering state - well inside
   * hand-drawn terrace accuracy - so sub-centimetre pointer jitter does not
   * rebuild the preview mesh on every mousemove. The draft preview (and its
   * red/green validity) follows automatically because it derives from the draft.
   */
  const handleObstacleDragMove = (id: string, x: number, y: number) => {
    if (obstacleMode !== "editing" || id !== selectedObstacleId) return;
    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    setObstacleDraft((draft) => {
      if (draft.x === String(rx) && draft.y === String(ry)) return draft;
      return { ...draft, x: String(rx), y: String(ry) };
    });
  };

  /**
   * Obstacle drag end: commit the move only when the dropped footprint is
   * valid, otherwise revert the draft to the stored obstacle. Selection and
   * the editor stay open either way.
   */
  const handleObstacleDragEnd = (id: string) => {
    if (obstacleMode !== "editing" || id !== selectedObstacleId) return;
    const original = obstacles.find((o) => o.id === id);
    if (!original) return;
    const candidate = draftToObstacle(obstacleDraft, id);
    const others = obstacles.filter((o) => o.id !== id);
    const result = validateObstacle(candidate, { terrace: terraceRing, others, parapetInsetM, parapetContactM });
    if (result.valid) {
      onUpdateObstacle?.(candidate);
    } else {
      setObstacleDraft(obstacleToDraft(original));
    }
  };

  const handleRoofPlace = (x: number, y: number) => {
    // Manual panel placement wins: while it is active a roof click places a
    // panel (or is refused) and nothing else consumes the click.
    if (manualPlaceActive && !drawing && obstacleMode === "idle") {
      handleManualRoofClick(x, y);
      return;
    }
    // Drawing mode accumulates absolute footprint points (near-duplicate
    // clicks, e.g. the two clicks of a double-click, collapse into one —
    // same convention as the map selection drawing).
    if (footPoints !== null) {
      setFootPoints((prev) => {
        if (!prev) return prev;
        const last = prev[prev.length - 1];
        if (last && Math.hypot(last.x - x, last.y - y) < 0.05) return prev;
        return [...prev, { x, y }];
      });
      return;
    }
    // Centimetre precision is well inside the accuracy of a hand-drawn terrace.
    setObstacleDraft((draft) => ({
      ...draft,
      x: Number(x.toFixed(2)).toString(),
      y: Number(y.toFixed(2)).toString(),
    }));
  };

  const startDrawFootprint = () => {
    setFootPoints([]);
    setFootError(null);
  };

  /**
   * Undo the most recently added footprint vertex.
   *
   * `footPoints` is the single source of truth (React state, never the Three.js
   * overlay), so removing the last array element is all that is needed: the
   * marker/edge/cursor overlay derives from it and updates on the next render.
   * Undo only ever removes one vertex and never touches a committed obstacle â€”
   * `finishFootprint` already cleared `footPoints` to null by the time an
   * obstacle exists, so there is nothing left to undo.
   */
  const undoFootPoint = () => {
    setFootPoints((prev) => (prev && prev.length > 0 ? prev.slice(0, -1) : prev));
  };

  const cancelDrawing = () => {
    setFootPoints(null);
    setFootError(null);
  };

  const finishFootprint = () => {
    if (footPoints === null) return;
    const result = validateFootprint(footPoints, {
      terrace: terraceRing,
      others: obstacles,
      parapetInsetM,
      parapetContactM,
    });
    if (!result.valid) {
      setFootError(result.error);
      return;
    }
    const { centroid, offsets } = splitPolygon(footPoints);
    setObstacleDraft((draft) => ({
      ...draft,
      type: "custom",
      x: centroid.x.toFixed(2),
      y: centroid.y.toFixed(2),
      polygon: offsets,
    }));
    setFootPoints(null);
    setFootError(null);
  };
  return (
    <div className="stage-card">
      <div className="design-layout">
        <div className="design-view">
      {/* 3D design viewport: the dedicated inspection scene (rotation +
          elevation + zoom, building stays centred). Satellite ground texture
          replaces the void with the actual site context. */}
      <div className="stage-3d-viewport" style={{ marginBottom: "var(--space-3)" }}>
        <Site3DViewer
          ref={viewerRef}
          localCoords={model.coords}
          obstacles={obstacles}
          selectedObstacleId={selectedObstacleId}
          hiddenObstacleId={obstacleMode === "editing" ? selectedObstacleId : null}
          previewObstacle={drawing ? drawnTemp : obstacleMode !== "idle" ? draftToObstacle(obstacleDraft, "obstacle-draft") : null}
          previewValid={drawing ? drawnValid : draftResult.valid}

          onObstacleSelect={handleObstacleSelect}
          obstacleDragEnabled={obstacleMode === "editing"}
          onObstacleDragMove={handleObstacleDragMove}
          onObstacleDragEnd={handleObstacleDragEnd}
          manualPanelPreview={
            manualPlaceActive && panelsEnabled && activeSet
              ? {
                  config: activeSet.config,
                  insetM: parapetInsetM,
                  mode: manualPlaceMode,
                  rotationDeg: manualSetRotation,
                }
              : null
          }
          manualPlaceActive={manualPlaceActive}
          onRoofPlace={handleRoofPlace}
          onRoofFinish={drawing ? finishFootprint : undefined}
          footprintPoints={drawing ? footPoints : null}
          footprintDrawing={drawing}
          sun={sun.clock}
          panelLayers={panelLayers}
          siteAnchor={siteAnchor}
          parapet={parapetModel}
          xray={xray}
          weatherPreset={weatherPreset}
          trees={trees}
          selectedTreeId={selectedTreeId}
          onTreeSelect={(id) => {
            setSelectedTreeId(id);
            if (id) {
              const found = trees.find((t) => t.id === id);
              if (found) startEditTree(found);
            } else if (treeMode !== "idle") {
              closeTreeEditor();
            }
          }}
          treePlaceActive={treePlaceActive}
          treePlaceType={selectedTreeType}
          treePlaceHeight={treePlaceHeight}
          treePlaceCanopyWidth={treePlaceCanopyWidth}
          treePlaceRotation={treePlaceRotation}
          onGroundPlace={handleGroundPlace}
          onCancelTreePlace={() => setTreePlaceActive(false)}
          className="model-viewport"
        />
        {/* Viewport Toolbar - floating contextual tools anchored to viewport */}
        {designMode && (
          <ViewportToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            xrayActive={xray}
            onToggleXray={() => setXray((v) => !v)}
            onResetView={() => viewerRef.current?.resetCamera()}
            obstacleType={obstacleDraft.type}
            drawing={drawing}
            manualPlaceActive={manualPlaceActive}
            sunPlaying={sun.playing}
            onToggleSunPlay={sun.togglePlay}
            inspectorCollapsed={inspectorCollapsed}
            onExitDesign={onExitDesign}
          />
        )}
      </div>

      {/* Viewport hint + camera/design-mode actions: the help text keeps its
          own flexible lane while the buttons stack vertically in a fixed
          action group, so the two never compete for horizontal space. */}
      <div className={`viewer-footer${designMode ? " viewer-footer--expanded" : ""}`} style={{ marginBottom: "var(--space-3)" }}>
        <p className="viewer-help">
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {obstacleMode !== "idle"
              ? "Click the roof to position the footprint. Drag to rotate. Scroll or pinch to zoom."
              : "Drag to rotate. Scroll or pinch to zoom. Click an obstacle to select it."}
          </span>
        </p>
        {!designMode && (
          <div className="viewer-actions">
            <button
              type="button"
              className="btn"
              onClick={() => viewerRef.current?.resetCamera()}
              title="Return to the default 3D view"
            >
              Reset view
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onEnterDesign}
              title="Expand the 3D workspace: the panel becomes the primary surface"
            >
              Open 3D design view
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setXray((v) => !v)}
              aria-pressed={xray}
              title="Fade the building shell to inspect the roof boundary against interior structures"
            >
              {xray ? "Solid view" : "X-ray"}
            </button>
          </div>
        )}
      </div>

        </div>
        <div className="design-side">
      <p className="stage-card__eyebrow">Stage 2 of 6</p>
      <h2 className="stage-card__title">3D Building Model</h2>
      <p className="stage-card__body">
        The terrace outline has been extruded to {model.heightM.toFixed(1)} m.
        Rotate and zoom to inspect the building from all angles.
      </p>

        <div className="inspector-panel" key={designMode ? "design" : "normal"} style={{ flex: 1 }}>
          {/* Building Metrics */}
          <CollapsibleSection
            id="metrics"
            title="Building Metrics"
            defaultOpen={false}
            icon={<Sun size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            <dl className="metric-list" style={{ marginBottom: "var(--space-3)" }}>
              <div>
                <dt>Terrace area</dt>
                <dd>{areaText}</dd>
              </div>
              <div>
                <dt>Perimeter</dt>
                <dd>{perimeterText}</dd>
              </div>
              <div>
                <dt>Footprint extent (E × N)</dt>
                <dd>{extentText}</dd>
              </div>
              <div>
                <dt>Building height</dt>
                <dd>{model.heightM.toFixed(1)} m</dd>
              </div>
              <div>
                <dt>Total height</dt>
                <dd>{(model.heightM + parapetHeightM).toFixed(1)} m</dd>
              </div>
              <div>
                <dt>Volume (approx.)</dt>
                <dd>{volumeText}</dd>
              </div>
            </dl>
            <div style={{ marginTop: "var(--space-2)" }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setEditingHeight(true)}
                title="Change the building height"
              >
                <RotateCcw size={14} strokeWidth={2} aria-hidden="true" /> Change height
              </button>
            </div>
          </CollapsibleSection>

          {/* Parapet & Clearance */}
          <CollapsibleSection
            id="parapet"
            title="Parapet & Clearance"
            defaultOpen={false}
            icon={<Eye size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            <div style={{ marginBottom: "var(--space-2)" }}>
              <dt>
                <label htmlFor="parapet-height">Parapet height</label>
              </dt>
              <dd>
                <span className="height-inline">
                  <input
                    id="parapet-height"
                    type="number"
                    step="0.1"
                    min={MIN_PARAPET_HEIGHT_M}
                    max={MAX_PARAPET_HEIGHT_M}
                    value={parapetDraft ?? parapetHeightM.toFixed(1)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setParapetDraft(raw);
                      const parsed = Number(raw);
                      if (validateParapetHeight(parsed) === null) onSetParapetHeight?.(parsed);
                    }}
                    onBlur={() => setParapetDraft(null)}
                    aria-describedby={parapetError ? "parapet-error" : undefined}
                    aria-invalid={parapetError !== null}
                  />{" "}
                  m
                </span>
                {parapetError && (
                  <span id="parapet-error" className="stage-card__warning" role="alert">
                    {parapetError}
                  </span>
                )}
              </dd>
            </div>
            <div style={{ marginBottom: "var(--space-2)" }}>
              <dt>
                <label htmlFor="panel-edge-setback">Panel edge setback</label>
              </dt>
              <dd>
                <span className="height-inline">
                  <input
                    id="panel-edge-setback"
                    type="number"
                    step="0.1"
                    min={PANEL_SETBACK_MIN_M}
                    max={PANEL_SETBACK_MAX_M}
                    value={setbackDraft ?? (activeSet?.config.setbackM ?? DEFAULT_PANEL_CONFIG.setbackM).toFixed(1)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setSetbackDraft(raw);
                      const parsed = Number(raw);
                      if (
                        activeSet &&
                        Number.isFinite(parsed) &&
                        parsed >= PANEL_SETBACK_MIN_M &&
                        parsed <= PANEL_SETBACK_MAX_M
                      ) {
                        handlePanelConfigChange({ setbackM: parsed });
                      }
                    }}
                    onBlur={() => setSetbackDraft(null)}
                    aria-describedby={setbackError ? "setback-error" : undefined}
                    aria-invalid={setbackError !== null}
                    disabled={!activeSet}
                  />{" "}
                  m
                </span>
                {setbackError && (
                  <span id="setback-error" className="stage-card__warning" role="alert">
                    {setbackError}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <label htmlFor="parapet-clearance">Parapet clearance</label>
              </dt>
              <dd>
                <span className="height-inline">
                  <input
                    id="parapet-clearance"
                    type="number"
                    step="0.1"
                    min={MIN_PARAPET_CLEARANCE_M}
                    max={MAX_PARAPET_CLEARANCE_M}
                    value={parapetClearanceDraft ?? parapetClearanceM.toFixed(1)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setParapetClearanceDraft(raw);
                      const parsed = Number(raw);
                      if (Number.isFinite(parsed) && parsed >= MIN_PARAPET_CLEARANCE_M && parsed <= MAX_PARAPET_CLEARANCE_M) {
                        setManualStatus(null);
                        onSetParapetClearance?.(parsed);
                      }
                    }}
                    onBlur={() => setParapetClearanceDraft(null)}
                    aria-describedby={parapetClearanceError ? "parapet-clearance-error" : undefined}
                    aria-invalid={parapetClearanceError !== null}
                    title="Clear gap kept between the parapet's inner face and a panel. Separate from the panel edge setback."
                  />{" "}
                  m
                </span>
                {parapetClearanceError && (
                  <span id="parapet-clearance-error" className="stage-card__warning" role="alert">
                    {parapetClearanceError}
                  </span>
                )}
              </dd>
            </div>
          </CollapsibleSection>

          {/* Sun & Shadows */}
          <CollapsibleSection
            id="sun"
            title="Sun & Shadows"
            defaultOpen={false}
            icon={<Moon size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            <SunControls
              date={sun.date}
              timeMinutes={sun.timeMinutes}
              playing={sun.playing}
              state={sun.state}
              timezoneLabel={timezoneLabel}
              dateTimeLabel={dateTimeLabel}
              onDateChange={sun.setDate}
              onTimeChange={sun.setTime}
              onTogglePlay={sun.togglePlay}
            />
            
          </CollapsibleSection>

          {/* Weather */}
          <CollapsibleSection
            id="weather"
            title="Weather"
            defaultOpen={false}
            icon={<Sun size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            <div className="weather-preset-controls">
              <div className="weather-preset-btn-group" role="group" aria-label="Weather presets">
                <button
                  type="button"
                  className={"weather-preset-btn" + (weatherPreset === "sunny" ? " weather-preset-btn--active" : "")}
                  onClick={() => setWeatherPreset("sunny")}
                  title="Sunny: clear daylight with direct shadows"
                >Sunny</button>
                <button
                  type="button"
                  className={"weather-preset-btn" + (weatherPreset === "cloudy" ? " weather-preset-btn--active" : "")}
                  onClick={() => setWeatherPreset("cloudy")}
                  title="Cloudy: soft diffuse lighting"
                >Cloudy</button>
                <button
                  type="button"
                  className={"weather-preset-btn" + (weatherPreset === "rainy" ? " weather-preset-btn--active" : "")}
                  onClick={() => setWeatherPreset("rainy")}
                  title="Rainy: overcast lighting with light rain visualization"
                >Rainy</button>
              </div>
            </div>
            <p className="panel-group__hint" style={{ marginTop: "var(--space-2)" }}>
              Visual simulation only: adjusts 3D lighting without affecting deterministic solar yield calculations.
            </p>
          </CollapsibleSection>

{/* Rooftop Obstacles */}
          <CollapsibleSection
            id="obstacles"
            title="Trees & Obstacles"
            defaultOpen={false}
            icon={<TreePine size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            <div className="obstacle-toolbar">
              <div className="obstacle-toolbar__labels">
                <h3 className="obstacle-section__title">Rooftop obstacles</h3>
                <p className="obstacle-count">
                  {obstacles.length === 0 ? "None on the roof yet" : `${obstacles.length} obstacle${obstacles.length === 1 ? "" : "s"} on the roof`}
                </p>
              </div>
              {obstacleMode === "idle" && (
                <button type="button" className="btn btn--secondary" onClick={startAddObstacle}>
                  <Plus size={15} strokeWidth={2} aria-hidden="true" /> Add obstacle
                </button>
              )}
            </div>

            {invalidObstacles.length > 0 && (
              <p className="obstacle-warning" role="alert">
                <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  {invalidObstacles
                    .map((entry) => `${obstacleTypeLabel(entry.obstacle.type)}: ${entry.error}`)
                    .join(" · ")}
                </span>
              </p>
            )}

            {drawing ? (
              <div className="obstacle-draw" role="group" aria-label="Draw rooftop footprint">
                <p className="obstacle-form__hint">
                  Rooftop footprint selection is active — click on the roof to add points
                  ({footPoints.length} so far). Double-click or Confirm to finish; the height
                  step follows.
                </p>
                {footError && (
                  <p className="obstacle-form__error" role="alert">
                    {footError}
                  </p>
                )}
                <div className="obstacle-form__actions">
                  <button type="button" className="btn btn--primary" onClick={finishFootprint}>
                    Confirm footprint
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={undoFootPoint}
                    disabled={(footPoints?.length ?? 0) === 0}
                    title="Remove the last drawn point"
                  >
                    Undo point
                  </button>
                  <button type="button" className="btn btn--subtle" onClick={cancelDrawing}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              obstacleMode !== "idle" && (
                <ObstacleEditor
                  mode={obstacleMode}
                  draft={obstacleDraft}
                  error={obstacleSubmitted && !draftResult.valid ? draftResult.error : null}
                  onDraftChange={setObstacleDraft}
                  onTypeChange={handleObstacleTypeChange}
                  onSubmit={handleObstacleSubmit}
                  onCancel={closeObstacleEditor}
                  onDrawFootprint={
                    obstacleMode === "adding" && obstacleDraft.type === "custom" ? startDrawFootprint : undefined
                  }
                />
              )
            )}

            {obstacles.length > 0 && (
              <ul className="obstacle-list">
                {obstacles.map((obstacle) => {
                  const invalid = invalidObstacles.find((entry) => entry.obstacle.id === obstacle.id);
                  const label = obstacleTypeLabel(obstacle.type);
                  return (
                    <li
                      key={obstacle.id}
                      className={`obstacle-item${selectedObstacleId === obstacle.id ? " is-selected" : ""}${invalid ? " is-invalid" : ""}`}
                    >
                      <div className="obstacle-item__body">
                        <span className="obstacle-item__name">{label}</span>
                        <span className="obstacle-item__meta">
                          {formatObstacleDimensions(obstacle)} · {obstacle.rotation}° · E {obstacle.position.x.toFixed(1)} · N {obstacle.position.y.toFixed(1)}
                          {invalid ? ` · ${invalid.error}` : ""}
                        </span>
                      </div>
                      <div className="obstacle-item__actions">
                        <button
                          type="button"
                          className="btn btn--subtle"
                          onClick={() => startEditObstacle(obstacle)}
                        >
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--subtle-danger"
                          onClick={() => handleDeleteObstacle(obstacle.id)}
                          aria-label={`Delete ${label}`}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Ground Trees */}
            <div className="viewport-toolbar__divider" style={{ width: "100%", height: "1px", margin: "var(--space-3) 0" }} />

            <div className="obstacle-toolbar">
              <div className="obstacle-toolbar__labels">
                <h3 className="obstacle-section__title">Ground trees</h3>
                <p className="obstacle-count">
                  {trees.length === 0 ? "No trees around the building yet" : `${trees.length} tree${trees.length === 1 ? "" : "s"} on the ground`}
                </p>
              </div>
              {treeMode === "idle" && !treePlaceActive && (
                <button type="button" className="btn btn--secondary" onClick={startAddTree}>
                  <Plus size={15} strokeWidth={2} aria-hidden="true" /> Add tree
                </button>
              )}
            </div>

            {treePlaceActive && (
              <div
                className="stage-card"
                style={{
                  padding: "var(--space-3)",
                  background: "var(--surface-sunken, #161b22)",
                  border: "1px solid var(--border-subtle, #30363d)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "var(--space-3)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                  <strong style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>Tree Placement Mode</strong>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setTreePlaceActive(false)}
                    title="Cancel placement"
                    aria-label="Cancel placement"
                  >
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
                  Move cursor over ground outside the building to preview. Click to place. Press Esc to cancel.
                </p>
                <div className="field" style={{ marginBottom: "var(--space-2)" }}>
                  <label htmlFor="tree-place-type" style={{ fontSize: "0.8rem" }}>Tree variant</label>
                  <select
                    id="tree-place-type"
                    value={selectedTreeType}
                    onChange={(e) => {
                      const t = e.target.value as TreeType;
                      setSelectedTreeType(t);
                      const def = treeTypeDefinition(t);
                      setTreePlaceHeight(def.defaultHeight);
                      setTreePlaceCanopyWidth(def.defaultCanopyWidth);
                    }}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {TREE_TYPES.map((def) => (
                      <option key={def.type} value={def.type}>{def.label}</option>
                    ))}
                  </select>
                </div>
                <div className="obstacle-form__grid" style={{ marginBottom: "var(--space-2)" }}>
                  <div className="field">
                    <label htmlFor="tree-place-height" style={{ fontSize: "0.8rem" }}>Height</label>
                    <div className="height-input-row">
                      <input
                        id="tree-place-height"
                        type="number"
                        step="0.5"
                        min="1"
                        max="30"
                        value={treePlaceHeight}
                        onChange={(e) => setTreePlaceHeight(Number(e.target.value) || 8)}
                        style={{ fontSize: "0.85rem" }}
                      />
                      <span className="height-unit">m</span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="tree-place-width" style={{ fontSize: "0.8rem" }}>Canopy width</label>
                    <div className="height-input-row">
                      <input
                        id="tree-place-width"
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="20"
                        value={treePlaceCanopyWidth}
                        onChange={(e) => setTreePlaceCanopyWidth(Number(e.target.value) || 5)}
                        style={{ fontSize: "0.85rem" }}
                      />
                      <span className="height-unit">m</span>
                    </div>
                  </div>
                </div>
                <div className="field" style={{ marginBottom: "var(--space-2)" }}>
                  <label htmlFor="tree-place-rotation" style={{ fontSize: "0.8rem" }}>Rotation</label>
                  <div className="height-input-row">
                    <input
                      id="tree-place-rotation"
                      type="number"
                      step="15"
                      value={treePlaceRotation}
                      onChange={(e) => setTreePlaceRotation(Number(e.target.value) || 0)}
                      style={{ fontSize: "0.85rem" }}
                    />
                    <span className="height-unit">°</span>
                  </div>
                </div>
                {treePlacementStatus && (
                  <p className="obstacle-form__error" role="alert" style={{ marginBottom: "var(--space-2)" }}>
                    {treePlacementStatus}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn--subtle"
                  onClick={() => setTreePlaceActive(false)}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Cancel placement
                </button>
              </div>
            )}

            {treeMode !== "idle" && (
              <TreeEditor
                mode={treeMode}
                draft={treeDraft}
                error={treeSubmitted && !treeValidationResult.valid ? treeValidationResult.error : null}
                onDraftChange={setTreeDraft}
                onTypeChange={handleTreeTypeChange}
                onSubmit={handleTreeSubmit}
                onCancel={closeTreeEditor}
              />
            )}

            {trees.length > 0 && (
              <ul className="obstacle-list">
                {trees.map((tree) => {
                  const label = treeTypeLabel(tree.type);
                  return (
                    <li
                      key={tree.id}
                      className={`obstacle-item${selectedTreeId === tree.id ? " is-selected" : ""}`}
                    >
                      <div className="obstacle-item__body">
                        <span className="obstacle-item__name">{label}</span>
                        <span className="obstacle-item__meta">
                          {formatTreeDimensions(tree)} · {tree.rotation}° · E {tree.position.x.toFixed(1)} · N {tree.position.y.toFixed(1)}
                        </span>
                      </div>
                      <div className="obstacle-item__actions">
                        <button
                          type="button"
                          className="btn btn--subtle"
                          onClick={() => startEditTree(tree)}
                        >
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--subtle-danger"
                          onClick={() => handleDeleteTree(tree.id)}
                          aria-label={`Delete ${label}`}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CollapsibleSection>

          {/* Solar Panel Design */}
          <CollapsibleSection
            id="solar-design"
            title="Solar Panel Design"
            defaultOpen={false}
            icon={<Grid3x3 size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            {panelsEnabled ? (
              <>
                <div className="stage-card__actions" style={{ marginBottom: "var(--space-2)" }}>
                  <button type="button" className="btn btn--secondary" onClick={() => setPanelsEnabled(false)}>
                    Remove solar panels
                  </button>
                </div>
                <SolarPanelSection
                  displayMode="all"
                  sets={panelSets}
                  activeSetId={activeSetId}
                  onSelectSet={setActiveSetId}
                  onAddSet={handleAddSet}
                  onDuplicateSet={handleDuplicateSet}
                  onDeleteSet={handleDeleteSet}
                  onRenameSet={(id: string, name: string) =>
                    setPanelSets((sets) => sets.map((s) => (s.id === id ? { ...s, name } : s)))
                  }
                  config={activeSet?.config ?? DEFAULT_PANEL_CONFIG}
                  onConfigChange={handlePanelConfigChange}
                  onRecalculate={handleRecalculate}
                  onAutoPlace={handleAutoPlaceSet}
                  onAutoPlaceAll={handleAutoPlaceAll}
                  onUndoLast={handleUndoLastPanel}
                  manualPlaceActive={manualPlaceActive}
                  onToggleManualPlace={() => setManualPlaceActive((v) => !v)}
                  manualPlaceMode={manualPlaceMode}
                  onManualPlaceModeChange={setManualPlaceMode}
                  manualPlacedCount={activeSet?.panels.length ?? 0}
                  manualStatus={manualStatus}
                  setWarning={activeSetProblems}
                  maxSetRows={setLimits.maxRows}
                  maxSetCols={setLimits.maxCols}
                  setRotationDeg={manualSetRotation}
                  onRotateSet={(delta) => setSetExtraRotation((deg) => deg + delta)}
                  onUndoLastSet={handleUndoLastSet}
                  canUndoLastSet={lastSetCommit !== null}
                  onClearManual={() =>
                    setPanelSets((sets) => sets.map((s) => s.id !== activeSetId ? s : {
                      ...s, panels: [], userModified: true,
                    }))
                  }
                  panelCount={panelCount}
                  capacityKw={capacityKw}
                  warning={placeWarning ?? (activeSet ? (placements[panelSets.indexOf(activeSet)]?.reason ?? null) : null)}
                  energy={energy}
                />
              </>
            ) : (
              <div className="obstacle-section">
                <div className="obstacle-toolbar">
                  <div className="obstacle-toolbar__labels">
                    <h3 className="obstacle-section__title">Solar panels</h3>
                    <p className="obstacle-count">No panels placed yet</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setPanelsEnabled(true)}
                    title="Generate a panel layout from the current settings"
                  >
                    Enable solar panels
                  </button>
                </div>
              </div>
            )}
          </CollapsibleSection>

          </div>

          {/* Bottom Action Bar */}
          <div className="inspector-actions">
            {/* Status */}
            <div className={validObstacleCount > 0 || activeSetProblems ? "inspector-actions__status" : "inspector-actions__status inspector-actions__status--valid"}>
              <span className="inspector-actions__status-icon">
                {validObstacleCount > 0 ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2">
                    <circle cx="9" cy="9" r="9" />
                    <polyline points="5 15 10 9 15 15" />
                  </svg>
                ) : null}
              </span>
              <span className="inspector-actions__status-text">
                {validObstacleCount > 0 ? `${validObstacleCount} obstacles need review` : activeSetProblems ? `${activeSetProblems}` : `Ready for analysis`}
              </span>
            </div>

            {/* Primary action */}
            <div className="inspector-actions__primary">
              <button
                type="button"
                className="btn btn--primary"
                onClick={onContinue}
                disabled={!backendReady}
                title={!backendReady ? BACKEND_WAITING_LABEL : "Continue to surface validation"}
              >
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
                Continue to Validate
              </button>
            </div>
          </div>

          {!backendReady && (
            <p className="readiness-lock" role="status" style={{ marginTop: "var(--space-2)" }}>
              <span className="readiness-lock__dot" aria-hidden="true" />
              {BACKEND_WAITING_LABEL} 3D view works offline; validation needs the analysis server.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModelPanel;
