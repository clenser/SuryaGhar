import type { LocationResult } from "../types";

/**
 * Milestone 1 test sites (AGENTS.md section 26). Used from the diagnostics panel
 * only, so ordinary users never see engineering test shortcuts in the main flow.
 */
export const INDIAN_TEST_SITES: Array<{ id: string; label: string; kind: string; place: LocationResult }> = [
  { id: "kolkata", label: "Kolkata", kind: "Dense urban", place: { name: "Kolkata", locality: null, state: "West Bengal", country: "India", latitude: 22.5726, longitude: 88.3639, bounds: null } },
  { id: "kalna", label: "Kalna", kind: "Smaller town", place: { name: "Kalna", locality: null, state: "West Bengal", country: "India", latitude: 23.2167, longitude: 88.3667, bounds: null } },
  { id: "delhi", label: "New Delhi", kind: "Dense urban", place: { name: "New Delhi", locality: null, state: "Delhi", country: "India", latitude: 28.6139, longitude: 77.209, bounds: null } },
  { id: "mumbai", label: "Mumbai", kind: "Dense urban", place: { name: "Mumbai", locality: null, state: "Maharashtra", country: "India", latitude: 19.076, longitude: 72.8777, bounds: null } },
  { id: "bengaluru", label: "Bengaluru", kind: "Suburban", place: { name: "Bengaluru", locality: null, state: "Karnataka", country: "India", latitude: 12.9716, longitude: 77.5946, bounds: null } },
];

export const INDIA_VIEW = { center: { lng: 82.5, lat: 22.5 }, zoom: 4.2, bearing: 0, pitch: 0 };

/** Default initial view: Kolkata at neighbourhood zoom for rooftop work. */
export const KOLKATA_VIEW = { center: { lng: 88.3639, lat: 22.5726 }, zoom: 12.5, bearing: 0, pitch: 0 };

/** Default initial location (replaced as soon as the user searches elsewhere). */
export const KOLKATA_PLACE: LocationResult = {
  name: "Kolkata",
  locality: null,
  state: "West Bengal",
  country: "India",
  latitude: 22.5726,
  longitude: 88.3639,
  bounds: null,
};
