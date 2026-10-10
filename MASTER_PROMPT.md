# SuryaGhar M2 — Realistic Rooftop Obstacles, Shadow Contact, Roof Surface Colors and Panel Height

Continue from the current repository state. Inspect the existing implementation and make these changes directly. Preserve the working 3D design workflow and all previous fixes.

**Maximum time: 15 minutes. No browser testing, no self-looping, no commits or pushes.**

## 1. Replace box-shaped obstacles with recognizable low-poly models

### Current problem
The obstacle selector contains:
- AC / HVAC
- Water Tank
- Staircase Room
- Lift Room
- Custom

However, the first four currently look like generic rectangular boxes or polygon extrusions. I want each predefined obstacle to have a recognizable 3D model. Low-poly geometry is sufficient; photorealistic assets are unnecessary.

### Required models

**AC / HVAC**
- A compact outdoor HVAC unit with a recognizable body, top fan grille or circular fan detail, and subtle vents.
- Keep the model low-poly and lightweight.

**Water Tank**
- A recognizable water tank, preferably cylindrical or a low-poly cylindrical tank.
- Include a simple top surface and subtle structural details if useful.

**Staircase Room**
- A small raised rooftop enclosure with walls and a distinguishable roof slab.
- Preserve the configured footprint and height behavior.

**Lift Room**
- A raised lift-machine-room enclosure with a recognizable rooftop structure and roof slab.
- Do not confuse it visually with the HVAC unit or water tank.

**Custom**
- Preserve the existing user-drawn polygon footprint and extrude that exact polygon.
- Do not replace custom geometry with a predefined model or rectangle.

### Geometry requirements
- Reuse the existing obstacle footprint, height, rotation, position and selection data.
- Keep predefined models inside their assigned footprints and within the requested heights.
- Build models from lightweight Three.js primitives and simple geometry; do not introduce external asset downloads or new dependencies.
- Preserve obstacle selection, editing, deletion and validation.
- Ensure the model geometry is disposed of correctly when replaced or deleted.
- Maintain compatibility with X-ray mode and the existing camera controls.

## 2. Fix the white gap between obstacles and their shadows

### Current problem
The screenshots show a small bright gap between an obstacle's base and its shadow. The shadow appears to float beside the object instead of connecting naturally to it.

Investigate the actual shadow-map setup before changing anything.

Requirements:
- Make shadows meet the obstacle base naturally when the sun angle and geometry imply contact.
- Correct relevant shadow-map bias, normal bias, shadow-camera settings or receiver geometry as appropriate.
- Ensure the rooftop receives obstacle shadows correctly.
- Keep shadow direction and length consistent with the actual sun azimuth and elevation.
- Avoid shadow acne, surface speckling, detached shadows and excessive dark patches.
- Apply the correction to the actual model geometry, not just the bounding box if the new models have different shapes.

Do not arbitrarily move shadow geometry toward the obstacle. Fix the underlying rendering issue with the smallest appropriate adjustment. Do not alter solar-position calculations or energy calculations.

## 3. Differentiate the usable rooftop surface and parapet

The rooftop is currently too visually uniform. I want clearer visual separation between the usable area, parapet walls and parapet top edges.

### Usable rooftop
- Give the usable roof area a slightly darker, neutral warm-grey shade than the current roof surface.
- Keep the color subtle and architectural, not dark enough to hide obstacle footprints or solar panels.
- Preserve the roof's existing geometry, texture/alignment behavior and coordinate system.
- Ensure the usable area remains clearly visible in both Solid and X-ray modes.

### Parapet walls
- Use a distinct but coordinated color for the parapet's vertical inner and outer wall surfaces.
- Keep them slightly darker than the roof surface so the roof boundary is easy to identify.

### Parapet top/cap
- Use a separate, lighter neutral shade for the parapet cap/edge.
- Make the cap visually distinct from the parapet wall and usable rooftop.

### Edge definition
- Keep the existing cyan selection/outline system where appropriate.
- Avoid making every edge bright or introducing excessive decorative outlines.
- Maintain readable boundaries at different camera angles and zoom levels.

Apply colors through the existing material and geometry architecture. Do not duplicate roof meshes merely to change colors unless required by the current implementation.

## 4. Solar-panel mounting-height default and updates

A panel mounting-height control already exists. Preserve it and make sure the default is **0.4 metres**.

