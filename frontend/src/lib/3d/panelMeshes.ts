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
import { panelTypeDefinition, type MountingType, type PanelTypeId } from "./panels";
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
 * Driven by the analytical annual loss percent (0 to 100).
 */
export interface PanelShadingMetric {
  annualLossPercent: number;
  severity?: "none" | "moderate" | "severe";
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
  // Two rails under the panel (they follow the tilt).
  panelParts.push(box(0.06, l - 0.1, 0.04, -(w / 2 - 0.14), 0, -t / 2 - 0.02, SUPPORT_COLOR));
  panelParts.push(box(0.06, l - 0.1, 0.04, w / 2 - 0.14, 0, -t / 2 - 0.02, SUPPORT_COLOR));

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

  // Box for the face overlay with tiny thickness (0.003m), placed slightly above glass
  const faceBox = new THREE.BoxGeometry(faceW, faceL, 0.003);
  faceBox.translate(0, 0, t * 0.35 + 0.002);

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
): THREE.Group {
  const group = new THREE.Group();
  group.name = "SolarPanels";
  if (panels.length === 0) return group;

  const geometry = createPanelUnitGeometry(panelTypeId, mounting, tiltDeg, mountHeightM, legRows, legCols);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.18,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, panels.length);
  mesh.name = "SolarPanelInstances";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // one bounding volume for the whole layout

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (panel.rotationDeg * Math.PI) / 180,
    );
    matrix.compose(new THREE.Vector3(panel.x, panel.y, roofZ), quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);

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
      if (metric && Number.isFinite(metric.annualLossPercent)) {
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
