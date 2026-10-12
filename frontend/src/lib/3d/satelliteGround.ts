/**
 * Satellite ground texture.
 *
 * Gives the 3D design viewport real site context: Esri World Imagery tiles —
 * the same documented provider/abstraction the map uses
 * (`providers/imagery.ts`, recovered URL template, no invented endpoints) —
 * stitched into one canvas and aligned to the local metre frame.
 *
 * Alignment is exact, not guessed: slippy-map tile math converts each tile's
 * (x, y, z) to WGS84 bounds, each corner is projected with the authoritative
 * `projectUtm`, and expressed relative to the local origin (the same UTM
 * centroid the geometry was built against). The ground plane is then
 * sized/positioned from those numbers, so imagery pixels sit over their true
 * coordinates.
 *
 * Network failures (offline, CORS, blocked tiles) resolve to `null` and the
 * viewer keeps its neutral studio ground — a missing texture never breaks
 * the scene.
 */

import { projectUtm, type LngLat } from "../geo";
import { activeImageryProvider } from "../../providers/imagery";

export const SATELLITE_TILE_PX = 256;
/** Longest texture edge target (px): crisp without punishing laptop GPUs. */
export const SATELLITE_MAX_TEXTURE_PX = 1024;
/** Never request more tiles than this for one ground texture. */
export const SATELLITE_MAX_TILES = 36;

export interface SatelliteGround {
  /** Stitched imagery canvas (north up: row 0 is the northern edge). */
  canvas: HTMLCanvasElement;
  /** Ground-plane size in local metres (matches the canvas aspect). */
  sizeM: { width: number; height: number };
  /** Plane centre in local metres (terrace centroid = origin). */
  centerM: { x: number; y: number };
  /** Slippy zoom the pixels were fetched at (resolution disclosure). */
  zoom: number;
}

/** Longitude → tile X at zoom (standard slippy-map math). */
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** Latitude → tile Y at zoom (standard slippy-map math). */
export function latToTileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

/** Tile X → west-edge longitude. */
export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

/** Tile Y → north-edge latitude. */
export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Metres per pixel at a latitude/zoom (Web-Mercator ground resolution). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Pick the deepest zoom whose stitched texture still fits the pixel budget
 * and tile-count cap. Pure math — unit-tested, no network.
 */
export function pickGroundZoom(extentM: number, lat: number): { zoom: number; tiles: number } {
  for (let zoom = 19; zoom >= 10; zoom--) {
    const mpp = metresPerPixel(lat, zoom);
    const px = extentM / mpp;
    if (px > SATELLITE_MAX_TEXTURE_PX) continue;
    const tiles = Math.ceil(px / SATELLITE_TILE_PX);
    if (tiles * tiles > SATELLITE_MAX_TILES) continue;
    return { zoom, tiles };
  }
  return { zoom: 10, tiles: 1 };
}

