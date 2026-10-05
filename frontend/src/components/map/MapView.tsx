import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildMapStyle, IMAGERY_LAYER_ID, TERRAIN_SOURCE_ID } from "./mapStyle";
import type { FeatureCollection } from "geojson";
import { BUILDINGS_LAYER_ID, LABEL_LAYER_ID, ROAD_LAYER_ID } from "../../providers/basemap";
import { INDIA_VIEW } from "../../config/locations";
import type { BoundingBox, LayerSettings, MapErrorEntry, MapViewState } from "../../types";
import { activeImageryProvider } from "../../providers/imagery";
import { activeTerrainProvider } from "../../providers/terrain";
import type { SelectionMode } from "../../hooks/useSelection";
import type { LngLat } from "../../lib/geo";

export interface MapViewHandle {
  flyToPlace(lng: number, lat: number, zoom?: number): void;
  fitBounds(bounds: BoundingBox): void;
  zoomBy(delta: number): void;
  resetNorth(): void;
  togglePitch(): void;
  getMap(): MapLibreMap | null;
}

interface MapViewProps {
  layers: LayerSettings;
  onViewChange: (state: MapViewState) => void;
  onMapError: (entry: Omit<MapErrorEntry, "id" | "at">) => void;
  onReady?: () => void;
  selectionMode?: SelectionMode;
  vertices?: LngLat[];
  panelFootprints?: FeatureCollection | null;
  orientation?: { tilt_deg: number; azimuth_deg: number } | null;
  selectionCentroid?: LngLat | null;
  shadowFC?: FeatureCollection | null;
  onAddVertex?: (point: LngLat) => void;
  onFinishDrawing?: () => void;
  onBeginDrag?: () => void;
  onMoveVertex?: (index: number, point: LngLat) => void;
  onDeleteVertex?: (index: number) => void;
}

