import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let configured = false;
let loadPromise: Promise<typeof google> | null = null;

export function getGoogleMapsApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? "";
}

export type GoogleMapsFailureKind = "missing-key" | "blocked" | "network" | "unknown";

export class GoogleMapsLoadError extends Error {
  readonly failureKind: GoogleMapsFailureKind;

  constructor(message: string, failureKind: GoogleMapsFailureKind) {
    super(message);
    this.name = "GoogleMapsLoadError";
    this.failureKind = failureKind;
  }
}

export function classifyGoogleMapsError(err: unknown): GoogleMapsLoadError {
  if (err instanceof GoogleMapsLoadError) return err;

  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();

  if (lower.includes("api key is missing")) {
    return new GoogleMapsLoadError(msg, "missing-key");
  }

  // Detect browser extension blocking (ERR_BLOCKED_BY_CLIENT, uBlock, AdBlock, Brave Shields, etc.)
  // or explicit DOM script loading failures where the request was denied before reaching Google.
  if (
    lower.includes("blocked_by_client") ||
    lower.includes("err_blocked_by_client") ||
    lower.includes("blocked by client") ||
    lower.includes("extension") ||
    lower.includes("adblock")
  ) {
    return new GoogleMapsLoadError(
      "Google Maps script was blocked by the browser or an extension (ERR_BLOCKED_BY_CLIENT). Disable ad blockers / shields or test in an Incognito / clean profile.",
      "blocked",
    );
  }

  // General script load failure from @googlemaps/js-api-loader:
  // "The Google Maps JavaScript API could not load."
  if (lower.includes("could not load") || lower.includes("failed to fetch") || lower.includes("network")) {
    // If running in browser and navigator is offline or adblocker silently aborted script element:
    return new GoogleMapsLoadError(
      "Google Maps JavaScript API could not load (request blocked or network failure). If an ad blocker or privacy shield is active, allow maps.googleapis.com or test in Incognito.",
      "blocked",
    );
  }

  return new GoogleMapsLoadError(msg || "Failed to load Google Maps JavaScript API.", "unknown");
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (loadPromise) {
    return loadPromise;
  }

  const existingGoogle =
    typeof window !== "undefined"
      ? (window as unknown as { google?: typeof google }).google
      : undefined;
  if (existingGoogle?.maps && typeof existingGoogle.maps.Map === "function") {
    return Promise.resolve(existingGoogle);
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(
      new GoogleMapsLoadError(
        "Google Maps API key is missing. Please set VITE_GOOGLE_MAPS_API_KEY in your .env file.",
        "missing-key",
      ),
    );
  }

  if (!configured) {
    setOptions({
      key: apiKey,
      v: "weekly",
      libraries: ["maps", "marker", "geometry", "places"],
    });
    configured = true;
  }

  const attempt = (async () => {
    try {
      const mapsLib = (await importLibrary("maps")) as
        | google.maps.MapsLibrary
        | { maps?: typeof google.maps }
        | undefined;

      const win =
        typeof window !== "undefined"
          ? (window as unknown as { google?: typeof google })
          : undefined;

      const libRecord =
        mapsLib && typeof mapsLib === "object"
          ? (mapsLib as unknown as Record<string, unknown>)
          : undefined;
      const nestedMaps =
        libRecord?.maps && typeof libRecord.maps === "object"
          ? (libRecord.maps as Record<string, unknown>)
          : undefined;

      const MapConstructor =
        (typeof libRecord?.Map === "function"
          ? (libRecord.Map as typeof google.maps.Map)
          : undefined) ??
        (typeof nestedMaps?.Map === "function"
          ? (nestedMaps.Map as typeof google.maps.Map)
          : undefined) ??
        (typeof win?.google?.maps?.Map === "function"
          ? win.google.maps.Map
          : undefined);

      if (typeof MapConstructor !== "function") {
        throw new GoogleMapsLoadError(
          "Google Maps library loaded without a valid Map constructor.",
          "unknown",
        );
      }

      const rootGoogle: typeof google =
        win?.google ??
        (nestedMaps ? (mapsLib as unknown as typeof google) : ({ maps: {} as typeof google.maps } as typeof google));

      if (!rootGoogle.maps || typeof rootGoogle.maps !== "object") {
        (rootGoogle as { maps: typeof google.maps }).maps = {} as typeof google.maps;
      }

      if (libRecord && !nestedMaps) {
        Object.assign(rootGoogle.maps, libRecord);
      } else if (nestedMaps) {
        Object.assign(rootGoogle.maps, nestedMaps);
      }
      rootGoogle.maps.Map = MapConstructor;

      if (win) {
        win.google = rootGoogle;
      }

      return rootGoogle;
    } catch (rawErr) {
      throw classifyGoogleMapsError(rawErr);
    }
  })();
  loadPromise = attempt;
  // A failed attempt must not poison later retries: drop the cached rejection
  // so the header retry (or a remount) performs a fresh load attempt. The
  // underlying @googlemaps/js-api-loader drops its own bootstrap promise on
  // script error, so the next call genuinely re-requests the API script.
  attempt.catch(() => {
    if (loadPromise === attempt) loadPromise = null;
  });

  return attempt;
}

/** Reset helper for tests. */
export function resetGoogleMapsLoaderForTests(): void {
  configured = false;
  loadPromise = null;
}
