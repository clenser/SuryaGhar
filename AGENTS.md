# AGENTS.md
# Solar Rooftop Analysis Platform
# Engineering instructions for AI coding agents

## 1. Mission

Build a production-quality, India-focused solar rooftop and open-ground analysis platform.

The platform must let a user:

1. Open a high-quality satellite map.
2. Search/navigate to a property.
3. Select a rooftop or usable ground area.
4. Validate whether the selected area is actually suitable.
5. Calculate usable area and solar-panel capacity.
6. Place panels using deterministic geometry.
7. Optimize panel orientation and tilt.
8. Analyze surrounding buildings, trees, and terrain.
9. Estimate shading and solar irradiation.
10. Estimate annual energy generation.
11. Clearly communicate confidence, assumptions, limitations, and data resolution.

The application must be engineered incrementally. Do not build the entire product in one step.

The current priority is to establish a reliable map foundation and then implement rooftop/ground selection and validation.

---

## 2. Critical Engineering Principles

### 2.1 Incremental implementation

Implement one independently testable capability at a time.

Preferred order:

Phase 1:
- Map
- Satellite imagery
- Base/context layers
- Terrain
- Location search
- Polygon selection
- Area calculation

Phase 2:
- Surface validation
- Segmentation
- Panel geometry
- Panel placement

Phase 3:
- Solar optimization
- Surrounding-object analysis
- Height estimation
- Shadows
- Irradiation
- Generation estimates

Do not implement later phases merely because they are described here.

### 2.2 Preserve working functionality

If an existing component works, do not rewrite it without evidence that the rewrite is necessary.

Before modifying a working map/provider:

1. Reproduce the issue.
2. Identify the actual cause.
3. Make the smallest appropriate change.
4. Retest the affected behavior.

Do not replace a functioning provider simply because another provider appears theoretically better.

### 2.3 Free-first development

The initial prototype should use free/open-source or freely testable services wherever practical.

Do not introduce paid APIs unless:
- there is a clear technical requirement,
- the free option is inadequate,
- and the user explicitly approves the cost.

Never add a billing dependency merely for convenience.

### 2.4 No undocumented/scraped APIs

Do not use:
- undocumented Google Maps/Earth endpoints,
- scraped proprietary tile endpoints,
- reverse-engineered APIs,
- browser automation to obtain restricted imagery,
- services that explicitly prohibit the intended usage.

Use documented APIs, documented tile services, or properly licensed datasets.

### 2.5 No fake precision

Never claim that an estimate is survey-grade.

If imagery resolution, DEM resolution, building height, tree height, shadow geometry, or solar resource data limits accuracy, expose that limitation.

---

# 3. Technology Stack

## Frontend

Preferred:

- React
- TypeScript
- Vite
- MapLibre GL JS

Use a clean component architecture.

Do not introduce a second frontend framework unless there is a demonstrated need.

## Backend

Preferred:

- Python
- FastAPI

The backend should own:
- AI/vision calls
- segmentation
- geospatial processing
- solar calculations
- analysis pipelines
- provider abstraction
- validation
- secrets

The browser must not receive private API keys.

## Geospatial

Preferred:

- Shapely
- GeoPandas
- pyproj
- Rasterio
- NumPy
- OpenCV

Use appropriate projected coordinate systems for metric calculations.

Do not calculate rooftop area by treating latitude/longitude degrees as meters.

## Machine learning

Preferred:

- PyTorch
- OpenCV
- segmentation models such as SAM/SAM 2 or an appropriate dedicated segmentation model
- Ultralytics where appropriate

The segmentation architecture must remain replaceable.

## Solar

Preferred:

- pvlib

Use pvlib for:
- solar position
- irradiance calculations
- PV performance estimation
- orientation/tilt analysis

Do not implement a fake solar formula when pvlib can provide the required calculation.

---

# 4. Current Map Architecture

The current prototype uses:

```text
MapLibre GL JS
        |
        +-- Satellite imagery
        |
        +-- OpenStreetMap/OpenFreeMap context
        |
        +-- Terrain / DEM
        |
        +-- OSM building data
        |
        +-- OSM roads
        |
        +-- 3D terrain
        |
        +-- 3D building visualization
```

MapLibre is only the renderer.

It does NOT provide satellite imagery or terrain data itself.

Provider availability, licensing, limits, resolution, and coverage must always be treated separately from the rendering library.

## Current prototype satellite provider

Esri World Imagery is the current prototype candidate because it provides useful satellite coverage for testing.

Important:

