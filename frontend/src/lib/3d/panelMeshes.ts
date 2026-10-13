/**
 * Solar panel Three.js meshes (Phase 5).
 *
 * Pure visualisation of `PlacedPanel` application state: every dimension is
 * metres from the panel record (AGENTS.md §40, §52, §64). Panels are rendered
 * with ONE `THREE.InstancedMesh` per layout — a shared merged unit geometry
 * (glass + frame + cell grid + mounting supports) instanced N times — so
 * hundreds of panels stay at one draw call (AGENTS.md §28, §45).
 *
 * Local unit frame: origin at the panel footprint centre ON the roof plane
 * (z = 0), +X = width, +Y = length (towards the panel azimuth). The instance
 * carries only position (x, y, roofZ) and the Z rotation — the tilt and the
 * support arrangement are baked into the geometry per mounting type, so
 * supports always stay vertical in the world frame.
 *
 * Cell grid: thin painted boxes merged into the unit (no textures, no
 * per-panel meshes) — deterministic and jsdom-testable.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  effectiveColSpacingM,
  effectivePanelDims,
  effectiveRowSpacingM,
  panelTypeDefinition,
  type MountingType,
  type PanelLayoutConfig,
  type PanelTypeId,
} from "./panels";
import type { PlacedPanel } from "./panelPlacement";

/** Aluminium frame colour. */
const FRAME_COLOR = 0xb9c0c8;
/** Dark blue-black photovoltaic glass. */
const GLASS_COLOR = 0x0b1522;
/** Subtle cell-grid lines on the glass. */
const GRID_COLOR = 0x1d3050;
/** Mounting rails / legs / wedges. */
const SUPPORT_COLOR = 0x8f97a3;
/** Galvanized structural steel footings / base plates & channel rails. */
const FOOTING_COLOR = 0x606770;

/**
 * Part colours, exported so tests can tell which merged vertices belong to the
 * plate, the glass or the supports (each part of the unit geometry is painted
 * one flat colour, so colour is the only discriminator after the merge).
 */
export const PANEL_PART_COLORS = {
  /** Aluminium frame rim (its bottom face sits on the panel underside). */
  frame: FRAME_COLOR,
  /** Photovoltaic glass (recessed inside the frame). */
  glass: GLASS_COLOR,
  /** Cell-grid lines painted on the glass. */
  grid: GRID_COLOR,
  /** Legs, rails and wedges. */
  support: SUPPORT_COLOR,
} as const;

/**
 * Roof stand-off, exported so tests can assert the supports actually touch
 * the roof plane (0 in the unit frame).
 */
export const PANEL_ROOF_STANDOFF_M = 0.02;
/** Small stand-off keeping supports off the roof plane (avoids z-fighting). */
const ROOF_STANDOFF_M = PANEL_ROOF_STANDOFF_M;
/**
 * How far a support is pushed INTO the panel (or roof) it carries.
 *
 * A support whose top face is exactly coplanar with the panel underside
 * z-fights with it at close zoom, and any rounding error turns into a visible
 * gap. A 1.5 mm penetration is invisible at working distances, removes the
 * flicker, and guarantees the assembly reads as connected from every angle.
 */
const SUPPORT_OVERLAP_M = 0.0015;
/**
 * Shortest support that is still drawable. A degenerate mount (the panel
 * resting almost on the roof) keeps a stub rather than inverting or leaving a
 * floating 4 cm post.
 */
const MIN_SUPPORT_LENGTH_M = 0.004;
/** Default mounting height when a caller does not specify one. Matches
 * `DEFAULT_PANEL_CONFIG.mountHeightM` so explicit and implicit paths agree. */
const DEFAULT_MOUNT_HEIGHT_M = 0.4;
/** Frame rim width. */
const FRAME_W_M = 0.03;
/** Cells across / along the module (visual only). */
const CELLS_ACROSS = 6;
const CELLS_ALONG = 12;

/**
 * Shading heatmap metrics per panel.
 * Driven by either annual loss percent or instantaneous geometric shade fraction.
 */
export interface PanelShadingMetric {
  annualLossPercent: number;
  severity?: "none" | "moderate" | "severe";
  /** Optional instantaneous shade fraction (0.0 to 1.0) when in Current Sun / Shadow View mode */
  instantaneousShadeFraction?: number;
  /** True when the sun is below the horizon (night) */
  isNight?: boolean;
}

/**
 * Continuous shading heatmap color function.
 * 
 * Maps annual shading loss percent to a continuous perceptually ordered dark/high-contrast gradient:
 * - Low shading / minimal loss: deep blue (#1d4ed8)
 * - Moderate shading: cyan / blue-green (#06b6d4)
 * - Intermediate shading: yellow (#eab308)
 * - High shading: orange (#f97316)
 * - Very high / severe hotspot: crimson red (#ef4444)
 * - undefined or negative: neutral muted slate (#64748b)
 */
