/**
 * enerzyAI 3D Scene & Export Branding Pipeline (Text-Only 3D Geometry)
 *
 * Implements clean, professional, geometry-based enerzyAI 3D text branding across:
 * 1. Installation Materials: mounting rails/frames (enerzyAI_MountingMark_01, etc.)
 * 2. Building Body: visible front exterior facade (enerzyAI_BuildingMark)
 * 3. Rooftop: subtle horizontal text marking on clear roof surface (enerzyAI_RooftopMark)
 * 4. Ground Plane: subtle corporate entrance text on ground (enerzyAI_GroundMark)
 *
 * Requirements:
 * - 100% pure 3D text geometry (TextGeometry with Helvetiker Bold typeface).
 * - Exact text: "enerzyAI" (lowercase enerzy, uppercase AI).
 * - NO logo symbol, NO taglines, NO background rectangles, NO borders, NO plaques, NO decals.
 * - Clean light silver-white finish (0xf1f5f9) in daylight, crisp white (0xffffff) at night.
 * - Light brushed aluminum finish (0xe2e8f0) on metallic mounting structures.
 * - Self-contained: fully supported in binary GLB export without external URLs or textures.
 * - Non-interactive / non-selectable: ignored by raycasters for solar panels & obstacles.
 */

import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BRANDING_TEXT, getEnerzyAIFont } from "./brandingAssets";
import type { LocalCoords3D } from "./coordinates";
import type { PanelLayoutConfig } from "./panels";
import type { PlacedSetPanel } from "./panelSets";

export interface BrandingOptions {
  localCoords: LocalCoords3D;
  buildingHeight: number;
  installationType?: "rooftop" | "ground";
  isNight?: boolean;
  panelLayers?: Array<{
    config: PanelLayoutConfig;
    panels: PlacedSetPanel[];
    isPanelSet?: boolean;
  }> | null;
}

/**
 * Creates 3D TextGeometry for "enerzyAI", centered around (0, 0, 0).
 */
export function createEnerzyAITextGeometry(size: number, depth: number): TextGeometry {
  const font = getEnerzyAIFont();
  const geometry = new TextGeometry(BRANDING_TEXT, {
    font,
    size,
    depth,
    curveSegments: 3,
    bevelEnabled: false,
  });
  geometry.computeBoundingBox();
  geometry.center();
  return geometry;
}

/**
 * Creates adaptive standard material for enerzyAI 3D text.
 * Uses a clean, light, elegant architectural finish (not deep or dark in color).
 */
export function createBrandingMaterial(isNight = false, isMetallic = false): THREE.MeshStandardMaterial {
  if (isMetallic) {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, // Crisp pure white for proper visibility on metal structure
      roughness: 0.20,
      metalness: 0.10,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      name: "enerzyAI_MetallicTextMat",
    });
  }

  return new THREE.MeshStandardMaterial({
    color: isNight ? 0x717f92 : 0x525d6d, // Soft, lighter architectural graphite slate
    roughness: 0.38,
    metalness: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    name: "enerzyAI_TextMat",
  });
}

/**
 * Creates a standalone 3D text mesh for "enerzyAI".
 * Contains NO background plaque, NO border, and NO raster texture.
 */
export function createEnerzyAITextMesh(options: {
  size: number;
  depth?: number;
  isNight?: boolean;
  isMetallic?: boolean;
  name: string;
}): THREE.Mesh {
  const size = options.size;
  const depth = options.depth ?? size * 0.06;
  const isNight = options.isNight ?? false;
  const isMetallic = options.isMetallic ?? false;

  const geom = createEnerzyAITextGeometry(size, depth);
  const mat = createBrandingMaterial(isNight, isMetallic);

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = options.name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  mesh.userData = {
    isBranding: true,
    isMetallic,
    selectable: false,
    text: BRANDING_TEXT,
    size,
    depth,
  };

  return mesh;
}

export interface WallSegmentDescriptor {
  p1: THREE.Vector2;
  p2: THREE.Vector2;
  midpoint: THREE.Vector2;
  normal: THREE.Vector2;
  tangent: THREE.Vector2;
  length: number;
  angleZ: number;
  score: number;
  index: number;
  prevIndex: number;
  nextIndex: number;
}

/**
 * Find all exterior facade wall segments of the building polygon.
 * Extracts length, midpoint, outward normal, tangent, orientation angle, and topological loop indices.
 * Guarantees that the outward normal ALWAYS points strictly away from the building centroid.
 */
