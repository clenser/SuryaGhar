import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Undo2, X } from "lucide-react";
import { MapView, type MapViewHandle } from "./components/map/MapView";
import { computeCentroidUtm, wgsPolygonToLocalMetres } from "./lib/3d/coordinates";
import { createObstacleId, splitPolygon, type Obstacle } from "./lib/3d/obstacles";
import type { LngLat } from "./lib/geo";
import { MapControls } from "./components/map/MapControls";
import { MapToolbar } from "./components/map/MapToolbar";
import { ImagerySelector } from "./components/map/ImagerySelector";
import { Header } from "./components/workspace/Header";
import { StatusBar } from "./components/workspace/StatusBar";
import { LayerPanel } from "./components/panels/LayerPanel";
import { LocationCard } from "./components/panels/LocationCard";
import { StageProgress } from "./components/workspace/StageProgress";
import { DEFAULT_LAYERS, useMapState } from "./hooks/useMapState";
import { ResetControl } from "./components/workspace/ResetControl";
import { SheetBar } from "./components/workspace/SheetBar";
import { useBottomSheet } from "./hooks/useBottomSheet";
import { useSelection } from "./hooks/useSelection";
import { useObstacles } from "./hooks/useObstacles";
import { useValidation } from "./hooks/useValidation";
import { BACKEND_WAITING_LABEL, useBackendReady } from "./hooks/useBackendStatus";
import { formatPlaceContext } from "./services/geocode";
import { KOLKATA_PLACE } from "./config/locations";
import { SelectionPanel } from "./components/selection/SelectionPanel";
import { ValidatePanel } from "./components/analysis/ValidatePanel";
import type { LocationResult } from "./types";
import type { SegmentationModel } from "./services/analysis";
import { ensureBackendAwake } from "./services/backendStatus";

type Stage = "select" | "model" | "validate";

// The 3D workspace (Three.js + local coordinate conversion) is only needed once
// the user opens the Model stage, so it is code-split out of the first load
// (AGENTS.md §75 progressive loading).
const ModelPanel = lazy(() => import("./components/analysis/ModelPanel"));

