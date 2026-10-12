import type { GeocodeResponse, LocationResult } from "../types";
import { API_BASE_URL } from "./apiBase";
import { requestBackend } from "./backendStatus";

export class GeocodeError extends Error {
  constructor(message: string, readonly kind: "network" | "timeout" | "server" | "validation") {
    super(message);
    this.name = "GeocodeError";
  }
}

const cache = new Map<string, { at: number; results: LocationResult[] }>();
const CACHE_LIMIT = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GOOGLE_GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const SKIP_NAME_TYPES = new Set(["plus_code", "postal_code", "postal_code_prefix", "street_number", "country"]);
const LOCALITY_TYPES = [
  "sublocality_level_1",
  "sublocality",
  "neighborhood",
  "locality",
  "postal_town",
  "administrative_area_level_3",
  "administrative_area_level_2",
];

function getFrontendGoogleGeocodingKey(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_GOOGLE_GEOCODING_API_KEY ?? env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
}

export function parseGoogleGeocodeResults(payload: unknown, limit = 6): LocationResult[] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { status?: unknown; results?: unknown };
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK" || !Array.isArray(data.results)) return null;

  const parsed: LocationResult[] = [];
  for (const raw of data.results) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const geometry = item.geometry as Record<string, unknown> | undefined;
    const location = geometry?.location as Record<string, unknown> | undefined;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const components = Array.isArray(item.address_components) ? item.address_components : [];
    let state: string | null = null;
    let country: string | null = null;
    let countryCode: string | null = null;
    const candidateNames: string[] = [];
    const localityCandidates: string[] = [];

    for (const comp of components) {
      if (!comp || typeof comp !== "object") continue;
      const c = comp as Record<string, unknown>;
      const longName = String(c.long_name ?? "").trim();
      const shortName = String(c.short_name ?? "").trim();
      const types = Array.isArray(c.types) ? c.types.map(String) : [];
      if (!longName || !types.length) continue;

      if (types.includes("country")) {
        country = longName;
        countryCode = shortName ? shortName.toUpperCase() : null;
      }
      if (types.includes("administrative_area_level_1") && !state) {
        state = longName;
      }
      if (!types.every((t) => SKIP_NAME_TYPES.has(t))) {
        candidateNames.push(longName);
      }
      if (types.some((t) => LOCALITY_TYPES.includes(t))) {
        localityCandidates.push(longName);
      }
    }

    if (countryCode && countryCode !== "IN") continue;
    if (!countryCode && !(lat >= 6.0 && lat <= 37.5 && lng >= 67.0 && lng <= 98.0)) continue;

    const formatted = String(item.formatted_address ?? "").trim();
    const formattedHead = formatted ? formatted.split(",")[0].trim() : "";
    const name = candidateNames[0] || formattedHead || "Unnamed place";

    let locality: string | null = localityCandidates.find((loc) => loc !== name && loc !== state) ?? null;
    if (!locality && localityCandidates.length > 0) {
      locality = localityCandidates[0];
    }

    let bounds: LocationResult["bounds"] = null;
    const rawBounds = (geometry?.bounds ?? geometry?.viewport) as Record<string, unknown> | undefined;
    const ne = rawBounds?.northeast as Record<string, unknown> | undefined;
    const sw = rawBounds?.southwest as Record<string, unknown> | undefined;
    if (ne && sw) {
      const south = Number(sw.lat);
      const north = Number(ne.lat);
      const west = Number(sw.lng);
      const east = Number(ne.lng);
      if ([south, north, west, east].every(Number.isFinite)) {
        bounds = { south, north, west, east };
      }
    }

    parsed.push({
      name,
      locality,
      state,
      country: country ?? "India",
      latitude: lat,
      longitude: lng,
      bounds,
    });
    if (parsed.length >= limit) break;
  }

  return parsed;
}

async function tryDirectGoogleGeocode(query: string, signal?: AbortSignal): Promise<LocationResult[] | null> {
  const apiKey = getFrontendGoogleGeocodingKey();
  if (!apiKey) return null;
  const params = new URLSearchParams({
    address: query,
    region: "in",
    components: "country:IN",
    language: "en",
    key: apiKey,
  });
  try {
    const response = await fetch(`${GOOGLE_GEOCODE_ENDPOINT}?${params.toString()}`, {
      signal,
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return parseGoogleGeocodeResults(payload);
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/** Calls the backend geocoder, with direct Google Geocoding fallback when configured. */
export async function searchLocations(query: string, signal?: AbortSignal): Promise<LocationResult[]> {
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;
  cache.delete(key);

  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), 8000);
  const combined = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal;

  let response: Response;
  try {
    response = await requestBackend(`${API_BASE_URL}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const fallbackResults = await tryDirectGoogleGeocode(query, combined);
    if (fallbackResults !== null) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), results: fallbackResults });
      return fallbackResults;
    }
    if (timeoutController.signal.aborted) throw new GeocodeError("Search timed out", "timeout");
    throw new GeocodeError("Search is unreachable. Check your connection.", "network");
  } finally {
    window.clearTimeout(timer);
  }

  if (response.status === 422) {
    console.error(`[API] /geocode 422`, await response.json().catch(() => null));
    throw new GeocodeError("Enter a place name to search", "validation");
  }
  if (response.status === 429) {
    const fallbackResults = await tryDirectGoogleGeocode(query, signal);
    if (fallbackResults !== null) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), results: fallbackResults });
      return fallbackResults;
    }
    console.error(`[API] /geocode 429`, await response.json().catch(() => null));
    throw new GeocodeError("Location search is temporarily unavailable.", "server");
  }
  if (response.status >= 500) {
    const fallbackResults = await tryDirectGoogleGeocode(query, signal);
    if (fallbackResults !== null) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), results: fallbackResults });
      return fallbackResults;
    }
    console.error(`[API] /geocode HTTP ${response.status}`, await response.json().catch(() => null));
    throw new GeocodeError("Location search is temporarily unavailable.", "server");
  }
  if (!response.ok) {
    console.error(`[API] /geocode HTTP ${response.status}`, await response.json().catch(() => null));
    throw new GeocodeError("Couldn't find that location. Try again.", "server");
  }

  const data = (await response.json()) as GeocodeResponse;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), results: data.results });
  return data.results;
}

/** Human-friendly context line: locality, state, country. Avoids raw geocoder metadata. */
export function formatPlaceContext(place: LocationResult): string {
  const parts = [place.locality, place.state, place.country].filter(
    (part, index, all): part is string => Boolean(part) && all.indexOf(part) === index && part !== place.name,
  );
  return parts.join(", ");
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
