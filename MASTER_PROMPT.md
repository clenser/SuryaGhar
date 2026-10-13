# SuryaGhar: Rooftop and Ground-Mounted Solar Installation System

## Objective

Extend the existing SuryaGhar application to support both rooftop solar and ground-mounted solar installations. Introduce an installation-type selector in Step 1, with **Rooftop selected by default**.

Ground mode must support realistic panel placement, multiple mounting-structure designs, a translucent usable-area boundary in the 3D scene, and structurally coherent component geometry.

This is an extension of the existing project, not a rewrite.

## Phase 0: Audit the existing code before changing it

Inspect the repository and trace the complete implementation of:

- Step 1 installation/location selection and polygon drawing.
- The current selection and validation domain models.
- The existing panel-layout endpoint and layout engine.
- Panel dimensions, orientation, spacing, setbacks and panel-set configuration.
- Existing 3D scene, coordinate transformations, terrain, building geometry, solar panels, support frames, obstacles and shadows.
- Solar analysis, shading and energy calculations.
- Existing tests, API contracts, types, state management and recent commits.

Identify where installation mode should live in the domain model and how it should propagate from Step 1 to layout, validation, 3D rendering and solar analysis.

Reuse the existing coordinate system, panel-layout engine, panel configuration, and 3D scene. Do not create a competing placement engine or coordinate system. Do not implement ground mode as a separate disconnected demo.

Before coding, provide a concise implementation plan and list the files that need changes.

## Phase 1: Installation type in Step 1

Add an installation-type selector:

- Rooftop
- Ground-mounted

Requirements:

1. Rooftop is the default for new projects and existing workflows without a saved installation type.
2. Persist the selection through subsequent stages and project state.
3. Switching modes must update the appropriate selection instructions, validation rules, layout settings and 3D geometry.
4. Do not reset unrelated project data or silently delete existing panel placements when switching modes.
5. Clearly handle incompatible geometry when switching modes. Preserve recoverable configuration and require regeneration or confirmation where necessary.
6. Ensure saved projects and API payloads remain backward-compatible where possible.

## Phase 2: Select the usable area

Use the existing polygon drawing and editing tools.

### Rooftop mode

Preserve the current rooftop selection, roof validation, setbacks, roof faces, obstacles and existing placement behavior.

### Ground mode

Allow users to draw a polygon around the usable land area.

- Calculate area, perimeter and centroid using the existing metric geometry implementation.
- Validate polygon closure, self-intersection, minimum area and invalid geometry.
- Respect the selected polygon boundary during layout.
- Support editing and deleting the polygon.
- Keep the original polygon authoritative. Do not replace metric calculations with Three.js screen coordinates.

### Translucent boundary in 3D

Render the selected usable area as a subtle, transparent surface or outline with a very small vertical offset above the terrain.

- Follow the selected polygon's actual footprint.
- Sample or project terrain elevation when terrain data is available.
- Avoid z-fighting, flickering, floating edges and intersection with the terrain.
- Use a thin outline and a lightly tinted transparent fill.
- Keep the boundary visible enough to understand the usable area without obscuring grass, terrain or panels.
- Recompute it when the polygon, terrain or coordinate transform changes.
- Dispose of obsolete geometry and materials when the boundary is replaced or removed.

Do not create an arbitrary-height wall around the plot.

## Phase 3: Ground mounting structure catalogue

Implement a structure selector in the panel design controls. Each option must correspond to a genuinely different geometric construction.

### A. Fixed-tilt ground mount: first priority

Generate a realistic multi-panel structure using:

- Ground-contact foundations or piles.
- Front and rear support posts at heights consistent with the selected tilt.
- Inclined primary beams or rafters.
- Transverse rails or purlins supporting the module frames.
- Appropriate cross-members and diagonal bracing.
- Module clamps or mounting interfaces.
- Consistent fasteners or small connector details where useful.

The geometry must form a coherent load path:

PV module → clamp → rail/purlin → rafter/beam → post → foundation → ground.