export function findAllFacadeSegments(vertices: Array<{ x: number; y: number } | THREE.Vector3>): WallSegmentDescriptor[] {
  if (vertices.length < 2) {
    return [
      {
        p1: new THREE.Vector2(-5, -5),
        p2: new THREE.Vector2(5, -5),
        midpoint: new THREE.Vector2(0, -5),
        normal: new THREE.Vector2(0, -1),
        tangent: new THREE.Vector2(1, 0),
        length: 10,
        angleZ: 0,
        score: -10,
        index: 0,
        prevIndex: 0,
        nextIndex: 0,
      },
    ];
  }

  // Deduplicate consecutive or closing duplicate vertices
  const raw = vertices;
  const unique: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const pt = raw[i];
    if (i === raw.length - 1 && raw.length > 2) {
      if (Math.hypot(pt.x - raw[0].x, pt.y - raw[0].y) < 0.01) continue;
    }
    unique.push({ x: pt.x, y: pt.y });
  }

  const count = unique.length;
  if (count < 2) return [];

  // Compute centroid of polygon
  let cx = 0;
  let cy = 0;
  for (const v of unique) {
    cx += v.x;
    cy += v.y;
  }
  cx /= count;
  cy /= count;

  const segments: WallSegmentDescriptor[] = [];

  for (let i = 0; i < count; i++) {
    const v1 = unique[i];
    const v2 = unique[(i + 1) % count];
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;

    const midX = (v1.x + v2.x) / 2;
    const midY = (v1.y + v2.y) / 2;

    // Outward normal candidate
    let nx = dy / len;
    let ny = -dx / len;

    // Verify outward direction away from building centroid
    if (nx * (midX - cx) + ny * (midY - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const outwardNormal = new THREE.Vector2(nx, ny).normalize();
    // Tangent along wall: tangent x up (0, 0, 1) = normal
    const tangent = new THREE.Vector2(-outwardNormal.y, outwardNormal.x).normalize();

    // Prefer south-facing facades (ny < 0) or frontmost (lowest Y)
    const southFactor = outwardNormal.y < -0.3 ? -10 : outwardNormal.y < 0 ? -5 : 5;
    const lengthBonus = -Math.min(len, 30) * 0.2;
    const score = midY + southFactor + lengthBonus;

    segments.push({
      p1: new THREE.Vector2(v1.x, v1.y),
      p2: new THREE.Vector2(v2.x, v2.y),
      midpoint: new THREE.Vector2(midX, midY),
      normal: outwardNormal,
      tangent,
      length: len,
      angleZ: Math.atan2(outwardNormal.x, -outwardNormal.y),
      score,
      index: i,
      prevIndex: (i - 1 + count) % count,
      nextIndex: (i + 1) % count,
    });
  }

  // Sort so the front-facing / South-facing facade is first
  segments.sort((a, b) => a.score - b.score);
  return segments;
}

/**
 * Find the primary front-facing facade wall segment (facing South / lowest Y).
 */
export function findFrontFacadeSegment(vertices: Array<{ x: number; y: number } | THREE.Vector3>): {
  p1: THREE.Vector2;
  p2: THREE.Vector2;
  midpoint: THREE.Vector2;
  normal: THREE.Vector2;
  length: number;
  angleZ: number;
} {
  const all = findAllFacadeSegments(vertices);
  if (all.length > 0) return all[0];
  return {
    p1: new THREE.Vector2(-5, -5),
    p2: new THREE.Vector2(5, -5),
    midpoint: new THREE.Vector2(0, -5),
    normal: new THREE.Vector2(0, -1),
    length: 10,
    angleZ: 0,
  };
}

/**
 * Creates flexible 3D text "enerzyAI" that conforms along the building wall polyline.
 *
 * Each letter glyph is individually articulated along the perimeter path:
 * - If the wall is straight, letters form a pristine, straight word.
 * - If the wall turns a corner, letters flexibly wrap around the corner.
 * - Every letter stays attached flush to the wall surface at all times.
 * - Never sticks out into thin air.
 */
export function createFlexibleWallTextMesh(options: {
  size: number;
  depth?: number;
  isNight?: boolean;
  name: string;
  currentSeg: WallSegmentDescriptor;
  prevSeg?: WallSegmentDescriptor | null;
  nextSeg?: WallSegmentDescriptor | null;
  offsetAlongSeg?: number;
  offsetFromWall?: number;
}): THREE.Mesh {
  const size = options.size;
  const depth = options.depth ?? 0.015;
  const isNight = options.isNight ?? false;
  const offsetFromWall = options.offsetFromWall ?? 0.015;
  const offsetAlongSeg = options.offsetAlongSeg ?? 0;

  const font = getEnerzyAIFont();
  const chars = Array.from(BRANDING_TEXT); // ['e', 'n', 'e', 'r', 'z', 'y', 'A', 'I']

  // Measure word-level vertical bounds to preserve true typographic baseline for every character.
  // In pure typography, lowercase 'y' extends below the baseline, lowercase 'e', 'n', 'e', 'r', 'z'
  // sit on the baseline up to x-height, and uppercase 'A' & 'I' extend up to cap-height.
  const wholeWordGeom = new TextGeometry(BRANDING_TEXT, {
    font,
    size,
    depth,
    curveSegments: 3,
    bevelEnabled: false,
  });
  wholeWordGeom.computeBoundingBox();
  const wordBb = wholeWordGeom.boundingBox!;
  const wordMidY = (wordBb.min.y + wordBb.max.y) / 2;
  wholeWordGeom.dispose();

  // Build each glyph geometry, measure width and center horizontally while maintaining shared baseline
  const glyphData: Array<{ geom: TextGeometry; width: number }> = [];
  for (const char of chars) {
    const g = new TextGeometry(char, {
      font,
      size,
      depth,
      curveSegments: 3,
      bevelEnabled: false,
    });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const w = Math.max(0.005, bb.max.x - bb.min.x);
    const midX = (bb.min.x + bb.max.x) / 2;
    // Translate in X to center glyph, in Y by shared wordMidY to preserve exact baseline, in Z to center depth
    g.translate(-midX, -wordMidY, -depth / 2);
    glyphData.push({ geom: g, width: w });
  }

  const gap = size * 0.08;
  let totalW = 0;
  for (let i = 0; i < glyphData.length; i++) {
    totalW += glyphData[i].width;
    if (i < glyphData.length - 1) totalW += gap;
  }

  const seg = options.currentSeg;
  const nextSeg = options.nextSeg;
  const prevSeg = options.prevSeg;

  // Determine wall traversal direction relative to tangent
  const dirX = seg.p2.x - seg.p1.x;
  const dirY = seg.p2.y - seg.p1.y;
  const dot = dirX * seg.tangent.x + dirY * seg.tangent.y;

  const rightCorner = dot >= 0 ? seg.p2 : seg.p1;
  const leftCorner = dot >= 0 ? seg.p1 : seg.p2;
  const rightAdjSeg = dot >= 0 ? nextSeg : prevSeg;
  const leftAdjSeg = dot >= 0 ? prevSeg : nextSeg;

  // Center point along the segment with user offset
  const centerPtX = seg.midpoint.x + offsetAlongSeg * seg.tangent.x;
  const centerPtY = seg.midpoint.y + offsetAlongSeg * seg.tangent.y;

  const dRight = Math.max(0.1, seg.length / 2 - offsetAlongSeg);
  const dLeft = Math.max(0.1, seg.length / 2 + offsetAlongSeg);

  const anchorX = centerPtX + seg.normal.x * (depth / 2 + offsetFromWall);
  const anchorY = centerPtY + seg.normal.y * (depth / 2 + offsetFromWall);

  const transformedGeometries: THREE.BufferGeometry[] = [];
  let currX = -totalW / 2;

  for (let k = 0; k < glyphData.length; k++) {
    const { geom, width } = glyphData[k];
    const charCenterX = currX + width / 2;
    currX += width + gap;

    let px = 0;
    let py = 0;
    let norm = seg.normal;
    let tang = seg.tangent;

    if (charCenterX >= 0) {
      if (charCenterX <= dRight || !rightAdjSeg) {
        // Lies on current wall segment
        px = centerPtX + charCenterX * seg.tangent.x + seg.normal.x * (depth / 2 + offsetFromWall);
        py = centerPtY + charCenterX * seg.tangent.y + seg.normal.y * (depth / 2 + offsetFromWall);
        norm = seg.normal;
        tang = seg.tangent;
      } else {
        // Bends around the right corner onto adjoining wall face!
        const extra = charCenterX - dRight;
        px = rightCorner.x + extra * rightAdjSeg.tangent.x + rightAdjSeg.normal.x * (depth / 2 + offsetFromWall);
        py = rightCorner.y + extra * rightAdjSeg.tangent.y + rightAdjSeg.normal.y * (depth / 2 + offsetFromWall);
        norm = rightAdjSeg.normal;
        tang = rightAdjSeg.tangent;
      }
    } else {
      const absX = Math.abs(charCenterX);
      if (absX <= dLeft || !leftAdjSeg) {
        // Lies on current wall segment
        px = centerPtX + charCenterX * seg.tangent.x + seg.normal.x * (depth / 2 + offsetFromWall);
        py = centerPtY + charCenterX * seg.tangent.y + seg.normal.y * (depth / 2 + offsetFromWall);
        norm = seg.normal;
        tang = seg.tangent;
      } else {
        // Bends around the left corner onto adjoining wall face!
        const extra = absX - dLeft;
        px = leftCorner.x - extra * leftAdjSeg.tangent.x + leftAdjSeg.normal.x * (depth / 2 + offsetFromWall);
        py = leftCorner.y - extra * leftAdjSeg.tangent.y + leftAdjSeg.normal.y * (depth / 2 + offsetFromWall);
        norm = leftAdjSeg.normal;
        tang = leftAdjSeg.tangent;
      }
    }

    const tangentVec = new THREE.Vector3(tang.x, tang.y, 0).normalize();
    const upVec = new THREE.Vector3(0, 0, 1);
    const normalVec = new THREE.Vector3(norm.x, norm.y, 0).normalize();

    const transform = new THREE.Matrix4().makeBasis(tangentVec, upVec, normalVec);
    transform.setPosition(px - anchorX, py - anchorY, 0);

    geom.applyMatrix4(transform);
    transformedGeometries.push(geom);
  }

  const mergedGeom = mergeGeometries(transformedGeometries, false);
  mergedGeom.computeVertexNormals();

  for (const item of glyphData) {
    item.geom.dispose();
  }

  const mat = createBrandingMaterial(isNight, false);
  const mesh = new THREE.Mesh(mergedGeom, mat);
  mesh.name = options.name;
  mesh.position.set(anchorX, anchorY, 0);
  mesh.userData = {
    isBranding: true,
    isBuildingMark: true,
    selectable: false,
    text: BRANDING_TEXT,
    size,
    depth,
  };

  return mesh;
}

/**
 * Deterministic pseudo-random float in [0, 1) seeded by a number.
 * Ensures consistent, reproducible placement across renders without frame-to-frame jitter.
 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Creates building facade brand markings on ALL sides in the wall area of the building.
 *
 * Strict geometric bounds & constraints:
 * - Asymmetrical & random: watermarks are randomly scattered across walls (no rigid symmetry).
 * - Proper placement: strictly inside wall boundaries, safely above ground and below parapets.
 * - Non-overlapping: distributed across irregular slots with safe spacing.
 * - Flexible: conforms along the wall polyline, wrapping around corners without sticking out.
 * - Light black architectural finish (0x3a424e daylight / 0x525e70 night).
 */
export function createAllBuildingFacadeMarks(
  localCoords: LocalCoords3D,
  buildingHeight: number,
  isNight = false,
): THREE.Mesh[] {
  const segments = findAllFacadeSegments(localCoords.vertices);
  const marks: THREE.Mesh[] = [];
  if (segments.length === 0 || buildingHeight <= 0.5) return marks;

  // Map original polygon loop index to segment descriptor
  const segByIndex = new Map<number, WallSegmentDescriptor>();
  for (const s of segments) segByIndex.set(s.index, s);

  let markIdx = 1;

  for (const seg of segments) {
    // Only place on walls wide enough to accommodate the word
    const maxLenSize = (seg.length * 0.35) / 4.6;
    const maxHeightSize = buildingHeight * 0.12;
    if (maxLenSize < 0.12 && seg.length < 1.6) continue;

    const textSize = Math.min(0.28, Math.max(0.14, Math.min(maxLenSize, maxHeightSize)));
    const depth = 0.015; // 1.5 cm clean architectural emboss

    const prevSeg = segByIndex.get(seg.prevIndex) ?? null;
    const nextSeg = segByIndex.get(seg.nextIndex) ?? null;

    // Scale number of watermarks with wall size:
    // As wall length and/or height increase, watermark count increases:
    // - Length < 1.6m: 0 marks
    // - Length 1.6m - 5.5m: 1 mark
    // - Length 5.5m - 10.5m: 2 marks
    // - Length 10.5m - 16m: 3 marks
    // - Length 16m - 22m: 4 marks
    // - Length 22m - 29m: 5 marks
    // - Length 29m - 37m: 6 marks
    // - Length >= 37m: min(12, floor(length / 5.0))
    let countPerWall = 1;
    if (seg.length >= 37) {
      countPerWall = Math.min(12, Math.floor(seg.length / 5.0));
    } else if (seg.length >= 29) {
      countPerWall = 6;
    } else if (seg.length >= 22) {
      countPerWall = 5;
    } else if (seg.length >= 16) {
      countPerWall = 4;
    } else if (seg.length >= 10.5) {
      countPerWall = 3;
    } else if (seg.length >= 5.5) {
      countPerWall = 2;
    }

    // Vertical tiers: if the building wall is tall (>= 11m) and wall is wide enough,
    // distribute marks across lower and upper wall tiers so height also increases visual coverage
    const vertTiers = buildingHeight >= 20 ? 3 : buildingHeight >= 11 && seg.length >= 6 ? 2 : 1;

    // Usable horizontal span with safe margins from wall corners
    const cornerMargin = Math.max(0.9, textSize * 2.5);
    const usableSpan = Math.max(0.4, seg.length - 2 * cornerMargin);

    const positionsAlongSeg: Array<{ offset: number; heightFrac: number }> = [];
    const seed = seg.index * 79 + Math.round(seg.length * 13);

    for (let j = 0; j < countPerWall; j++) {
      // Divide usable span into countPerWall zones with randomized jitter (no symmetry)
      const slotWidth = usableSpan / countPerWall;
      const slotCenter = -usableSpan / 2 + (j + 0.5) * slotWidth;
      const jitterMax = slotWidth * 0.32;
      const jitter = (pseudoRandom(seed + j * 29 + 11) - 0.5) * 2 * jitterMax;
      const offset = slotCenter + jitter;

      // Assign vertical height based on tier and random jitter
      const tier = (j + Math.floor(pseudoRandom(seed + j * 17) * vertTiers)) % vertTiers;
      let hFrac: number;
      if (vertTiers === 1) {
        hFrac = 0.38 + pseudoRandom(seed + j * 43 + 19) * 0.24; // ~38% - 62%
      } else if (vertTiers === 2) {
        if (tier === 0) {
          hFrac = 0.26 + pseudoRandom(seed + j * 43 + 19) * 0.18; // ~26% - 44% (lower tier)
        } else {
          hFrac = 0.56 + pseudoRandom(seed + j * 43 + 37) * 0.18; // ~56% - 74% (upper tier)
        }
      } else {
        // 3 tiers for very tall structures
        if (tier === 0) hFrac = 0.20 + pseudoRandom(seed + j * 43 + 11) * 0.14;
        else if (tier === 1) hFrac = 0.44 + pseudoRandom(seed + j * 43 + 23) * 0.14;
        else hFrac = 0.68 + pseudoRandom(seed + j * 43 + 37) * 0.14;
      }

      positionsAlongSeg.push({ offset, heightFrac: hFrac });
    }

    for (const posConfig of positionsAlongSeg) {
      const meshName = markIdx === 1 ? "enerzyAI_BuildingMark" : `enerzyAI_BuildingMark_${String(markIdx).padStart(2, "0")}`;
      markIdx++;

      const textMesh = createFlexibleWallTextMesh({
        size: textSize,
        depth,
        isNight,
        name: meshName,
        currentSeg: seg,
        prevSeg,
        nextSeg,
        offsetAlongSeg: posConfig.offset,
        offsetFromWall: 0.015,
      });

      // Position vertically in the wall area, safely below parapets and above ground
      const posZ = Math.max(0.85, Math.min(buildingHeight * posConfig.heightFrac, buildingHeight - 0.75));
      textMesh.position.z = posZ;

      marks.push(textMesh);
    }
  }

  return marks;
}

/**
 * Building Facade Brand Marking: clean, light 3D text "enerzyAI" on the primary front exterior wall.
 * Maintained for backward compatibility with existing tests & utilities.
 */
export function createBuildingFacadeMark(
  localCoords: LocalCoords3D,
  buildingHeight: number,
  isNight = false,
): THREE.Mesh {
  const allMarks = createAllBuildingFacadeMarks(localCoords, buildingHeight, isNight);
  if (allMarks.length > 0) return allMarks[0];

  // Fallback if geometry has no valid segments
  const facade = findFrontFacadeSegment(localCoords.vertices);
  const textSize = 0.28;
  const depth = 0.015;
  const textMesh = createEnerzyAITextMesh({
    size: textSize,
    depth,
    isNight,
    name: "enerzyAI_BuildingMark",
  });
  textMesh.position.set(facade.midpoint.x, facade.midpoint.y, Math.min(buildingHeight * 0.5, buildingHeight - 0.7));
  return textMesh;
}

/**
 * Compute the 2D planar area of a polygon in m².
 */
export function computePolygonArea(vertices: Array<{ x: number; y: number } | THREE.Vector3>): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

/**
 * Standard 2D ray-casting point-in-polygon test.
 */
export function isPointInPolygon(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number } | THREE.Vector3>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculate the minimum distance from point (px, py) to the polygon boundary edges.
 */
export function distanceToPolygonEdges(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number } | THREE.Vector3>,
): number {
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const dist = Math.hypot(px - projX, py - projY);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/**
 * Rooftop Brand Markings: subtle light 3D text "enerzyAI" scattered across rooftop areas
 * in random places and random orientations, scaling with roof area.
 */
export function createAllRooftopMarks(
  localCoords: LocalCoords3D,
  buildingHeight: number,
  isNight = false,
): THREE.Mesh[] {
  const marks: THREE.Mesh[] = [];
  const vertices = localCoords.vertices;
  if (vertices.length < 3 || buildingHeight <= 0.5) return marks;

  const roofArea = computePolygonArea(vertices);
  // Scale number of rooftop watermarks with roof area:
  // e.g. <50m² -> 3 marks, 150m² -> 5 marks, 400m² -> 8-9 marks, >1000m² -> 12-16 marks
  const targetCount = Math.max(3, Math.min(16, Math.round(Math.sqrt(Math.max(25, roofArea)) * 0.45)));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX <= 1.5 || spanY <= 1.5) return marks;

  const textSize = 0.26;
  const depth = 0.003; // Ultra-shallow 3mm flush engraving
  const edgeMargin = Math.max(0.85, Math.min(1.4, Math.min(spanX, spanY) * 0.12));
  const minSeparation = Math.max(1.8, Math.min(4.5, Math.sqrt(roofArea / targetCount) * 0.85));

  const acceptedPoints: Array<{ x: number; y: number; angleZ: number }> = [];
  const baseSeed = Math.round((spanX * 137 + spanY * 269 + roofArea * 17) % 100000);

  for (let k = 0; k < targetCount; k++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const seed = baseSeed + k * 193 + attempt * 29;
      const rx = pseudoRandom(seed);
      const ry = pseudoRandom(seed + 13);
      const cx = minX + edgeMargin + rx * (spanX - 2 * edgeMargin);
      const cy = minY + edgeMargin + ry * (spanY - 2 * edgeMargin);

      if (!isPointInPolygon(cx, cy, vertices)) continue;
      if (distanceToPolygonEdges(cx, cy, vertices) < edgeMargin) continue;

      // Ensure separation from previously placed rooftop marks
      let tooClose = false;
      for (const p of acceptedPoints) {
        if (Math.hypot(cx - p.x, cy - p.y) < minSeparation) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Random orientation in the horizontal plane (0 to 360 deg)
      const randomAngleZ = pseudoRandom(seed + 91) * Math.PI * 2;
      acceptedPoints.push({ x: cx, y: cy, angleZ: randomAngleZ });
      break;
    }
  }

  // Fallback: if tight geometry yielded fewer than 2 marks, place at least one near centroid or clear corner
  if (acceptedPoints.length === 0) {
    let sumX = 0, sumY = 0;
    for (const v of vertices) { sumX += v.x; sumY += v.y; }
    acceptedPoints.push({
      x: sumX / vertices.length,
      y: sumY / vertices.length,
      angleZ: pseudoRandom(baseSeed + 71) * Math.PI * 2,
    });
  }

  for (let i = 0; i < acceptedPoints.length; i++) {
    const pt = acceptedPoints[i];
    const meshName = i === 0 ? "enerzyAI_RooftopMark" : `enerzyAI_RooftopMark_${String(i + 1).padStart(2, "0")}`;
    const textMesh = createEnerzyAITextMesh({
      size: textSize,
      depth,
      isNight,
      name: meshName,
    });

    textMesh.position.set(pt.x, pt.y, buildingHeight + depth / 2 + 0.002);
    // Random orientation around Z axis, lying flat on the roof slab
    textMesh.rotation.set(0, 0, pt.angleZ);
    textMesh.userData.isRooftopMark = true;

    marks.push(textMesh);
  }

  return marks;
}