- Do not assume anonymous Esri imagery endpoints are suitable for production.
- Verify current Esri terms/licensing before production deployment.
- Do not promise universal high-resolution rooftop coverage.
- Native imagery resolution matters.

If imagery stops becoming more detailed at a location, do not fake additional detail by upscaling and presenting it as higher-resolution imagery.

The provider must be abstracted so another imagery provider can later be substituted.

Example conceptual interface:

```ts
interface ImageryProvider {
  getSourceConfig(): unknown;
  getDisplayName(): string;
  getAttribution(): string;
  getCoverageInfo?(): unknown;
}
```

Do not hard-code provider-specific assumptions throughout the application.

---

# 5. MapLibre Requirements

Use MapLibre GL JS for:

- pan
- zoom
- rotation
- pitch
- raster imagery
- vector layers
- raster DEM terrain
- hillshade
- 3D building extrusion
- drawing/editing overlays

The map must remain responsive.

Do not create hundreds or thousands of DOM markers for geospatial visualization when a MapLibre source/layer can handle the data.

Prefer:
- GeoJSON sources
- vector sources
- raster sources
- MapLibre layers

over manually created HTML elements.

---

# 6. Map Layers

Conceptual layers:

### Satellite imagery
Primary visual layer.

### OSM/base context
Used for:
- roads
- place names
- boundaries
- orientation

### OSM buildings
Used as contextual building footprints and later as inputs to surrounding-object analysis.

### OSM roads
Context only unless explicitly required by analysis.

### 3D buildings
Visualization and future shadow-analysis support.

OSM building height/tag data must not automatically be treated as accurate surveyed height.

### Terrain hillshade
Optional visual enhancement.

### 3D terrain
Important for later terrain/shadow analysis.

Keep technical/debug layer controls separate from the normal user workflow.

---

# 7. Terrain

Possible sources include:

- AWS terrain datasets/tiles
- OpenTopography
- SRTM
- Copernicus DEM
- another properly licensed DEM provider

Do not assume a particular DEM provider will always remain free or unrestricted.

Abstract the terrain provider.

Terrain resolution must be recorded.

A 30 m DEM cannot accurately represent a small rooftop parapet.

Do not use coarse terrain data to make precise building-height claims.

---

# 8. Location Search

Location search should be implemented behind a geocoding abstraction.

Example:

```ts
interface Geocoder {
  search(query: string): Promise<LocationResult[]>;
}

interface LocationResult {
  name: string;
  latitude: number;
  longitude: number;
  bounds?: BoundingBox;
}
```

Initial scope:
- India-focused search
- city/locality/address search
- map fly-to behavior

Do not permanently couple the UI to one geocoding provider.

Respect provider attribution, rate limits, and usage policies.

---

# 9. Rooftop / Ground Selection

This is the next major feature after the map foundation.

User workflow:

```text
Search location
      ↓
Navigate map
      ↓
Zoom to property
      ↓
Select Area
      ↓
Draw polygon
      ↓
Edit polygon
      ↓
Calculate area/perimeter
      ↓
Validate selection
      ↓
Confirm
```

Required functionality:

- Draw polygon
- Add vertices
- Move vertices
- Delete vertices
- Undo/redo where practical
- Clear selection
- Confirm selection
- Calculate area in m²
- Calculate perimeter
- Calculate centroid
- Store GeoJSON representation

Use GeoJSON for interchange.

Example:

```json
{
  "type": "Polygon",
  "coordinates": []
}
```

For metric calculations, transform coordinates into an appropriate projected CRS before calculating area.

---

# 10. Selection Validation

The validation system must distinguish between:

- roof
- usable ground
- road
- water
- vegetation/tree
- other building surface
- unknown

The system must NOT silently replace the user's polygon.

Instead return structured information such as:

```json
{
  "classification": "roof",
  "confidence": 0.91,
  "coverage": 0.87,
  "warnings": [],
  "mask": null
}
```

For mixed selections:

```json
{
  "classification": "mixed",
  "confidence": 0.72,
  "coverage": 0.81,
  "components": {
    "roof": 0.81,
    "vegetation": 0.12,
    "unknown": 0.07
  }
}
```

The UI should explain why a selection is questionable.

---

# 11. Groq Vision

Groq is intended for semantic visual validation and structured reasoning.

Environment variable:

```env
GROQ_API_KEY=
```

The actual key must NEVER be committed.

Never put the actual API key in:
- AGENTS.md
- MASTER_PROMPT.md
- source code
- frontend code
- Git history
- logs
- screenshots
- test fixtures

Use:

```text
.env
```

and ensure `.env` is ignored by Git.

Provide:

```text
.env.example
```

containing only:

```env
GROQ_API_KEY=
```

