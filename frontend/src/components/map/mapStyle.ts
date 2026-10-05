import type { StyleSpecification } from "maplibre-gl";
import { activeImageryProvider, type ImageryProvider } from "../../providers/imagery";
import { activeTerrainProvider, type TerrainProvider } from "../../providers/terrain";
import { getBasemapLayers, getBasemapSource, BASEMAP_SOURCE_ID } from "../../providers/basemap";

export const IMAGERY_SOURCE_ID = "imagery";
export const IMAGERY_LAYER_ID = "imagery-layer";
export const TERRAIN_SOURCE_ID = "terrain-dem";

/**
 * Builds the base style. MapLibre only renders; sources come from provider modules.
 * Layer order: background, imagery, OSM context, labels. 3D buildings are included
 * but hidden until the user enables them.
 */
export function buildMapStyle(
  imagery: ImageryProvider = activeImageryProvider,
  terrain: TerrainProvider = activeTerrainProvider,
): StyleSpecification {
  const basemapLayers = getBasemapLayers();
  return {
    version: 8,
    name: "Solar Site Analysis",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [IMAGERY_SOURCE_ID]: imagery.getSourceConfig(),
      [BASEMAP_SOURCE_ID]: getBasemapSource(),
      [TERRAIN_SOURCE_ID]: {
        type: "raster-dem",
        tiles: terrain.getTileUrls(),
        encoding: terrain.getEncoding(),
        tileSize: terrain.getTileSize(),
        maxzoom: terrain.getCoverage().maxZoom,
        attribution: `Elevation © ${terrain.getDisplayName()}`,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0d1822" } },
      {
        id: IMAGERY_LAYER_ID,
        type: "raster",
        source: IMAGERY_SOURCE_ID,
        paint: { "raster-opacity": 1, "raster-fade-duration": 150 },
      },
      ...basemapLayers,
    ],
  };
}
