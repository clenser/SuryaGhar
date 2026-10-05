/**
 * Imagery provider abstraction (AGENTS.md section 4). The map never hard-codes
 * provider URLs; it asks the active provider for its source configuration.
 */
import type { StyleSpecification } from "maplibre-gl";

export interface CoverageInfo {
  nativeMaxZoom: number;
  notes: string;
  prototypeOnly: boolean;
}

export interface ImageryProvider {
  readonly id: string;
  getSourceConfig(): Extract<StyleSpecification["sources"][string], { type: "raster" }>;
  getDisplayName(): string;
  getAttribution(): string;
  getCoverageInfo(): CoverageInfo;
}

/**
 * Esri World Imagery. Anonymous endpoint is used for prototype testing only.
 * AGENTS.md requires verifying Esri terms before any production use.
 */
export class EsriWorldImagery implements ImageryProvider {
  readonly id = "esri-world-imagery";

  getSourceConfig() {
    return {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: this.getAttribution(),
    };
  }

  getDisplayName(): string {
    return "Esri World Imagery";
  }

  getAttribution(): string {
    return "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";
  }

  getCoverageInfo(): CoverageInfo {
    return {
      nativeMaxZoom: 19,
      notes:
        "Resolution varies by location. Zoom levels beyond the native imagery show blur, not added detail.",
      prototypeOnly: true,
    };
  }
}

export const activeImageryProvider: ImageryProvider = new EsriWorldImagery();
