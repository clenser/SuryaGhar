import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { BoundingBox, LayerSettings, MapErrorEntry, MapViewState } from "../../types";
import type { SelectionMode } from "../../hooks/useSelection";
import type { LngLat } from "../../lib/geo";
import { GoogleMapView, type GoogleMapViewHandle } from "./GoogleMapView";
import type { MapLibreMapViewHandle } from "./MapLibreMapView";
import {
  ensureProviderWatch,
  failGoogleWatch,
  failMapProvider,
  markGoogleReady,
  markMapLibreReady,
  useMapProvider,
} from "../../services/mapProvider";

// Backup provider loads ONLY when the fallback actually runs: the
// maplibre-gl runtime and its CSS stay out of the initial bundle.
const MapLibreMapView = lazy(() =>
  import("./MapLibreMapView").then((m) => ({ default: m.MapLibreMapView })),
);

// Pure geometry/measurement helpers stay reachable from the historical import
// path (tests and panels import them from this module).
export { compassShort, measureFC, panelCellsFC } from "./GoogleMapView";
export type { MeasureData } from "./GoogleMapView";

export interface MapViewHandle {
  flyToPlace(lng: number, lat: number, zoom?: number): void;
  fitBounds(bounds: BoundingBox): void;
  zoomBy(delta: number): void;
  resetNorth(): void;
  togglePitch(): void;
  getMap(): google.maps.Map | MapLibreMap | null;
}

interface MapViewProps {
  layers: LayerSettings;
  initialView?: MapViewState | null;
  onViewChange: (state: MapViewState) => void;
  onMapError: (entry: Omit<MapErrorEntry, "id" | "at">) => void;
  onReady?: () => void;
  selectionMode?: SelectionMode;
  vertices?: LngLat[];
  backgroundPolygon?: LngLat[] | null;
  panelFootprints?: import("geojson").FeatureCollection | null;
  orientation?: { tilt_deg: number; azimuth_deg: number } | null;
  selectionCentroid?: LngLat | null;
  shadowFC?: import("geojson").FeatureCollection | null;
  showMeasurements?: boolean;
  onAddVertex?: (point: LngLat) => void;
  onFinishDrawing?: () => void;
  onBeginDrag?: () => void;
  onMoveVertex?: (index: number, point: LngLat) => void;
  onDeleteVertex?: (index: number) => void;
}

/**
 * Provider-switching map view. Google Maps stays the primary implementation
 * (GoogleMapView); the previous MapLibre implementation (MapLibreMapView —
 * Esri World Imagery + OpenFreeMap context) is the automatic backup. Exactly
 * one child is mounted at a time — keyed so the two providers can never share
 * a container — and all timing lives in the shared mapProvider store.
 */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const provider = useMapProvider();
  const googleRef = useRef<GoogleMapViewHandle | null>(null);
  const libreRef = useRef<MapLibreMapViewHandle | null>(null);
  // Last viewport reported by whichever provider is active, so a mid-session
  // fallback resumes at the same location/zoom/rotation.
  const lastView = useRef<MapViewState | null>(null);

  // Arm the readiness watch when the map initializes. Idempotent in the
  // store: StrictMode double-mount, remounts and HMR cannot double-arm it.
  // Soft entry preserves terminal provider states (returning from the 3D
  // design workspace resumes the working provider, never a fresh cycle).
  useEffect(() => {
    ensureProviderWatch();
  }, []);

  const activeChild = () => googleRef.current ?? libreRef.current;

  useImperativeHandle(
    ref,
    () => ({
      flyToPlace(lng: number, lat: number, zoom?: number) {
        activeChild()?.flyToPlace(lng, lat, zoom);
      },
      fitBounds(bounds: BoundingBox) {
        activeChild()?.fitBounds(bounds);
      },
      zoomBy(delta: number) {
        activeChild()?.zoomBy(delta);
      },
      resetNorth() {
        activeChild()?.resetNorth();
      },
      togglePitch() {
        activeChild()?.togglePitch();
      },
      getMap() {
        return googleRef.current?.getMap() ?? libreRef.current?.getMap() ?? null;
      },
    }),
    [],
  );

  const onViewChange = (state: MapViewState) => {
    lastView.current = state;
    props.onViewChange(state);
  };

  const onGoogleReady = () => {
    markGoogleReady(); // cancels the fallback watch/timers
    props.onReady?.();
  };
  const onGoogleError = (entry: Omit<MapErrorEntry, "id" | "at">) => {
    // Every error the Google child reports is definitive (loader rejection,
    // construction failure, gm_authFailure) → start the countdown at once.
    failGoogleWatch(entry.message);
    props.onMapError(entry);
  };

  const onMapLibreReady = () => {
    markMapLibreReady();
    props.onReady?.(); // clears the imagery-failed banner on success
  };
  const onMapLibreError = (entry: Omit<MapErrorEntry, "id" | "at">) => {
    // Non-fatal source warnings (partial tile failures) — record only; the
    // backup map keeps working. Fatal paths go through onInitError/store watch.
    props.onMapError(entry);
  };
  const onMapLibreFatal = (message: string) => {
    failMapProvider(message);
    props.onMapError({ kind: "style", message });
  };

  const showGoogle =
    provider === "google-loading" || provider === "google-ready" || provider === "fallback-countdown";
  const showMapLibre = provider === "maplibre-loading" || provider === "maplibre-ready";

  const shared = {
    layers: props.layers,
    selectionMode: props.selectionMode,
    vertices: props.vertices,
    backgroundPolygon: props.backgroundPolygon,
    panelFootprints: props.panelFootprints,
    orientation: props.orientation,
    selectionCentroid: props.selectionCentroid,
    shadowFC: props.shadowFC,
    showMeasurements: props.showMeasurements,
    onAddVertex: props.onAddVertex,
    onFinishDrawing: props.onFinishDrawing,
    onBeginDrag: props.onBeginDrag,
    onMoveVertex: props.onMoveVertex,
    onDeleteVertex: props.onDeleteVertex,
  };

  return (
    <>
      {showGoogle && (
        <GoogleMapView
          key="google"
          ref={googleRef}
          {...shared}
          initialView={props.initialView ?? lastView.current}
          onViewChange={onViewChange}
          onMapError={onGoogleError}
          onReady={onGoogleReady}
        />
      )}
      {showMapLibre && (
        <Suspense
          fallback={
            <div
              className="map-view"
              role="application"
              aria-label="Satellite map of India. Use mouse, touch, or keyboard arrows to navigate."
            >
              <div className="map-view__loading" aria-live="polite">Loading map</div>
            </div>
          }
        >
          <MapLibreMapView
            key="maplibre"
            ref={libreRef}
            {...shared}
            initialView={props.initialView ?? lastView.current}
            onViewChange={onViewChange}
            onMapError={onMapLibreError}
            onReady={onMapLibreReady}
            onInitError={onMapLibreFatal}
          />
        </Suspense>
      )}
      {provider === "map-error" && (
        <div
          className="map-view map-view--error"
          role="application"
          aria-label="Satellite map of India. Use mouse, touch, or keyboard arrows to navigate."
        >
          <div className="map-view__error" role="alert">
            Map unavailable — both map providers failed. Use the retry action in the header.
          </div>
        </div>
      )}
    </>
  );
});
