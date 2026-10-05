import type { LngLat } from "../lib/geo";
import { API_BASE_URL } from "./apiBase";
import { requestBackend } from "./backendStatus";

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
  segmentation?: {
    model: string;
    display_name: string;
    inference_time_seconds: number;
    device: string;
  } | null;
evidence?: {
      semantic_available?: boolean;
      hotosm_building_fraction?: number;
      osm?: {
        available?: boolean;
        overlap_fraction?: number | null;
        buildings_overlapping?: number;
        buildings_with_tagged_height?: number;
        height_source?: "osm_tag" | "unavailable";
        median_height_m?: number | null;
        max_height_m?: number | null;
      };
      supporting?: {
        hotosm_building_fraction?: number;
        osm_overlap_fraction?: number | null;
        geometry_confidence?: number;
        segmentation_confidence?: number;
        note?: string;
      };
      vision?: { classification?: string; confidence?: number; provider?: string; model?: string | null; reason?: string | null };
    } | null;
}

export interface PanelLayoutResult {
  panel_count: number;
  capacity_kwp: number;
  usable_area_m2: number;
  total_area_m2: number;
  occupied_area_m2?: number | null;
  excluded_area_m2?: number | null;
  footprints: GeoJSON.Feature[];
  assumptions: Record<string, number | string | boolean | null>;
  warnings: string[];
  optimization_metadata?: Record<string, number | string | boolean | number[] | null>;
  panel?: { width_m: number; height_m: number; wattage_w: number } | null;
  layout?: {
    panel_count: number;
    installed_capacity_kwp: number;
    panels: GeoJSON.Feature[];
    usable_area_m2: number;
    occupied_area_m2: number | null;
  } | null;
  orientation?: { tilt_deg: number; azimuth_deg: number; compass_direction: string } | null;
  solar?: {
    annual_generation_kwh: number | null;
    specific_yield_kwh_kwp: number | null;
    optimization_method: string;
    resource_provider: string;
    confidence: string;
  } | null;
}

export const PANEL_PRESETS = [
  { id: "standard", name: "Standard residential", wattage_w: 550, width_m: 2.28, height_m: 1.13, note: "550 W · 2.28 × 1.13 m" },
  { id: "compact", name: "Compact residential", wattage_w: 450, width_m: 2.1, height_m: 1.05, note: "450 W · ~2.10 × 1.05 m" },
  { id: "higheff", name: "High-efficiency residential", wattage_w: 580, width_m: 2.28, height_m: 1.13, note: "580 W · ~2.28 × 1.13 m" },
  { id: "custom", name: "Custom (advanced)", wattage_w: 550, width_m: 2.28, height_m: 1.13, note: "Enter exact dimensions" },
] as const;

export type PanelPresetId = (typeof PANEL_PRESETS)[number]["id"];

export const CAPACITY_PRESETS: Array<{ id: string; label: string; kwp: number | null }> = [
  { id: "auto", label: "Auto / Best fit", kwp: null },
  { id: "1kw", label: "1 kW", kwp: 1 },
  { id: "2kw", label: "2 kW", kwp: 2 },
  { id: "3kw", label: "3 kW", kwp: 3 },
  { id: "5kw", label: "5 kW", kwp: 5 },
  { id: "custom", label: "Custom", kwp: null },
];

export function compassDirection(azimuthDeg: number): string {
  const names = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];
  const idx = Math.round(((azimuthDeg % 360) + 360) % 360 / 45) % 8;
  return names[idx];
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
    response = await requestBackend(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Aborted requests are not network errors; let callers handle cancellation.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.error(`[API] network failure calling ${API_BASE_URL}${path}`, err);
    throw new ApiError("Could not reach the analysis service.", "network");
  }
  if (response.status === 422) {
    const detail = await response.json().catch(() => null);
    console.error(`[API] ${path} 422`, detail);
    throw new ApiError(detail?.detail ?? "The request was invalid.", "validation");
  }
  if (response.status === 429) {
    console.error(`[API] ${path} 429`, await response.json().catch(() => null));
    throw new ApiError("Rate limited. Please try again in a moment.", "server");
  }
  if (response.status >= 500) {
    console.error(`[API] ${path} HTTP ${response.status}`, await response.json().catch(() => null));
    throw new ApiError("Surface analysis failed on the server.", "server");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    console.error(`[API] ${path} HTTP ${response.status}`, detail);
    throw new ApiError(`The analysis service returned an error (HTTP ${response.status}).`, "server");
  }
  return response.json() as Promise<T>;
}

export type SegmentationModel = "hotosm_buildings" | "sam2_tiny" | "sam2_base_plus" | "sam2_large";

export const SEGMENTATION_MODELS: Array<{ id: SegmentationModel; label: string; hint: string }> = [
  { id: "sam2_tiny", label: "Tiny model", hint: "Fastest · Lightweight" },
  { id: "sam2_base_plus", label: "Base+ model", hint: "Balanced · Higher quality" },
  { id: "sam2_large", label: "Large model", hint: "Highest quality · Slowest" },
];

export function validateSurface(
  vertices: LngLat[],
  segmentationModel?: SegmentationModel,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  return post(
    "/selection/validate",
    {
      geometry: polygonGeometry(vertices),
      ...(segmentationModel ? { segmentation_model: segmentationModel } : {}),
    },
    signal,
  );
}

export function computePanelLayout(
  vertices: LngLat[],
  spec: {
    panel_width_m: number;
    panel_height_m: number;
    wattage_w: number;
    row_spacing_m: number | null;
    setback_m: number;
    tilt_deg: number | null;
    azimuth_deg: number | null;
    target_capacity_kwp?: number | null;
  },
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
