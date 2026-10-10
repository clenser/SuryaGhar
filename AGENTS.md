# AGENTS.md — Surya-Ghar

## 1. Project Overview

Surya-Ghar is a professional solar rooftop and open-ground planning application for India.

The application allows a user to:

1. Search for a location.
2. Select a building/rooftop or open-ground area.
3. Validate that the selected area is suitable.
4. Measure the selected area using real geographic coordinates.
5. Design the selected building/terrace as a 3D structure.
6. Enter building height and generate a 3D building model.
7. Add rooftop obstacles with real dimensions and heights.
8. Simulate the sun throughout the day.
9. Visualize realistic shadows from buildings and rooftop obstacles.
10. Select different solar-panel types.
11. Place solar panels on the rooftop in 3D.
12. Visualize panel and obstacle shadows.
13. Analyze panel orientation, tilt, shading, and solar production.
14. Produce a final solar-layout recommendation.

The application should remain technically grounded in real geographic coordinates, real dimensions, deterministic geometry, and established solar-physics calculations.

AI/ML may assist with validation, recognition, ranking, or optimization, but AI must not replace deterministic geometric or solar calculations.

---

# 2. Core Product Principle

Surya-Ghar is a combination of:

- Geographic mapping
- Rooftop geometry
- 3D architectural visualization
- Solar-position calculation
- Shadow simulation
- Solar-panel layout
- Solar-energy analysis

The architecture should therefore separate:

