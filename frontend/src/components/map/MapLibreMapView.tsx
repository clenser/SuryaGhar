import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildMapStyle, IMAGERY_LAYER_ID, TERRAIN_SOURCE_ID } from "./mapStyle";
import type { FeatureCollection } from "geojson";
import { BUILDINGS_LAYER_ID, LABEL_LAYER_ID, ROAD_LAYER_ID } from "../../providers/basemap";
import { KOLKATA_VIEW } from "../../config/locations";
import type { BoundingBox, LayerSettings, MapErrorEntry, MapViewState } from "../../types";
import { activeImageryProvider } from "../../providers/imagery";
import { activeTerrainProvider } from "../../providers/terrain";
import type { SelectionMode } from "../../hooks/useSelection";
import { formatArea, projectUtm, type LngLat } from "../../lib/geo";

export interface MapLibreMapViewHandle {
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
  /** Viewport captured from the primary provider so a mid-session fallback
   *  resumes at the same location/zoom instead of jumping to the default. */
  initialView?: MapViewState | null;
  /** Fatal construction failure (e.g. WebGL unavailable) — distinct from the
   *  non-fatal source errors reported through onMapError. */
  onInitError?: (message: string) => void;
  selectionMode?: SelectionMode;
  vertices?: LngLat[];
  panelFootprints?: FeatureCollection | null;
  orientation?: { tilt_deg: number; azimuth_deg: number } | null;
  selectionCentroid?: LngLat | null;
  shadowFC?: FeatureCollection | null;
  showMeasurements?: boolean;
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

/**
 * Touch pointers need bigger drag handles and label pills. A true 44px canvas
 * handle would swallow small rooftops, so this is the practical maximum that
 * keeps the map usable while still being comfortable to hit.
 */
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export const MapLibreMapView = forwardRef<MapLibreMapViewHandle, MapViewProps>(function MapLibreMapView(
  { layers, onViewChange, onMapError, onReady, initialView = null, onInitError, selectionMode = "idle", vertices = [], panelFootprints = null, orientation = null, selectionCentroid = null, shadowFC = null, showMeasurements = true, onAddVertex, onFinishDrawing, onBeginDrag, onMoveVertex, onDeleteVertex },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef({ onViewChange, onMapError, onReady });
  callbacks.current = { onViewChange, onMapError, onReady };
  const fatalRef = useRef(onInitError);
  fatalRef.current = onInitError;
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
    // Touch pointers get larger drag handles (44px-class touch targets are
    // impossible for canvas circles; 9px radius is the practical maximum
    // before handles obscure small rooftops).
    const coarse = isCoarsePointer();
    const handleRadius = coarse ? 9 : 5.5;
    const handleFirstRadius = coarse ? 11 : 8;
    if (!map.getSource("sel-polygon")) {
      map.addSource("sel-polygon", { type: "geojson", data: emptyFC() });
      map.addSource("sel-vertices", { type: "geojson", data: emptyFC() });
      map.addSource("panel-footprints", { type: "geojson", data: emptyFC() });
      map.addSource("sel-shadows", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "sel-fill",
        type: "fill",
        source: "sel-polygon",
        paint: { "fill-color": "#13a8b5", "fill-opacity": 0.16 },
      });
      // Soft glow under the selection outline so the roof reads on any imagery.
      map.addLayer({
        id: "sel-glow",
        type: "line",
        source: "sel-polygon",
        paint: {
          "line-color": "#13a8b5",
          "line-width": 9,
          "line-opacity": 0.28,
          "line-blur": 6,
        },
      });
      map.addLayer({
        id: "sel-line",
        type: "line",
        source: "sel-polygon",
        paint: { "line-color": "#13a8b5", "line-width": 2.5 },
      });
      map.addLayer({
        id: "sel-vertices",
        type: "circle",
        source: "sel-vertices",
        paint: {
          "circle-radius": handleRadius,
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
          "circle-radius": handleFirstRadius,
          "circle-color": "#0f6e7a",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
        },
      });
      // CAD-style measurement annotations (labels + ticks), fed by measureFC.
      map.addSource("measure-labels", { type: "geojson", data: emptyFC() });
      map.addSource("measure-ticks", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "measure-tick-casing",
        type: "line",
        source: "measure-ticks",
        paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "measure-ticks",
        type: "line",
        source: "measure-ticks",
        paint: { "line-color": "#0b1f33", "line-width": 1.4, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "measure-labels",
        type: "symbol",
        source: "measure-labels",
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["get", "size"],
          "text-rotate": ["get", "rotate"],
          "text-rotation-alignment": "map",
          "text-font": ["Noto Sans Regular"],
          "text-padding": 4,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0b1f33",
          "text-halo-width": 4,
          "text-halo-blur": 0.6,
        },
      });
      // Dark PV modules with a thin light frame + small inter-module separation
      // (separation comes from the min_panel_spacing_m packing gap).
      map.addLayer({
        id: "panel-fill",
        type: "fill",
        source: "panel-footprints",
        paint: { "fill-color": "#0b1526", "fill-opacity": 0.92 },
      });
      map.addLayer({
        id: "panel-outline",
        type: "line",
        source: "panel-footprints",
        paint: { "line-color": "#d7e3f5", "line-width": 0.9, "line-opacity": 0.9 },
      });
      // Subtle hover highlight for the panel under the cursor.
      map.addLayer({
        id: "panel-hover",
        type: "fill",
        source: "panel-footprints",
        filter: ["==", ["get", "_pi"], -1],
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.14 },
      });
      // Cell/frame dividers derived from the real panel geometry (separate
      // source so the texture follows panel rotation exactly).
      map.addSource("panel-cells", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "panel-cell-lines",
        type: "line",
        source: "panel-cells",
        paint: { "line-color": "#8ea6c8", "line-width": 0.5, "line-opacity": 0.55 },
      });
      // Single compact orientation indicator at the panel-field centroid.
      // Rotation is applied imperatively from the backend azimuth (not via a
      // data expression) so the marker can never silently end up unrotated.
      map.addSource("panel-direction", { type: "geojson", data: emptyFC() });
      try {
        if (!map.hasImage("dir-chevron")) {
          map.addImage("dir-chevron", makeChevronImage(), { pixelRatio: 2 });
        }
      } catch {
        // Canvas image generation unavailable; the textual legend still shows
        // the facing direction. Never break the remaining layers.
      }
      map.addLayer({
        id: "panel-direction",
        type: "symbol",
        source: "panel-direction",
        layout: {
          "icon-image": "dir-chevron",
          "icon-size": 0.85,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotate": 0,
          "icon-rotation-alignment": "map",
        },
      });
      map.addLayer({
        id: "sel-shadows-fill",
        type: "fill",
        source: "sel-shadows",
        paint: { "fill-color": "#1a237e", "fill-opacity": 0.28 },
      });
    }
  }, [loaded]);

  // Keep selection geometry + live CAD measurements in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const polySource = map.getSource("sel-polygon") as maplibregl.GeoJSONSource | undefined;
    const vertSource = map.getSource("sel-vertices") as maplibregl.GeoJSONSource | undefined;
    if (polySource) polySource.setData(polygonFC(vertices));
    if (vertSource) vertSource.setData(pointsFC(vertices));
    const measured = showMeasurements
      ? measureFC(vertices, isCoarsePointer() ? 1.2 : 1)
      : { labels: emptyFC(), ticks: emptyFC() };
    const labelSource = map.getSource("measure-labels") as maplibregl.GeoJSONSource | undefined;
    const tickSource = map.getSource("measure-ticks") as maplibregl.GeoJSONSource | undefined;
    if (labelSource) labelSource.setData(measured.labels);
    if (tickSource) tickSource.setData(measured.ticks);
  }, [vertices, loaded, showMeasurements]);

  const panelFootprintsRef = useRef(panelFootprints);
  panelFootprintsRef.current = panelFootprints;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("panel-footprints") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(indexedFootprints(panelFootprintsRef.current));
    const cells = map.getSource("panel-cells") as maplibregl.GeoJSONSource | undefined;
    if (cells) cells.setData(panelCellsFC(panelFootprintsRef.current));
  }, [panelFootprints, loaded]);

  // Subtle hover brightening for the panel under the cursor (visual only).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof map.queryRenderedFeatures !== "function") return;
    const clearHover = () => {
      try {
        if (map.getLayer("panel-hover")) map.setFilter("panel-hover", ["==", ["get", "_pi"], -1]);
      } catch {
        // Layer teardown race; ignore.
      }
    };
    const onHover = (event: maplibregl.MapMouseEvent) => {
      if (dragIndexRef.current !== null) return;
      try {
        const hits = map.queryRenderedFeatures(event.point, { layers: ["panel-fill"] });
        const id = hits.length > 0 ? Number(hits[0].properties?._pi ?? -1) : -1;
        if (map.getLayer("panel-hover")) map.setFilter("panel-hover", ["==", ["get", "_pi"], id]);
      } catch {
        // Query during style transitions; ignore.
      }
    };
    map.on("mousemove", onHover);
    const canvas = map.getCanvas();
    canvas.addEventListener("mouseleave", clearHover);
    return () => {
      map.off("mousemove", onHover);
      canvas.removeEventListener("mouseleave", clearHover);
    };
  }, [loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("sel-shadows") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(shadowFC ?? emptyFC());
  }, [shadowFC, loaded]);

  // Compact orientation indicator at the panel-field centroid, rotated to the
  // actual backend azimuth. No annotation arrows across the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("panel-direction") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!orientation || !selectionCentroid || !panelFootprints?.features?.length) {
      source.setData(emptyFC());
      return;
    }
    const az = ((orientation.azimuth_deg % 360) + 360) % 360;
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { azimuth: az },
          geometry: { type: "Point", coordinates: [selectionCentroid.lng, selectionCentroid.lat] },
        },
      ],
    });
    // Imperative rotation from the SAME backend azimuth value used for the
    // marker data and the legend text, so all three always agree.
    try {
      if (map.getLayer("panel-direction") && map.hasImage("dir-chevron")) {
        map.setLayoutProperty("panel-direction", "icon-rotate", az);
      }
    } catch {
      // Marker image missing (see setup guard); legend text still applies.
    }
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

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(),
        // Resume where the primary provider left off (mid-session fallback),
        // falling back to the default site view on first load.
        center: initialView
          ? [initialView.center.lng, initialView.center.lat]
          : [KOLKATA_VIEW.center.lng, KOLKATA_VIEW.center.lat],
        zoom: initialView ? initialView.zoom : KOLKATA_VIEW.zoom,
        maxZoom: 22,
        bearing: initialView ? initialView.bearing : 0,
        pitch: initialView ? initialView.pitch : 0,
        maxPitch: 70,
        attributionControl: { compact: true }, // single attribution control; MapLibre default is not duplicated
        dragRotate: true,
        pitchWithRotate: true,
        renderWorldCopies: false,
        fadeDuration: 150,
      });
    } catch (err) {
      // Construction failure (typically WebGL unavailable): fatal for this
      // provider — the state machine surfaces "Map unavailable" + retry.
      fatalRef.current?.(err instanceof Error ? err.message : "Backup map could not be created.");
      return;
    }
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
        const nextZoom = Math.min(Math.max(map.getZoom() + delta, 2), 22);
        map.easeTo({ zoom: nextZoom, duration: 220 });
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
        <span className="map-legend__north" title="North ΓÇö map orientation">N Γåæ</span>
        {orientation && panelFootprints?.features?.length ? (
          <span className="map-legend__azimuth" title="Panel orientation from the solar analysis">
            Panels face {compassShort(orientation.azimuth_deg)} ┬╖ {Math.round(((orientation.azimuth_deg % 360) + 360) % 360)}┬░
          </span>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Direction arrow badge (white halo, teal core): a real arrowhead on a
 * visible shaft, pointing up (= north before map rotation is applied).
 * Large enough to read the facing direction at a glance, small enough to
 * stay subordinate to the panel layout itself.
 */
function makeChevronImage(): ImageData {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const draw = (scale: number, color: string) => {
    const s = size / 2;
    ctx.fillStyle = color;
    // Shaft (tail): long, centered, from below-center up into the head.
    const shaftHalf = 4.5 * scale;
    ctx.fillRect(s - shaftHalf, s - 4 * scale, shaftHalf * 2, 24 * scale);
    // Arrowhead.
    ctx.beginPath();
    ctx.moveTo(s, s - 22 * scale);
    ctx.lineTo(s + 13 * scale, s + 2 * scale);
    ctx.lineTo(s - 13 * scale, s + 2 * scale);
    ctx.closePath();
    ctx.fill();
  };
  draw(1.4, "rgba(255,255,255,0.92)"); // halo for contrast on imagery
  draw(1.0, "#0f6e7a"); // teal core
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Cell/frame divider lines derived from real panel geometry. Each panel is a
 * rotated rectangle: inset a frame, add a longitudinal center line and evenly
 * spaced transverse dividers. Pure rendering ΓÇö positions still come 1:1 from
 * the backend footprints.
 */
export function panelCellsFC(panels: FeatureCollection | null): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  if (!panels?.features) return { type: "FeatureCollection", features };
  for (const feature of panels.features.slice(0, 400)) {
    const geom = feature.geometry;
    if (!geom || geom.type !== "Polygon") continue;
    const ring = geom.coordinates[0];
    if (!ring || ring.length < 4) continue;
    const lines = panelCellLines(ring as Array<[number, number]>);
    for (const line of lines) {
      features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
    }
  }
  return { type: "FeatureCollection", features };
}

function panelCellLines(ring: Array<[number, number]>): Array<Array<[number, number]>> {
  const pts = ring.slice(0, 4);
  const latRef = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  const kx = 111320 * Math.max(Math.cos((latRef * Math.PI) / 180), 0.2);
  const ky = 111320;
  const toM = (p: [number, number]): [number, number] => [(p[0] - pts[0][0]) * kx, (p[1] - pts[0][1]) * ky];
  const m = pts.map(toM);
  const cx = m.reduce((s, p) => s + p[0], 0) / m.length;
  const cy = m.reduce((s, p) => s + p[1], 0) / m.length;

  // Long axis = longest edge direction.
  const edges = [0, 1, 2, 3].map((i) => {
    const a = m[i];
    const b = m[(i + 1) % 4];
    return { dx: b[0] - a[0], dy: b[1] - a[1], len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  edges.sort((a, b) => b.len - a.len);
  const long = edges[0];
  if (long.len < 0.3) return [];
  const ux = long.dx / long.len;
  const uy = long.dy / long.len;
  // Short axis = perpendicular; extents from corner projections (robust to
  // vertex order and near-square panels).
  const vx = -uy;
  const vy = ux;
  let hl = 0;
  let hw = 0;
  for (const p of m) {
    hl = Math.max(hl, Math.abs((p[0] - cx) * ux + (p[1] - cy) * uy));
    hw = Math.max(hw, Math.abs((p[0] - cx) * vx + (p[1] - cy) * vy));
  }
  if (hw < 0.15) return [];

  const margin = Math.min(0.07, hl * 0.06, hw * 0.12);
  const il = hl - margin;
  const iw = hw - margin;
  const toLngLat = (x: number, y: number): [number, number] => [pts[0][0] + (cx + x) / kx, pts[0][1] + (cy + y) / ky];
  const corner = (a: number, b: number): [number, number] => toLngLat(a * ux + b * -uy, a * uy + b * ux);
  const out: Array<Array<[number, number]>> = [];

  // Frame.
  out.push([corner(-il, -iw), corner(il, -iw), corner(il, iw), corner(-il, iw), corner(-il, -iw)]);
  // Longitudinal center line.
  out.push([corner(-il, 0), corner(il, 0)]);
  // Transverse dividers (~6 cell rows).
  const rows = 6;
  for (let i = 1; i < rows; i++) {
    const t = -il + (2 * il * i) / rows;
    out.push([corner(t, -iw), corner(t, iw)]);
  }
  return out;
}

export function compassShort(azimuthDeg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8;
  return names[idx];
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** Backend footprints with a stable per-panel index for hover highlighting. */
function indexedFootprints(panels: FeatureCollection | null): FeatureCollection {
  if (!panels?.features) return emptyFC();
  return {
    type: "FeatureCollection",
    features: panels.features.map((feature, index) => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), _pi: index },
    })),
  };
}

export interface MeasureData {
  labels: FeatureCollection;
  ticks: FeatureCollection;
}

/**
 * CAD-style measurement annotations derived from real selection geometry:
 * per-edge length pills at edge midpoints (offset outward so they never cover
 * the polygon), perpendicular tick marks, and a central area label. All
 * distances come from the UTM projection in lib/geo ΓÇö nothing is hardcoded.
 *
 * `labelScale` grows the text pills on touch devices so measurements stay
 * readable without changing the underlying geometry (1 = desktop).
 */
export function measureFC(vertices: LngLat[], labelScale = 1): MeasureData {
  const edgeSize = Math.max(12, Math.round(12 * labelScale));
  const areaSize = Math.max(15, Math.round(15 * labelScale));
  const labels: FeatureCollection["features"] = [];
  const ticks: FeatureCollection["features"] = [];
  if (!vertices || vertices.length < 3) return { labels: emptyFC(), ticks: emptyFC() };
  const projected = vertices.map(projectUtm);
  const n = projected.length;
  const meanLat = vertices.reduce((s, p) => s + p.lat, 0) / n;
  const kx = 111320 * Math.max(Math.cos((meanLat * Math.PI) / 180), 0.2);
  const ky = 111320;
  // Absolute UTM meters -> lng/lat, anchored at the first vertex.
  const origin = projected[0];
  const toLngLat = (x: number, y: number): [number, number] => [
    vertices[0].lng + (x - origin.x) / kx,
    vertices[0].lat + (y - origin.y) / ky,
  ];
  const cx = projected.reduce((s, p) => s + p.x, 0) / n;
  const cy = projected.reduce((s, p) => s + p.y, 0) / n;

  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }

  for (let i = 0; i < n; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1.0) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Outward normal (away from centroid) so labels never cover the roof.
    let nx = -dy / len;
    let ny = dx / len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // Keep text upright: normalize rotation into [-90, 90].
    let rotate = (-Math.atan2(dy, dx) * 180) / Math.PI;
    if (rotate > 90) rotate -= 180;
    if (rotate < -90) rotate += 180;
    labels.push({
      type: "Feature",
      properties: { label: `${len.toFixed(1)} m`, size: edgeSize, rotate: Math.round(rotate * 10) / 10 },
      geometry: { type: "Point", coordinates: toLngLat(mx + nx * 1.4, my + ny * 1.4) },
    });
    const tickHalf = Math.min(Math.max(len * 0.08, 0.5), 2.0) / 2;
    ticks.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [toLngLat(mx - nx * tickHalf, my - ny * tickHalf), toLngLat(mx + nx * tickHalf, my + ny * tickHalf)],
      },
    });
  }

  const area = Math.abs(area2) / 2;
  labels.push({
    type: "Feature",
    properties: { label: formatArea(area), size: areaSize, rotate: 0 },
    geometry: {
      type: "Point",
      coordinates: [vertices.reduce((s, p) => s + p.lng, 0) / n, vertices.reduce((s, p) => s + p.lat, 0) / n],
    },
  });
  return {
    labels: { type: "FeatureCollection", features: labels },
    ticks: { type: "FeatureCollection", features: ticks },
  };
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
  return `${providerNote} ${raw.length > 140 ? raw.slice(0, 140) + "ΓÇª" : raw}`;
}

export type { MapLayerMouseEvent };
