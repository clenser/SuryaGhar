/**
 * Vector context layers (roads, labels, buildings) from OpenStreetMap-derived
 * OpenMapTiles data served by OpenFreeMap. MapLibre renders; this module only
 * describes sources and layer structure.
 */
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

export const BASEMAP_SOURCE_ID = "osm-context";
export const BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors · OpenFreeMap";
export const BUILDINGS_LAYER_ID = "buildings-3d";
export const ROAD_LAYER_ID = "context-roads";
export const LABEL_LAYER_ID = "context-labels";

export function getBasemapSource(): SourceSpecification {
  return {
    type: "vector",
    url: "https://tiles.openfreemap.org/planet",
    attribution: BASEMAP_ATTRIBUTION,
  };
}

const labelName: unknown = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

export function getBasemapLayers(): LayerSpecification[] {
  return [
    {
      id: ROAD_LAYER_ID,
      type: "line",
      source: BASEMAP_SOURCE_ID,
      "source-layer": "transportation",
      filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 2.4, 17, 6],
        "line-opacity": 0.75,
      },
    },
    {
      id: BUILDINGS_LAYER_ID,
      type: "fill-extrusion",
      source: BASEMAP_SOURCE_ID,
      "source-layer": "building",
      minzoom: 14,
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": "#d9d4c7",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    },
    {
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: BASEMAP_SOURCE_ID,
      "source-layer": "place",
      filter: ["in", "class", "city", "town", "village", "suburb", "neighbourhood", "quarter", "hamlet"],
      layout: {
        "text-field": labelName as never,
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 14],
        "text-font": ["Noto Sans Regular"],
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(10, 18, 28, 0.85)",
        "text-halo-width": 1.4,
      },
    },
  ];
}
