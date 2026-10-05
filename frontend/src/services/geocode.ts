import type { GeocodeResponse, LocationResult } from "../types";
import { API_BASE_URL } from "./apiBase";

export class GeocodeError extends Error {
  constructor(message: string, readonly kind: "network" | "timeout" | "server" | "validation") {
    super(message);
    this.name = "GeocodeError";
  }
}

const cache = new Map<string, LocationResult[]>();
const CACHE_LIMIT = 50;

/** Calls the backend geocoder. The browser never contacts the upstream provider directly. */
export async function searchLocations(query: string, signal?: AbortSignal): Promise<LocationResult[]> {
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), 8000);
  const combined = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeoutController.signal.aborted) throw new GeocodeError("Search timed out", "timeout");
    throw new GeocodeError("Search is unreachable. Check your connection.", "network");
  } finally {
    window.clearTimeout(timer);
  }

  if (response.status === 422) {
    console.error(`[API] /geocode 422`, await response.json().catch(() => null));
    throw new GeocodeError("Enter a place name to search", "validation");
  }
  if (!response.ok) {
    console.error(`[API] /geocode HTTP ${response.status}`, await response.json().catch(() => null));
    throw new GeocodeError("Location search is temporarily unavailable", "server");
  }

  const data = (await response.json()) as GeocodeResponse;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, data.results);
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
