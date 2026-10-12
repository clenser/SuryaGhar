import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeocodeError, parseGoogleGeocodeResults, searchLocations } from "../services/geocode";

const okBody = {
  provider: "nominatim",
  results: [{ name: "Kalna", locality: null, state: "West Bengal", country: "India", latitude: 23.2167, longitude: 88.3667, bounds: null }],
};

describe("searchLocations", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the backend proxy, never to an upstream provider", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }));
    const results = await searchLocations("Kalna town");
    expect(results[0].name).toBe("Kalna");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/geocode");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: "Kalna town" });
    expect(String(url)).not.toContain("nominatim");
  });

  it("caches repeated queries", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }));
    await searchLocations("cache-test-query");
    await searchLocations("CACHE-TEST-QUERY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 422 to a user-facing validation error", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));
    await expect(searchLocations("ab-validation")).rejects.toMatchObject({ kind: "validation" });
  });

  it("maps server failures to a server error", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(searchLocations("ab-server")).rejects.toBeInstanceOf(GeocodeError);
    await expect(searchLocations("ab-server")).rejects.toMatchObject({ kind: "server" });
  });

  it("maps a network failure to a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(searchLocations("ab-network")).rejects.toMatchObject({ kind: "network" });
  });

  it("parses Google Geocoding API payload into LocationResult items with bounds", () => {
    const parsed = parseGoogleGeocodeResults({
      status: "OK",
      results: [
        {
          address_components: [
            { long_name: "Bidhannagar", short_name: "Bidhannagar", types: ["locality", "political"] },
            { long_name: "Kolkata", short_name: "Kolkata", types: ["administrative_area_level_3", "political"] },
            { long_name: "West Bengal", short_name: "WB", types: ["administrative_area_level_1", "political"] },
            { long_name: "India", short_name: "IN", types: ["country", "political"] },
          ],
          formatted_address: "Bidhannagar, West Bengal, India",
          geometry: {
            location: { lat: 22.5797, lng: 88.4146 },
            bounds: {
              northeast: { lat: 22.6036, lng: 88.4484 },
              southwest: { lat: 22.5469, lng: 88.3948 },
            },
          },
        },
      ],
    });
    expect(parsed).toEqual([
      {
        name: "Bidhannagar",
        locality: "Kolkata",
        state: "West Bengal",
        country: "India",
        latitude: 22.5797,
        longitude: 88.4146,
        bounds: { south: 22.5469, north: 22.6036, west: 88.3948, east: 88.4484 },
      },
    ]);
  });
});

