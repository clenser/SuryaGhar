import { useCallback, useEffect, useRef, useState } from "react";
import { MapView, type MapViewHandle } from "./components/map/MapView";
import { MapControls } from "./components/map/MapControls";
import { Header } from "./components/workspace/Header";
import { OnboardingCard } from "./components/workspace/OnboardingCard";
import { StatusBar } from "./components/workspace/StatusBar";
import { LayerPanel } from "./components/panels/LayerPanel";
import { SelectedPlaceCard } from "./components/panels/SelectedPlaceCard";
import { useMapState } from "./hooks/useMapState";
import { useSelection } from "./hooks/useSelection";
import { formatPlaceContext } from "./services/geocode";
import { activeImageryProvider } from "./providers/imagery";
import { SelectionPanel } from "./components/selection/SelectionPanel";
import { ValidatePanel } from "./components/analysis/ValidatePanel";
import { DesignPanel } from "./components/analysis/DesignPanel";
import { SolarPanel } from "./components/analysis/SolarPanel";
import { SitePanel } from "./components/analysis/SitePanel";
import type { LocationResult } from "./types";

type Stage = "select" | "validate" | "design" | "solar" | "site";

export default function App() {
  const mapRef = useRef<MapViewHandle | null>(null);
  const { layers, updateLayers, view, setView, errors, recordError } = useMapState();
  const [advanced, setAdvanced] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [place, setPlace] = useState<LocationResult | null>(null);
  const [imageryFailed, setImageryFailed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const selection = useSelection();
  const [stage, setStage] = useState<Stage>("select");
  const [panelFootprints, setPanelFootprints] = useState<GeoJSON.FeatureCollection | null>(null);
  const [shadowFC, setShadowFC] = useState<GeoJSON.FeatureCollection | null>(null);
  const [capacityKwp, setCapacityKwp] = useState(0);

  // Selection cleared -> reset overlays, capacity, and the current stage so the UI never
  // shows a dead-end stage panel.
  useEffect(() => {
    if (selection.mode === "idle") {
      setStage("select");
      setPanelFootprints(null);
      setShadowFC(null);
      setCapacityKwp(0);
    }
  }, [selection.mode]);

  const handleSelectPlace = useCallback((next: LocationResult) => {
    setPlace(next);
    if (next.bounds && next.bounds.north - next.bounds.south > 0.02) {
      mapRef.current?.fitBounds(next.bounds);
    } else {
      mapRef.current?.flyToPlace(next.longitude, next.latitude, next.locality ? 15.5 : 15);
    }
  }, []);

  // Advanced controls and diagnostics live in the layers panel, so turning advanced on also opens it.
  const handleAdvancedToggle = useCallback(() => {
    setAdvanced((on) => {
      if (!on) setLayersOpen(true);
      return !on;
    });
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

  // Derive the workflow stepper from the same source of truth as the stage panel.
  const workflowStep = !place
    ? 0
    : selection.mode !== "confirmed"
      ? 1
      : stage === "select"
        ? 2
        : stage === "validate"
          ? 2
          : stage === "design"
            ? 3
            : stage === "solar"
              ? 4
              : 5;
  const TITLES: Record<number, string> = {
    0: "Find a property to begin",
    1: "Select an area",
    2: "Validate the surface",
    3: "Design the solar layout",
    4: "Analyse",
    5: "Results",
  };
  const SUBTITLES: Record<number, string> = {
    0: "Search for an address, locality or landmark in India. The map will move to that place.",
    1: "Zoom to a rooftop or open ground, then draw a polygon around it.",
    2: "Let HOTOSM, OSM and AI vision check what you selected.",
    3: "Compute the panel layout for this area.",
    4: "Estimate annual energy and site context.",
    5: "Review surroundings, shadows and final numbers.",
  };
  const workflowTitle = TITLES[workflowStep];
  const workflowSubtitle = SUBTITLES[workflowStep];

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
          shadowFC={shadowFC}
          onAddVertex={selection.addVertex}
          onFinishDrawing={selection.finishDrawing}
          onBeginDrag={selection.beginVertexDrag}
          onMoveVertex={selection.moveVertex}
          onDeleteVertex={selection.deleteVertex}
        />

        <div className="stage-panel">
          <div className="stage-tabs" role="tablist" aria-label="Analysis stages">
            {(["select", "validate", "design", "solar", "site"] as Stage[]).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={stage === s}
                className={stage === s ? "is-active" : ""}
                disabled={
                  s === "select"
                    ? false
                    : s === "solar"
                      ? selection.mode !== "confirmed" || capacityKwp <= 0
                      : selection.mode !== "confirmed"
                }
                onClick={() => setStage(s)}
              >
                {s === "select" ? "Select" : s === "validate" ? "Validate" : s === "design" ? "Design" : s === "solar" ? "Solar" : "Site"}
              </button>
            ))}
          </div>

          {stage === "select" && (
            <SelectionPanel selection={selection} onStartValidate={() => setStage("validate")} />
          )}
          {stage === "validate" && selection.vertices.length >= 3 && (
            <ValidatePanel vertices={selection.vertices} onContinue={() => setStage("design")} onRedraw={() => setStage("select")} />
          )}
          {stage === "design" && selection.vertices.length >= 3 && (
            <DesignPanel
              vertices={selection.vertices}
              onResult={setPanelFootprints}
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

        <MapControls
          bearing={view?.bearing ?? 0}
          pitch={view?.pitch ?? 0}
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

        {place ? (
          <SelectedPlaceCard
            name={place.name}
            context={formatPlaceContext(place)}
            latitude={place.latitude}
            longitude={place.longitude}
            onClear={() => setPlace(null)}
          />
        ) : null}

        <OnboardingCard
          visible
          step={workflowStep}
          title={workflowTitle}
          subtitle={workflowSubtitle}
        />
      </main>

      <StatusBar view={view} selectedName={place?.name ?? null} />
      <span className="sr-only" aria-live="polite">
        Map provider: {activeImageryProvider.getDisplayName()}
      </span>
    </div>
  );
}