export function getShadingHeatmapColor(lossPercent: number | undefined): THREE.Color {
  if (lossPercent === undefined || lossPercent === null || !Number.isFinite(lossPercent) || lossPercent < 0) {
    return new THREE.Color(0x64748b);
  }
  // Clamp between 0% and 20% for the visual scale
  const clamped = Math.max(0, Math.min(lossPercent, 20));
  const t = clamped / 20; // 0 to 1

  // Color stops in sRGB:
  // t = 0.00: #1d4ed8 (29, 78, 216)   - deep blue (low shading)
  // t = 0.25: #06b6d4 (6, 182, 212)   - cyan / blue-green (moderate)
  // t = 0.50: #eab308 (234, 179, 8)   - yellow (intermediate)
  // t = 0.75: #f97316 (249, 115, 22)  - orange (high)
  // t = 1.00: #ef4444 (239, 68, 68)   - crimson red (severe hotspot)
  const c = new THREE.Color();
  if (t <= 0.25) {
    const factor = t / 0.25;
    c.setRGB(
      (29 + (6 - 29) * factor) / 255,
      (78 + (182 - 78) * factor) / 255,
      (216 + (212 - 216) * factor) / 255,
    );
  } else if (t <= 0.50) {
    const factor = (t - 0.25) / 0.25;
    c.setRGB(
      (6 + (234 - 6) * factor) / 255,
      (182 + (179 - 182) * factor) / 255,
      (212 + (8 - 212) * factor) / 255,
    );
  } else if (t <= 0.75) {
    const factor = (t - 0.50) / 0.25;
    c.setRGB(
      (234 + (249 - 234) * factor) / 255,
      (179 + (115 - 179) * factor) / 255,
      (8 + (22 - 8) * factor) / 255,
    );
  } else {
    const factor = Math.min(1, (t - 0.75) / 0.25);
    c.setRGB(
      (249 + (239 - 249) * factor) / 255,
      (115 + (68 - 115) * factor) / 255,
      (22 + (68 - 22) * factor) / 255,
    );
  }
  return c;
}

/**
 * Continuous shading heatmap color function for instantaneous geometric shade fraction (0 to 1.0).
 * 0.0 = deep blue (full direct sunlight / 0% shaded)
 * 0.25 = cyan (25% obstructed)
 * 0.50 = yellow (50% obstructed)
 * 0.75 = orange (75% obstructed)
 * 1.00 = crimson red (100% in shade)
 * isNight = dark slate/charcoal (#1e293b)
 */
export function getInstantaneousShadeColor(fraction: number | undefined, isNight = false): THREE.Color {
  if (isNight) {
    return new THREE.Color(0x1e293b); // Dark slate/charcoal at night
  }
  if (fraction === undefined || fraction === null || !Number.isFinite(fraction) || fraction < 0) {
    return new THREE.Color(0x1d4ed8); // Default to unshaded blue
  }
  return getShadingHeatmapColor(fraction * 20); // Scale 0..1 to 0..20 to reuse smooth color stops
}

function paint(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    values[i * 3] = c.r;
    values[i * 3 + 1] = c.g;
    values[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
  return geometry;
}

function box(
  w: number,
  l: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(l, 0.001), Math.max(h, 0.001));
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

/** Triangular prism (shed wedge): triangle in the YZ plane, extruded along X. */
function wedge(widthM: number, lengthM: number, backHeightM: number): THREE.BufferGeometry {
  const hw = widthM / 2;
  const hl = lengthM / 2;
  // Triangle in YZ: +Y is the low (front) side, −Y the high (back) side, so
  // the wedge is deepest at the back, where it carries the raised edge of the
  // tilted panel. The hypotenuse runs front-bottom → back-top.
  const a: [number, number, number] = [-hw, hl, 0]; // front-bottom, x = -hw
  const b: [number, number, number] = [-hw, -hl, 0]; // back-bottom, x = -hw
  const c: [number, number, number] = [-hw, -hl, backHeightM]; // back-top, x = -hw
  const d: [number, number, number] = [hw, hl, 0]; // front-bottom, x = +hw
  const e: [number, number, number] = [hw, -hl, 0]; // back-bottom, x = +hw
  const f: [number, number, number] = [hw, -hl, backHeightM]; // back-top, x = +hw

  const vertices: number[] = [];
  const tri = (
    p: [number, number, number],
    q: [number, number, number],
    r: [number, number, number],
  ) => {
    vertices.push(...p, ...q, ...r);
  };
  tri(a, b, c); // left side wall (x = -hw)
  tri(d, e, f); // right side wall (x = +hw)
  tri(a, d, f); // sloped top — follows the panel underside
  tri(a, f, c); // sloped top, second triangle
  tri(b, e, d); // bottom
  tri(b, d, a); // bottom, second triangle
  tri(c, f, e); // vertical back wall
  tri(c, e, b); // vertical back wall, second triangle
  // The front edge has zero height, so there is no front cap to build.

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  // Match the BoxGeometry attribute set (position/normal/uv + colour) and the
  // indexed layout, otherwise mergeGeometries refuses the mixed geometries.
  const vertexCount = vertices.length / 3;
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 2), 2),
  );
  geometry.setIndex(Array.from({ length: vertexCount }, (_, i) => i));
  return paint(geometry, SUPPORT_COLOR);
}

/**
 * Merged unit geometry: photovoltaic panel plus its mounting arrangement.
 *
 * Coordinate frame (one panel, no instance transform): the panel is built
 * flat in its OWN frame (+X = width, +Y = length, centred on the origin),
 * rotated about X by `-tilt` so the +Y edge dips, then lifted so its centre is
 * at `centerH`. Supports are vertical world-frame prisms: each one is placed
 * at the world position of the panel point it carries and sized to reach that
 * point's underside, so the assembly stays connected at every tilt and
 * mounting height (see the flat branch for the mapping).
 *
 * `mountHeightM` is the support height above the roof plane - it lifts the
 * whole assembly and stretches every leg/support accordingly, so the rendered
 * geometry matches the configured value rather than a fixed stand-off.
 * `legRows`/`legCols` select the visual support pattern for flat mounting
 * (legs spread along the row/length and column/width directions, matching
 * the rows x columns lattice); other mounting types ignore them.
 * Returned geometry must be disposed by the caller when the layout changes.
 */