For a row of modules, use shared structural members only where their spans and positions make geometric sense. Do not duplicate support posts at every panel edge if a shared frame is intended.

### B. Adjustable-tilt ground mount

Add pivot brackets and locking or adjustment connections. Changing tilt must update the module plane and associated support geometry while preserving valid joints, clearances and support contact.

### C. Single-axis tracker

Treat this as a separate articulated structure. Include support posts, bearing housings, torque tube, module rails and a drive/actuator representation. Rotate the array around the defined axis using a consistent pivot hierarchy.

Do not implement it by rotating a static group around an arbitrary world-space origin. Add tracker animation or solar-following controls only if they can be integrated correctly with the existing solar-analysis model.

### D. Elevated ground mount / agrivoltaic

Support configurable clearance beneath the modules. Use taller columns, primary beams, cross-members, bracing and appropriate foundations. Ensure the panel array is supported by the frame rather than appearing to float.

### E. Pole mount

Provide a central mast or appropriate multiple-mast arrangement, a head frame and support arms. Limit the configuration to a sensible panel count and footprint.

Prioritize A completely before implementing the other structure types. Do not present a structure as functional when only its appearance has been implemented.

Dual-axis trackers may be added later after their two-axis kinematics, bearings, drive assemblies and support geometry can be represented coherently.

## Phase 4: Correct structural geometry and joints

This is a critical requirement. Visual plausibility is not enough if the structure contains obvious geometric errors.

Use explicit local coordinate frames and parent-child transforms for each assembly.

Implement the following safeguards:

1. Derive support heights from the panel plane, tilt, mounting clearance and chosen support configuration.
2. Derive rail, beam and brace endpoints from shared structural anchor points.
3. Generate members between endpoints using a reusable beam/cylinder/box helper that correctly calculates midpoint, length and orientation.
4. Use consistent member cross-sections and reasonable dimensions relative to the panel size.
5. Align connectors with their corresponding members.
6. Avoid duplicate or overlapping members caused by independently generating each panel's complete frame.
7. Avoid disconnected braces, inverted supports, beams passing through panels, and foundations floating above or penetrating the ground excessively.
8. Prevent panel-to-panel overlap, support-to-panel intersection and unintended frame collisions.
9. Account for terrain elevation differences and prevent support legs from ending above the terrain or extending through it.
10. Recompute the full affected assembly after changes to tilt, azimuth, row spacing, support height, panel dimensions or panel count.
11. Use stable keys and deterministic geometry generation so rerenders do not duplicate meshes or alter placements unexpectedly.

Implement geometry validation where practical. For each generated structural member, validate finite coordinates, nonzero length, expected endpoint alignment and valid support connections.

Use instanced meshes or shared geometries/materials for repeated members where appropriate.

**Important:** These checks establish geometric consistency in the visualization, not certified structural safety. Do not claim engineering validation of wind loads, soil bearing capacity, foundations or steel sections without a separate engineering calculation and the required site data.

## Phase 5: Ground panel layout

Reuse the current panel-layout engine and panel dimensions.

Add a ground-placement strategy that supports:

- Selected land polygon and boundary setbacks.
- Panel portrait and landscape arrangements where compatible with the structure.
- User-selected tilt and azimuth.
- Row direction and inter-row spacing.
- Minimum maintenance/access clearance.
- Terrain-aware support placement.
- Configurable mounting clearance.
- Multiple rows and shared structural members.
- Panel count, installed capacity and footprint reporting.

Do not treat ground-mounted panels as a single coplanar collection when the selected design requires multiple rows or separate tables.

### Shading and row spacing

Calculate the row-to-row shadow clearance using panel dimensions, tilt and solar geometry, rather than a fixed arbitrary gap.

Use the project's existing solar-position and shading calculations where possible. At a minimum, distinguish geometric layout feasibility from time-dependent shading.

When terrain slope or the selected polygon prevents a valid layout, report the reason. Never silently place panels outside the usable area or through obstacles.

