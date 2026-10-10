/**
 * Building model construction: terrace polygon + building height → validated 3D state.
 *
 * The geographic polygon stays authoritative (AGENTS.md §4, §52): this module
 * only packages the existing projected geometry into the local 3D frame used by
 * the Three.js visualisation. Height validation lives here so the UI input and
 * the geometry library enforce exactly the same rules.
 */

import type { LngLat } from "../geo";
import { getLocalBounds, terraceToLocal3D, type LocalCoords3D } from "./coordinates";

/** Lowest building height the application accepts (metres). */
export const MIN_BUILDING_HEIGHT_M = 0.5;
/** Highest building height the application accepts (metres). */
export const MAX_BUILDING_HEIGHT_M = 200;

/**
 * Validate a user-entered building height.
 * @returns an error message, or `null` when the height is usable
 */
export function validateBuildingHeight(height: unknown): string | null {
  if (typeof height !== "number" || !Number.isFinite(height)) return "Enter a valid number";
  if (height < MIN_BUILDING_HEIGHT_M) return `Height must be at least ${MIN_BUILDING_HEIGHT_M} m`;
  if (height > MAX_BUILDING_HEIGHT_M) return `Height must not exceed ${MAX_BUILDING_HEIGHT_M} m`;
  return null;
}

/** Immutable description of the extruded building, independent of Three.js meshes. */
export interface BuildingModel {
  /** Local 3D vertices (centroid at origin) plus the extrusion height */
  coords: LocalCoords3D;
  /** Building height in metres (propagates to the extruded top face) */
  heightM: number;
  /** Axis-aligned footprint extent of the terrace in local metres (E × N) */
  extentM: { east: number; north: number };
  /** Number of polygon vertices actually used (closing duplicate excluded) */
  vertexCount: number;
}

/**
 * Build the 3D building state from a WGS84 terrace polygon and a height.
 *
 * The polygon shape is preserved exactly — an irregular terrace is never
 * replaced by its bounding rectangle (AGENTS.md §12).
 *
 * @throws Error when the height is invalid or the polygon has fewer than 3 vertices
 */
export function createBuildingModel(vertices: LngLat[], heightM: number): BuildingModel {
  const heightError = validateBuildingHeight(heightM);
  if (heightError) throw new Error(heightError);

  const coords = terraceToLocal3D(vertices, heightM);
  const bounds = getLocalBounds(coords.vertices);

  return {
    coords,
    heightM,
    extentM: {
      east: bounds.max.x - bounds.min.x,
      north: bounds.max.y - bounds.min.y,
    },
    vertexCount: coords.vertices.length,
  };
}