export default function App() {
  const mapRef = useRef<MapViewHandle | null>(null);
  const { layers, updateLayers, view, setView, errors, recordError } = useMapState();
  const [advanced, setAdvanced] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Default initial location: Kolkata. Replaced as soon as the user searches
  // elsewhere; never re-applied afterwards.
  const [place, setPlace] = useState<LocationResult | null>(KOLKATA_PLACE);
  const [measureOn, setMeasureOn] = useState(true);
  const [imageryFailed, setImageryFailed] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const selection = useSelection();
  const [stage, setStage] = useState<Stage>("select");
  const [buildingHeight, setBuildingHeight] = useState<number | null>(null);
  /**
   * Parapet height above the roof (m). Null means "no explicit value yet" —
   * consumers fall back to DEFAULT_PARAPET_HEIGHT_M so old projects keep
   * rendering a parapet instead of breaking.
   */
  const [parapetHeight, setParapetHeight] = useState<number | null>(null);
  /** Configurable panel-to-parapet clear gap (m); null = default. */
  const [parapetClearance, setParapetClearance] = useState<number | null>(null);
  /**
   * 3D design workspace (correction milestone): when true, the side panel
   * becomes the primary surface and the satellite map docks as a context
   * inset (CSS-only switch — no remounts, no provider churn, no second map).
   * Entered explicitly from the Model stage, exited explicitly or whenever
   * the stage/site changes.
   */
  const [designMode, setDesignMode] = useState(false);
  /** Read-only Final Model presentation mode active after Step 3 validation */
  const [finalView, setFinalView] = useState(false);
  // Rooftop obstacles: application state, cleared with the selection so a new
  // site never inherits another rooftop's objects (AGENTS.md §40).
  const obstacleStore = useObstacles();
  // Segmentation model persists across stages; validation only runs when the
  // user clicks "Proceed with analysis". Default: Tiny (sam2_tiny).
  const [segmentationModel, setSegmentationModel] = useState<SegmentationModel>("sam2_tiny");
  // Validation state lives here so tab switches (which unmount ValidatePanel)
  // never lose the result. Reset is the explicit way to clear it.
  const validation = useValidation();
  // Mobile bottom-sheet state. Desktop ignores it (CSS-gated below 600px).
  const sheetCtl = useBottomSheet("partial");
  // Readiness gate: backend-dependent controls (Validate,
  // compute/analyse actions, stage transitions past Select) stay disabled
  // until GET /api/ready reports 200. Map browsing, search, selection,
  // editing and measurements are map-local and never lock. Unlocking is
  // automatic via the shared store — no refresh, no state reset.
  const backendReady = useBackendReady();

  // Probe the local backend exactly once on page load, before any user
  // action. ensureBackendAwake() single-flights concurrent callers (StrictMode
  // double-mount, rerenders), and the shared backendStatus store drives the
  // header pill from checking -> online without any further work here.
  // Deliberately NOT aborted on cleanup: under StrictMode the cleanup runs
  // before the second effect, and aborting would leave the second mount
  // sharing an already-dead promise — no live probe, pill stuck mid-state
  // until some later request happened to succeed. A shared live cycle is
  // single-active by construction, and the module-level store survives HMR.
  useEffect(() => {
    ensureBackendAwake().catch(() => {
      // Status UI already reflects the outcome; boot must never fail on probe.
    });
  }, []);

  const [nearbyBuildingFlow, setNearbyBuildingFlow] = useState<{
    step: "draw" | "height";
    vertices: LngLat[];
    height: number;
  } | null>(null);

  const handleStartAddNearbyBuilding = useCallback(() => {
    setNearbyBuildingFlow({
      step: "draw",
      vertices: [],
      height: 12,
    });
  }, []);

  const handleCancelNearbyBuilding = useCallback(() => {
    setNearbyBuildingFlow(null);
    setDesignMode(true);
  }, []);

  const handleConfirmNearbyBuilding = useCallback(() => {
    if (!nearbyBuildingFlow || nearbyBuildingFlow.vertices.length < 3) return;
    const originUtm = computeCentroidUtm(selection.vertices);
    const localPoints = wgsPolygonToLocalMetres(nearbyBuildingFlow.vertices, originUtm);
    const { centroid, offsets } = splitPolygon(localPoints);
    const xs = offsets.map((p) => p.x);
    const ys = offsets.map((p) => p.y);
    const width = Math.max(0.5, Math.max(...xs) - Math.min(...xs));
    const length = Math.max(0.5, Math.max(...ys) - Math.min(...ys));

    const newBuildingObstacle: Obstacle = {
      id: createObstacleId(),
      type: "building",
      position: centroid,
      width,
      length,
      height: Math.max(1, nearbyBuildingFlow.height || 12),
      rotation: 0,
      polygon: offsets,
    };

    obstacleStore.add(newBuildingObstacle);
    setNearbyBuildingFlow(null);
    setDesignMode(true);
  }, [nearbyBuildingFlow, selection.vertices, obstacleStore]);

  // Selection cleared -> reset overlays and the current stage so the UI never
  // shows a dead-end stage panel.
  useEffect(() => {
    if (selection.mode === "idle") {
      setStage("select");
      setDesignMode(false);
      setFinalView(false);
      setBuildingHeight(null);
      setParapetHeight(null);
      obstacleStore.clear();
      setNearbyBuildingFlow(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.mode, obstacleStore.clear]);

  // Full workspace reset back to the clean initial state. Permanent app/API
  // configuration (layers object shape, providers, thresholds) is untouched;
  // only user session state is cleared and defaults restored.
  const handleReset = useCallback(() => {
    selection.clear();
    validation.reset();
    setBuildingHeight(null);
    setParapetHeight(null);
    obstacleStore.clear();
    setNearbyBuildingFlow(null);
    setSegmentationModel("sam2_tiny");
    setStage("select");
    setDesignMode(false);
    setFinalView(false);
    setPlace(KOLKATA_PLACE);
    updateLayers({ ...DEFAULT_LAYERS });
    mapRef.current?.flyToPlace(KOLKATA_PLACE.longitude, KOLKATA_PLACE.latitude, 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, updateLayers]);

  // A genuinely new polygon belongs to a new analysis: drop the old result.
  // Tab switches alone never touch validation state (it lives above).
  const verticesKey = JSON.stringify(selection.vertices);
  useEffect(() => {
    validation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticesKey]);

  const hasAnalysisData =
    selection.vertices.length > 0 ||
    validation.snapshot.kind !== "idle" ||
    obstacleStore.obstacles.length > 0 ||
    buildingHeight !== null ||
    stage !== "select";

  // Location search only updates the selected place + camera. SEARCHING is not a
  // workflow stage: selecting/closing the search popup must never mutate `stage`.
  const handleSelectPlace = useCallback((next: LocationResult) => {
    setPlace(next);
    if (next.bounds && next.bounds.north - next.bounds.south > 0.02) {
      mapRef.current?.fitBounds(next.bounds);
    } else {
      mapRef.current?.flyToPlace(next.longitude, next.latitude, next.locality ? 15.5 : 15);
    }
  }, []);

  const handleModelHeight = useCallback(
    (height: number) => {
      setBuildingHeight(height);
      setStage("model");
    },
    []
  );

  // Advanced controls and diagnostics live in the layers panel, so turning advanced on also opens it.
  const handleAdvancedToggle = useCallback(() => {
    setAdvanced((on) => {
      if (!on) setLayersOpen(true);
      return !on;
    });
  }, []);

  // Locate: fly to the browser geolocation, falling back to Kolkata.
  const handleLocate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      mapRef.current?.flyToPlace(KOLKATA_PLACE.longitude, KOLKATA_PLACE.latitude, 13);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.flyToPlace(pos.coords.longitude, pos.coords.latitude, 15),
      () => mapRef.current?.flyToPlace(KOLKATA_PLACE.longitude, KOLKATA_PLACE.latitude, 13),
      { timeout: 8000 },
    );
  }, []);

  const handleMapError = useCallback(
    (entry: Parameters<typeof recordError>[0]) => {
      recordError(entry);
      if (entry.kind === "imagery") {
        setImageryFailed(true);
        setBannerMessage(entry.message);
        setBannerDismissed(false);
      }
    },
    [recordError],
  );

  // Escape closes the layers panel, a standard overlay behaviour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && layersOpen) setLayersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layersOpen]);

  const showBanner = imageryFailed && !bannerDismissed;

  // Sidebar stage navigation. The map stays clean: progress is communicated
  // through the current stage panel, section headings and primary actions.
  const stageOrder: Stage[] = ["select", "model", "validate"];
  const has3DWorkspace = (stage === "model" || stage === "validate") && selection.vertices.length >= 3;
  const inDesignWorkspace = has3DWorkspace && (designMode || stage === "validate" || finalView) && nearbyBuildingFlow === null;

  return (
    <div className="app" data-sheet={sheetCtl.sheet}>
      <Header advanced={advanced} onAdvancedToggle={handleAdvancedToggle} onSelectPlace={handleSelectPlace} designMode={inDesignWorkspace} />

      <main className={`workspace${inDesignWorkspace ? " design-mode" : ""}`} data-sheet={sheetCtl.sheet}>
        {/*
          Design mode owns the workspace: the map unmounts completely (no
          hidden inset, no background GPU work) and the panel becomes the 3D
          design surface. Mounting again on exit resumes the preserved
          provider state via ensureProviderWatch — never a fresh wake cycle.
        */}
        {!inDesignWorkspace && (
        <MapView
          ref={mapRef}
          layers={layers}
          onViewChange={setView}
          onMapError={handleMapError}
          onReady={() => {
            setImageryFailed(false);
            setBannerMessage(null);
          }}
          backgroundPolygon={nearbyBuildingFlow ? selection.vertices : null}
          selectionMode={
            nearbyBuildingFlow
              ? nearbyBuildingFlow.step === "draw"
                ? (nearbyBuildingFlow.vertices.length >= 3 ? "editing" : "drawing")
                : "idle"
              : selection.mode
          }
          vertices={nearbyBuildingFlow ? nearbyBuildingFlow.vertices : selection.vertices}
          selectionCentroid={
            nearbyBuildingFlow
              ? null
              : selection.metrics
                ? { lng: selection.metrics.centroid.lng, lat: selection.metrics.centroid.lat }
                : null
          }
          showMeasurements={measureOn}
          onAddVertex={
            nearbyBuildingFlow
              ? (point) => {
                  if (nearbyBuildingFlow.step !== "draw") return;
                  const last = nearbyBuildingFlow.vertices[nearbyBuildingFlow.vertices.length - 1];
                  if (last && Math.abs(last.lng - point.lng) < 1e-6 && Math.abs(last.lat - point.lat) < 1e-6) return;
                  setNearbyBuildingFlow((prev) => (prev ? { ...prev, vertices: [...prev.vertices, point] } : null));
                }
              : selection.addVertex
          }
          onFinishDrawing={
            nearbyBuildingFlow
              ? () => {
                  if (nearbyBuildingFlow.vertices.length >= 3) {
                    setNearbyBuildingFlow((prev) => (prev ? { ...prev, step: "height" } : null));
                  }
                }
              : selection.finishDrawing
          }
          onBeginDrag={nearbyBuildingFlow ? () => {} : selection.beginVertexDrag}
          onMoveVertex={
            nearbyBuildingFlow
              ? (index, point) => {
                  setNearbyBuildingFlow((prev) =>
                    prev ? { ...prev, vertices: prev.vertices.map((p, i) => (i === index ? point : p)) } : null
                  );
                }
              : selection.moveVertex
          }
          onDeleteVertex={
            nearbyBuildingFlow
              ? (index) => {
                  setNearbyBuildingFlow((prev) =>
                    prev ? { ...prev, vertices: prev.vertices.filter((_, i) => i !== index) } : null
                  );
                }
              : selection.deleteVertex
          }
        />
        )}

        <div className={`stage-panel-wrapper${panelCollapsed && !inDesignWorkspace ? " is-collapsed" : ""}`}>
          {!inDesignWorkspace && (
            <button
              type="button"
              className="stage-panel__toggle"
              onClick={() => setPanelCollapsed((c) => !c)}
              aria-label={panelCollapsed ? "Expand control panel" : "Collapse control panel"}
              title={panelCollapsed ? "Expand control panel" : "Collapse control panel"}
            >
              <ChevronRight
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                className={`stage-panel__toggle-icon${panelCollapsed ? " is-collapsed" : ""}`}
              />
            </button>
          )}

          <div className="stage-panel" data-sheet={sheetCtl.sheet}>
          <SheetBar
            sheet={sheetCtl.sheet}
            stageLabel={
              stage === "select"
                ? "Select area"
                : stage === "model"
                  ? "3D building & solar"
                  : "Surface assessment"
            }
            summary={
              validation.snapshot.kind === "ok"
                ? "Assessment ready"
                : null
            }
            onCycle={sheetCtl.cycle}
            onDragEnd={sheetCtl.applyDrag}
          />
          <div className="stage-panel__body">
          {place ? (
            <LocationCard
              name={place.name}
              context={formatPlaceContext(place)}
              latitude={place.latitude}
              longitude={place.longitude}
            />
          ) : null}
          {!backendReady && (
            <p className="readiness-lock" role="status">
              <span className="readiness-lock__dot" aria-hidden="true" />
              {BACKEND_WAITING_LABEL} You can browse the map and select an area meanwhile.
            </p>
          )}
          <StageProgress
            steps={stageOrder.map((s) => ({
              id: s,
              label:
                s === "select"
                  ? "Select"
                  : s === "model"
                    ? "Model & 3D"
                    : "Validate",
              disabled:
                s === "select"
                  ? false
                  : selection.mode !== "confirmed",
            }))}
            currentId={stage}
            onSelect={(id) => {
              const nextStage = id as Stage;
              setStage(nextStage);
              setFinalView(false);
              if (nextStage === "select") {
                setDesignMode(false);
              } else if (nextStage === "validate") {
                setDesignMode(true);
              }
            }}
            backendLocked={!backendReady}
          />

          {nearbyBuildingFlow ? (
            <div className="stage-card">
              <p className="stage-card__eyebrow">Nearby Obstacle Simulation</p>
              {nearbyBuildingFlow.step === "draw" ? (
                <>
                  <h2 className="stage-card__title">Outline Nearby Building</h2>
                  <p className="stage-card__body">
                    Click to trace the boundary of a nearby building or obstacle on the map.
                    The green polygon marks your main rooftop terrace. Draw at least 3 points, then proceed to enter its height.
                  </p>
                  <p className="stage-card__meta" aria-live="polite">
                    {nearbyBuildingFlow.vertices.length} point{nearbyBuildingFlow.vertices.length === 1 ? "" : "s"} placed
                    {nearbyBuildingFlow.vertices.length >= 3 ? " · Outline complete" : " (draw at least 3 points)"}
                  </p>
                  <div className="stage-card__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={nearbyBuildingFlow.vertices.length < 3}
                      onClick={() => setNearbyBuildingFlow((prev) => prev ? { ...prev, step: "height" } : null)}
                    >
                      <Check size={15} strokeWidth={2} aria-hidden="true" />
                      Next: Enter height
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={nearbyBuildingFlow.vertices.length === 0}
                      onClick={() => setNearbyBuildingFlow((prev) => prev ? { ...prev, vertices: prev.vertices.slice(0, -1) } : null)}
                    >
                      <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
                      Undo
                    </button>
                    <button
                      type="button"
                      className="btn btn--subtle"
                      onClick={handleCancelNearbyBuilding}
                    >
                      <X size={15} strokeWidth={1.75} aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="stage-card__title">Enter Building Height</h2>
                  <p className="stage-card__body">
                    Enter the estimated height of this nearby building in metres. It will be extruded from the ground in 3D to simulate realistic shadow casting onto your rooftop and solar panels.
                  </p>
                  <div className="field" style={{ marginTop: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                    <label htmlFor="nearby-building-height">Building Height</label>
                    <div className="height-input-row">
                      <input
                        id="nearby-building-height"
                        type="number"
                        step="0.5"
                        min="1"
                        max="100"
                        value={nearbyBuildingFlow.height}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setNearbyBuildingFlow((prev) => prev ? { ...prev, height: val } : null);
                        }}
                        autoFocus
                      />
                      <span className="height-unit">m</span>
                    </div>
                  </div>
                  <div className="stage-card__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={!nearbyBuildingFlow.height || nearbyBuildingFlow.height <= 0}
                      onClick={handleConfirmNearbyBuilding}
                    >
                      <Check size={15} strokeWidth={2} aria-hidden="true" />
                      Confirm & View in 3D
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setNearbyBuildingFlow((prev) => prev ? { ...prev, step: "draw" } : null)}
                    >
                      Back to outline
                    </button>
                    <button
                      type="button"
                      className="btn btn--subtle"
                      onClick={handleCancelNearbyBuilding}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {stage === "select" && (
                <SelectionPanel
                  selection={selection}
                  onStartValidate={() => setStage("model")}
                  backendReady={backendReady}
                />
              )}
              {has3DWorkspace && (
                <Suspense
                  fallback={
                    <div className="stage-card">
                      <p className="stage-card__eyebrow">Stage 2 of 3</p>
                      <h2 className="stage-card__title">Loading 3D workspace…</h2>
                    </div>
                  }
                >
                  <ModelPanel
                    vertices={selection.vertices}
                    metrics={selection.metrics}
                    buildingHeight={buildingHeight}
                    onSetHeight={handleModelHeight}
                    parapetHeight={parapetHeight}
                    onSetParapetHeight={setParapetHeight}
                    parapetClearance={parapetClearance}
                    onSetParapetClearance={setParapetClearance}
                    onContinue={() => {
                      setDesignMode(true);
                      setFinalView(false);
                      setStage("validate");
                    }}
                    backendReady={backendReady}
                    siteCountry={place?.country}
                    obstacles={obstacleStore.obstacles}
                    onAddObstacle={obstacleStore.add}
                    onUpdateObstacle={obstacleStore.update}
                    onRemoveObstacle={obstacleStore.remove}
                    designMode={designMode}
                    onEnterDesign={() => setDesignMode(true)}
                    onExitDesign={() => setDesignMode(false)}
                    finalView={finalView}
                    onBackToDesign={() => setFinalView(false)}
                    onBackToMap={() => {
                      setFinalView(false);
                      setDesignMode(false);
                      setStage("select");
                    }}
                    onReset={handleReset}
                    hasAnalysisData={hasAnalysisData}
                    stage={stage === "validate" ? "validate" : "model"}
                    onStartAddNearbyBuilding={handleStartAddNearbyBuilding}
                    validationPanel={
                      <ValidatePanel
                        snapshot={validation.snapshot}
                        elapsed={validation.elapsed}
                        segmentationModel={segmentationModel}
                        onSegmentationModelChange={setSegmentationModel}
                        onProceed={(model) => validation.proceed(selection.vertices, model)}
                        onContinue={() => {
                          setStage("model");
                          setDesignMode(true);
                          setFinalView(true);
                        }}
                        onRedraw={() => {
                          setFinalView(false);
                          setDesignMode(false);
                          setStage("select");
                        }}
                        onBackToModel={() => {
                          setStage("model");
                          setFinalView(false);
                        }}
                        backendReady={backendReady}
                      />
                    }
                  />
                </Suspense>
              )}
            </>
          )}
          {selection.mode === "confirmed" && stage !== "select" && selection.vertices.length < 3 && (
            <div className="stage-card">
              <h2 className="stage-card__title">No valid selection</h2>
              <p className="stage-card__body">Draw and confirm an area before continuing.</p>
              <button type="button" className="btn" onClick={() => setStage("select")}>Back to selection</button>
            </div>
          )}

          {/* Bottom Reset control is hidden in Step 2 / design mode (reclaimed for 3D viewport height) */}
          {stage !== "model" && !inDesignWorkspace && (
            <ResetControl hasData={hasAnalysisData} onReset={handleReset} />
          )}
          </div>
        </div>
      </div>

        {showBanner && (
          <div className="map-banner" role="status">
            <div>
              <strong>Primary map could not be loaded.</strong>
              <span>
                {bannerMessage ||
                  " Check your connection, privacy shields or ad blockers. The backup MapLibre map will be used automatically."}
              </span>
            </div>
            <button type="button" className="map-banner__dismiss" onClick={() => setBannerDismissed(true)}>
              Dismiss
            </button>
          </div>
        )}

        {/*
          Map-only chrome is unmounted (not merely hidden) in design mode:
          the imagery selector, drawing toolbar, map controls and layer panel
          belong to the 2D workspace. Their state lives in App, so exiting
          design mode restores them untouched.
        */}
        {!inDesignWorkspace && (
          <>
            <ImagerySelector onOpenLayers={() => setLayersOpen(true)} />

        <MapToolbar
          mode={selection.mode}
          hasVertices={selection.vertices.length > 0}
          measureOn={measureOn}
          onSelect={selection.start}
          onEdit={selection.enterEditing}
          onClear={selection.clear}
          onMeasure={() => setMeasureOn((v) => !v)}
        />

        <MapControls
          bearing={view?.bearing ?? 0}
          pitch={view?.pitch ?? 0}
          onLocate={handleLocate}
          layersOpen={layersOpen}
          terrainOn={layers.terrain}
          buildingsOn={layers.buildings3d}
          onZoomIn={() => mapRef.current?.zoomBy(1)}
          onZoomOut={() => mapRef.current?.zoomBy(-1)}
          onResetNorth={() => mapRef.current?.resetNorth()}
          onTogglePitch={() => mapRef.current?.togglePitch()}
          onToggleTerrain={() => updateLayers({ terrain: !layers.terrain })}
          onToggleLayers={() => setLayersOpen((v) => !v)}
        />

        <LayerPanel
          open={layersOpen}
          layers={layers}
          advanced={advanced}
          errors={errors}
          onChange={updateLayers}
          onAdvancedChange={setAdvanced}
          onClose={() => setLayersOpen(false)}
          onJumpTo={handleSelectPlace}
        />
          </>
        )}

      </main>

      <StatusBar view={view} selectedName={place?.name ?? null} />
      <span className="sr-only" aria-live="polite">
        Map provider: Google Maps Satellite
      </span>
    </div>
  );
}
