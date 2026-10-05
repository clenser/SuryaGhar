import { useCallback, useEffect, useRef, useState } from "react";
import { MapView, type MapViewHandle } from "./components/map/MapView";
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
import { useSelection } from "./hooks/useSelection";
import { useValidation } from "./hooks/useValidation";
import { formatPlaceContext } from "./services/geocode";
import { activeImageryProvider } from "./providers/imagery";
import { KOLKATA_PLACE } from "./config/locations";
import { SelectionPanel } from "./components/selection/SelectionPanel";
import { ValidatePanel } from "./components/analysis/ValidatePanel";
import { DesignPanel } from "./components/analysis/DesignPanel";
import { SolarPanel } from "./components/analysis/SolarPanel";
import { SitePanel } from "./components/analysis/SitePanel";
import type { LocationResult } from "./types";
import type { SegmentationModel } from "./services/analysis";
import { ensureBackendAwake } from "./services/backendStatus";

type Stage = "select" | "validate" | "design" | "solar" | "site";

export default function App() {
  const mapRef = useRef<MapViewHandle | null>(null);
  const { layers, updateLayers, view, setView, errors, recordError } = useMapState();
  const [advanced, setAdvanced] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  // Default initial location: Kolkata. Replaced as soon as the user searches
  // elsewhere; never re-applied afterwards.
  const [place, setPlace] = useState<LocationResult | null>(KOLKATA_PLACE);
  const [measureOn, setMeasureOn] = useState(true);
  const [imageryFailed, setImageryFailed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const selection = useSelection();
  const [stage, setStage] = useState<Stage>("select");
  const [panelFootprints, setPanelFootprints] = useState<GeoJSON.FeatureCollection | null>(null);
  const [shadowFC, setShadowFC] = useState<GeoJSON.FeatureCollection | null>(null);
  const [capacityKwp, setCapacityKwp] = useState(0);
  // Segmentation model persists across stages; validation only runs when the
  // user clicks "Proceed with analysis". Default: Tiny (sam2_tiny).
  const [segmentationModel, setSegmentationModel] = useState<SegmentationModel>("sam2_tiny");
  const [designOrientation, setDesignOrientation] = useState<{ tilt_deg: number; azimuth_deg: number } | null>(null);
  // Validation state lives here so tab switches (which unmount ValidatePanel)
  // never lose the result. Reset is the explicit way to clear it.
  const validation = useValidation();

  // Wake the on-demand backend exactly once on page load, before any user
  // action. ensureBackendAwake() single-flights concurrent callers (StrictMode
  // double-mount, rerenders), and the shared backendStatus store drives the
  // header pill from starting -> online without any further work here.
  useEffect(() => {
    ensureBackendAwake().catch(() => {
      // Status UI already reflects the outcome; boot must never fail on wake.
    });
  }, []);

  // Selection cleared -> reset overlays, capacity, and the current stage so the UI never
  // shows a dead-end stage panel.
  useEffect(() => {
    if (selection.mode === "idle") {
      setStage("select");
      setPanelFootprints(null);
      setShadowFC(null);
      setCapacityKwp(0);
      setDesignOrientation(null);
    }
  }, [selection.mode]);

  // Full workspace reset back to the clean initial state. Permanent app/API
  // configuration (layers object shape, providers, thresholds) is untouched;
  // only user session state is cleared and defaults restored.
  const handleReset = useCallback(() => {
    selection.clear();
    validation.reset();
    setPanelFootprints(null);
    setShadowFC(null);
    setCapacityKwp(0);
    setDesignOrientation(null);
    setSegmentationModel("sam2_tiny");
    setStage("select");
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
    panelFootprints !== null ||
    shadowFC !== null ||
    capacityKwp > 0 ||
    designOrientation !== null ||
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

  const handleLayoutResult = useCallback(
    (footprints: GeoJSON.FeatureCollection | null, orientation?: { tilt_deg: number; azimuth_deg: number } | null) => {
      setPanelFootprints(footprints);
      setDesignOrientation(orientation ?? null);
    },
    [],
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
  const stageOrder: Stage[] = ["select", "validate", "design", "solar", "site"];

  return (
    <div className="app">
      <Header advanced={advanced} onAdvancedToggle={handleAdvancedToggle} onSelectPlace={handleSelectPlace} />

      <main className="workspace">
        <MapView
          ref={mapRef}
          layers={layers}
          onViewChange={setView}
          onMapError={handleMapError}
          onReady={() => setImageryFailed(false)}
          selectionMode={selection.mode}
          vertices={selection.vertices}
          panelFootprints={panelFootprints}
          orientation={designOrientation}
          selectionCentroid={
            selection.metrics
              ? { lng: selection.metrics.centroid.lng, lat: selection.metrics.centroid.lat }
              : null
          }
          shadowFC={shadowFC}
          showMeasurements={measureOn}
          onAddVertex={selection.addVertex}
          onFinishDrawing={selection.finishDrawing}
          onBeginDrag={selection.beginVertexDrag}
          onMoveVertex={selection.moveVertex}
          onDeleteVertex={selection.deleteVertex}
        />

        <div className="stage-panel">
          {place ? (
            <LocationCard
              name={place.name}
              context={formatPlaceContext(place)}
              latitude={place.latitude}
              longitude={place.longitude}
            />
          ) : null}
          <StageProgress
            steps={stageOrder.map((s) => ({
              id: s,
              label:
                s === "select"
                  ? "Select"
                  : s === "validate"
                    ? "Validate"
                    : s === "design"
                      ? "Design"
                      : s === "solar"
                        ? "Solar"
                        : "Site",
              disabled:
                s === "select"
                  ? false
                  : s === "solar"
                    ? selection.mode !== "confirmed" || capacityKwp <= 0
                    : selection.mode !== "confirmed",
            }))}
            currentId={stage}
            onSelect={(id) => setStage(id as Stage)}
          />

          {stage === "select" && (
            <SelectionPanel selection={selection} onStartValidate={() => setStage("validate")} />
          )}
          {stage === "validate" && selection.vertices.length >= 3 && (
            <ValidatePanel
              snapshot={validation.snapshot}
              elapsed={validation.elapsed}
              segmentationModel={segmentationModel}
              onSegmentationModelChange={setSegmentationModel}
              onProceed={(model) => validation.proceed(selection.vertices, model)}
              onContinue={() => setStage("design")}
              onRedraw={() => setStage("select")}
            />
          )}
          {stage === "design" && selection.vertices.length >= 3 && (
            <DesignPanel
              vertices={selection.vertices}
              onResult={handleLayoutResult}
              onContinue={(kwp) => {
                setCapacityKwp(kwp);
                setStage("solar");
              }}
            />
          )}
          {stage === "solar" && selection.metrics && capacityKwp > 0 && (
            <SolarPanel
              latitude={selection.metrics.centroid.lat}
              longitude={selection.metrics.centroid.lng}
              capacityKwp={capacityKwp}
              onContinue={() => setStage("site")}
            />
          )}
          {stage === "site" && selection.vertices.length >= 3 && (
            <SitePanel vertices={selection.vertices} onShadows={setShadowFC} />
          )}
          {selection.mode === "confirmed" && stage !== "select" && stage !== "site" && selection.vertices.length < 3 && (
            <div className="stage-card">
              <h2 className="stage-card__title">No valid selection</h2>
              <p className="stage-card__body">Draw and confirm an area before continuing.</p>
              <button type="button" className="btn" onClick={() => setStage("select")}>Back to selection</button>
            </div>
          )}

          <ResetControl hasData={hasAnalysisData} onReset={handleReset} />
        </div>

        {showBanner && (
          <div className="map-banner" role="status">
            <div>
              <strong>Satellite imagery could not be loaded.</strong>
              <span> Check your connection or try another location. Analysis accuracy may differ on any fallback source.</span>
            </div>
            <button type="button" className="map-banner__dismiss" onClick={() => setBannerDismissed(true)}>
              Dismiss
            </button>
          </div>
        )}

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

      </main>

      <StatusBar view={view} selectedName={place?.name ?? null} />
      <span className="sr-only" aria-live="polite">
        Map provider: {activeImageryProvider.getDisplayName()}
      </span>
    </div>
  );
}
