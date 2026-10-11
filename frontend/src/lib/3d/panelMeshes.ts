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

/** Small stand-off keeping supports off the roof plane (avoids z-fighting). */
const ROOF_STANDOFF_M = 0.02;
/** Default mounting height when a caller does not specify one. Matches
 * `DEFAULT_PANEL_CONFIG.mountHeightM` so explicit and implicit paths agree. */
const DEFAULT_MOUNT_HEIGHT_M = 0.4;
/** Frame rim width. */
const FRAME_W_M = 0.03;
/** Cells across / along the module (visual only). */
const CELLS_ACROSS = 6;
const CELLS_ALONG = 12;

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
 * `mountHeightM` is the support height above the roof plane - it lifts the
 * whole assembly and stretches every leg/support accordingly, so the rendered
 * geometry matches the configured value rather than a fixed stand-off.
 * `legRows`/`legCols` select the visual support pattern for flat mounting
 * (legs spread along the row/column directions); other mounting types
 * ignore them.
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
  const lowEdgeCenter = t / 2 + (l / 2) * sin; // centre height with low edge at roof

  if (mounting === "flat") {
    // Raised on thin legs: an open, clearly elevated arrangement. The
    // leg length and the panel centre both derive from mountHeight, so
    // changing the control raises the array and stretches the supports.
    const centerH = ROOF_STANDOFF_M + mountHeight + (l / 2) * sin;
    // Legs spread evenly across the footprint: legRows positions along the
    // row (width) direction, legCols along the column (length) direction.
    // 2 x 2 lands exactly on the four corners; a count of 1 centres.
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
    const legXs = spanX(legRows);
    const legYs = spanY(legCols);
    for (const sx of legXs) {
      for (const sy of legYs) {
        // Each leg runs from the roof up to the panel underside at its own
        // position, so a tilted array keeps standing on every support point.
        const under = centerH - sy * sin - t / 2 - ROOF_STANDOFF_M;
        const h = Math.max(0.04, under);
        parts.push(box(0.05, 0.05, h, sx, sy, ROOF_STANDOFF_M + h / 2, SUPPORT_COLOR));
      }
    }
    // Lift the panel assembly to its elevated centre height.
    const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
    for (const part of panelParts) part.applyMatrix4(lift);
  } else if (mounting === "tilted") {
    // Lying flush on the roof plane, held by one rail under the high edge.
    const centerH = ROOF_STANDOFF_M + mountHeight + lowEdgeCenter;
    const backHeight = l * sin; // rail under the −Y (high) edge
    if (backHeight > 0.02) {
      parts.push(box(w, 0.07, backHeight, 0, -(l / 2 - 0.035), ROOF_STANDOFF_M + mountHeight + backHeight / 2, SUPPORT_COLOR));
    }
    const lift = new THREE.Matrix4().makeTranslation(0, 0, centerH);
    for (const part of panelParts) part.applyMatrix4(lift);
  } else {
    // Shed: single-slope solid wedge under the panel.
    const centerH = ROOF_STANDOFF_M + mountHeight + lowEdgeCenter;
    const backHeight = l * sin + t / 2;
    if (backHeight > 0.03) {
      const support = wedge(w, l * 0.98, backHeight - 0.01);
      support.translate(0, 0, ROOF_STANDOFF_M + mountHeight);
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
 * Build the panel layer for the current application state: one group holding
 * a single InstancedMesh (empty layouts return an empty group).
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
): THREE.Group {
  const group = new THREE.Group();
  group.name = "SolarPanels";
  if (panels.length === 0) return group;

  const geometry = createPanelUnitGeometry(panelTypeId, mounting, tiltDeg, mountHeightM, legRows, legCols);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.45,
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