## Critical architecture rule

Do NOT make Groq the core pixel-accurate segmentation engine.

Use:

```text
Satellite crop
      ↓
Segmentation model
      ↓
Pixel-level mask
      ↓
Groq Vision
      ↓
Semantic validation + reasoning
```

Groq should answer questions such as:

- Is this likely a roof?
- Is this likely usable ground?
- Does the selected region contain obvious vegetation?
- Does it look like a road?
- Does it contain water?
- Is the selection visually ambiguous?

The segmentation layer must remain independent so that Groq can later be replaced or supplemented.

---

# 12. Segmentation Layer

The segmentation layer should initially be local.

No paid segmentation API is required for the first implementation.

Candidate models:

- SAM 2
- suitable lightweight segmentation models
- dedicated roof segmentation models
- other properly licensed open-source segmentation models

The implementation must use an abstraction such as:

```python
class SegmentationProvider:
    def segment(self, image, context):
        raise NotImplementedError
```

or an equivalent clean interface.

The rest of the application must not depend directly on SAM 2.

The segmentation output should contain:

```json
{
  "mask": "...",
  "classes": [],
  "confidence": 0.0,
  "resolution": {
    "width": 0,
    "height": 0
  }
}
```

The exact representation can differ depending on implementation.

---

# 13. Image Preparation

Do not send an unnecessarily huge satellite image to the vision system.

The backend should:

1. Receive the selected geographic polygon.
2. Determine the relevant image bounds.
3. Retrieve/crop imagery.
4. Convert the geographic selection into image coordinates.
5. Generate a suitable crop.
6. Run segmentation.
7. Run semantic validation.
8. Return structured results.

Preserve the relationship between:
- geographic coordinates
- image pixels
- segmentation mask

Do not lose georeferencing.

---

# 14. Panel Placement

Panel placement must be deterministic and geometry-based.

Inputs should eventually include:

- panel width
- panel height
- orientation
- tilt
- row spacing
- edge setback
- obstacle exclusion zones
- walkway requirements
- user-defined spacing

Basic flow:

```text
Validated polygon
        ↓
Convert to metric geometry
        ↓
Apply setbacks
        ↓
Remove obstacles
        ↓
Generate panel candidates
        ↓
Rotate/orient candidates
        ↓
Pack panels
        ↓
Count panels
        ↓
Calculate DC capacity
```

Do not use an LLM to decide panel coordinates.

Geometry determines placement.

AI may assist with interpretation, but not replace deterministic geometry.

---

# 15. Panel Capacity

Example:

```text
panel_count × panel_wattage = total DC capacity
```

Return:

- panel count
- panel dimensions
- panel wattage
- total kWp
- usable area
- unused area
- assumptions

All assumptions must be visible.

---

# 16. Solar Orientation and Tilt

Use pvlib.

Potential variables:

- latitude
- longitude
- azimuth
- tilt
- time
- irradiance
- weather/solar-resource dataset

Optimization should compare candidate orientations rather than simply claiming that one universal tilt is optimal.

Example:

```text
Candidate tilt 15°
Candidate tilt 20°
Candidate tilt 25°
Candidate tilt 30°
...
```

Then evaluate expected annual irradiation/energy.

The actual search range and resolution should be configurable.

---

# 17. Surrounding Object Analysis

Later phases may analyze:

- nearby buildings
- trees
- terrain
- walls
- other obstacles

Sources can include:

- OSM
- satellite imagery
- DEM
- segmentation
- computer vision
- building-height datasets where available

Do not claim exact building/tree heights from a single ordinary satellite image.

Height estimates must have:
- method
- source
- resolution
- uncertainty/confidence

---

# 18. Shadow Analysis

Shadow analysis should eventually combine:

- latitude
- longitude
- date/time
- sun azimuth
- solar altitude
- obstacle geometry
- obstacle height
- terrain

Use proper solar-position calculations.

Do not use hard-coded sun angles.

The system should support time-based shadow visualization.

Later it can calculate:
- shaded fraction
- shading by hour
- seasonal effects
- annual shading losses

---

# 19. Solar Irradiation and Generation

Generation estimation should clearly separate:

### Resource estimate
Solar irradiation available at the location.

### System estimate
Expected PV production after:
- panel orientation
- tilt
- temperature
- system losses
- shading
- inverter assumptions

Use pvlib and documented datasets.

Do not present a single number without assumptions.

Prefer:

```text
Estimated annual generation:
X to Y kWh/year

Confidence:
Medium

Major uncertainties:
- imagery resolution
- surrounding-object height
- weather/resource dataset
- shading assumptions
```