```text
MAP / GEOGRAPHY
        ↓
2D GEOMETRY
        ↓
3D MODEL
        ↓
SUN / SHADOW SIMULATION
        ↓
SOLAR PANEL PLACEMENT
        ↓
SOLAR ENERGY ANALYSIS

3. Existing Technology Stack
Frontend
- React
- TypeScript
- Vite
- MapLibre GL JS / existing map implementation
- Google Maps APIs where already integrated
- Turf.js where appropriate
- Three.js for the new 3D design environment
- Three.js GLTFLoader for 3D assets
- Three.js OrbitControls for controlled 3D navigation
Backend
- Python
- FastAPI
- Shapely
- GeoPandas where required
- pyproj / PROJ
- Rasterio where required
- NumPy
- OpenCV
- pvlib
- PVGIS
- existing segmentation/vision providers
Mapping / Google Services
The application currently has access to:
- Google Maps
- Google Geocoding API
- Google Static Maps API
Use existing Google services where already integrated.
Do not introduce additional Google APIs merely because they appear convenient.
Do not replace existing map functionality unnecessarily.
4. Important Architecture Rule
The current 2D mapping and geometry system remains the foundation.
The new 3D system is an additional design layer.
Do NOT rewrite the existing geographic measurement system just to introduce 3D.
The relationship should be:
Existing 2D geographic system
            ↓
     Real-world geometry
            ↓
       3D conversion
            ↓
      Three.js renderer

The 3D renderer should consume real-world dimensions from the existing geometry system.
5. Location Workflow
The first stage remains location selection.
User flow:
Search location
      ↓
Autocomplete suggestions
      ↓
Select location
      ↓
Map flies to location
      ↓
Building/site becomes working area
      ↓
Map is effectively fixed on selected site
      ↓
3D design workflow begins

The existing frontend autocomplete architecture should remain fast and independent from backend wake requests.
Location search must NOT:
- call /api/health
- call ensureBackendAwake()
- unnecessarily wake EC2
- update backend inactivity tracking
- send every keystroke through the backend
The existing application wake mechanism should continue to happen on application mount.
6. Site / Building Selection
After selecting a location, the user selects the specific building or site.
The selected building becomes the active design site.
The application should retain:
- latitude
- longitude
- selected polygon
- coordinate reference system
- UTM zone
- real-world dimensions
- area
- perimeter
- centroid
The map should zoom appropriately to the selected building.
Once the user enters the 3D design workflow, the selected site should remain the primary working context.
7. Terrace Outline Workflow
The user should first define the terrace/building outline.
Example:
Define Terrace
      ↓
Draw polygon around rooftop
      ↓
Display real-world measurements
      ↓
Confirm terrace

The existing measurement system should be reused.
Do not estimate dimensions from screen pixels.
Do not calculate area directly from raw latitude/longitude degrees.
8. Geographic Geometry
User-drawn coordinates normally originate as:
Latitude / Longitude
WGS84 / EPSG:4326

Convert them to an appropriate projected CRS for metric calculations.
For example, areas around Kolkata/West Bengal commonly fall within UTM Zone 45N:
EPSG:32645

However, the implementation must determine the appropriate UTM zone from the actual site location rather than blindly assuming one EPSG code globally.
Use:
pyproj / PROJ

for coordinate transformation.
Then use:
Shapely

for geometric calculations.
Because projected coordinates are in metres:
area = polygon.area

produces:
square metres (m²)

Similarly:
polygon.length

produces the perimeter in metres.
Individual edge lengths should be calculated from the projected geometry.
9. Existing Measurement UI
The existing CAD-like measurement UI should remain.
It should support:
- Edge length labels
- Area label
- Perpendicular measurement indicators
- Polygon editing
- Real-time measurement updates
- Centroid information
- Clear visual distinction between geometry and satellite imagery
Example:
26.6 m
34.1 m
18.3 m
3.4 m
3.5 m

These values must come from actual projected geometry.
Never fabricate or visually estimate measurements.
10. New 3D Design Environment
After the terrace outline is confirmed, transition to the 3D design environment.
Recommended renderer:
Three.js

The 3D environment should use the real-world dimensions obtained from the geographic geometry.
The basic transformation is:
2D UTM polygon
       ↓
X/Y coordinates in metres
       ↓
User enters building height
       ↓
Extrude polygon along Z axis
       ↓
3D building

Three.js should visualize the model.
Shapely/pyproj remain responsible for authoritative geometry.
11. Building Height
After defining the terrace, prompt the user:
Enter building height

Example:
Building height: 17.2 m

The entered height becomes the Z dimension of the building.
Example:
Terrace polygon
      +
17.2 m height
      ↓
3D building

The system should not pretend that height is known if the user has not provided reliable height data.
If external elevation/height data is introduced later, it must be clearly identified as an estimate unless authoritative data exists.
12. 3D Building Generation
The terrace polygon becomes the top face of the building.
The building should be generated by extruding the polygon vertically.
Conceptually:
        Terrace
     ┌───────────┐
    /           /|
   /___________/ |
   |           | |
   |           | |  Height
   |           | |
   |           |/
   └───────────┘

The 3D building is primarily a visualization and simulation model.
The original geographic polygon remains authoritative.
Do not permanently modify the original geographic coordinates just because the 3D model changes.
13. Three.js Coordinate System
The 3D scene should use a local engineering coordinate system.
Recommended concept:
UTM metres
     ↓
local origin near selected building
     ↓
Three.js coordinates

Do not render large global UTM coordinates directly into Three.js if unnecessary.
Use a local origin near the selected site to maintain numerical stability.
Example:
UTM:
X = 326500.23
Y = 2512345.42

Local:
X = 0
Y = 0

Relative local coordinates should be used for the 3D scene.
14. 3D Camera
The user specifically wants controlled viewing.
The initial camera system should use:
Three.js OrbitControls

The camera should support:
- Horizontal rotation
- Vertical/elevation rotation
- Zoom
The application should NOT behave like an unrestricted first-person game.
The camera should remain focused around the selected building.
The building should remain the primary target.
Avoid unnecessary:
- Free flying
- Roll rotation
- First-person movement
- Arbitrary camera teleportation
The intended interaction is an architectural/site-design viewer.
15. Rooftop Obstacles
The user must be able to add obstacles to the rooftop.
Examples:
- Water tanks
- Staircase rooms
- Lift rooms
- HVAC units
- AC units
- Parapet structures
- Utility rooms
- Other rooftop equipment
Workflow:
Add obstacle
      ↓
Draw/select footprint
      ↓
Enter dimensions or use measured footprint
      ↓
Enter obstacle height
      ↓
Create 3D obstacle
      ↓
Place on rooftop

Each obstacle should have:
ID
type
footprint
position
width
length
height
rotation

The footprint should ideally be represented using the same local/metric coordinate system as the terrace.
16. Obstacle Geometry
Obstacles are not just visual decorations.
Their actual geometry must participate in:
- Panel placement
- Clearance calculations
- Shadow calculation
- Shading analysis
- 3D visualization
Example:
Obstacle:
2.5 m × 1.8 m
Height:
1.2 m

This should create a corresponding 3D mesh.
17. Obstacle Placement
An obstacle should be constrained to the terrace where appropriate.
The system should validate:
obstacle footprint ⊂ terrace usable geometry

or clearly indicate if the obstacle extends outside the terrace.
Obstacle overlap should be detected.
Obstacles should not silently overlap each other.
18. Parapet / Roof Edge
The design should eventually support roof-edge/parapet representation.
Parapet height can be entered by the user.
Example:
Parapet height: 1.0 m

The parapet can then participate in:
- 3D visualization
- shadow simulation
- panel clearance
- shading analysis
This should be implemented as a separate geometry layer rather than altering the base terrace polygon.
19. Sun Position
Solar position must be calculated scientifically.
Use:
pvlib

The primary inputs are:
Latitude
Longitude
Date
Time
Timezone

pvlib can provide:
solar azimuth
solar elevation

These values define the direction of sunlight.
Do not use arbitrary animation angles for solar analysis.
20. Three.js Sun Simulation
Three.js should visualize the calculated sun.
Recommended approach:
pvlib
  ↓
Sun azimuth/elevation
  ↓
Convert to local 3D direction
  ↓
Three.js DirectionalLight
  ↓
Shadow camera
  ↓
Real-time shadows

The Three.js light is the visualization layer.
pvlib remains the authoritative source for solar position.
21. Time-of-Day Control
The user must be able to change the time.
Example:
08:00
09:00
10:00
11:00
12:00
13:00
14:00
15:00
16:00
17:00

Changing the time should update:
- Sun position
- Light direction
- Shadow direction
- Shadow length
- Panel shading
The UI should support both:
Manual time selection

and:
Play / simulate full day

22. Full-Day Sun Simulation
The application should eventually support:
▶ Simulate Day

The simulation should move the sun continuously according to calculated solar positions.
It should not simply rotate a light at a constant arbitrary speed.
The animation should be driven by actual time progression.
Example:
06:00 → sunrise
08:00
10:00
12:00 → solar noon
14:00
16:00
18:00 → sunset

The exact available period depends on the selected date and geographic location.
23. Shadow Rendering
Use Three.js shadow maps for interactive visualization.
The scene should support:
Building
+
Rooftop obstacles
+
Solar panels
+
DirectionalLight
=
Visible shadows

The shadows should update whenever:
- Time changes
- Date changes
- Object moves
- Object height changes
- Panel tilt changes
- Panel position changes
Optimize shadow-map resolution carefully.
Do not use unnecessarily high shadow resolution because the application must remain responsive in a browser.
24. Visualization vs Scientific Shading Analysis
Separate these two concepts.
Visual shadow
Use:
Three.js shadow maps

for immediate interactive visualization.
Quantitative solar shading
Use deterministic solar/geometric calculations for final analysis.
The final solar analysis should not depend on the visual renderer's shadow-map pixels.
Three.js is for:
"What does the shadow look like?"

The analytical engine is for:
"How much solar energy is actually lost?"

25. Solar Panel Model Library
The application should use lightweight 3D solar-panel models.
Do NOT use a large, highly detailed model for every individual panel.
Use a small collection of reusable low-poly GLB/glTF assets.
Recommended formats:
GLB
glTF

Recommended frontend loader:
Three.js GLTFLoader

26. Solar Panel Types
The application should support several panel types.
Example categories:
Panel A
450 W

Panel B
550 W

Panel C
600 W

The exact models/specifications should be configurable.
Each panel type should have metadata such as:
{
  "id": "panel-550w",
  "name": "550 W Solar Panel",
  "wattage": 550,
  "width_m": 1.13,
  "length_m": 2.28,
  "thickness_m": 0.035,
  "weight_kg": 28
}

Do not hard-code these values into rendering components.
27. Panel 3D Assets
Each panel asset should contain only the geometry necessary for useful visualization.
Prefer:
- Low polygon count
- Realistic proportions
- Aluminium frame
- Dark photovoltaic surface
- Basic cell grid
- Basic mounting/support geometry where useful
Avoid:
- Excessively detailed bolts
- Tiny wires
- High-resolution textures
- Extremely dense meshes
- Heavy animations
The application may display hundreds of panels.
Performance is more important than microscopic visual detail.
28. Instanced Rendering
When many identical panels are displayed, prefer:
THREE.InstancedMesh

where appropriate.
For example:
One 550 W panel model
       ↓
Instance × 100
       ↓
100 panels

This is substantially preferable to loading 100 independent copies of the same detailed mesh.
29. Panel Placement
Panel placement must be based on physical dimensions.
The 3D model is only the visual representation.
The authoritative panel footprint is:
panel width
panel length
panel orientation
panel tilt
panel position

The placement engine should determine whether a panel physically fits.
Do not determine placement based on rendered pixels.
30. Panel Layout Pipeline
Use:
Terrace polygon
      ↓
Setbacks
      ↓
Obstacle exclusion
      ↓
Panel dimensions
      ↓
Candidate orientation
      ↓
Geometric packing
      ↓
Valid panel positions
      ↓
3D visualization

Shapely should remain authoritative for geometric feasibility.
Three.js should visualize the result.
31. Panel Setbacks
Panel placement must respect required setbacks.
Conceptually:
Terrace polygon
      ↓
Negative buffer
      ↓
Usable roof polygon

Use Shapely's metric buffering for the authoritative calculation.
Do not fake setbacks visually in Three.js.
32. Obstacle Clearance
Panels should maintain configurable clearance from obstacles.
Conceptually:
Obstacle footprint
      ↓
buffer by required clearance
      ↓
exclusion zone
      ↓
remove overlapping panel positions

This allows obstacles to affect both:
- Panel placement
- Shading
33. Panel Orientation
Panel orientation must distinguish between:
Geographic azimuth
The direction the panel faces.
Tilt
The angle of the panel relative to horizontal.
These values must remain separate.
The system should allow:
Azimuth
Tilt

to be modified independently.
34. Solar Optimization
The existing deterministic solar analysis remains authoritative.
Recommended pipeline:
PVGIS weather/resource data
        ↓
pvlib
        ↓
Tilt × Azimuth sweep
        ↓
Energy estimate
        ↓
Best configuration

Do not replace this with an LLM.
AI may later rank or optimize valid configurations, but it must not replace pvlib/PVGIS or geometric validation.
35. Future AI Optimization Layer
AI/ML may eventually be added above the deterministic engine.
Recommended architecture:
Generate valid configurations
            ↓
Deterministic solar calculations
            ↓
Candidate dataset
            ↓
AI/ML optimizer/ranker
            ↓
Top configurations
            ↓
Final deterministic verification
            ↓
Recommendation

Possible objectives:
- Annual energy
- Panel count
- Roof utilization
- Shading loss
- Installation complexity
- Self-consumption
- Estimated cost
The AI layer must never output an invalid geometric layout.
36. 3D Panel Shadows
Solar panels themselves must participate in the 3D shadow system.
Therefore:
Panel mesh
+
DirectionalLight
=
Panel shadow

Panel shadows should update when:
- Sun moves
- Panel moves
- Panel rotates
- Panel tilt changes
This allows users to visually understand:
Building shadow
Obstacle shadow
Panel shadow
Panel-to-panel shadow

37. Panel Placement Interaction
The 3D editor should eventually support:
Select panel
Move panel
Rotate panel
Change tilt
Duplicate panel
Delete panel

However, free placement must still be validated.
Invalid placement should be visually indicated.
Examples:
Valid:
Panel fully inside usable roof
No obstacle collision
Required clearance satisfied

Invalid:
Panel crosses roof edge
Panel intersects obstacle
Panel violates required clearance

38. Panel Types UI
The UI should provide a panel-type selector.
Example:
Solar Panels

┌──────────────────────┐
│ 450 W                │
│ 1.72 × 1.13 m        │
└──────────────────────┘

┌──────────────────────┐
│ 550 W                │
│ 2.28 × 1.13 m        │
└──────────────────────┘

┌──────────────────────┐
│ 600 W                │
│ 2.38 × 1.13 m        │
└──────────────────────┘

The actual available panel library should be configurable.
39. 3D Scene Layers
Keep the 3D scene logically separated.
Recommended structure:
Scene
├── Terrain / map reference
├── Building
├── Roof
├── Parapets
├── Obstacles
├── Solar panels
├── Solar shadows
├── Measurement helpers
├── Selection helpers
└── Lighting

Do not put all geometry into one giant mesh.
40. 3D Object Metadata
Every editable 3D object should have application-level metadata.
Example:
interface SiteObject {
  id: string;
  type: "building" | "obstacle" | "panel";
  position: Vector3;
  rotation: Vector3;
  dimensions: {
    width: number;
    length: number;
    height: number;
  };
}

For solar panels, additionally store:
interface SolarPanelObject extends SiteObject {
  panelTypeId: string;
  wattage: number;
  tilt: number;
  azimuth: number;
}

The exact implementation may differ, but object state must be separable from Three.js mesh instances.
41. Persistence
The application should be able to serialize a 3D design.
A saved project should contain enough information to reconstruct the scene without saving raw Three.js objects.
Store:
Location
Terrace polygon
CRS / projection information
Building height
Parapet information
Obstacles
Obstacle dimensions
Obstacle heights
Panel type
Panel positions
Panel rotations
Panel tilt
Panel azimuth
Design settings
Simulation date/time

Do not serialize the Three.js renderer itself.
42. Satellite Imagery
Satellite imagery remains the geographic reference.
It should not be treated as a 3D model.
The workflow is:
Satellite map
     ↓
Geographic reference
     ↓
User geometry
     ↓
3D reconstruction

The 3D building model is based on measured/user-provided geometry and height.
Do not claim that satellite imagery alone provides exact building height.
43. Google Maps / Geocoding / Static Maps
Existing Google services may continue to provide:
- Location search
- Geocoding
- Map context
- Static map imagery where already used
Do not introduce unnecessary duplicate providers.
Keep API keys/secrets out of the frontend where the relevant Google API architecture requires server-side protection.
Never expose sensitive backend keys such as:
GROQ_API_KEY

to the frontend.
44. 3D Terrain / External 3D Data
If external 3D terrain/building datasets are introduced later, they must be treated as separate data providers.
Possible future providers can include:
- Google 3D Tiles / Photorealistic 3D Tiles where licensing/API access permits
- Cesium ecosystem
- OpenStreetMap building footprints
- DEM/DSM providers
- LiDAR/photogrammetry datasets where available
Do not make the application's core rooftop model dependent on availability of these datasets.
The user-created terrace model must work independently.
45. Rendering Performance
The 3D editor must remain usable on normal laptops and mobile devices.
Priorities:
1. Low-poly assets
2. Reusable models
3. InstancedMesh for repeated panels
4. Controlled shadow-map resolution
5. Frustum culling
6. Avoid unnecessary post-processing
7. Dispose unused geometries/materials/textures
8. Avoid rendering invisible objects
9. Avoid loading all panel models at startup
10. Lazy-load 3D assets when entering the design workflow
Do not sacrifice the entire application performance for visual realism.
46. Mobile 3D Experience
The existing mobile redesign must remain functional.
On mobile:
- Use touch-friendly controls
- Maintain minimum ~44px touch targets
- Avoid excessive UI overlays
- Keep the 3D scene usable
- Provide simplified controls
- Avoid loading unnecessary high-detail assets
- Use lower rendering quality when necessary
The 3D editor should not force the desktop layout onto a mobile screen.
47. Dark Theme
The existing light/dark theme architecture must apply to the 3D design UI.
The 3D scene itself should remain physically readable.
Do not simply invert satellite imagery.
The UI around the scene should use the application's dark theme tokens.
48. UI Design Principles
Maintain the existing Surya-Ghar design system.
Important principles:
- Professional
- Minimal
- Engineering-oriented
- Clear hierarchy
- No unnecessary decorative UI
- Strong spatial feedback
- Clear measurements
- Clear object selection
- Clear simulation state
The 3D workspace should feel like a lightweight architectural/solar-design tool rather than a video game.
49. Recommended 3D UI Structure
A possible structure:
┌──────────────────────────────────────────────────────────┐
│ Surya-Ghar   Site Name             Sun: 12:30   Controls │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│                    3D BUILDING                           │
│                                                          │
│              panels / obstacles / shadows               │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Select   Measure   Obstacle   Panel   Sun Simulation    │
└──────────────────────────────────────────────────────────┘

The exact UI may evolve.
Do not copy this literally if it conflicts with the existing design system.
50. Design Workflow / Stages
The application should conceptually progress through:
1. Location
      ↓
2. Site Selection
      ↓
3. Terrace Outline
      ↓
4. Building Height
      ↓
5. 3D Model
      ↓
6. Obstacles
      ↓
7. Sun Simulation
      ↓
8. Solar Panels
      ↓
9. Shading Analysis
      ↓
10. Solar Energy Analysis
      ↓
11. Final Recommendation

The existing StageProgress component should be extended carefully rather than replaced blindly.
51. Validation Rules
Every stage should validate the required inputs before allowing the next stage.
Examples:
Terrace
Must contain:
valid polygon
minimum area
non-self-intersecting geometry

Building
Must contain:
valid terrace
positive building height

Obstacle
Must contain:
valid footprint
positive height
valid position

Solar panel
Must contain:
valid panel type
valid dimensions
valid position
valid orientation

52. Measurement Accuracy
The following are authoritative:
pyproj / UTM
Shapely

Three.js measurement overlays are visualization only.
Never derive authoritative dimensions from:
- screen coordinates
- camera distance
- pixel measurements
- mesh bounding boxes after arbitrary scaling
All physical dimensions must originate from the geographic/engineering coordinate system.
53. Shadow Accuracy
There are two levels.
Level 1 — Interactive
Three.js:
DirectionalLight
shadowMap

provides real-time visual shadows.
Level 2 — Analytical
Use:
pvlib
+
3D geometry

for quantitative shading calculations.
The analytical result should not depend on the GPU's shadow-map resolution.
54. Solar Simulation Date
Solar position depends on both:
time
date

The application should eventually allow the user to select:
Date
Time

and optionally:
Entire day

For energy analysis, use representative meteorological data such as PVGIS TMY where appropriate.
55. Existing Solar Analysis
Do not remove the current solar-analysis system.
The existing pipeline remains useful:
PVGIS
  ↓
pvlib
  ↓
Tilt/Azimuth sweep
  ↓
PV output

The 3D system adds physical geometry and shading context.
It does not replace the existing solar engine.
56. 3D + Existing Solar Engine
The intended final architecture is:
                  LOCATION
                     │
                     ▼
              TERRACE POLYGON
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
   2D GEOMETRY             3D MODEL
   Shapely/pyproj          Three.js
          │                     │
          │             ┌───────┴────────┐
          │             │                │
          │             ▼                ▼
          │         OBSTACLES        PANELS
          │             │                │
          └─────────────┴────────────────┘
                        │
                        ▼
                 SUN POSITION
                     pvlib
                        │
                        ▼
                  SHADOW MODEL
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
        VISUAL SHADOW         ANALYTICAL
        Three.js              SHADING
                                   │
                                   ▼
                            SOLAR ANALYSIS
                            pvlib + PVGIS

57. AI/ML Usage
AI/ML is allowed for:
- Rooftop validation
- Building detection
- Object recognition
- Obstacle recognition
- Layout ranking
- Configuration optimization
- User assistance
AI/ML must not be the authoritative source for:
- Geographic distance
- Polygon area
- Panel collision
- Panel physical fit
- Solar position
- Solar azimuth
- Solar elevation
- Final geometric validity
Use deterministic mathematics for these.
58. Existing AI / Vision Architecture
The current validation architecture may continue using:
Satellite crop
      ↓
Building detection
      ↓
OSM evidence
      ↓
Semantic/segmentation evidence
      ↓
Vision model
      ↓
Combined validation

The new 3D workflow does not remove this.
59. Backend API Design
3D-specific APIs should be introduced only when server-side persistence or computation is required.
Do not create an API endpoint merely to perform a calculation that can safely be done locally in the browser.
Examples that can potentially remain frontend-only:
- Camera movement
- 3D mesh creation
- Visual shadow rendering
- Panel model rendering
- UI state
- Local object manipulation
Examples appropriate for backend:
- Persistent project storage
- Heavy solar analysis
- PVGIS processing
- Large-scale shading calculations
- AI/ML processing
- Server-side report generation
60. Frontend / Backend Boundary
The browser should own:
Interaction
Visualization
Camera
3D rendering
Immediate geometry feedback
Panel manipulation
Visual sun simulation

The backend should own:
Authoritative analysis
Heavy computation
External data providers
AI/ML
Persistent analysis
Reports

Do not send every mouse movement or camera movement to FastAPI.
61. Asset Management
3D assets should be stored in a dedicated frontend asset directory.
Example:
frontend/
  public/
    models/
      solar-panels/
        panel-450w.glb
        panel-550w.glb
        panel-600w.glb

The exact location can differ according to the existing project structure.
Each model must have associated metadata.
Do not duplicate the same model file under multiple names.
62. 3D Asset Licensing
Every externally sourced 3D model must have a clear license compatible with the application.
Before adding a model:
- Verify license
- Record source
- Record attribution requirements
- Record whether commercial use is permitted
- Record whether modification is permitted
Do not add random Sketchfab/CGTrader/Fab models without checking licensing.
63. Model Quality Requirement
Models should be:
Low-poly
Realistic proportions
Correct physical dimensions
GLB/glTF preferred
Fast to load
Suitable for repeated rendering

Visual realism is secondary to:
correct dimensions
performance
license

64. 3D Scene Units
All 3D engineering geometry should use:
1 Three.js unit = 1 metre

unless there is a strong technical reason otherwise.
For example:
Building:
30 m × 20 m × 17 m

Three.js:
30 × 20 × 17

This keeps calculations intuitive and reduces conversion mistakes.
65. Avoid Hidden Unit Conversions
Do not silently mix:
pixels
degrees
metres
centimetres
Three.js units

Every conversion must be explicit.
Preferred:
geographic coordinates
      ↓
UTM metres
      ↓
local metres
      ↓
Three.js units

66. Testing Requirements
Any significant 3D feature should include tests where practical.
Test:
- Polygon extrusion
- Height conversion
- Coordinate transformation
- Panel dimensions
- Panel placement
- Obstacle collision
- Setback calculation
- Shadow direction conversion
- Solar-position conversion
- Serialization/deserialization
Visual-only Three.js behaviour may require manual browser testing in addition to unit tests.
67. Browser Testing
For the 3D editor, manually verify at minimum:
Desktop Chrome
Desktop Edge
Mobile Chrome
Mobile Safari

Check:
- Camera interaction
- Touch rotation
- Zoom
- Panel placement
- Shadow rendering
- Theme
- Responsive UI
- Performance
- WebGL availability
Provide a graceful fallback if WebGL is unavailable.
68. Performance Testing
Test with:
10 panels
50 panels
100 panels
250 panels
500 panels

The application should remain usable.
If performance degrades:
1. Instance repeated meshes
2. Reduce model complexity
3. Reduce shadow resolution
4. Reduce unnecessary lights
5. Reduce draw calls
6. Use level-of-detail where appropriate
Do not immediately remove features.
69. Existing Backend Wake Architecture
The existing backend wake architecture must remain intact.
Current conceptual flow:
Page load
   ↓
ensureBackendAwake()
   ↓
/api/health
   ↓
API Gateway
   ↓
Wake Lambda
   ↓
EC2
   ↓
FastAPI

Do not cause every frontend interaction to wake the backend.
Especially:
Location autocomplete
Camera movement
3D rotation
3D zoom
Panel dragging
Sun animation

must not unnecessarily call the backend.
70. Backend Activity Tracking
Existing inactivity tracking must remain functional.
The application already uses SSM-backed activity tracking for automatic EC2 lifecycle management.
Do not introduce unnecessary API requests from the 3D renderer.
The 3D scene should remain primarily client-side.
71. Code Organization
Avoid putting the entire 3D system into one React component.
Prefer separation such as:
src/
  components/
    3d/
      Site3DViewer.tsx
      BuildingModel.tsx
      ObstacleModel.tsx
      SolarPanelModel.tsx
      SunControls.tsx
      ShadowControls.tsx

  services/
    solar/
    geometry/
    geocode/

  lib/
    3d/
      scene.ts
      camera.ts
      lighting.ts
      shadows.ts
      coordinates.ts

  data/
    panels/
      panelTypes.ts

The exact structure should follow the existing project conventions.
Do not create duplicate abstractions when equivalent existing utilities already exist.
72. React and Three.js Boundary
React should manage:
- UI
- application state
- controls
- panels
- forms
- stage progression
Three.js should manage:
- Scene
- Camera
- Meshes
- Lights
- Shadows
- Rendering
Do not trigger unnecessary React re-renders for every animation frame.
Use refs and Three.js state appropriately.
73. Animation
Sun simulation should use an animation loop efficiently.
Do not cause:
React state update
→ render
→ Three.js update

60 times per second unless necessary.
Use Three.js's rendering loop for continuous animation.
React state should be synchronized at meaningful interaction points.
74. Error Handling
The 3D system must gracefully handle:
- WebGL unavailable
- Model loading failure
- Invalid geometry
- Invalid height
- Invalid obstacle
- Invalid panel placement
- Shadow rendering failure
- Solar calculation failure
Never leave the user with a silent blank/black area.
Provide a clear message and recovery action.
75. Progressive Loading
The 3D editor should load progressively.
Recommended:
Enter 3D mode
      ↓
Initialize renderer
      ↓
Show building
      ↓
Load panel assets when required
      ↓
Load additional assets lazily

Do not preload every possible panel model if the user has not selected them.
76. Important UX Rule
The 3D model must always correspond to the real selected site.
Do not make the user feel that the application has switched to an unrelated generic 3D scene.
The satellite imagery, terrace outline, measurements, building dimensions, obstacles, and panels should all correspond to the same geographic site.
77. Current Development Priority
Implement the new 3D system incrementally.
Recommended order:
Phase 1
Existing location selection
        ↓
Terrace polygon
        ↓
Building height
        ↓
Basic 3D extrusion

Phase 2
3D camera
3D measurements
Obstacle creation
Obstacle height

Phase 3
pvlib sun position
Three.js directional light
Real-time shadows
Time controls
Full-day simulation

Phase 4
Solar panel asset library
450 W
550 W
600 W

Phase 5
Panel placement
Panel rotation
Panel tilt
Panel clearance
Obstacle collision

Phase 6
Panel/obstacle shading
Solar analysis
Energy estimation

Phase 7
Optimization
Reports
Project persistence
Advanced AI ranking

Do not attempt to implement the entire 3D system in one rewrite.
78. Non-Negotiable Engineering Rules
1. Do not replace the existing working application unnecessarily.
2. Do not rewrite the existing 2D geometry engine just to add 3D.
3. Do not calculate physical distances from screen pixels.
4. Do not calculate area directly from latitude/longitude degrees.
5. Do not use Three.js as the authoritative geographic geometry engine.
6. Do not use AI/LLMs for authoritative solar physics.
7. Do not use visual shadow maps as the final quantitative energy calculation.
8. Do not send every 3D interaction to the backend.
9. Do not expose backend/API secrets.
10. Do not add unlicensed 3D assets.
11. Do not use huge high-poly models for repeated solar panels.
12. Prefer GLB/glTF for web 3D assets.
13. Prefer InstancedMesh for repeated panels.
14. Keep 3D units in metres.
15. Keep geographic calculations in projected metric coordinates.
16. Keep the 3D model and geographic geometry logically separate.
17. Preserve existing backend wake/autostop behaviour.
18. Preserve the existing light/dark theme.
19. Preserve responsive/mobile behaviour.
20. Do not introduce undocumented or scraped Google APIs.
79. Target End-State
The final Surya-Ghar experience should feel like a lightweight professional solar-design tool.
A user should be able to:
Search:
"ABC Building, Kolkata"

        ↓

Select building

        ↓

Map zooms to site

        ↓

Define terrace

        ↓

See real dimensions:

26.6 m
34.1 m
18.3 m
...

        ↓

Enter:

Building height = 17.2 m

        ↓

3D building appears

        ↓

Add rooftop obstacles

        ↓

Enter obstacle heights

        ↓

Obstacles appear in 3D

        ↓

Choose:

12:00 PM

        ↓

Real sun direction appears

        ↓

Real-time shadows appear

        ↓

Change time:

08:00 → 10:00 → 12:00 → 14:00 → 16:00

        ↓

Shadows move

        ↓

Select:

550 W Solar Panel

        ↓

Place panels on rooftop

        ↓

Panels appear as lightweight 3D models

        ↓

Panel shadows update

        ↓

System validates:

Roof boundary
Setbacks
Obstacles
Clearances
Panel orientation
Shading

        ↓

Solar analysis

        ↓

Final recommended layout

The end result should combine:
Google Maps / geographic context
+
existing Surya-Ghar 2D geometry
+
Three.js 3D modeling
+
pvlib solar-position calculations
+
Three.js real-time shadows
+
lightweight GLB solar-panel assets
+
Shapely geometric validation
+
PVGIS solar-resource analysis

without making any one technology responsible for tasks it is not designed to perform.