/**
 * Rooftop Brand Marking: subtle light 3D text "enerzyAI" flush on rooftop surface.
 * Returns the primary rooftop mark for backward compatibility.
 */
export function createRooftopMark(
  localCoords: LocalCoords3D,
  buildingHeight: number,
  isNight = false,
): THREE.Mesh {
  const allMarks = createAllRooftopMarks(localCoords, buildingHeight, isNight);
  if (allMarks.length > 0) return allMarks[0];

  const textSize = 0.26;
  const depth = 0.003;
  const textMesh = createEnerzyAITextMesh({
    size: textSize,
    depth,
    isNight,
    name: "enerzyAI_RooftopMark",
  });
  textMesh.position.set(0, 0, buildingHeight + depth / 2 + 0.002);
  textMesh.rotation.set(0, 0, 0);
  return textMesh;
}

/**
 * Ground Plane Brand Marking: 3D text "enerzyAI" lying flat on the ground plane in front of site.
 */
export function createGroundMark(localCoords: LocalCoords3D, isNight = false): THREE.Mesh {
  const textSize = 0.55;
  const depth = 0.025;

  const textMesh = createEnerzyAITextMesh({
    size: textSize,
    depth,
    isNight,
    name: "enerzyAI_GroundMark",
  });

  const vertices = localCoords.vertices;
  let minY = -5;
  let sumX = 0;

  if (vertices.length > 0) {
    for (const v of vertices) {
      if (v.y < minY) minY = v.y;
      sumX += v.x;
    }
    sumX /= vertices.length;
  }

  // Position 2.5m in front of the southern boundary
  const posX = sumX;
  const posY = minY - 2.5;

  textMesh.position.set(posX, posY, depth / 2 + 0.01);
  textMesh.rotation.set(0, 0, 0);

  return textMesh;
}