---

# 20. Confidence System

Every AI/geospatial estimate should expose confidence or uncertainty where meaningful.

Potential confidence categories:

- High
- Medium
- Low

Examples:

```text
Roof classification: High
Building height: Medium
Tree height: Low
Shadow estimate: Medium
Annual generation: Medium
```

Confidence should be based on actual evidence, not arbitrary UI decoration.

---

# 21. Provider Abstraction

External providers must be replaceable.

Create clear interfaces for:

```text
ImageryProvider
TerrainProvider
Geocoder
SegmentationProvider
VisionValidator
SolarResourceProvider
BuildingDataProvider
```

Do not scatter provider URLs throughout the codebase.

Configuration should select providers.

Example:

```env
IMAGERY_PROVIDER=esri
TERRAIN_PROVIDER=...
VISION_PROVIDER=groq
SEGMENTATION_PROVIDER=local
```

Provider-specific code belongs inside provider modules.

---

# 22. Secrets and Security

Never expose backend secrets to the browser.

Frontend may contain public configuration only.

Private keys belong in backend environment variables or a proper secrets manager.

Required:

```gitignore
.env
.env.*
!.env.example
```

Never log:
- API keys
- authorization headers
- private tokens
- uploaded image contents unless explicitly required for debugging

Validate uploaded files.

Apply:
- file-size limits
- MIME/type validation
- request-size limits
- timeouts
- rate limits where appropriate

---

# 23. API Design

Keep backend APIs small and explicit.

Suggested endpoints:

```text
GET  /health
GET  /config
POST /geocode
POST /selection/validate
POST /segmentation
POST /panel-layout
POST /solar-analysis
POST /shadow-analysis
```

Do not create endpoints simply because a function exists.

Group related operations logically.

Use Pydantic models for request/response validation.

Return structured errors.

---

# 24. Testing

Every feature must have tests.

Minimum expectations:

### Frontend
- component tests
- map initialization tests where practical
- selection interaction tests
- build test

### Backend
- unit tests
- API tests
- geospatial geometry tests
- validation tests
- provider mock tests

### AI
Do not require a live Groq API call for every automated test.

Use mocked responses for normal CI tests.

Create a separate optional integration test for the live Groq API.

### Geospatial
Test:
- polygon area
- CRS transformation
- invalid polygons
- self-intersecting polygons
- multipolygons
- tiny polygons
- large polygons

---

# 25. Map Diagnostic Testing

When diagnosing map imagery:

Do not assume a grey tile means a frontend bug.

Determine whether:

1. The map requested the tile.
2. The provider returned a response.
3. The response contained imagery.
4. The provider has native imagery at that zoom.
5. The browser rejected the request.
6. CORS/network policy blocked it.

Log enough information to identify the actual failure.

Never increase `maxzoom` and claim that this creates higher-resolution imagery.

---

# 26. Indian Test Locations

Use multiple locations to prevent provider-specific assumptions.

Initial test locations:

- Kolkata
- Kalna
- Delhi
- Mumbai
- Bengaluru

At minimum test:

- urban dense area
- suburban area
- smaller town
- rural/open area
- rooftop area

The system should not be considered map-ready after testing only one location.

---

# 27. UI Principles

The normal interface should be simple.

Do not expose every technical layer to ordinary users.

Recommended main workflow:

```text
Search
   ↓
Select area
   ↓
Validate
   ↓
Place panels
   ↓
Analyze solar
   ↓
Results
```

Advanced/debug controls can contain:

- satellite opacity
- OSM opacity
- terrain exaggeration
- 3D buildings
- terrain
- provider diagnostics
- imagery metadata

The interface should not look like an engineering debugging console unless the user explicitly enters an advanced mode.

---

# 28. UX Requirements

Important interactions:

- Smooth map navigation
- Clear selected polygon
- Clear editing state
- Undo/cancel
- Loading indicators
- Error messages
- Provider/data warnings
- Confidence indicators
- Explainable validation results

Do not hide failed API/provider operations behind an indefinite spinner.

Every long-running operation should have:
- loading state
- success state
- error state
- timeout/failure handling

---

# 29. Performance

Avoid unnecessary processing.

For imagery:

- crop only relevant regions
- resize intelligently
- cache repeated requests where allowed
- avoid downloading massive images for small selections

For segmentation:

- run inference only on relevant image regions
- use GPU if available
- allow CPU fallback
- expose inference timing during development

For map:

- use vector/raster sources efficiently
- avoid excessive DOM nodes
- avoid unnecessary re-renders

---

# 30. Caching