Requirements:
- Default newly enabled solar-panel mounting height to `0.4 m`.
- Preserve user-selected height changes.
- Apply the height to the actual panel geometry and supporting structures, not just the form value.
- Update the panel layout/rendered meshes when the height changes.
- Keep panel spacing, edge setback, tilt, azimuth, mounting style and roof clearance behavior intact.
- Ensure panels remain positioned correctly above the usable roof and do not intersect the roof surface.
- Preserve the existing default that solar panels are opt-in.
- Do not introduce duplicate height state if the current configuration already contains a mounting-height property.
- Ensure the displayed value and actual rendered panel elevation remain consistent.

## 5. Preserve the existing custom drawing and editing workflow

Do not break:
- The custom polygon drawing tool and its visible markers/edges/live preview.
- Confirm and Cancel controls.
- Footprint validation, parapet inset and overlap checks.
- Height input and polygon extrusion.
- Obstacle selection, editing and deletion.
- Existing building/parapet geometry.
- Working X-ray/Solid transparency and material restoration.
- Camera collision restrictions and useful rooftop inspection.
- Satellite ground appearance, camera framing and sun/time controls.
- Solar calculations, shadow-analysis outputs, map provider and AWS wake behavior.

Do not change unrelated backend code or redesign the UI.

## 6. Implementation and verification restrictions

- Inspect the relevant existing source files first.
- Implement the actual changes directly; do not return only a plan.
- Keep changes focused and avoid unnecessary dependencies or large refactors.
- Do not create external asset downloads or spend time searching for 3D models.
- Do not enter a repeated analysis/self-correction loop.
- Do not launch a browser, Chrome, Playwright, screenshots or browser automation.
- Do not create temporary browser-probe scripts.
- Run at most one focused test command and one TypeScript/build check if time permits.
- Do not claim visual verification.
- Stop within 15 minutes.
- Do not commit or push.

At the end, ensure Vite on port `5173` serves the latest changes, restarting it only if needed. Do not restart a healthy backend unnecessarily.

## 7. Required final report

Report:
1. Which predefined obstacle models were implemented and how they differ.
2. What caused the shadow gap, if established, and the fix applied.
3. The usable-roof, parapet-wall and parapet-cap color changes.
4. How the 0.4 m panel-height default and later adjustments affect rendered geometry.
5. Exact files changed.
6. Exact test/build results.
7. Any incomplete or unverified behavior.

Distinguish implemented code from visually verified results. Do not claim that shadows or model appearance are visually correct without visual verification.

Start implementing now and stop within the time limit. also make the shadow a little bette wuality relaastic and improve clarity ..are all the things mentioned in this prompt already done/if so ignore if not any  skipped do..
# SuryaGhar M3 — Complete Solar Panel Planning, Manual Editing, Automatic Placement and Realistic Hourly Power Simulation

You are working in the existing SuryaGhar rooftop solar-planning application. Implement M3 directly in the current repository. Use the two supplied reference images as functional and UI guidance.

This is a substantial feature milestone. Build on the existing 3D workspace, roof geometry, obstacle system, solar configuration and `pvlib`/PVGIS integration. Do not replace working systems with a new implementation.

**Primary objective:** A user must be able to configure solar panels, automatically arrange them, manually place and edit individual panels or groups, prevent physically invalid placements, and estimate real-world energy generation throughout the day while accounting for changing shadows.

## 1. Start by inspecting the existing project

Inspect only the relevant source files and current implementation:
- Solar-panel configuration and panel mesh generation.
- Panel layout/packing engine.
- 3D viewer, camera, roof coordinates and pointer interaction.
- Usable roof polygon, parapet and obstacle validation.
- Existing panel mounting-height configuration.
- Solar-analysis API and current `pvlib`/PVGIS integration.
- Existing energy charts, results panels and application state management.

Identify what already works and reuse it. Do not rewrite the solar calculation pipeline or create duplicate state/configuration systems.

Check the current working tree and preserve unrelated changes. Do not reset, clean or revert user work.

# 2. Implement a configurable solar-panel catalog

Users must be able to select the actual panel configuration before placement.

Each panel model should support:
- Manufacturer and model name, when known.
- Rated peak power in watts (Wp).
- Panel length and width in metres.
- Efficiency, when available from reliable product specifications.
- Optional temperature coefficient and other electrical parameters required by the existing simulation.
- Portrait or landscape mounting orientation.
- Tilt and azimuth.
- Panel mounting height, defaulting to the existing **0.4 m** setting.
- Mounting structure and support configuration where supported by the existing system.

### Data requirements
- Reuse an existing panel catalog if present.
- If the catalog is incomplete, create a maintainable configuration structure with source attribution for actual product specifications.
- Never invent manufacturer specifications or silently treat placeholder values as verified data.
- Clearly distinguish manufacturer-specified values, user-configured values and engineering defaults.
- Allow the user to enter custom panel dimensions and rated power when a model is unavailable.