/**
 * Installation Component Marks: discrete light metallic 3D text "enerzyAI"
 * engraved directly on the solar panel module frame and the metal mounting structure.
 *
 * Mathematically aligned flush with the physical geometry:
 * 1. enerzyAI_PanelMark_01: flush on the bottom aluminium frame rim of the solar panel module,
 *    tilted at the exact panel tilt angle and rotated with the panel heading.
 * 2. enerzyAI_MountingMark_01: flush on the front vertical face of the metal structural leg/post.
 */
export function createMountingMarks(
  panelLayers: BrandingOptions["panelLayers"],
  buildingHeight: number,
  isNight = false,
): THREE.Mesh[] {
  const marks: THREE.Mesh[] = [];
  if (!panelLayers || panelLayers.length === 0) return marks;

  const ROOF_STANDOFF_M = 0.02;
  const FRAME_W_M = 0.03;

  let mountMarkIdx = 1;
  let panelMarkIdx = 1;

  for (const layer of panelLayers) {
    const panels = layer.panels;
    if (!panels || panels.length === 0) continue;

    const config = layer.config;
    const tiltDeg = config?.tiltDeg ?? 15;
    const tilt = (tiltDeg * Math.PI) / 180;
    const mountHeight = Number.isFinite(config?.mountHeightM) && config?.mountHeightM! > 0
      ? config.mountHeightM!
      : 0.4;

    // Physical dimensions from config or default 550W panel
    const widthM = config?.customWidthM ?? 1.13;
    const lengthM = config?.customLengthM ?? 2.28;
    const thicknessM = 0.035;

    // Panel center lift height above roof plane (matching panelMeshes.ts)
    const sinTilt = Math.sin(tilt);
    const cosTilt = Math.cos(tilt);
    const centerH = ROOF_STANDOFF_M + mountHeight + (lengthM / 2) * sinTilt;

    // Pick first panel
    const p = panels[0];
    const rotZ = ((p.rotationDeg ?? 0) * Math.PI) / 180;
    const cosR = Math.cos(rotZ);
    const sinR = Math.sin(rotZ);

    // 1. Metal Mounting Structure Engraving:
    // Placed directly on the front vertical face of the metal structural support leg/post
    const mountBadgeSize = 0.022; // 2.2 cm font size
    const mountBadgeDepth = 0.002; // 2 mm shallow metal stamp

    const mountTextMesh = createEnerzyAITextMesh({
      size: mountBadgeSize,
      depth: mountBadgeDepth,
      isNight,
      isMetallic: true,
      name: `enerzyAI_MountingMark_${String(mountMarkIdx++).padStart(2, "0")}`,
    });

    // In panelMeshes.ts, front legs are at local Y: (lengthM / 2 - 0.18)
    const legLocalX = -(widthM / 2 - 0.14); // front-left structural leg
    const legLocalY = lengthM / 2 - 0.18;
    const legUnitY = cosTilt * legLocalY - sinTilt * (thicknessM / 2);
    const legFaceY = legUnitY + 0.02 + 0.002; // 2 mm in front of the 0.04m post's front face
    const legFaceZ = ROOF_STANDOFF_M + 0.012 + (mountHeight * 0.45);

    // World position of mounting mark
    const mountWorldX = p.x + (legLocalX * cosR - legFaceY * sinR);
    const mountWorldY = p.y + (legLocalX * sinR + legFaceY * cosR);
    const mountWorldZ = buildingHeight + legFaceZ;

    mountTextMesh.position.set(mountWorldX, mountWorldY, mountWorldZ);

    // Orientation: text stands upright on the front vertical face of the leg
    const mountNormal = new THREE.Vector3(-sinR, cosR, 0).normalize();
    const mountUp = new THREE.Vector3(0, 0, 1);
    const mountTangent = new THREE.Vector3(-cosR, -sinR, 0).normalize();
    const mountBasis = new THREE.Matrix4().makeBasis(mountTangent, mountUp, mountNormal);
    mountTextMesh.rotation.setFromRotationMatrix(mountBasis);

    marks.push(mountTextMesh);

    // 2. Solar Panel Frame Engraving:
    // Placed directly on the lower front aluminium frame rim of the solar panel module
    const panelBadgeSize = 0.016; // 1.6 cm laser engraving on frame rim
    const panelBadgeDepth = 0.002; // 2 mm depth

    const panelTextMesh = createEnerzyAITextMesh({
      size: panelBadgeSize,
      depth: panelBadgeDepth,
      isNight,
      isMetallic: true,
      name: `enerzyAI_PanelMark_${String(panelMarkIdx++).padStart(2, "0")}`,
    });

    // Local coordinates on un-tilted panel:
    // Center of lower front aluminium frame extrusion (in panelMeshes.ts front low edge is at +Y)
    const localX = 0;
    const localY = (lengthM - FRAME_W_M) / 2;
    const localZ = thicknessM / 2 + 0.001; // Sits flush on top surface of the aluminium frame

    // Rotate by -tilt about X axis
    const tiltY = localY * cosTilt + localZ * sinTilt;
    const tiltZ = -localY * sinTilt + localZ * cosTilt;
    const unitZ = centerH + tiltZ;

    // Rotate by rotZ in world space
    const panelWorldX = p.x + (localX * cosR - tiltY * sinR);
    const panelWorldY = p.y + (localX * sinR + tiltY * cosR);
    const panelWorldZ = buildingHeight + unitZ;

    panelTextMesh.position.set(panelWorldX, panelWorldY, panelWorldZ);

    // Orientation: tilted and aligned with the panel module's frame
    const panelTangent = new THREE.Vector3(cosR, sinR, 0).normalize();
    const panelUp = new THREE.Vector3(
      -sinR * cosTilt,
      cosR * cosTilt,
      -sinTilt,
    ).normalize();
    const panelNormal = new THREE.Vector3(
      -sinR * sinTilt,
      cosR * sinTilt,
      cosTilt,
    ).normalize();

    const panelBasis = new THREE.Matrix4().makeBasis(panelTangent, panelUp, panelNormal);
    panelTextMesh.rotation.setFromRotationMatrix(panelBasis);

    marks.push(panelTextMesh);

    // Limit to 4 marks total to keep assembly clean and professional
    if (marks.length >= 4) break;
  }

  return marks;
}