Caching may be used for:
- imagery metadata
- geocoding
- DEM data
- AI results
- segmentation results

Cache keys must include enough context to prevent incorrect reuse.

For example:

```text
provider
location
zoom/resolution
polygon
model/version
prompt/version
```

Do not reuse an old AI result after changing the model or validation logic without considering invalidation.

---

# 31. Reproducibility

Analysis results should record enough metadata to reproduce them.

Record, where applicable:

- imagery provider
- imagery date if available
- imagery resolution
- DEM provider
- DEM resolution
- segmentation model
- segmentation model version
- vision model
- solar-resource dataset
- panel specifications
- assumptions
- algorithm version

---

# 32. Error Handling

Never silently fall back from one provider to another if the change materially affects accuracy.

If fallback occurs, tell the user.

Example:

```text
Primary satellite imagery unavailable.
Showing alternate imagery.
Analysis accuracy may differ.
```

Do not hide degraded data quality.

---

# 33. AI Agent Working Rules

When working on this project:

1. Inspect the existing code before modifying it.
2. Identify the current architecture.
3. Run the relevant tests before changing code.
4. Make a focused change.
5. Run tests again.
6. Report exactly what changed.
7. Report remaining limitations.
8. Do not claim a feature works unless it was actually tested.

Do not fabricate:
- API responses
- imagery coverage
- model accuracy
- test results
- solar estimates
- provider availability

---

# 34. Do Not Overengineer Early

Avoid adding:
- microservices
- Kubernetes
- complex queues
- unnecessary databases
- expensive cloud infrastructure
- paid APIs
- unnecessary authentication
- premature distributed processing

The initial application can be a well-structured frontend + FastAPI backend.

Introduce complexity only when justified by a real requirement.

---

# 35. Database

A database is not required for the earliest map prototype.

When persistence becomes necessary, prefer:

- PostgreSQL
- PostGIS

Potential persisted objects:

- users
- projects
- site locations
- selected polygons
- panel layouts
- analysis runs
- analysis metadata
- results

Use PostGIS for geographic data.

---

# 36. Recommended Development Milestones

## Milestone 1: Map foundation

Must demonstrate:

- MapLibre works
- satellite imagery works
- map navigation works
- multiple Indian locations work
- OSM/context works
- terrain works where available
- 3D terrain works where available
- no major console errors

Do not proceed until this is stable.

## Milestone 2: Area selection

Implement:

- polygon drawing
- polygon editing
- area calculation
- perimeter
- centroid
- GeoJSON export
- confirmation

## Milestone 3: Surface validation

Implement:

- imagery crop
- local segmentation
- Groq semantic validation
- confidence
- structured result
- warning/rejection logic

## Milestone 4: Panel placement

Implement:

- panel dimensions
- setbacks
- deterministic packing
- panel count
- kWp

## Milestone 5: Solar optimization

Implement:

- orientation
- tilt
- pvlib
- solar resource
- generation estimate

## Milestone 6: Surroundings

Implement:

- buildings
- terrain
- trees where feasible
- height estimates
- confidence

## Milestone 7: Shadows

Implement:

- solar position
- obstacle geometry
- shadow projection
- time/season analysis
- shading loss

## Milestone 8: Production hardening

Implement:

- provider licensing verification
- authentication if required
- persistence
- rate limiting
- monitoring
- caching
- deployment
- security review

---

# 37. Definition of Done

A feature is complete only when:

- implementation exists
- UI exists where required
- backend/API exists where required
- tests exist
- relevant tests pass
- failure cases are handled
- no secrets are exposed
- assumptions are documented
- actual behavior has been manually verified where appropriate

Do not mark a feature complete because the code compiles.

---

# 38. Immediate Priority

At the beginning of a new implementation session:

1. Inspect the repository.
2. Read this AGENTS.md.
3. Read MASTER_PROMPT.md if present.
4. Identify what has already been implemented.
5. Do not rebuild the map if the map foundation is already working.
6. Run the existing tests.
7. Continue from the next unfinished milestone.

The intended immediate development path is:

```text
Working map
   ↓
Rooftop/ground polygon selection
   ↓
Area + geometry
   ↓
Local segmentation
   ↓
Groq semantic validation
   ↓
Panel placement
   ↓
Solar analysis
   ↓
Surrounding/shadow analysis
```

---

# 39. Final Rule

Accuracy is more important than feature count.

A smaller system that correctly states:
"imagery resolution is insufficient for reliable rooftop analysis here"

is better than a larger system that produces a precise-looking but unsupported result.

Build incrementally, test independently, preserve working components, keep providers replaceable, protect secrets, and never invent accuracy.