Do not spend the implementation time building an unnecessarily large product database. A small, reliable catalog with custom-panel support is sufficient for M3.

# 3. Create a proper panel-set workflow

Use the reference image's concept of configurable panel sets and an editable frame/array.

A **panel set** is a group of panels that shares common configuration. The user should be able to create multiple sets with different configurations on the same roof.

Each set must support:
- Panel model.
- Number of rows and columns.
- Panel orientation: portrait or landscape.
- Tilt in degrees.
- Azimuth in degrees, with a clearly documented convention.
- Panel spacing.
- Edge setback.
- Mounting height.
- Mounting structure and support parameters, where available.
- Automatic or manual placement mode.

Show the set's panel count, rated capacity and configuration clearly.

For example, a set configured as 2 rows × 5 columns should create ten individual panel meshes. Changing the row/column configuration must update the set's geometry and capacity correctly.

Allow users to create, rename, configure, duplicate and delete sets. If a set is duplicated, create a separate editable set with a new identity.

Do not assume every set shares the same tilt, orientation, dimensions or height.

# 4. Automatic panel placement

Provide an explicit **Auto-place panels** action for each set, with a separate option to auto-place all eligible sets if practical.

The algorithm must fit the actual configured panels within the usable roof area.

### Geometric constraints

- Use the actual roof polygon, including non-rectangular and concave footprints.
- Respect parapet setbacks and usable-roof boundaries.
- Avoid collisions with HVAC units, water tanks, staircase rooms, lift rooms, custom obstacles and other prohibited regions.
- Account for panel dimensions, portrait/landscape orientation, tilt, spacing and mounting structure.
- Ensure panels do not extend beyond the usable roof.
- Prevent panel-panel overlap and collisions with obstacle geometry.
- Preserve safe distances required by the existing configuration; do not invent regulatory clearances and label them as official requirements.
- Support irregular roof shapes without assuming that every roof is rectangular.

Optimize for the number of feasible panels and installed capacity while maintaining all geometric constraints. Where practical, compare alternative orientations and row arrangements.

### Placement results

After auto-placement, show:
- Number of panels successfully placed.
- Total installed capacity in kWp.
- Panels omitted and the reason, if any.
- Remaining usable roof area or a suitable roof-coverage estimate.
- Any placement warnings.

If the full requested arrangement does not fit, place the feasible subset and explain the limitation. Do not silently create overlapping panels or place panels outside the roof.

Automatic placement must be deterministic for the same inputs.

# 5. Manual panel placement and full editing

Manual placement is a core feature, not an optional future enhancement.

Implement an explicit **Manual placement** mode.

### Placement interaction

- Allow the user to select a panel set and place panels individually on the rooftop.
- Show a visible panel preview following the pointer.
- Display whether the proposed position is valid before the panel is committed.
- Clearly distinguish valid and invalid placement previews.
- Allow placement by clicking the roof.
- Where practical, support dragging existing panels to new positions.
- Provide rotation/orientation controls for portrait and landscape placement.
- Keep placement coordinates in the existing roof-local metre coordinate system.
- Make interaction work with the current Z-up scene and camera architecture.

### Editing after placement

Every placed panel must remain editable. Users must be able to:
- Select a panel individually.
- Select a complete panel set.
- Move a panel or set.
- Rotate panels or a set.
- Change panel orientation.
- Adjust tilt, azimuth, spacing and mounting height.
- Change panel model or electrical rating.
- Delete individual panels or an entire set.
- Return to automatic placement after manual adjustments, with a clear warning before overwriting custom arrangements.

When changing a shared set configuration, update its members consistently. Preserve individual overrides only if the existing data model explicitly supports them; otherwise, explain that the set change applies to all its panels.

Support undo for accidental placement, movement and deletion if it can be added without destabilizing the existing interaction architecture.

Do not allow accidental camera rotation when the user is trying to select or drag a panel. Preserve the existing camera controls outside placement interactions.

# 6. Prevent physically impossible panel placement

Create or reuse a centralized placement validator. Both automatic and manual placement must use the same core geometric rules.

Validate:
- Roof containment.
- Parapet and edge setbacks.
- Obstacle clearance.
- Panel-panel collisions.
- Panel-set collisions.
- Valid panel dimensions and height.
- Mounting structure clearance.
- Invalid or degenerate geometry.