If constraints prevent fitting the requested count, explain the limiting factor and offer an alternative count or configuration. Do not silently relax setbacks, spacing or other user-selected constraints.

## Phase 6: Integrate with solar analysis

Ground and rooftop modes must continue using the existing authoritative solar-analysis pipeline.

- Ground mode uses the selected panel tilt, azimuth, site coordinates and relevant terrain/obstacle shading inputs.
- Rooftop mode retains its existing roof-face geometry, placement behavior and shading logic.
- If tracker support is implemented, ensure its operating orientation is represented consistently in the solar model. Do not claim tracker energy gains merely because the 3D panels rotate.
- Keep visualization-only objects, including the selection boundary, out of panel counts, structural quantities and solar calculations.
- Do not invent precise terrain, elevation or shading data when the underlying source is unavailable.

## Phase 7: 3D rendering and interaction

Integrate all new geometry into the existing Three.js scene and render lifecycle.

- Preserve orbit controls, camera behavior, lighting, shadows, scene selection and existing object interactions.
- Ensure panel placement, dragging, selection and editing continue to work.
- Avoid flickering from coincident surfaces, duplicate meshes and incorrect depth ordering.
- Keep frame components visually distinct from the solar modules and ground.
- Use realistic daylight materials and sensible component proportions.
- Ensure regenerated geometry is disposed of correctly.
- Avoid unnecessary per-frame allocations.
- Keep performance acceptable for multi-row arrays with many modules.

Use a clear visual distinction between the usable-area boundary, the actual panel footprint and the mounting frame.

## Phase 8: User interface

When Ground is selected, expose only the controls relevant to ground installation:

- Structure type.
- Tilt angle.
- Azimuth.
- Row spacing.
- Mounting clearance or support height.
- Panel arrangement.
- Boundary setback.
- Foundation representation where supported.
- Panel count and total capacity.

Provide sensible defaults but do not imply that those defaults are engineering-certified values.

Show the selected area, placed array footprint, module count, capacity and any layout warnings.

When Rooftop is selected, retain the current rooftop-specific workflow and controls.

## Phase 9: Tests and regression protection

Add tests for:

- Rooftop as the default installation mode.
- Installation mode persistence and mode switching.
- Backward-compatible saved projects and API payloads.
- Ground polygon validity, area and setback constraints.
- Layout containment and panel spacing.
- Correct panel-plane orientation and support heights.
- Structural-member endpoints, lengths and joint alignment.
- Shared rails and posts without duplicate geometry.
- Terrain-following supports.
- Adjustable tilt geometry updates.
- Tracker pivot behavior, if implemented.
- Cleanup and regeneration without duplicate meshes.
- Ground and rooftop solar-analysis regression.
- Existing panel configuration, placement, obstacle, shading and validation workflows.

Run the existing backend test suite, frontend tests, TypeScript checks and production build. Fix failures introduced by this change. Report the actual commands and results; never claim tests passed unless they were run.

## Hard constraints

- Do not rewrite the project architecture.
- Do not introduce a competing panel-placement engine or coordinate system.
- Do not remove or weaken existing rooftop functionality.
- Do not change unrelated backend services, authentication, map providers or infrastructure.
- Do not use arbitrary screen-space coordinates for metric placement.
- Do not represent structurally disconnected geometry as a valid mounting design.
- Do not silently alter user-selected constraints or panel count.
- Do not expose secrets or commit `.env` files, API keys or private keys.
- Do not commit or push unless explicitly authorized.

## Deliverables

1. Working Rooftop/Ground selection in Step 1.
2. A translucent usable-area boundary in the 3D scene.
3. Ground fixed-tilt structures with coherent supports, rails, braces and foundations.
4. A structure catalogue implemented in phases, without placeholder options being presented as functional.
5. Correct panel layout, clearances and solar-analysis integration.
6. Regression tests and build results.
7. A concise change report identifying modified files, completed structure types, remaining limitations and any live behavior that could not be verified.

Start by auditing the current codebase, then implement fixed-tilt ground mounting end to end before expanding the catalogue.