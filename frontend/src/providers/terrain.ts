/**
 * Terrain (DEM) provider abstraction (AGENTS.md section 7). Resolution is recorded
 * so the UI never implies building-height precision from coarse elevation data.
 */
export interface TerrainCoverage {
  maxZoom: number;
  resolutionNote: string;
}

export interface TerrainProvider {
  readonly id: string;
  getDisplayName(): string;
  getTileUrls(): string[];
  getEncoding(): "terrarium" | "mapbox";
  getTileSize(): number;
  getCoverage(): TerrainCoverage;
}

export class AwsTerrariumTerrain implements TerrainProvider {
  readonly id = "aws-terrarium";

  getDisplayName(): string {
    return "AWS Terrain Tiles";
  }

  getTileUrls(): string[] {
    return ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];
  }

  getEncoding(): "terrarium" {
    return "terrarium";
  }

  getTileSize(): number {
    return 256;
  }

  getCoverage(): TerrainCoverage {
    return {
      maxZoom: 15,
      resolutionNote:
        "Elevation resolution is roughly tens of metres in this tile set. Too coarse for rooftop parapet or building-height measurements.",
    };
  }
}

export const activeTerrainProvider: TerrainProvider = new AwsTerrariumTerrain();