For tilted panels, validate their actual projected footprint and 3D bounds as appropriate. Do not validate only the panel's center point.

A panel that visually fits at roof level but collides with an elevated obstacle must be rejected or flagged according to the existing clearance rules.

If the roof geometry or obstacle positions change, revalidate existing panels and clearly identify newly invalid placements. Do not silently delete or relocate user panels.

Use accurate geometry and spatial indexing where necessary, but avoid adding heavy dependencies without a clear need.

# 7. Real-world hourly solar-energy estimation

This is one of the most important parts of M3.

Use the existing solar-analysis pipeline. Reuse `pvlib` and the existing PVGIS integration wherever available.

Do not replace real solar/weather inputs with arbitrary irradiance values, fixed daily multipliers or hardcoded sunny-day assumptions.

## A. Location and weather inputs

Use:
- The selected site's latitude, longitude and timezone.
- Correct solar position for the selected date and local time.
- Real irradiance and meteorological data where available.
- PVGIS typical meteorological year (TMY) data for representative annual estimates, if already supported.
- Actual date-specific weather/irradiance data when a supported source provides it.

Clearly distinguish:
1. A representative typical-weather estimate.
2. A date-specific estimate based on available weather data.
3. A fallback simulation when external data cannot be retrieved.

Cache external data where appropriate. Handle rate limits, unavailable services, timeouts and offline operation gracefully.

Do not fabricate real-time weather data when a service is unavailable.

## B. Solar irradiance on each panel

For each panel or panel group, calculate plane-of-array irradiance using the existing validated solar model and the panel's tilt and azimuth.

Use appropriate components of:
- Direct beam irradiance.
- Diffuse sky irradiance.
- Ground-reflected irradiance, where supported by the model.

Use actual panel orientation and the selected location's solar position. Do not assume every panel is horizontal or south-facing.

## C. Dynamic obstacle and parapet shading

Calculate how shadows from the following affect individual panels throughout the day:
- Parapet walls and caps.
- Water tanks.
- HVAC units.
- Staircase rooms.
- Lift rooms.
- Custom obstacles.
- Other modeled obstructions for which usable geometry or height data exists.

Use the actual 3D obstacle geometry and heights. Reuse the existing shadow-projection logic or introduce a suitable geometry-based shading calculation that respects the current Z-up coordinate system.

For each simulated time step:
1. Calculate the sun direction.
2. Project obstacle geometry along the correct sun-ray direction.
3. Determine which parts of each panel are shaded.
4. Estimate direct-beam shading loss.
5. Account for diffuse irradiance and partial shading using a documented, appropriate approximation.
6. Calculate the resulting panel energy output.

Do not equate the visible darkness of a rendered shadow with the exact percentage of electrical power lost. Rendering and energy calculations serve different purposes.

### Electrical shading limitations

A single shaded cell can have different electrical effects depending on module wiring, bypass diodes, string layout and inverter/MPPT behavior.

Do not claim a physically exact electrical shading simulation unless the necessary module and system parameters are available.

Implement a defensible, documented approximation that estimates partial-shading losses from shaded panel area and available electrical parameters. Clearly state the model's limitations.

If string-level electrical simulation is supported by the existing system, reuse it. Otherwise, keep the shading model modular so string-level behavior can be added later.

## D. Hourly production and charts

Calculate output at an appropriate time resolution throughout the selected day. Prefer hourly output with finer internal sampling where needed to capture changing shadows.

Display:
- Time of day in the site's local timezone.
- Solar elevation and azimuth where useful.
- Available irradiance.
- Estimated unshaded output.
- Estimated output after shading.
- Shading loss in watts or percentage.
- Total daily energy in kWh.

Provide a chart comparing shaded and unshaded output over time.

The user should be able to change the date and see the simulation update. Where the existing sun/time controls allow it, selecting a time should also update the 3D sun direction and visible shadows.

## E. Annual and financial estimates

If the existing PVGIS/TMY integration supports it, calculate:
- Estimated annual energy in kWh.
- Monthly energy totals.
- Installed DC capacity in kWp.
- Capacity factor or equivalent performance metric, where justified.
- Estimated shading losses over the modeled period.

Keep financial estimates separate unless reliable tariff and system-cost inputs already exist. Do not invent electricity tariffs, installation costs or financial savings.

# 8. Data model and performance

Persist the minimum configuration necessary to reproduce the user's layout:
- Panel model/configuration.
- Panel-set identity.
- Panel positions and rotations.
- Tilt and azimuth.
- Spacing and setbacks.
- Mounting height.
- Manual versus automatic arrangement.
- Relevant user overrides.

