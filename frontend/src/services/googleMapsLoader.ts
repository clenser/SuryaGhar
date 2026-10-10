import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let configured = false;
let loadPromise: Promise<typeof google> | null = null;

export function getGoogleMapsApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? "";
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
      new Error(
        "Google Maps API key is missing. Please set VITE_GOOGLE_MAPS_API_KEY in your .env file."
      )
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
    await importLibrary("maps");
    return (window as unknown as { google: typeof google }).google!;
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
