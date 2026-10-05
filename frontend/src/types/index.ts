export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface LocationResult {
  name: string;
  locality: string | null;
  state: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  bounds: BoundingBox | null;
}

export interface GeocodeResponse {
  results: LocationResult[];
  provider: string;
}

export interface MapViewState {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Public, non-secret user-facing layer settings. */
export interface LayerSettings {
  satelliteOpacity: number; // 0..1
  contextOpacity: number; // OSM roads and labels, 0..1
  buildings3d: boolean;
  terrain: boolean;
  terrainExaggeration: number; // 1..2
}

export type MapErrorKind = "imagery" | "terrain" | "basemap" | "style";

export interface MapErrorEntry {
  id: number;
  kind: MapErrorKind;
  message: string;
  at: string;
}