export function createPanelUnitGeometry(
  panelTypeId: PanelTypeId,
  mounting: MountingType,
  tiltDeg: number,
  mountHeightM: number = DEFAULT_MOUNT_HEIGHT_M,
  legRows = 2,
  legCols = 2,
  withoutLegs = false,
): THREE.BufferGeometry {
  const type = panelTypeDefinition(panelTypeId);
  const w = type.widthM;
  const l = type.lengthM;
  const t = type.thicknessM;
  const tilt = ((tiltDeg * Math.PI) / 180);
  const mountHeight = Number.isFinite(mountHeightM) && mountHeightM > 0
    ? mountHeightM
    : DEFAULT_MOUNT_HEIGHT_M;

  const parts: THREE.BufferGeometry[] = [];

  // --- Panel assembly, built flat and centred at the origin -------------
  const panelParts: THREE.BufferGeometry[] = [];
  // Glass (slightly recessed inside the frame).
  panelParts.push(box(w - 2 * FRAME_W_M, l - 2 * FRAME_W_M, t * 0.5, 0, 0, t * 0.1, GLASS_COLOR));
  // Frame rim: two long + two short extrusions.
  panelParts.push(box(FRAME_W_M, l, t, -(w - FRAME_W_M) / 2, 0, 0, FRAME_COLOR));
  panelParts.push(box(FRAME_W_M, l, t, (w - FRAME_W_M) / 2, 0, 0, FRAME_COLOR));
  panelParts.push(box(w - 2 * FRAME_W_M, FRAME_W_M, t, 0, -(l - FRAME_W_M) / 2, 0, FRAME_COLOR));
  panelParts.push(box(w - 2 * FRAME_W_M, FRAME_W_M, t, 0, (l - FRAME_W_M) / 2, 0, FRAME_COLOR));
  // Cell grid: thin lines just above the glass surface.
  const gridZ = t * 0.5 + 0.002;
  for (let i = 1; i < CELLS_ACROSS; i++) {
    const x = -w / 2 + (i * w) / CELLS_ACROSS;
    panelParts.push(box(0.01, l - 2 * FRAME_W_M, 0.004, x, 0, gridZ, GRID_COLOR));
  }
  for (let j = 1; j < CELLS_ALONG; j++) {
    const y = -l / 2 + (j * l) / CELLS_ALONG;
    panelParts.push(box(w - 2 * FRAME_W_M, 0.01, 0.004, 0, y, gridZ, GRID_COLOR));
  }
  // Two rails under the panel (they follow the tilt) — only when using individual panel legs.
  // When withoutLegs is true, the shared table frame provides continuous rails across the set.
  if (!withoutLegs) {
    panelParts.push(box(0.06, l - 0.1, 0.04, -(w / 2 - 0.14), 0, -t / 2 - 0.02, SUPPORT_COLOR));
    panelParts.push(box(0.06, l - 0.1, 0.04, w / 2 - 0.14, 0, -t / 2 - 0.02, SUPPORT_COLOR));
  }

  // Tilt about X: the +Y edge dips toward the sun (normal leans to +Y).
  const tiltMatrix = new THREE.Matrix4().makeRotationX(-tilt);
  for (const part of panelParts) {
    part.applyMatrix4(tiltMatrix);
    parts.push(part);
  }

  // --- Mounting arrangement (world-vertical frame, z = 0 is the roof) ---
  const sin = Math.sin(tilt);
  const cos = Math.cos(tilt);
  const lowEdgeCenter = t / 2 + (l / 2) * sin; // centre height with low edge at roof

  if (mounting === "flat") {
    // Raised on thin legs: an open, clearly elevated arrangement. The
    // plate height and every leg length derive from `mountHeight` through the
    // SAME underside plane, so changing the control raises the array and
    // stretches the supports together - the panel and its legs can never
    // drift apart.
    const centerH = ROOF_STANDOFF_M + mountHeight + (l / 2) * sin;

    if (!withoutLegs) {
      // Legs spread evenly across the footprint: legRows positions along the
      // panel LENGTH axis (the set's row direction, +Y) and legCols along the
      // panel WIDTH axis (the set's column direction, +X) - the same axes the
      // rows x columns lattice uses. 2 x 2 lands exactly on the four corners;
      // a count of 1 centres.
      const spanX = (n: number): number[] => {
        const count = Math.max(1, Math.floor(n));
        if (count <= 1) return [0];
        return Array.from({ length: count }, (_, i) => -(w / 2 - 0.14) + (i * (w - 0.28)) / (count - 1));
      };
      const spanY = (n: number): number[] => {
        const count = Math.max(1, Math.floor(n));
        if (count <= 1) return [0];
        return Array.from({ length: count }, (_, i) => -(l / 2 - 0.18) + (i * (l - 0.36)) / (count - 1));
      };
      const legXs = spanX(legCols);
      const legYs = spanY(legRows);
      const basePlateSize = 0.14; // 14cm x 14cm footing to eliminate floating look & anchor shadows
      const basePlateThickness = 0.012; // 12mm structural footing plate

      for (const sx of legXs) {
        // Connect front and back legs along Y with a bottom channel rail resting on footings
        if (legYs.length >= 2) {
          const yStart = cos * legYs[0] - sin * (t / 2);
          const yEnd = cos * legYs[legYs.length - 1] - sin * (t / 2);
          const railCenterY = (yStart + yEnd) / 2;
          const railLen = Math.abs(yEnd - yStart);
          parts.push(box(0.04, railLen, 0.025, sx, railCenterY, ROOF_STANDOFF_M + basePlateThickness + 0.0125, FOOTING_COLOR));
        }

        for (const sy of legYs) {
          // The support grid is laid out in the panel's OWN frame, and the tilt
          // rotates that frame about X, so a support at local (sx, sy) stands
          // at world (sx, cos*sy - sin*t/2) - directly under the point of the
          // panel it carries. Placing it at the raw local y instead throws the
          // outer legs outside the (foreshortened) tilted footprint, where they
          // hold nothing and read as detached struts: at 15 deg the panel still
          // covers them, at 45 deg they stand ~16 cm beyond its edge.
          const legY = cos * sy - sin * (t / 2);
          // Base plate (footing) resting on the roof plane
          parts.push(
            box(basePlateSize, basePlateSize, basePlateThickness, sx, legY, ROOF_STANDOFF_M + basePlateThickness / 2, FOOTING_COLOR),
          );
          // Height of the panel underside above that support point. The plate is
          // a plane, so every leg is a different length; the overlap keeps the
          // joint welded (no gap, and no coplanar z-fighting where they meet).
          const underside = centerH - sin * sy - cos * (t / 2);
          const height = Math.max(
            MIN_SUPPORT_LENGTH_M,
            underside + SUPPORT_OVERLAP_M - ROOF_STANDOFF_M,
          );
          parts.push(box(0.05, 0.05, height, sx, legY, ROOF_STANDOFF_M + height / 2, SUPPORT_COLOR));
        }
      }
    }
    // Lift the panel assembly to its elevated centre height.
    const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
    for (const part of panelParts) part.applyMatrix4(lift);
  } else if (mounting === "tilted") {
    // Lying flush on the roof plane, held by one rail under the high edge.
    const centerH = ROOF_STANDOFF_M + mountHeight + lowEdgeCenter;
    // The rail faces are vertical, so its top must reach the HIGHEST
    // underside point over the rail's own footprint: anything less leaves a
    // daylight gap under the raised edge of the panel.
    const railY = -(l / 2 - 0.035);
    const railTop = centerH - sin * (railY - 0.035) - cos * (t / 2) + SUPPORT_OVERLAP_M;
    const railWorldY = cos * railY - sin * (t / 2);
    const railBase = ROOF_STANDOFF_M + mountHeight;
    const railHeight = railTop - railBase;
    if (railHeight > 0.02) {
      parts.push(box(w, 0.07, railHeight, 0, railWorldY, railBase + railHeight / 2, SUPPORT_COLOR));
    }
    const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
    for (const part of panelParts) part.applyMatrix4(lift);
  } else {
    // Shed: single-slope solid wedge under the panel. The wedge is a prism,
    // so its height comes from the underside at its own back edge and its
    // hypotenuse then runs parallel to the plate.
    const centerH = ROOF_STANDOFF_M + mountHeight + lowEdgeCenter;
    const wedgeBase = ROOF_STANDOFF_M + mountHeight;
    const wedgeLength = l * 0.98;
    const wedgeTop = centerH - sin * (-wedgeLength / 2) - cos * (t / 2) + SUPPORT_OVERLAP_M;
    const backHeight = wedgeTop - wedgeBase;
    if (backHeight > 0.03) {
      const support = wedge(w, wedgeLength, backHeight);
      support.translate(0, 0, wedgeBase);
      parts.push(support);
    }
    const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
    for (const part of panelParts) part.applyMatrix4(lift);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error("Failed to merge panel unit geometry");
  }
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Build a thin coplanar face geometry that covers the active photovoltaic
 * module face (recessed inside the frame) and tracks the exact panel tilt and lift.
 *
 * This geometry is used for the edge-to-edge heatmap overlay mesh.
 * It is positioned +0.003m above the glass face in the tilted frame so that
 * the continuous heatmap completely fills the PV cell area without z-fighting,
 * while leaving the aluminium frame and support legs clearly visible.
 */
export function createPanelHeatmapFaceGeometry(
  panelTypeId: PanelTypeId,
  mounting: MountingType,
  tiltDeg: number,
  mountHeightM: number = DEFAULT_MOUNT_HEIGHT_M,
): THREE.BufferGeometry {
  const type = panelTypeDefinition(panelTypeId);
  const w = type.widthM;
  const l = type.lengthM;
  const t = type.thicknessM;
  const tilt = (tiltDeg * Math.PI) / 180;
  const mountHeight = Number.isFinite(mountHeightM) && mountHeightM > 0
    ? mountHeightM
    : DEFAULT_MOUNT_HEIGHT_M;

  // Active module face rectangle (inside the frame borders)
  const faceW = Math.max(w - 2 * FRAME_W_M, 0.01);
  const faceL = Math.max(l - 2 * FRAME_W_M, 0.01);

  // Thin box for the face overlay (0.002m), placed slightly proud of the glass surface
  const faceBox = new THREE.BoxGeometry(faceW, faceL, 0.002);
  faceBox.translate(0, 0, t * 0.5 + 0.003);

  // Tilt about X to match the panel assembly tilt
  const tiltMatrix = new THREE.Matrix4().makeRotationX(-tilt);
  faceBox.applyMatrix4(tiltMatrix);

  // World-vertical elevation matching the panel mount
  const sin = Math.sin(tilt);
  const lowEdgeCenter = t / 2 + (l / 2) * sin;

  let centerH = ROOF_STANDOFF_M + mountHeight + (l / 2) * sin;
  if (mounting === "tilted" || mounting === "shed") {
    centerH = ROOF_STANDOFF_M + mountHeight + lowEdgeCenter;
  }
  const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
  faceBox.applyMatrix4(lift);

  faceBox.computeVertexNormals();
  faceBox.computeBoundingSphere();
  return faceBox;
}

/**
 * Shared mounting table frame geometry for Panel Sets (Task 1).
 *
 * Implements a true commercial mounting table structure where every row `r`
 * tilts about its own row axis `(Y = rowCenterY, Z = centerH)` — matching the
 * exact per-module transform in `createPanelUnitGeometry`:
 * - Continuous longitudinal rails per row running beneath the modules across all columns.
 * - Under-frame mounting clamps flush with the module frame underside (never penetrating the PV glass).
 * - Transverse cross-beams / sloped rafters directly beneath the rails in each row.
 * - Vertical structural legs supporting each row's rafters from roof baseplates, tied by
 *   continuous ground channels and low-clearance knee braces that stay strictly below the rafters.
 */
export function createSharedPanelSetFrameGeometry(
  config: PanelLayoutConfig,
  tableRowsOverride?: number,
  tableColsOverride?: number,
): THREE.BufferGeometry {
  const typeDef = panelTypeDefinition(config.panelTypeId);
  const dims = effectivePanelDims(config);
  const w = dims.widthM;
  const l = dims.lengthM;
  const t = typeDef.thicknessM;
  const tilt = (config.tiltDeg * Math.PI) / 180;
  const sin = Math.sin(tilt);
  const cos = Math.cos(tilt);

  const setRows = Math.max(1, tableRowsOverride ?? config.setRows);
  const setCols = Math.max(1, tableColsOverride ?? config.setCols);
  const rowSpacing = effectiveRowSpacingM(config);
  const colSpacing = effectiveColSpacingM(config);

  const stepU = w + colSpacing;
  const stepV = l + rowSpacing;

  const totalWidth = setCols * w + (setCols - 1) * colSpacing;

  const mountHeight = Number.isFinite(config.mountHeightM) && config.mountHeightM > 0
    ? config.mountHeightM
    : DEFAULT_MOUNT_HEIGHT_M;
  const centerH = ROOF_STANDOFF_M + mountHeight + (l / 2) * sin;

  const parts: THREE.BufferGeometry[] = [];

  const railProfileW = 0.04;
  const railProfileH = 0.035;
  const railLengthX = totalWidth + 0.06;

  // In each row's local tilted frame, the panel underside is at z = -t / 2.
  // The top of the longitudinal rail welds into the bottom of the aluminium frame rim by SUPPORT_OVERLAP_M (2 mm),
  // staying >10 mm below the recessed PV glass layer.
  const railTopLocalZ = -t / 2 + SUPPORT_OVERLAP_M;
  const railCenterLocalZ = railTopLocalZ - railProfileH / 2;
  const railBottomLocalZ = railTopLocalZ - railProfileH;

  const railTiltMatrix = new THREE.Matrix4().makeRotationX(-tilt);

  // 1. Continuous longitudinal rails per row across all columns + under-frame clamps
  for (let r = 0; r < setRows; r++) {
    const rowCenterY = (r - (setRows - 1) / 2) * stepV;
    const yOffsets = [-l * 0.26, l * 0.26];

    for (const dy of yOffsets) {
      const unrotatedRail = box(
        railLengthX,
        railProfileW,
        railProfileH,
        0,
        dy,
        railCenterLocalZ,
        SUPPORT_COLOR,
      );
      unrotatedRail.applyMatrix4(railTiltMatrix);
      unrotatedRail.translate(0, rowCenterY, centerH);
      parts.push(unrotatedRail);

      // Under-frame clamping brackets at module borders and table ends (strictly below railTopLocalZ)
      const clampH = 0.016;
      const clampCenterLocalZ = railTopLocalZ - clampH / 2;
      for (let c = 0; c <= setCols; c++) {
        let clampX: number;
        if (c === 0) clampX = -totalWidth / 2;
        else if (c === setCols) clampX = totalWidth / 2;
        else clampX = -totalWidth / 2 + c * stepU - colSpacing / 2;

        const clamp = box(0.035, 0.05, clampH, clampX, dy, clampCenterLocalZ, FRAME_COLOR);
        clamp.applyMatrix4(railTiltMatrix);
        clamp.translate(0, rowCenterY, centerH);
        parts.push(clamp);
      }
    }
  }

  // 2. Transverse cross-beams / sloped rafters directly beneath the longitudinal rails
  const legCols = Math.max(1, config.legCols);
  const legRows = Math.max(1, config.legRows);

  const spanX = (count: number): number[] => {
    if (count <= 1) return [0];
    const margin = Math.min(0.28, totalWidth * 0.2);
    const half = Math.max(0.05, totalWidth / 2 - margin);
    return Array.from({ length: count }, (_, i) => -half + (i * 2 * half) / (count - 1));
  };

  const legXs = spanX(legCols);

  const rafterW = 0.05;
  const rafterH = 0.04;
  const rafterLen = l * 0.88;
  const rafterTopLocalZ = railBottomLocalZ + SUPPORT_OVERLAP_M;
  const rafterCenterLocalZ = rafterTopLocalZ - rafterH / 2;
  const rafterBottomLocalZ = rafterTopLocalZ - rafterH;

  for (const rx of legXs) {
    for (let r = 0; r < setRows; r++) {
      const rowCenterY = (r - (setRows - 1) / 2) * stepV;
      const unrotatedRafter = box(
        rafterW,
        rafterLen,
        rafterH,
        rx,
        0,
        rafterCenterLocalZ,
        SUPPORT_COLOR,
      );
      unrotatedRafter.applyMatrix4(railTiltMatrix);
      unrotatedRafter.translate(0, rowCenterY, centerH);
      parts.push(unrotatedRafter);
    }
  }

  // 3. Shared structural legs, baseplates, continuous ground channels, and low-clearance bracing
  const basePlateSize = 0.16;
  const basePlateThickness = 0.014;
  const legThickness = 0.05;

  // Support positions along each row's sloped rafter (in the row's local tilted frame):
  // - Single row: legRows positions distributed along the rafter.
  // - Multi-row: if legRows <= 1, one central post per row; otherwise front & back posts per row
  //   so every row's tilted rafter is supported at both its high and low ends without floating or piercing.
  const rowSyPoints: number[] = (() => {
    if (legRows <= 1) return [0];
    if (setRows === 1) {
      const half = l * 0.32;
      return Array.from({ length: legRows }, (_, i) => -half + (i * 2 * half) / (legRows - 1));
    }
    return [-l * 0.32, l * 0.32];
  })();

  for (const lx of legXs) {
    const allBentLegYs: number[] = [];

    for (let r = 0; r < setRows; r++) {
      const rowCenterY = (r - (setRows - 1) / 2) * stepV;
      const rowLegs: Array<{ y: number; zTop: number }> = [];

      for (const sy of rowSyPoints) {
        // Exact world/table coordinates of the point (lx, sy, rafterBottomLocalZ) on row r's rafter underside:
        // After makeRotationX(-tilt) and translate(0, rowCenterY, centerH):
        //   Y = rowCenterY + cos(tilt)*sy + sin(tilt)*rafterBottomLocalZ
        //   Z = centerH    - sin(tilt)*sy + cos(tilt)*rafterBottomLocalZ
        const legY = rowCenterY + cos * sy + sin * rafterBottomLocalZ;
        const rafterUndersideZ = centerH - sin * sy + cos * rafterBottomLocalZ;

        // Account for leg cross-section slope clearance so the high-side edge of the vertical post
        // stays strictly inside the rafter and never protrudes above the rafter top face.
        const topZ = Math.max(
          ROOF_STANDOFF_M + MIN_SUPPORT_LENGTH_M,
          rafterUndersideZ + SUPPORT_OVERLAP_M,
        );
        const legHeight = topZ - ROOF_STANDOFF_M;

        parts.push(
          box(
            basePlateSize,
            basePlateSize,
            basePlateThickness,
            lx,
            legY,
            ROOF_STANDOFF_M + basePlateThickness / 2,
            FOOTING_COLOR,
          ),
        );
        parts.push(
          box(
            legThickness,
            legThickness,
            legHeight,
            lx,
            legY,
            ROOF_STANDOFF_M + legHeight / 2,
            SUPPORT_COLOR,
          ),
        );

        allBentLegYs.push(legY);
        rowLegs.push({ y: legY, zTop: topZ });
      }

      // Low-clearance diagonal brace within row r: stays strictly below the lowest rafter point (front.zTop)
      if (rowLegs.length >= 2) {
        const back = rowLegs[0]; // high side (-Y in row)
        const front = rowLegs[rowLegs.length - 1]; // low side (+Y in row)
        const zBottom = ROOF_STANDOFF_M + basePlateThickness + 0.015;
        const zBraceTop = Math.min(front.zTop, back.zTop) - 0.015;
        const dy = back.y - front.y;
        const dz = zBraceTop - zBottom;
        const strutLen = Math.hypot(dy, dz);
        if (zBraceTop > zBottom + 0.04 && strutLen > 0.18) {
          const strut = box(0.032, strutLen, 0.032, 0, 0, 0, SUPPORT_COLOR);
          const strutAngle = Math.atan2(dz, dy);
          strut.applyMatrix4(new THREE.Matrix4().makeRotationX(strutAngle));
          strut.translate(
            lx,
            (front.y + back.y) / 2,
            (zBottom + zBraceTop) / 2,
          );
          parts.push(strut);
        }
      }
    }

    // Continuous ground channel rail tying all legs of this bent across all rows on the roof
    if (allBentLegYs.length >= 2) {
      const minY = Math.min(...allBentLegYs);
      const maxY = Math.max(...allBentLegYs);
      const tieLen = (maxY - minY) + basePlateSize * 0.75;
      const tieCenterY = (minY + maxY) / 2;
      parts.push(
        box(
          0.045,
          tieLen,
          0.025,
          lx,
          tieCenterY,
          ROOF_STANDOFF_M + basePlateThickness + 0.0125,
          FOOTING_COLOR,
        ),
      );
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error("Failed to merge panel set frame geometry");
  }
  merged.computeBoundingSphere();
  return merged;
}

interface ResolvedTableDescriptor {
  tableId: string;
  rows: number;
  cols: number;
  centerX: number;
  centerY: number;
  rotationDeg: number;
  panels: PlacedPanel[];
}

/**
 * Partition `panels` into shared-table panels (with resolved table descriptors)
 * and standalone individual-mount panels.
 *
 * Ownership rules:
 * 1. Any panel with an explicit `tableId` and `(tableRows > 1 || tableCols > 1)`
 *    always uses its shared mounting table frame, even if standalone panels are
 *    later added to the same `PanelSet` or if a panel in the table was removed.
 * 2. Any panel without `tableId` when other panels in the list have `tableId` is
 *    an explicit standalone panel and always receives individual legs.
 * 3. When no panel in `panels` carries `tableId` (legacy/direct callers) and
 *    `options?.isPanelSet` is true with `setRows * setCols > 1`, complete chunks
 *    of `setRows * setCols` are grouped into shared tables and any remaining
 *    panels receive individual legs.
 */
function partitionPanelsByMounting(
  panels: PlacedPanel[],
  options?: { isPanelSet?: boolean; config?: PanelLayoutConfig },
): {
  setPanels: PlacedPanel[];
  standalonePanels: PlacedPanel[];
  tables: ResolvedTableDescriptor[];
} {
  const config = options?.config;
  if (!config) {
    return { setPanels: [], standalonePanels: panels, tables: [] };
  }

  const dims = effectivePanelDims(config);
  const stepU = dims.widthM + effectiveColSpacingM(config);
  const stepV = dims.lengthM + effectiveRowSpacingM(config);

  const hasExplicitTableIds = panels.some((p) => Boolean(p.tableId));

  if (hasExplicitTableIds) {
    const setPanels: PlacedPanel[] = [];
    const standalonePanels: PlacedPanel[] = [];
    const byTable = new Map<string, PlacedPanel[]>();

    for (const p of panels) {
      const tRows = p.tableRows ?? config.setRows;
      const tCols = p.tableCols ?? config.setCols;
      if (p.tableId && (tRows > 1 || tCols > 1)) {
        setPanels.push(p);
        const list = byTable.get(p.tableId);
        if (list) list.push(p);
        else byTable.set(p.tableId, [p]);
      } else {
        standalonePanels.push(p);
      }
    }

    const tables: ResolvedTableDescriptor[] = [];
    for (const [tableId, members] of byTable.entries()) {
      const first = members[0];
      const rows = Math.max(1, first.tableRows ?? config.setRows);
      const cols = Math.max(1, first.tableCols ?? config.setCols);
      const rotDeg = first.rotationDeg;
      const rad = (rotDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      let sumCx = 0;
      let sumCy = 0;
      for (const m of members) {
        if (
          m.tableRow !== undefined &&
          m.tableCol !== undefined &&
          m.tableRows !== undefined &&
          m.tableCols !== undefined
        ) {
          const du = (m.tableCol - (m.tableCols - 1) / 2) * stepU;
          const dv = (m.tableRow - (m.tableRows - 1) / 2) * stepV;
          sumCx += m.x - (du * cos - dv * sin);
          sumCy += m.y - (du * sin + dv * cos);
        } else {
          sumCx += m.x;
          sumCy += m.y;
        }
      }

      tables.push({
        tableId,
        rows,
        cols,
        centerX: sumCx / members.length,
        centerY: sumCy / members.length,
        rotationDeg: rotDeg,
        panels: members,
      });
    }

    return { setPanels, standalonePanels, tables };
  }

  // Fallback for callers that pass raw PlacedPanel[] without tableId
  const tableSize = config.setRows * config.setCols;
  const useLegacySet = Boolean(
    options?.isPanelSet &&
    (config.setRows > 1 || config.setCols > 1) &&
    panels.length >= tableSize,
  );

  if (!useLegacySet) {
    return { setPanels: [], standalonePanels: panels, tables: [] };
  }

  const tableCount = Math.floor(panels.length / tableSize);
  const setPanelCount = tableCount * tableSize;
  const setPanels = panels.slice(0, setPanelCount);
  const standalonePanels = panels.slice(setPanelCount);
  const tables: ResolvedTableDescriptor[] = [];

  for (let tIdx = 0; tIdx < tableCount; tIdx++) {
    const start = tIdx * tableSize;
    const members = panels.slice(start, start + tableSize);
    let avgX = 0;
    let avgY = 0;
    for (const m of members) {
      avgX += m.x;
      avgY += m.y;
    }
    tables.push({
      tableId: `legacy-table-${tIdx}`,
      rows: config.setRows,
      cols: config.setCols,
      centerX: avgX / members.length,
      centerY: avgY / members.length,
      rotationDeg: members[0].rotationDeg,
      panels: members,
    });
  }

  return { setPanels, standalonePanels, tables };
}

/**
 * Build the panel layer for the current application state: one group holding
 * the base InstancedMesh (panels + frame + mounting) and, when shading visualization
 * is enabled, a dedicated InstancedMesh full-face heatmap overlay covering the PV surface.
 */
export function createPanelGroup(
  panels: PlacedPanel[],
  panelTypeId: PanelTypeId,
  mounting: MountingType,
  tiltDeg: number,
  roofZ: number,
  mountHeightM: number = DEFAULT_MOUNT_HEIGHT_M,
  legRows = 2,
  legCols = 2,
  shadingSeverities?: Array<"none" | "moderate" | "severe">,
  shadingMetrics?: Array<PanelShadingMetric | null | undefined>,
  options?: {
    isPanelSet?: boolean;
    config?: PanelLayoutConfig;
  },
): THREE.Group {
  const group = new THREE.Group();
  group.name = "SolarPanels";
  if (panels.length === 0) return group;

  const { setPanels, standalonePanels, tables } = partitionPanelsByMounting(panels, options);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  const buildModuleInstancedMesh = (
    subset: PlacedPanel[],
    withoutLegs: boolean,
    meshName: string,
  ): THREE.InstancedMesh => {
    const geometry = createPanelUnitGeometry(
      panelTypeId,
      mounting,
      tiltDeg,
      mountHeightM,
      legRows,
      legCols,
      withoutLegs,
    );
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.28,
      metalness: 0.18,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, subset.length);
    mesh.name = meshName;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    for (let i = 0; i < subset.length; i++) {
      const panel = subset[i];
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (panel.rotationDeg * Math.PI) / 180,
      );
      matrix.compose(new THREE.Vector3(panel.x, panel.y, roofZ), quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  };

  if (setPanels.length > 0 && standalonePanels.length === 0) {
    group.add(buildModuleInstancedMesh(setPanels, true, "SolarPanelInstances"));
  } else if (standalonePanels.length > 0 && setPanels.length === 0) {
    group.add(buildModuleInstancedMesh(standalonePanels, false, "SolarPanelInstances"));
  } else {
    // Mixed layout: set panels use legless module geometry on shared frames;
    // standalone panels use full individual-leg geometry simultaneously.
    group.add(buildModuleInstancedMesh(setPanels, true, "SolarPanelInstances"));
    group.add(buildModuleInstancedMesh(standalonePanels, false, "SolarPanelStandaloneInstances"));
  }

  // Render shared mounting table frames for all multi-panel tables
  if (tables.length > 0 && options?.config) {
    const config = options.config;
    // Group tables by (rows, cols) in case a layer contains tables of different grid sizes
    const byDims = new Map<string, ResolvedTableDescriptor[]>();
    for (const tbl of tables) {
      const key = `${tbl.rows}x${tbl.cols}`;
      const list = byDims.get(key);
      if (list) list.push(tbl);
      else byDims.set(key, [tbl]);
    }

    let dimGroupIdx = 0;
    for (const [, dimTables] of byDims.entries()) {
      const { rows, cols } = dimTables[0];
      const frameGeom = createSharedPanelSetFrameGeometry(config, rows, cols);
      const frameMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.40,
      });
      const frameMesh = new THREE.InstancedMesh(frameGeom, frameMat, dimTables.length);
      frameMesh.name = dimGroupIdx === 0 ? "SolarPanelSharedFrame" : `SolarPanelSharedFrame_${dimGroupIdx}`;
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
      frameMesh.frustumCulled = false;

      const fMatrix = new THREE.Matrix4();
      const fQuat = new THREE.Quaternion();
      const fScale = new THREE.Vector3(1, 1, 1);

      for (let tIdx = 0; tIdx < dimTables.length; tIdx++) {
        const tbl = dimTables[tIdx];
        fQuat.setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          (tbl.rotationDeg * Math.PI) / 180,
        );
        fMatrix.compose(new THREE.Vector3(tbl.centerX, tbl.centerY, roofZ), fQuat, fScale);
        frameMesh.setMatrixAt(tIdx, fMatrix);
      }
      frameMesh.instanceMatrix.needsUpdate = true;
      group.add(frameMesh);
      dimGroupIdx += 1;
    }
  }

  // When shading visualization is active (either via shadingMetrics or legacy shadingSeverities),
  // render a dedicated instanced overlay that completely covers the PV module face edge-to-edge
  // with the continuous heatmap gradient.
  const hasShadingData = Boolean(
    (shadingMetrics && shadingMetrics.length > 0) ||
    (shadingSeverities && shadingSeverities.length > 0)
  );

  if (hasShadingData) {
    const heatmapGeom = createPanelHeatmapFaceGeometry(panelTypeId, mounting, tiltDeg, mountHeightM);
    const heatmapMat = new THREE.MeshStandardMaterial({
      roughness: 0.70,
      metalness: 0.0,
      transparent: true,
      opacity: 0.90,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0,
    });
    const heatmapMesh = new THREE.InstancedMesh(heatmapGeom, heatmapMat, panels.length);
    heatmapMesh.name = "SolarPanelHeatmapInstances";
    heatmapMesh.castShadow = false;
    heatmapMesh.receiveShadow = true;
    heatmapMesh.frustumCulled = false;

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (panel.rotationDeg * Math.PI) / 180,
      );
      matrix.compose(new THREE.Vector3(panel.x, panel.y, roofZ), quaternion, scale);
      heatmapMesh.setMatrixAt(i, matrix);

      let color: THREE.Color;
      const metric = shadingMetrics ? shadingMetrics[i] : undefined;
      if (metric && (metric.isNight || Number.isFinite(metric.instantaneousShadeFraction))) {
        color = getInstantaneousShadeColor(metric.instantaneousShadeFraction, metric.isNight);
      } else if (metric && Number.isFinite(metric.annualLossPercent)) {
        color = getShadingHeatmapColor(metric.annualLossPercent);
      } else if (shadingSeverities && shadingSeverities[i]) {
        const sev = shadingSeverities[i];
        if (sev === "severe") {
          color = getShadingHeatmapColor(15);
        } else if (sev === "moderate") {
          color = getShadingHeatmapColor(7.5);
        } else {
          color = getShadingHeatmapColor(1.0);
        }
      } else {
        color = new THREE.Color(0x64748b);
      }
      heatmapMesh.setColorAt(i, color);
    }
    heatmapMesh.instanceMatrix.needsUpdate = true;
    if (heatmapMesh.instanceColor) {
      heatmapMesh.instanceColor.needsUpdate = true;
    }
    group.add(heatmapMesh);
  }

  return group;
}

