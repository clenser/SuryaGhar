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

import { useMemo, useRef, useState } from "react";
import { RotateCcw, ArrowRight, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { BACKEND_WAITING_LABEL } from "../../hooks/useBackendStatus";
import type { LngLat, PolygonMetrics } from "../../lib/geo";
import { formatArea } from "../../lib/geo";
import { createBuildingModel } from "../../lib/3d/building";
import {
  DEFAULT_PARAPET_HEIGHT_M,
  DEFAULT_PARAPET_THICKNESS_M,
  MAX_PARAPET_HEIGHT_M,
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
import { Site3DViewer, type Site3DViewerHandle } from "../3d/Site3DViewer";
import { ObstacleEditor } from "../3d/ObstacleEditor";
import { SunControls } from "../3d/SunControls";
import { SolarPanelSection } from "../3d/SolarPanelSection";
import { BuildingHeightPanel } from "./BuildingHeightPanel";
import { useSunSimulation } from "../../hooks/useSunSimulation";
import { formatTimezoneLabel, formatSiteDateTime, localWallClockToUtc } from "../../lib/solar";
import { placePanels } from "../../lib/3d/panelPlacement";
import {
  DEFAULT_PANEL_CONFIG,
  panelTypeDefinition,
  totalCapacityKw,
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
   * the sun simulation — never to assume a shared offset for every site.
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
  /** 3D design workspace visible (panel is the primary surface) */
  designMode?: boolean;
  /** Deliberate transition into the design workspace (no auto-entry) */
  onEnterDesign?: () => void;
  /** Deliberate return to the full-map workspace */
  onExitDesign?: () => void;
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
  // roof — the user explicitly enables placement first.
  const [panelConfig, setPanelConfig] = useState<PanelLayoutConfig>(DEFAULT_PANEL_CONFIG);
  const [panelRevision, setPanelRevision] = useState(0);
  const [panelsEnabled, setPanelsEnabled] = useState(false);
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

  // Terrace polygon + height → local 3D coordinates (metres, centroid at origin).
  const model = useMemo(() => {
    if (buildingHeight === null || vertices.length < 3) return null;
    try {
      return createBuildingModel(vertices, buildingHeight);
    } catch (err) {
      console.error("[ModelPanel] Building model creation failed:", err);
      return null;
    }
  }, [vertices, buildingHeight]);

  // Roof ring in local metres — the authoritative boundary for obstacle checks.
  const terraceRing = useMemo(
    () => (model ? model.coords.vertices.map((v) => ({ x: v.x, y: v.y })) : []),
    [model],
  );

  // Parapet: resolved height (explicit value or safe default), local draft
  // for the input, and the usability inset it imposes on the roof. The roof
  // elevation itself never moves: parapet adds upward from the roof surface.
  const parapetHeightM = parapetHeight ?? DEFAULT_PARAPET_HEIGHT_M;
  const [parapetDraft, setParapetDraft] = useState<string | null>(null);
  const parapetError = useMemo(() => {
    if (parapetDraft === null) return null;
    return validateParapetHeight(Number(parapetDraft));
  }, [parapetDraft]);
  const parapetInsetM = DEFAULT_PARAPET_THICKNESS_M + PARAPET_CLEARANCE_M;

  // Inner usable roof ring for panel placement: footprint inset by the
  // parapet boundary. Falls back to the raw terrace when the offset
  // degenerates (narrow sections), so placement never crashes.
  const usableRing = useMemo(() => {
    if (terraceRing.length < 3) return terraceRing;
    return offsetPolygonInward(terraceRing, parapetInsetM) ?? terraceRing;
  }, [terraceRing, parapetInsetM]);

  // Transparency (X-ray) mode: see the roof boundary against interior
  // structures. Mutates materials in place via rebuild — no scene reset.
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
  // the configuration — recomputed when any of them change (the revision
  // counter backs the explicit "Recalculate" action). Disabled by default:
  // an empty configuration produces zero panel meshes, never a full roof.
  const configError = validatePanelConfig(panelConfig);
  const placement = useMemo(
    () =>
      configError
        ? { panels: [], reason: configError as string | null }
        : !panelsEnabled
          ? { panels: [], reason: null }
          : placePanels({ terrace: usableRing, obstacles, config: panelConfig }),
    [usableRing, obstacles, panelConfig, configError, panelRevision, panelsEnabled],
  );

  // Capacity: count × watts / 1000, from the selected configuration.
  const panelCount = configError ? 0 : placement.panels.length;
  const capacityKw = totalCapacityKw(
    panelCount,
    panelTypeDefinition(panelConfig.panelTypeId).watts,
  );

  // Stable identity for the viewport layer (a fresh object every render would
  // rebuild the InstancedMesh on each parent render). Null while disabled so
  // the viewer effect cleans up any previous group and renders no panels.
  const panelLayer = useMemo(
    () => (panelsEnabled ? { config: panelConfig, panels: configError ? [] : placement.panels } : null),
    [panelConfig, placement, configError, panelsEnabled],
  );

  // Mounting is Flat Roof only for now: any non-flat patch (stale state,
  // future callers) is normalised back to flat; the engine keeps supporting
  // other types internally for later milestones.
  const handlePanelConfigChange = (patch: Partial<PanelLayoutConfig>) => {
    setPanelConfig((current) => {
      const { mounting, ...rest } = patch;
      return { ...current, ...rest, mounting: mounting === undefined ? current.mounting : "flat" };
    });
  };

  // Obstacles that no longer satisfy the rules (e.g. the terrace changed).
  const invalidObstacles = useMemo(
    () => findInvalidObstacles(obstacles, terraceRing, parapetInsetM),
    [obstacles, terraceRing, parapetInsetM],
  );

  // Draft candidate + its deterministic validation result (drives the ghost).
  const draftResult = useMemo(() => {
    const candidate = draftToObstacle(obstacleDraft, selectedObstacleId ?? "obstacle-draft");
    const others = obstacles.filter(
      (o) => obstacleMode !== "editing" || o.id !== selectedObstacleId,
    );
    return validateObstacle(candidate, { terrace: terraceRing, others, parapetInsetM });
  }, [obstacleDraft, selectedObstacleId, obstacles, obstacleMode, terraceRing, parapetInsetM]);

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
    return validateObstacle(drawnTemp, { terrace: terraceRing, others: obstacles, parapetInsetM }).valid;
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
  const areaText = metrics ? formatArea(metrics.areaM2) : "—";
  const perimeterText = metrics ? `${metrics.perimeterM.toFixed(1)} m` : "—";
  const volumeText = metrics ? `${(metrics.areaM2 * model.heightM).toFixed(1)} m³` : "—";
  const extentText = `${model.extentM.east.toFixed(1)} m × ${model.extentM.north.toFixed(1)} m`;

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

  const handleRoofPlace = (x: number, y: number) => {
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
          onRoofPlace={handleRoofPlace}
          onRoofFinish={drawing ? finishFootprint : undefined}
          footprintPoints={drawing ? footPoints : null}
          footprintDrawing={drawing}
          sun={sun.clock}
          panelLayer={panelLayer}
          siteAnchor={siteAnchor}
          parapet={parapetModel}
          xray={xray}
          className="model-viewport"
        />
      </div>

      {/* Viewport hint + camera/design-mode actions */}
      <p className="stage-card__hint" style={{ marginBottom: "var(--space-3)" }}>
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
        {obstacleMode !== "idle"
          ? "Click the roof to position the footprint · Drag to rotate · Scroll or pinch to zoom"
          : "Drag to rotate · Scroll or pinch to zoom · Click an obstacle to select it"}
        <button
          type="button"
          className="btn"
          onClick={() => viewerRef.current?.resetCamera()}
          title="Return to the default 3D view"
        >
          Reset view
        </button>
        {designMode ? (
          <button type="button" className="btn" onClick={onExitDesign} title="Return to the full-map workspace">
            Back to map
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onEnterDesign}
            title="Expand the 3D workspace: the panel becomes the primary surface"
          >
            Open 3D design view
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setXray((v) => !v)}
          aria-pressed={xray}
          title="Fade the building shell to inspect the roof boundary against interior structures"
        >
          {xray ? "Solid view" : "X-ray"}
        </button>
      </p>

        </div>
        <div className="design-side">
      <p className="stage-card__eyebrow">Stage 2 of 6</p>
      <h2 className="stage-card__title">3D Building Model</h2>
      <p className="stage-card__body">
        The terrace outline has been extruded to {model.heightM.toFixed(1)} m.
        Rotate and zoom to inspect the building from all angles.
      </p>

      {/* Building metrics — all values come from the projected geometry */}
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
        <div>
          <dt>Total height</dt>
          <dd>{(model.heightM + parapetHeightM).toFixed(1)} m</dd>
        </div>
        <div>
          <dt>Volume (approx.)</dt>
          <dd>{volumeText}</dd>
        </div>
      </dl>

      {/* Sun simulation: date, local time, sun position, full-day playback */}
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

      {/* Rooftop obstacles */}
      <div className="obstacle-section">
        <div className="obstacle-toolbar">
          <div className="obstacle-toolbar__labels">
            <h3 className="obstacle-section__title">Rooftop obstacles</h3>
            <p className="obstacle-count">
              {obstacles.length === 0
                ? "None on the roof yet"
                : `${obstacles.length} obstacle${obstacles.length === 1 ? "" : "s"} on the roof`}
            </p>
          </div>
          {obstacleMode === "idle" && (
            <button type="button" className="btn btn--secondary" onClick={startAddObstacle}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              Add obstacle
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
                  className={`obstacle-item${
                    selectedObstacleId === obstacle.id ? " is-selected" : ""
                  }${invalid ? " is-invalid" : ""}`}
                >
                  <div className="obstacle-item__body">
                    <span className="obstacle-item__name">{label}</span>
                    <span className="obstacle-item__meta">
                      {formatObstacleDimensions(obstacle)} · {obstacle.rotation}° · E{" "}
                      {obstacle.position.x.toFixed(1)} · N {obstacle.position.y.toFixed(1)}
                      {invalid ? ` · ${invalid.error}` : ""}
                    </span>
                  </div>
                  <div className="obstacle-item__actions">
                    <button
                      type="button"
                      className="btn btn--subtle"
                      onClick={() => startEditObstacle(obstacle)}
                    >
                      <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--subtle-danger"
                      onClick={() => handleDeleteObstacle(obstacle.id)}
                      aria-label={`Delete ${label}`}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Solar panel layout (Phase 5): strictly opt-in. The roof stays empty
          until the user explicitly enables placement; disabling again removes
          every panel mesh and resets the counts. */}
      {panelsEnabled ? (
        <>
          <div className="stage-card__actions" style={{ marginBottom: "var(--space-2)" }}>
            <button type="button" className="btn btn--secondary" onClick={() => setPanelsEnabled(false)}>
              Remove solar panels
            </button>
          </div>
          <SolarPanelSection
            config={panelConfig}
            onConfigChange={handlePanelConfigChange}
            onRecalculate={() => setPanelRevision((revision) => revision + 1)}
            panelCount={panelCount}
            capacityKw={capacityKw}
            warning={placement.reason}
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

      {/* Actions */}
      <div className="stage-card__actions actions-duo">
        <button type="button" className="btn btn--secondary" onClick={() => setEditingHeight(true)}>
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
          Change height
        </button>
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