const SOURCE_ERROR_KIND: Record<string, MapErrorEntry["kind"]> = {
  [IMAGERY_LAYER_ID]: "imagery",
  imagery: "imagery",
  [TERRAIN_SOURCE_ID]: "terrain",
  "osm-context": "basemap",
};

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { layers, onViewChange, onMapError, onReady, selectionMode = "idle", vertices = [], panelFootprints = null, orientation = null, selectionCentroid = null, shadowFC = null, onAddVertex, onFinishDrawing, onBeginDrag, onMoveVertex, onDeleteVertex },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef({ onViewChange, onMapError, onReady });
  callbacks.current = { onViewChange, onMapError, onReady };
  const selCallbacks = useRef({ onAddVertex, onFinishDrawing, onBeginDrag, onMoveVertex, onDeleteVertex });
  selCallbacks.current = { onAddVertex, onFinishDrawing, onBeginDrag, onMoveVertex, onDeleteVertex };
  const modeRef = useRef(selectionMode);
  modeRef.current = selectionMode;
  const verticesRef = useRef(vertices);
  verticesRef.current = vertices;
  const dragIndexRef = useRef<number | null>(null);

  // Selection sources/layers are added once the map style has loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!map.getSource("sel-polygon")) {
      map.addSource("sel-polygon", { type: "geojson", data: emptyFC() });
      map.addSource("sel-vertices", { type: "geojson", data: emptyFC() });
      map.addSource("panel-footprints", { type: "geojson", data: emptyFC() });
      map.addSource("sel-shadows", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "sel-fill",
        type: "fill",
        source: "sel-polygon",
        paint: { "fill-color": "#0f6e7a", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "sel-line",
        type: "line",
        source: "sel-polygon",
        paint: { "line-color": "#0f6e7a", "line-width": 2.5 },
      });
      map.addLayer({
        id: "sel-vertices",
        type: "circle",
        source: "sel-vertices",
        paint: {
          "circle-radius": 5.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#0f6e7a",
          "circle-stroke-width": 2,
        },
      });
      // First vertex is the "close polygon" affordance during drawing.
      map.addLayer({
        id: "sel-vertices-first",
        type: "circle",
        source: "sel-vertices",
        filter: ["==", ["get", "index"], 0],
        paint: {
          "circle-radius": 8,
          "circle-color": "#0f6e7a",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
        },
      });
      // Dark PV modules with a thin light frame + small inter-module separation
      // (separation comes from the min_panel_spacing_m packing gap).
      map.addLayer({
        id: "panel-fill",
        type: "fill",
        source: "panel-footprints",
        paint: { "fill-color": "#101c38", "fill-opacity": 0.88 },
      });
      map.addLayer({
        id: "panel-cell-lines",
        type: "line",
        source: "panel-footprints",
        paint: { "line-color": "#3d5a99", "line-width": 0.4, "line-opacity": 0.5 },
      });
      map.addLayer({
        id: "panel-outline",
        type: "line",
        source: "panel-footprints",
        paint: { "line-color": "#c8d4f0", "line-width": 0.8 },
      });
      // Recommended azimuth direction arrow (subtle, map-native).
      if (!map.getSource("orientation-arrow")) {
        map.addSource("orientation-arrow", { type: "geojson", data: emptyFC() });
      }
      if (!map.getLayer("orientation-arrow")) {
        map.addLayer({
          id: "orientation-arrow",
          type: "line",
          source: "orientation-arrow",
          paint: { "line-color": "#ffb300", "line-width": 2.5, "line-opacity": 0.9 },
        });
      }
      map.addLayer({
        id: "sel-shadows-fill",
        type: "fill",
        source: "sel-shadows",
        paint: { "fill-color": "#1a237e", "fill-opacity": 0.28 },
      });
    }
  }, [loaded]);

  // Keep selection geometry in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const polySource = map.getSource("sel-polygon") as maplibregl.GeoJSONSource | undefined;
    const vertSource = map.getSource("sel-vertices") as maplibregl.GeoJSONSource | undefined;
    if (polySource) polySource.setData(polygonFC(vertices));
    if (vertSource) vertSource.setData(pointsFC(vertices));
  }, [vertices, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("panel-footprints") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(panelFootprints ?? emptyFC());
  }, [panelFootprints, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("sel-shadows") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(shadowFC ?? emptyFC());
  }, [shadowFC, loaded]);

  // Recommended azimuth arrow from the panel-field centroid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("orientation-arrow") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!orientation || !selectionCentroid || !panelFootprints?.features?.length) {
      source.setData(emptyFC());
      return;
    }
    source.setData(azimuthArrowFC(selectionCentroid, orientation.azimuth_deg));
  }, [orientation, selectionCentroid, panelFootprints, loaded]);

  // Drawing interactions.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (modeRef.current === "drawing") {
        const points = verticesRef.current;
        // Clicking the first vertex with 3+ points closes/finishes the polygon.
        if (points.length >= 3) {
          const first = map.project([points[0].lng, points[0].lat]);
          const clicked = map.project(event.lngLat);
          if (Math.hypot(first.x - clicked.x, first.y - clicked.y) <= 14) {
            selCallbacks.current.onFinishDrawing?.();
            return;
          }
        }
        selCallbacks.current.onAddVertex?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
      }
    };
    const onDblClick = (event: maplibregl.MapMouseEvent) => {
      if (modeRef.current === "drawing") {
        event.preventDefault();
        selCallbacks.current.onFinishDrawing?.();
      }
    };
    const onVertexDown = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (modeRef.current !== "editing" && modeRef.current !== "confirmed") return;
      const feature = event.features?.[0];
      if (!feature || feature.properties?.index === undefined) return;
      const index = Number(feature.properties.index);
      dragIndexRef.current = index;
      selCallbacks.current.onBeginDrag?.();
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };
    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      if (dragIndexRef.current === null) return;
      selCallbacks.current.onMoveVertex?.(dragIndexRef.current, { lng: event.lngLat.lng, lat: event.lngLat.lat });
    };
    const onMouseUp = () => {
      if (dragIndexRef.current !== null) {
        dragIndexRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
      }
    };
    const onContextMenu = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (modeRef.current !== "editing" && modeRef.current !== "confirmed") return;
      const feature = event.features?.[0];
      if (!feature) return;
      event.preventDefault();
      selCallbacks.current.onDeleteVertex?.(Number(feature.properties?.index));
    };
    const onVertexEnter = () => {
      if (modeRef.current === "drawing") {
        map.getCanvas().style.cursor = "pointer";
      } else if (modeRef.current === "editing" || modeRef.current === "confirmed") {
        map.getCanvas().style.cursor = "grab";
      }
    };
    const onVertexLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("mousedown", "sel-vertices", onVertexDown as never);
    map.on("contextmenu", "sel-vertices", onContextMenu as never);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.on("mouseenter", "sel-vertices", onVertexEnter);
    map.on("mouseleave", "sel-vertices", onVertexLeave);

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("mousedown", "sel-vertices", onVertexDown as never);
      map.off("contextmenu", "sel-vertices", onContextMenu as never);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.off("mouseenter", "sel-vertices", onVertexEnter);
      map.off("mouseleave", "sel-vertices", onVertexLeave);
    };
  }, [loaded]);

  // Disable scroll-zoom-style double-click zoom while drawing/editing so dblclick can finish.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectionMode === "drawing" || selectionMode === "editing") {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [selectionMode, loaded]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(),
      center: [INDIA_VIEW.center.lng, INDIA_VIEW.center.lat],
      zoom: INDIA_VIEW.zoom,
      bearing: 0,
      pitch: 0,
      maxPitch: 70,
      attributionControl: { compact: true }, // single attribution control; MapLibre default is not duplicated
      dragRotate: true,
      pitchWithRotate: true,
      renderWorldCopies: false,
      fadeDuration: 150,
    });
    mapRef.current = map;

    const emitView = () => {
      const center = map.getCenter();
      callbacks.current.onViewChange({
        center: { lng: center.lng, lat: center.lat },
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };
    map.on("move", emitView);
    map.on("load", () => {
      setLoaded(true);
      emitView();
      callbacks.current.onReady?.();
    });

    map.on("error", (event: { error?: Error; sourceId?: string }) => {
      const message = event.error?.message ?? "Unknown map error";
      // Never log request URLs or auth headers; only classify the failure.
      const kind = (event.sourceId && SOURCE_ERROR_KIND[event.sourceId]) || "style";
      if (kind === "imagery" && /404|no such tile/i.test(message)) return;
      callbacks.current.onMapError({ kind, message: friendlyMessage(kind, message) });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Apply layer settings whenever they change, without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    setPaint(map, IMAGERY_LAYER_ID, "raster-opacity", layers.satelliteOpacity);
    for (const id of [ROAD_LAYER_ID, LABEL_LAYER_ID]) {
      setPaint(map, id, id === ROAD_LAYER_ID ? "line-opacity" : "text-opacity", layers.contextOpacity * (id === ROAD_LAYER_ID ? 0.75 : 1));
    }
    if (map.getLayer(BUILDINGS_LAYER_ID)) {
      map.setLayoutProperty(BUILDINGS_LAYER_ID, "visibility", layers.buildings3d ? "visible" : "none");
    }
    if (layers.terrain) {
      if (map.getSource(TERRAIN_SOURCE_ID)) {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: layers.terrainExaggeration });
      }
    } else {
      map.setTerrain(null);
    }
  }, [layers, loaded]);

  useImperativeHandle(
    ref,
    () => ({
      flyToPlace(lng, lat, zoom = 16) {
        mapRef.current?.flyTo({ center: [lng, lat], zoom, essential: true, duration: 1400 });
      },
      fitBounds(bounds) {
        mapRef.current?.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 60, maxZoom: 17, duration: 1400, essential: true },
        );
      },
      zoomBy(delta) {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ zoom: map.getZoom() + delta, duration: 220 });
      },
      resetNorth() {
        mapRef.current?.easeTo({ bearing: 0, duration: 300 });
      },
      togglePitch() {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ pitch: map.getPitch() > 1 ? 0 : 55, duration: 500 });
      },
      getMap() {
        return mapRef.current;
      },
    }),
    [],
  );

  return (
    <div className="map-view" role="application" aria-label="Satellite map of India. Use mouse, touch, or keyboard arrows to navigate.">
      <div ref={containerRef} className="map-view__canvas" data-mode={selectionMode} />
      {!loaded && <div className="map-view__loading" aria-live="polite">Loading map</div>}
      <div className="map-legend" aria-hidden="true">
        <span className="map-legend__north" title="North">N ↑</span>
        {orientation && panelFootprints?.features?.length ? (
          <span className="map-legend__azimuth">Panels face {compassShort(orientation.azimuth_deg)} · {Math.round(orientation.azimuth_deg)}°</span>
        ) : null}
      </div>
    </div>
  );
});