Use the application's existing state and persistence architecture. Do not introduce a new database or duplicate persistence system unless essential.

For performance:
- Avoid expensive geometry rebuilding on every mouse movement.
- Use lightweight previews during placement.
- Debounce or batch expensive calculations.
- Recalculate only affected panels where practical.
- Cache solar/weather inputs.
- Dispose of obsolete Three.js geometries and materials.
- Keep manual editing responsive for realistic rooftop panel counts.

# 9. UI expectations

Build on the existing dark SuryaGhar design system.

Provide a clear workflow:
1. Select panel model.
2. Configure panel set.
3. Choose Auto-place or Manual placement.
4. Review placement results.
5. Edit individual panels or sets.
6. Run or refresh the energy simulation.
7. Inspect hourly output and shading losses.

Keep the 3D workspace usable. Do not crowd the viewport with excessive controls. Use the existing inspector and panel-setting patterns.

Provide clear feedback for:
- Invalid placements.
- Insufficient roof space.
- Overlapping obstacles.
- Missing weather data.
- Estimated versus measured/model-derived values.
- Failed external data requests.

# 10. Preserve all existing functionality

Do not regress:
- Building and parapet geometry.
- Working X-ray/Solid mode.
- Satellite-ground texture and coordinate alignment.
- Custom obstacle drawing, editing and deletion.
- Obstacle models and shadow rendering.
- Existing camera collision restrictions.
- Solar-panel mounting-height default of 0.4 m.
- Existing panel layout and configuration where it already works.
- Sun/time controls.
- Current `pvlib`/PVGIS integration.
- Map-provider selection, local development and AWS wake behavior.

Do not rewrite the backend or solar calculations wholesale. Extend the existing architecture and keep backward compatibility with existing saved state where applicable.

# 11. Execution plan and anti-loop rules

Work in this order:

**Phase 1 — Panel configuration and geometry**
- Panel catalog/configuration.
- Panel-set data model.
- Shared placement validator.
- Automatic placement and result summary.

**Phase 2 — Manual editing**
- Manual placement preview.
- Selection, move, rotate and edit operations.
- Validation feedback.
- Reliable state updates and cleanup.

**Phase 3 — Real-data energy simulation**
- Reuse existing PVGIS/weather and `pvlib` services.
- Calculate orientation-aware hourly output.
- Add obstacle-aware shading losses.
- Display daily production and shaded/unshaded comparison.

**Phase 4 — Integration**
- Connect UI, panel meshes, placement state and analysis.
- Verify existing features remain intact.

Complete a useful, integrated implementation rather than scattering incomplete scaffolding across every phase. If time runs short, prioritize working panel configuration, valid auto/manual placement and a defensible hourly simulation over cosmetic polish.

### Strict rules
- Maximum execution time: **30 minutes**.
- Inspect the current repository and implement changes directly.
- Do not spend the majority of the time writing plans or repeatedly exploring the same files.
- Do not enter an endless analysis, test-fix-test or self-correction loop.
- Do not add tests that merely restate implementation assumptions or weaken validation to make tests pass.
- Do not invent real-world data or claim unavailable precision.
- Do not commit or push.

### Browser-testing restriction
Do not launch Chrome or another browser. Do not use Playwright, screenshots, browser automation or temporary browser-probe scripts. Use focused unit tests, existing backend tests, TypeScript checks and production builds only. Do not claim visual or end-to-end verification.

Run a limited, relevant set of checks and report any failure honestly. Do not repeatedly run the same failed command without a specific reason.

At the end, ensure Vite on port `5173` serves the latest changes, restarting it only if necessary. Do not restart a healthy backend unnecessarily.

# 12. Required final report

Report:
1. **Panel configuration:** Catalog, custom-panel support and panel-set controls implemented.
2. **Automatic placement:** Constraints, optimization behavior and placement results.
3. **Manual editing:** Individual/set placement, editing, rotation and validation.
4. **Energy simulation:** Real data sources used, time resolution, weather fallback and output metrics.
5. **Shading model:** Geometry included, method used, electrical assumptions and limitations.
6. **Persistence and performance:** State/persistence changes and cleanup behavior.
7. **Files changed:** Exact relevant files.
8. **Verification:** Exact commands and results.
9. **Outstanding work:** Anything incomplete, approximated or unverified.

Clearly separate actual weather/product data from defaults and approximations. Distinguish unit-test success from verified UI behavior.

**Start by inspecting the existing code and implement M3 in the current architecture. Do not stop after producing a plan.**

at last creat the detailed report on what all u have done