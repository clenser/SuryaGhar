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
  if (typeof window !== "undefined" && (window as unknown as { google?: typeof google }).google?.maps) {
    return Promise.resolve((window as unknown as { google: typeof google }).google!);
  }

  if (loadPromise) {
    return loadPromise;
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
      libraries: ["geometry", "places"],
    });
    configured = true;
  }

  const attempt = (async () => {
    try {
      await importLibrary("maps");
      return (window as unknown as { google: typeof google }).google!;
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