function azimuthArrowFC(center: LngLat, azimuthDeg: number): FeatureCollection {
  // ~25 m arrow extending from the panel-field centroid toward the azimuth.
  const rad = (azimuthDeg * Math.PI) / 180;
  const latM = 111320;
  const lngM = 111320 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.2);
  const lenM = 25;
  const dx = (Math.sin(rad) * lenM) / lngM;
  const dy = (Math.cos(rad) * lenM) / latM;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[center.lng, center.lat], [center.lng + dx, center.lat + dy]] },
      },
    ],
  };
}

function compassShort(azimuthDeg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8;
  return names[idx];
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function polygonFC(vertices: LngLat[]): FeatureCollection {
  if (vertices.length < 3) {
    // While drawing, show an open line of the points so far.
    if (vertices.length === 0) return emptyFC();
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: vertices.map((v) => [v.lng, v.lat]),
          },
        },
      ],
    };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [vertices.map((v) => [v.lng, v.lat]).concat([[vertices[0].lng, vertices[0].lat]])],
        },
      },
    ],
  };
}

function pointsFC(vertices: LngLat[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vertices.map((v, index) => ({
      type: "Feature" as const,
      properties: { index },
      geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
    })),
  };
}

function setPaint(map: MapLibreMap, layerId: string, property: string, value: number) {
  if (!map.getLayer(layerId)) return;
  try {
    map.setPaintProperty(layerId, property as never, value);
  } catch {
    // Layer exists but property not valid for its type; ignore rather than crash the map.
  }
}

function friendlyMessage(kind: MapErrorEntry["kind"], raw: string): string {
  const providerNote =
    kind === "imagery"
      ? `${activeImageryProvider.getDisplayName()} tiles failed to load.`
      : kind === "terrain"
        ? `${activeTerrainProvider.getDisplayName()} elevation failed to load.`
        : kind === "basemap"
          ? "Road and label data failed to load."
          : "Map style error.";
  return `${providerNote} ${raw.length > 140 ? raw.slice(0, 140) + "…" : raw}`;
}

export type { MapLayerMouseEvent };
