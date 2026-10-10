import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { KOLKATA_VIEW } from "../../config/locations";
import type { BoundingBox, LayerSettings, MapErrorEntry, MapViewState } from "../../types";
import type { SelectionMode } from "../../hooks/useSelection";
import { formatArea, projectUtm, type LngLat } from "../../lib/geo";
import { loadGoogleMaps } from "../../services/googleMapsLoader";

export interface GoogleMapViewHandle {
  flyToPlace(lng: number, lat: number, zoom?: number): void;
  fitBounds(bounds: BoundingBox): void;
  zoomBy(delta: number): void;
  resetNorth(): void;
  togglePitch(): void;
  getMap(): google.maps.Map | null;
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
  showMeasurements?: boolean;
  onAddVertex?: (point: LngLat) => void;
  onFinishDrawing?: () => void;
  onBeginDrag?: () => void;
  onMoveVertex?: (index: number, point: LngLat) => void;
  onDeleteVertex?: (index: number) => void;
}

interface CustomOverlayInstance {
  setMap(map: google.maps.Map | null): void;
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export const GoogleMapView = forwardRef<GoogleMapViewHandle, MapViewProps>(function GoogleMapView(
  {
    layers,
    onViewChange,
    onMapError,
    onReady,
    selectionMode = "idle",
    vertices = [],
    panelFootprints = null,
    orientation = null,
    selectionCentroid = null,
    shadowFC = null,
    showMeasurements = true,
    onAddVertex,
    onFinishDrawing,
    onBeginDrag,
    onMoveVertex,
    onDeleteVertex,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
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

  // Overlay references
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const vertexMarkersRef = useRef<google.maps.Marker[]>([]);
  const measurementOverlaysRef = useRef<CustomOverlayInstance[]>([]);
  const panelPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const panelCellPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const shadowPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const directionMarkerRef = useRef<google.maps.Marker | null>(null);

  // Initialize Google Maps instance
  useEffect(() => {
    let active = true;

    if (!containerRef.current || mapRef.current) return;

    // Documented Google callback for rejected/invalid keys: the API script
    // can load fine while the key is refused, so imagery never renders.
    // Surfaced through onMapError — the provider state machine treats it as
    // a definitive failure and starts the fallback countdown immediately.
    const win = window as unknown as { gm_authFailure?: () => void };
    const prevAuthFailure = win.gm_authFailure;
    const ourAuthFailure = () => {
      callbacks.current.onMapError({
        kind: "imagery",
        message: "Google Maps rejected the API key (authentication failed).",
      });
    };
    win.gm_authFailure = ourAuthFailure;

    loadGoogleMaps()
      .then((googleInstance) => {
        if (!active || !containerRef.current) return;

        const map = new googleInstance.maps.Map(containerRef.current, {
          center: { lat: KOLKATA_VIEW.center.lat, lng: KOLKATA_VIEW.center.lng },
          zoom: Math.round(KOLKATA_VIEW.zoom),
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          tilt: 0,
          heading: 0,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          rotateControl: false,
        });

        mapRef.current = map;

        const emitView = () => {
          const center = map.getCenter();
          if (!center) return;
          callbacks.current.onViewChange({
            center: { lng: center.lng(), lat: center.lat() },
            zoom: map.getZoom() ?? KOLKATA_VIEW.zoom,
            bearing: map.getHeading() ?? 0,
            pitch: map.getTilt() ?? 0,
          });
        };

        map.addListener("center_changed", emitView);
        map.addListener("zoom_changed", emitView);
        map.addListener("heading_changed", emitView);
        map.addListener("tilt_changed", emitView);

        googleInstance.maps.event.addListenerOnce(map, "idle", () => {
          if (!active) return;
          setLoaded(true);
          emitView();
          callbacks.current.onReady?.();
        });
      })
      .catch((err: Error) => {
        if (!active) return;
        callbacks.current.onMapError({
          kind: "imagery",
          message: err.message || "Failed to load Google Maps JavaScript API.",
        });
      });

    return () => {
      active = false;
      mapRef.current = null;
      if (win.gm_authFailure === ourAuthFailure) win.gm_authFailure = prevAuthFailure;
    };
  }, []);

  // Update map type / context layer based on layers prop
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    if (layers.satelliteOpacity > 0) {
      if (layers.contextOpacity > 0) {
        map.setMapTypeId(window.google.maps.MapTypeId.HYBRID);
      } else {
        map.setMapTypeId(window.google.maps.MapTypeId.SATELLITE);
      }
    } else {
      map.setMapTypeId(window.google.maps.MapTypeId.ROADMAP);
    }
  }, [layers, loaded]);

  // Click & Drawing listener on Map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    const clickListener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      if (modeRef.current === "drawing") {
        const points = verticesRef.current;
        const clickedLng = e.latLng.lng();
        const clickedLat = e.latLng.lat();

        if (points.length >= 3) {
          // If close to first vertex, finish drawing
          const first = points[0];
          const kx = 111320 * Math.max(Math.cos((first.lat * Math.PI) / 180), 0.2);
          const ky = 111320;
          const distM = Math.hypot((first.lng - clickedLng) * kx, (first.lat - clickedLat) * ky);
          if (distM < 1.5) {
            selCallbacks.current.onFinishDrawing?.();
            return;
          }
        }
        selCallbacks.current.onAddVertex?.({ lng: clickedLng, lat: clickedLat });
      }
    });

    const dblClickListener = map.addListener("dblclick", () => {
      if (modeRef.current === "drawing") {
        selCallbacks.current.onFinishDrawing?.();
      }
    });

    return () => {
      window.google.maps.event.removeListener(clickListener);
      window.google.maps.event.removeListener(dblClickListener);
    };
  }, [loaded]);

  // Manage Terrace / Boundary Polygon, Incomplete Polyline, and Vertices
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    const isCoarse = isCoarsePointer();
    const handleRadius = isCoarse ? 9 : 6;
    const handleFirstRadius = isCoarse ? 11 : 8;

    // Clean up existing vertex markers
    vertexMarkersRef.current.forEach((m) => m.setMap(null));
    vertexMarkersRef.current = [];

    // Polygon / Line rendering
    if (vertices.length >= 3) {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }

      const path = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
      if (!polygonRef.current) {
        polygonRef.current = new window.google.maps.Polygon({
          paths: path,
          strokeColor: "#13a8b5",
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: "#13a8b5",
          fillOpacity: 0.16,
          map,
          zIndex: 5,
        });
      } else {
        polygonRef.current.setPaths(path);
        polygonRef.current.setMap(map);
      }
    } else {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }

      if (vertices.length > 0) {
        const path = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
        if (!polylineRef.current) {
          polylineRef.current = new window.google.maps.Polyline({
            path,
            strokeColor: "#13a8b5",
            strokeOpacity: 0.9,
            strokeWeight: 2.5,
            map,
            zIndex: 5,
          });
        } else {
          polylineRef.current.setPath(path);
          polylineRef.current.setMap(map);
        }
      } else if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    }

    // Render vertex markers with drag / click affordances
    const isDraggable = selectionMode === "editing" || selectionMode === "confirmed";

    const newMarkers = vertices.map((v, index) => {
      const isFirst = index === 0;
      const radius = isFirst ? handleFirstRadius : handleRadius;
      const fillColor = isFirst ? "#0f6e7a" : "#ffffff";
      const strokeColor = isFirst ? "#ffffff" : "#0f6e7a";

      const marker = new window.google.maps.Marker({
        position: { lat: v.lat, lng: v.lng },
        map,
        draggable: isDraggable,
        zIndex: isFirst ? 20 : 10,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: radius,
          fillColor,
          fillOpacity: 1,
          strokeColor,
          strokeWeight: 2.2,
        },
      });

      marker.addListener("click", () => {
        if (modeRef.current === "drawing" && index === 0 && verticesRef.current.length >= 3) {
          selCallbacks.current.onFinishDrawing?.();
        }
      });

      marker.addListener("rightclick", () => {
        if (modeRef.current === "editing" || modeRef.current === "confirmed") {
          selCallbacks.current.onDeleteVertex?.(index);
        }
      });

      marker.addListener("dragstart", () => {
        dragIndexRef.current = index;
        selCallbacks.current.onBeginDrag?.();
      });

      marker.addListener("drag", (e: google.maps.MapMouseEvent) => {
        if (e.latLng && dragIndexRef.current !== null) {
          selCallbacks.current.onMoveVertex?.(dragIndexRef.current, {
            lng: e.latLng.lng(),
            lat: e.latLng.lat(),
          });
        }
      });

      marker.addListener("dragend", () => {
        dragIndexRef.current = null;
      });

      return marker;
    });

    vertexMarkersRef.current = newMarkers;
  }, [vertices, selectionMode, loaded]);

  // CAD-style live measurement labels & ticks overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    // Clear existing measurement overlays
    measurementOverlaysRef.current.forEach((o) => o.setMap(null));
    measurementOverlaysRef.current = [];

    if (!showMeasurements || vertices.length < 3) return;

    const measured = measureFC(vertices, isCoarsePointer() ? 1.2 : 1);
    const overlays: CustomOverlayInstance[] = [];

    // Custom HTML Overlay using google.maps.OverlayView prototype
    function createLabelOverlay(
      pos: { lat: number; lng: number },
      text: string,
      fontSize: number,
      rotateDeg: number
    ): CustomOverlayInstance {
      const OverlayClass = class extends window.google.maps.OverlayView {
        private div: HTMLDivElement | null = null;
        private position: google.maps.LatLng = new window.google.maps.LatLng(pos.lat, pos.lng);

        override onAdd() {
          this.div = document.createElement("div");
          this.div.style.position = "absolute";
          this.div.style.transform = `translate(-50%, -50%) rotate(${rotateDeg}deg)`;
          this.div.style.background = "#0b1f33";
          this.div.style.color = "#ffffff";
          this.div.style.padding = "2px 6px";
          this.div.style.borderRadius = "999px";
          this.div.style.fontSize = `${fontSize}px`;
          this.div.style.fontWeight = "600";
          this.div.style.border = "1px solid rgba(255, 255, 255, 0.25)";
          this.div.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
          this.div.style.pointerEvents = "none";
          this.div.style.whiteSpace = "nowrap";
          this.div.style.zIndex = "30";
          this.div.innerText = text;

          const panes = this.getPanes();
          panes?.overlayMouseTarget.appendChild(this.div);
        }

        override draw() {
          if (!this.div) return;
          const projection = this.getProjection();
          if (!projection) return;
          const point = projection.fromLatLngToDivPixel(this.position);
          if (point) {
            this.div.style.left = `${point.x}px`;
            this.div.style.top = `${point.y}px`;
          }
        }

        override onRemove() {
          if (this.div) {
            this.div.parentNode?.removeChild(this.div);
            this.div = null;
          }
        }
      };

      const overlay = new OverlayClass();
      overlay.setMap(map);
      return overlay;
    }

    // Add labels
    for (const feature of measured.labels.features) {
      const geom = feature.geometry;
      if (geom.type === "Point") {
        const [lng, lat] = geom.coordinates;
        const label = String(feature.properties?.label ?? "");
        const size = Number(feature.properties?.size ?? 12);
        const rotate = Number(feature.properties?.rotate ?? 0);
        const overlay = createLabelOverlay({ lat, lng }, label, size, rotate);
        overlays.push(overlay);
      }
    }

    // Render tick polylines
    for (const feature of measured.ticks.features) {
      const geom = feature.geometry;
      if (geom.type === "LineString") {
        const path = geom.coordinates.map(([lng, lat]) => ({ lat, lng }));
        const polyline = new window.google.maps.Polyline({
          path,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          strokeOpacity: 0.9,
          map,
          zIndex: 15,
        });
        overlays.push({
          setMap: (m: google.maps.Map | null) => polyline.setMap(m),
        });
      }
    }

    measurementOverlaysRef.current = overlays;
  }, [vertices, showMeasurements, loaded]);

  // Panel Footprints & Cells rendering
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    panelPolygonsRef.current.forEach((p) => p.setMap(null));
    panelPolygonsRef.current = [];

    panelCellPolylinesRef.current.forEach((l) => l.setMap(null));
    panelCellPolylinesRef.current = [];

    if (!panelFootprints?.features?.length) return;

    // Render panel outline polygons
    const newPanels: google.maps.Polygon[] = [];
    for (const feature of panelFootprints.features) {
      const geom = feature.geometry;
      if (geom && geom.type === "Polygon") {
        const ring = geom.coordinates[0];
        if (ring && ring.length >= 4) {
          const path = ring.map(([lng, lat]) => ({ lat, lng }));
          const polygon = new window.google.maps.Polygon({
            paths: path,
            strokeColor: "#d7e3f5",
            strokeOpacity: 0.9,
            strokeWeight: 1,
            fillColor: "#0b1526",
            fillOpacity: 0.92,
            map,
            zIndex: 6,
          });

          // Subtle hover
          polygon.addListener("mouseover", () => {
            polygon.setOptions({ fillColor: "#1c2e4a" });
          });
          polygon.addListener("mouseout", () => {
            polygon.setOptions({ fillColor: "#0b1526" });
          });

          newPanels.push(polygon);
        }
      }
    }
    panelPolygonsRef.current = newPanels;

    // Render cell lines inside panels
    const cellsFC = panelCellsFC(panelFootprints);
    const newCellLines: google.maps.Polyline[] = [];
    for (const feature of cellsFC.features) {
      if (feature.geometry.type === "LineString") {
        const path = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        const line = new window.google.maps.Polyline({
          path,
          strokeColor: "#8ea6c8",
          strokeWeight: 0.8,
          strokeOpacity: 0.6,
          map,
          zIndex: 7,
        });
        newCellLines.push(line);
      }
    }
    panelCellPolylinesRef.current = newCellLines;
  }, [panelFootprints, loaded]);

  // Direction chevron indicator at centroid
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    if (directionMarkerRef.current) {
      directionMarkerRef.current.setMap(null);
      directionMarkerRef.current = null;
    }

    if (!orientation || !selectionCentroid || !panelFootprints?.features?.length) return;

    const az = ((orientation.azimuth_deg % 360) + 360) % 360;

    const marker = new window.google.maps.Marker({
      position: { lat: selectionCentroid.lat, lng: selectionCentroid.lng },
      map,
      zIndex: 25,
      icon: {
        path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        rotation: az,
        fillColor: "#0f6e7a",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 1.5,
      },
    });

    directionMarkerRef.current = marker;
  }, [orientation, selectionCentroid, panelFootprints, loaded]);

  // Shadow polygon rendering
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || typeof window === "undefined" || !window.google?.maps) return;

    shadowPolygonsRef.current.forEach((p) => p.setMap(null));
    shadowPolygonsRef.current = [];

    if (!shadowFC?.features?.length) return;

    const newShadows: google.maps.Polygon[] = [];
    for (const feature of shadowFC.features) {
      if (feature.geometry.type === "Polygon") {
        const ring = feature.geometry.coordinates[0];
        if (ring && ring.length >= 4) {
          const path = ring.map(([lng, lat]) => ({ lat, lng }));
          const polygon = new window.google.maps.Polygon({
            paths: path,
            strokeColor: "#1a237e",
            strokeOpacity: 0.3,
            strokeWeight: 1,
            fillColor: "#1a237e",
            fillOpacity: 0.28,
            map,
            zIndex: 4,
          });
          newShadows.push(polygon);
        }
      }
    }
    shadowPolygonsRef.current = newShadows;
  }, [shadowFC, loaded]);

  // Expose imperative handle to parent
  useImperativeHandle(
    ref,
    () => ({
      flyToPlace(lng, lat, zoom = 16) {
        const map = mapRef.current;
        if (!map) return;
        map.panTo({ lat, lng });
        map.setZoom(zoom);
      },
      fitBounds(bounds) {
        const map = mapRef.current;
        if (!map || typeof window === "undefined" || !window.google?.maps) return;
        const gBounds = new window.google.maps.LatLngBounds(
          { lat: bounds.south, lng: bounds.west },
          { lat: bounds.north, lng: bounds.east }
        );
        map.fitBounds(gBounds);
      },
      zoomBy(delta) {
        const map = mapRef.current;
        if (!map) return;
        const currentZoom = map.getZoom() ?? KOLKATA_VIEW.zoom;
        map.setZoom(currentZoom + delta);
      },
      resetNorth() {
        const map = mapRef.current;
        if (!map) return;
        map.setHeading(0);
      },
      togglePitch() {
        const map = mapRef.current;
        if (!map) return;
        const currentTilt = map.getTilt() ?? 0;
        map.setTilt(currentTilt > 1 ? 0 : 45);
      },
      getMap() {
        return mapRef.current;
      },
    }),
    [],
  );

  return (
    <div
      className="map-view"
      role="application"
      aria-label="Satellite map of India. Use mouse, touch, or keyboard arrows to navigate."
    >
      <div ref={containerRef} className="map-view__canvas" data-mode={selectionMode} />
      {!loaded && <div className="map-view__loading" aria-live="polite">Loading map</div>}
      <div className="map-legend" aria-hidden="true">
        <span className="map-legend__north" title="North — map orientation">N ↑</span>
        {orientation && panelFootprints?.features?.length ? (
          <span className="map-legend__azimuth" title="Panel orientation from the solar analysis">
            Panels face {compassShort(orientation.azimuth_deg)} · {Math.round(((orientation.azimuth_deg % 360) + 360) % 360)}°
          </span>
        ) : null}
      </div>
    </div>
  );
});

export function compassShort(azimuthDeg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8;
  return names[idx];
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export interface MeasureData {
  labels: FeatureCollection;
  ticks: FeatureCollection;
}

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
    let nx = -dy / len;
    let ny = dx / len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
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

  out.push([corner(-il, -iw), corner(il, -iw), corner(il, iw), corner(-il, iw), corner(-il, -iw)]);
  out.push([corner(-il, 0), corner(il, 0)]);
  const rows = 6;
  for (let i = 1; i < rows; i++) {
    const t = -il + (2 * il * i) / rows;
    out.push([corner(t, -iw), corner(t, iw)]);
  }
  return out;
}
