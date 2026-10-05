import type { LngLat } from "../lib/geo";
import { API_BASE_URL } from "./apiBase";

export interface ValidationResult {
  classification: string;
  confidence: number;
  coverage: number;
  components: Record<string, number>;
  metrics: {
    area_m2?: number;
    perimeter_m?: number;
    centroid?: { lat: number; lng: number };
  };
  images: { original: string; overlay: string; mask: string } | null;
  warnings: string[];
  limitations: string[] | null;
  providers: { imagery: string; vision: string; segmentation?: string; segmentation_model?: string } | null;
  ai?: { provider: string | null; model: string | null; primary_class: string | null; is_suitable_for_solar: boolean | null } | null;
  confidence_detail?: { overall_level?: string; overall_score?: number; stages?: Array<Record<string, unknown>>; limitations?: string[] } | null;
  evidence?: {
    hotosm_building_fraction?: number;
    osm?: { available?: boolean; overlap_fraction?: number | null; buildings_overlapping?: number; median_height_m?: number | null; max_height_m?: number | null };
    vision?: { classification?: string; confidence?: number; provider?: string; model?: string | null };
  } | null;
}

export interface PanelLayoutResult {
  panel_count: number;
  capacity_kwp: number;
  usable_area_m2: number;
  total_area_m2: number;
  footprints: GeoJSON.Feature[];
  assumptions: Record<string, number | string>;
  warnings: string[];
}

export interface SolarResult {
  annual_kwh: number | null;
  specific_yield_kwh_kwp: number | null;
  poa_kwh_m2: number | null;
  selected: { tilt_deg?: number; azimuth_deg?: number };
  candidates: Array<Record<string, number | string>>;
  confidence: string;
  resource_provider: string;
  assumptions: Record<string, number | string>;
  warnings: string[];
}

export interface SurroundingsResult {
  building_count: number;
  buildings_with_height_tag: number;
  median_height_m: number | null;
  max_height_m: number | null;
  tree_count: number;
  area_m2: number;
  confidence: string;
  warnings: string[];
  provider: string;
}

export interface ShadowResult {
  hour_shading_fraction: number;
  hourly: Array<{ hour_utc: number; shaded_fraction: number; sun_altitude_deg: number; sun_azimuth_deg: number }>;
  shadow_geojson: GeoJSON.FeatureCollection;
  sun_altitude_deg: number;
  sun_azimuth_deg: number;
  confidence: string;
  warnings: string[];
}

export class ApiError extends Error {
  constructor(message: string, readonly kind: "network" | "server" | "validation") {
    super(message);
  }
}

function polygonGeometry(vertices: LngLat[]) {
  return {
    type: "Polygon",
    coordinates: [[...vertices.map((v) => [v.lng, v.lat]), [vertices[0].lng, vertices[0].lat]]],
  };
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Aborted requests are not network errors; let callers handle cancellation.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.error(`[API] network failure calling ${API_BASE_URL}${path}`, err);
    throw new ApiError("The analysis service is unreachable. Start the backend on port 8000.", "network");
  }
  if (response.status === 422) {
    const detail = await response.json().catch(() => null);
    console.error(`[API] ${path} 422`, detail);
    throw new ApiError(detail?.detail ?? "The request was invalid.", "validation");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    console.error(`[API] ${path} HTTP ${response.status}`, detail);
    throw new ApiError(`The analysis service returned an error (HTTP ${response.status}).`, "server");
  }
  return response.json() as Promise<T>;
}

export function validateSurface(vertices: LngLat[], signal?: AbortSignal): Promise<ValidationResult> {
  return post("/selection/validate", { geometry: polygonGeometry(vertices) }, signal);
}

export function computePanelLayout(
  vertices: LngLat[],
  spec: { panel_width_m: number; panel_height_m: number; wattage_w: number; row_spacing_m: number; setback_m: number; tilt_deg: number; azimuth_deg: number },
  signal?: AbortSignal,
): Promise<PanelLayoutResult> {
  return post("/panel-layout", { geometry: polygonGeometry(vertices), ...spec }, signal);
}

export function analyzeSolar(
  latitude: number,
  longitude: number,
  capacity_kwp: number,
  signal?: AbortSignal,
): Promise<SolarResult> {
  return post("/solar-analysis", { latitude, longitude, capacity_kwp }, signal);
}

export function analyzeSurroundings(vertices: LngLat[], signal?: AbortSignal): Promise<SurroundingsResult> {
  return post("/surroundings", { geometry: polygonGeometry(vertices) }, signal);
}

export function analyzeShadows(vertices: LngLat[], date: string, hourUtc: number, signal?: AbortSignal): Promise<ShadowResult> {
  return post("/shadow-analysis", { geometry: polygonGeometry(vertices), date, hour_utc: hourUtc }, signal);
}