/**
 * Assemble the complete enerzyAI branding group for the 3D scene.
 */
export function createSiteBranding(options: BrandingOptions): THREE.Group {
  const brandingRoot = new THREE.Group();
  brandingRoot.name = "SuryaGhar_Branding";

  const isGround = options.installationType === "ground";
  const buildingHeight = isGround ? 0 : options.buildingHeight;
  const isNight = options.isNight ?? false;

  // 1. Building Facade Marks (on all valid sides in the wall area)
  if (!isGround && buildingHeight > 0.5) {
    const facadeMarks = createAllBuildingFacadeMarks(options.localCoords, buildingHeight, isNight);
    for (const mark of facadeMarks) {
      brandingRoot.add(mark);
    }
  }

  // 2. Rooftop Marks (scattered across rooftop areas in random places and random orientations)
  if (!isGround && buildingHeight > 0.5) {
    const rooftopMarks = createAllRooftopMarks(options.localCoords, buildingHeight, isNight);
    for (const mark of rooftopMarks) {
      brandingRoot.add(mark);
    }
  }

  // 3. Ground Mark (visible for both rooftop & ground installations)
  const groundMark = createGroundMark(options.localCoords, isNight);
  brandingRoot.add(groundMark);

  // 4. Installation Material Marks (mounting rails, legs & solar panel frames)
  const mountingMarks = createMountingMarks(options.panelLayers, buildingHeight, isNight);
  for (const mark of mountingMarks) {
    brandingRoot.add(mark);
  }

  return brandingRoot;
}

/**
 * Update adaptive branding materials when lighting / sun mode changes.
 */
export function updateBrandingAdaptiveLighting(
  brandingGroup: THREE.Group,
  isNight: boolean,
): void {
  brandingGroup.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) {
        const isMetallic = mesh.userData?.isMetallic;
        if (isMetallic) {
          mat.color.setHex(0xffffff);
          mat.roughness = 0.20;
        } else {
          mat.color.setHex(isNight ? 0x717f92 : 0x525d6d);
          mat.roughness = 0.38;
        }
        mat.needsUpdate = true;
      }
    }
  });
}

/**
 * Dispose all resources in a branding group.
 */
export function disposeBrandingGroup(brandingGroup: THREE.Group): void {
  brandingGroup.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material?.dispose();
      }
    }
  });
  while (brandingGroup.children.length > 0) {
    brandingGroup.remove(brandingGroup.children[0]);
  }
}