/** Build one tile URL from the active provider's own template. */
export function groundTileUrl(x: number, y: number, zoom: number): string {
  const template = String(activeImageryProvider.getSourceConfig().tiles?.[0] ?? "");
  return template.replace("{z}", String(zoom)).replace("{y}", String(y)).replace("{x}", String(x));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Esri and Google Static Maps serve CORS `*`
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Satellite tile failed: ${url}`));
    img.src = url;
  });
}

export interface GroundRequest {
  /** Terrace ring in WGS84 (extent source for tile coverage). */
  ring: LngLat[];
  /**
   * Local origin in UTM metres — MUST be the same centroid
   * (`coords.centroidUtm`) the geometry was built against, so texture pixels
   * and meshes share one frame instead of two near-identical centroids.
   */
  originUtm: { x: number; y: number };
  /** Extra context around the footprint in metres (site surroundings). */
  marginM?: number;
}

const GOOGLE_STATIC_MAP_ENDPOINT = "https://maps.googleapis.com/maps/api/staticmap";
const GOOGLE_STATIC_LOGICAL_PX = 640;

function getGoogleStaticMapsKey(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_GOOGLE_STATIC_MAPS_API_KEY ?? env.GOOGLE_STATIC_MAPS_API_KEY ?? "").trim();
}

export function googleStaticMapUrl(lat: number, lng: number, zoom: number, apiKey: string): string {
  const params = new URLSearchParams({
    center: `${lat.toFixed(7)},${lng.toFixed(7)}`,
    zoom: String(zoom),
    size: `${GOOGLE_STATIC_LOGICAL_PX}x${GOOGLE_STATIC_LOGICAL_PX}`,
    scale: "2",
    maptype: "satellite",
    format: "jpg",
    key: apiKey.trim(),
  });
  return `${GOOGLE_STATIC_MAP_ENDPOINT}?${params.toString()}`;
}

/**
 * Fetch + stitch the satellite ground for a terrace. Returns null on any
 * failure (the viewer keeps neutral studio ground). Results are cached per
 * site so orbiting never refetches imagery: no new requests per movement.
 */
const groundCache = new Map<string, Promise<SatelliteGround | null>>();

export function fetchSatelliteGround({ ring, originUtm, marginM = 60 }: GroundRequest): Promise<SatelliteGround | null> {
  if (ring.length < 3) return Promise.resolve(null);
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ring) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return Promise.resolve(null);

  // Metre margin via equirectangular approximation (framing only — geometry
  // still goes through projectUtm below, never through this estimate).
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  const padLat = marginM / mPerDegLat;
  const padLng = marginM / Math.max(mPerDegLng, 1);
  const west = minLng - padLng;
  const east = maxLng + padLng;
  const south = minLat - padLat;
  const north = maxLat + padLat;

  const extentM = Math.max((east - west) * mPerDegLng, (north - south) * mPerDegLat, 1);
  const { zoom } = pickGroundZoom(extentM, midLat);
  const staticKey = getGoogleStaticMapsKey();
  const key = `${staticKey ? "gstatic" : "tiles"}:${west.toFixed(5)},${south.toFixed(5)},${east.toFixed(5)},${north.toFixed(5)},${zoom}`;
  const cached = groundCache.get(key);
  if (cached) return cached;

  const task = (async (): Promise<SatelliteGround | null> => {
    if (staticKey) {
      try {
        const img = await loadImage(googleStaticMapUrl(midLat, midLng, zoom, staticKey));
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || GOOGLE_STATIC_LOGICAL_PX;
        canvas.height = img.naturalHeight || GOOGLE_STATIC_LOGICAL_PX;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const centerTileX = lngToTileX(midLng, zoom);
          const centerTileY = latToTileY(midLat, zoom);
          const halfSpanTiles = (GOOGLE_STATIC_LOGICAL_PX / SATELLITE_TILE_PX) / 2;
          const topLeft = projectUtm({
            lng: tileXToLng(centerTileX - halfSpanTiles, zoom),
            lat: tileYToLat(centerTileY - halfSpanTiles, zoom),
          });
          const bottomRight = projectUtm({
            lng: tileXToLng(centerTileX + halfSpanTiles, zoom),
            lat: tileYToLat(centerTileY + halfSpanTiles, zoom),
          });
          const widthM = bottomRight.x - topLeft.x;
          const heightM = topLeft.y - bottomRight.y;
          if (widthM > 0 && heightM > 0) {
            return {
              canvas,
              sizeM: { width: widthM, height: heightM },
              centerM: {
                x: (topLeft.x + bottomRight.x) / 2 - originUtm.x,
                y: (topLeft.y + bottomRight.y) / 2 - originUtm.y,
              },
              zoom,
            };
          }
        }
      } catch {
        // Fall through to Esri tile stitching if Google Static Maps fails
      }
    }

    try {
      const x0 = Math.floor(lngToTileX(west, zoom));
      const x1 = Math.floor(lngToTileX(east, zoom));
      const y0 = Math.floor(latToTileY(north, zoom));
      const y1 = Math.floor(latToTileY(south, zoom));
      const nx = x1 - x0 + 1;
      const ny = y1 - y0 + 1;
      if (nx <= 0 || ny <= 0 || nx * ny > SATELLITE_MAX_TILES) return null;

      const canvas = document.createElement("canvas");
      canvas.width = nx * SATELLITE_TILE_PX;
      canvas.height = ny * SATELLITE_TILE_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      await Promise.all(
        Array.from({ length: nx * ny }, (_, i) => {
          const tx = x0 + (i % nx);
          const ty = y0 + Math.floor(i / nx);
          return loadImage(groundTileUrl(tx, ty, zoom)).then((img) => {
            ctx.drawImage(img, (tx - x0) * SATELLITE_TILE_PX, (ty - y0) * SATELLITE_TILE_PX);
          });
        }),
      );

      // Exact alignment: tile corners → UTM → local metres (the terrace
      // centroid is the local origin, matching terraceToLocal3D).
      const topLeft = projectUtm({ lng: tileXToLng(x0, zoom), lat: tileYToLat(y0, zoom) });
      const bottomRight = projectUtm({ lng: tileXToLng(x1 + 1, zoom), lat: tileYToLat(y1 + 1, zoom) });
      const widthM = bottomRight.x - topLeft.x;
      const heightM = topLeft.y - bottomRight.y;
      if (!(widthM > 0 && heightM > 0)) return null;
      return {
        canvas,
        sizeM: { width: widthM, height: heightM },
        centerM: {
          x: (topLeft.x + bottomRight.x) / 2 - originUtm.x,
          y: (topLeft.y + bottomRight.y) / 2 - originUtm.y,
        },
        zoom,
      };
    } catch {
      return null;
    }
  })();
  groundCache.set(key, task);
  return task;
}