/**
 * Fast in-place update of panel shading colors on an existing panel group.
 * Modifies heatmap InstancedMesh colors directly without destroying/recreating geometries or meshes.
 * Returns true if an existing heatmap mesh was updated, or false if geometry needs rebuild.
 */
export function updatePanelGroupShading(
  group: THREE.Group,
  panels: PlacedPanel[],
  shadingSeverities?: Array<"none" | "moderate" | "severe">,
  shadingMetrics?: Array<PanelShadingMetric | null | undefined>,
): boolean {
  const heatmapMesh = group.getObjectByName("SolarPanelHeatmapInstances") as THREE.InstancedMesh | null;
  const hasShadingData = Boolean(
    (shadingMetrics && shadingMetrics.length > 0) ||
    (shadingSeverities && shadingSeverities.length > 0)
  );

  if (!heatmapMesh) {
    // If there is shading data but no heatmap mesh exists, or vice versa, caller must rebuild
    return !hasShadingData;
  }

  if (!hasShadingData) {
    heatmapMesh.visible = false;
    return true;
  }

  if (heatmapMesh.count !== panels.length) {
    return false; // count mismatch requires full rebuild
  }

  heatmapMesh.visible = true;
  for (let i = 0; i < panels.length; i++) {
    let color: THREE.Color;
    const metric = shadingMetrics ? shadingMetrics[i] : undefined;
    if (metric && (metric.isNight || Number.isFinite(metric.instantaneousShadeFraction))) {
      color = getInstantaneousShadeColor(metric.instantaneousShadeFraction, metric.isNight);
    } else if (metric && Number.isFinite(metric.annualLossPercent)) {
      color = getShadingHeatmapColor(metric.annualLossPercent);
    } else if (shadingSeverities && shadingSeverities[i]) {
      const sev = shadingSeverities[i];
      if (sev === "severe") {
        color = getShadingHeatmapColor(15);
      } else if (sev === "moderate") {
        color = getShadingHeatmapColor(7.5);
      } else {
        color = getShadingHeatmapColor(1.0);
      }
    } else {
      color = new THREE.Color(0x64748b);
    }
    heatmapMesh.setColorAt(i, color);
  }

  if (heatmapMesh.instanceColor) {
    heatmapMesh.instanceColor.needsUpdate = true;
  }
  return true;
}

/** Dispose every geometry and material a panel group owns. */
export function disposePanelGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
