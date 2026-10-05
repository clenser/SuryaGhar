# MASTER_PROMPT.md
# Solar Rooftop Analysis Platform
# Autonomous implementation specification for Claude Code

## 1. PURPOSE

You are the primary implementation agent for this project.

Build a professional India-focused solar rooftop and open-ground analysis web application.

The application is intended to become a serious product, not a coding demonstration.

Core experience:

Open map
-> Search property
-> Inspect satellite imagery
-> Select rooftop / usable ground
-> Validate selected area
-> Generate solar panel layout
-> Optimize orientation / tilt
-> Analyze surroundings and shading
-> Estimate solar generation
-> Present professional results

Build incrementally. Complete the current milestone before moving to the next.

---

## 2. MOST IMPORTANT EXECUTION RULE

BUILD THE PRODUCT. DO NOT GET STUCK TESTING INFRASTRUCTURE.

This is an autonomous coding task.

Inspect the repository, make reasonable engineering decisions, implement the requested milestone, build it, and report the result.

Do not repeatedly stop to ask the user questions.

Do not enter an open-ended diagnostic loop.

Do not spend significant time testing external providers from the shell.

Do not wait indefinitely for commands.

Do not repeatedly retry an unavailable service.

If an external provider cannot be verified, document the limitation and continue implementing around the provider abstraction.

The user will manually test the finished application.

---

## 3. TESTING POLICY

The user does NOT want a large automated testing or diagnostic cycle during implementation.

### During implementation

Do not:

- repeatedly run the full test suite
- repeatedly run curl diagnostics
- repeatedly test external APIs
- repeatedly test tile URLs
- create diagnostic scripts unless absolutely necessary
- repeatedly launch browser automation
- stop after every small code change to run tests
- turn implementation into a testing project

You may inspect existing tests to understand the project.

You may run a focused command when necessary to diagnose an actual code or build problem.

### Final verification

At the end of the current milestone:

1. Run the essential build command.
2. If the build succeeds, consider the milestone build-verified.
3. Report the build result.
4. Stop.

If the build fails:

1. Fix the actual build error.
2. Run the build again.
3. Stop once it succeeds.

Do not run a broad test suite just because one exists.

The user will manually test the application.

---

## 4. COMMAND TIMEOUT RULE

No command may be allowed to hang indefinitely.

For external commands, use reasonable timeouts.

This applies to:

- curl
- wget
- npm commands
- package installation
- development servers
- browser processes
- external APIs

External network checks should normally have a timeout of about 10 seconds.

For example:

curl --max-time 10 ...

If a network request hangs or times out:

STOP.

Do not repeatedly retry it.

Do not investigate it for an extended period.

Treat it as an external-provider limitation and continue.

---

## 5. WHAT NOT TO DO

Never enter this pattern:

curl provider
-> hangs
-> retry
-> retry
-> create diagnostic script
-> test another URL
-> wait for server
-> test again
-> ask user

Instead:

reasonable provider check
-> if successful, continue
-> if timeout/failure, continue implementation
-> verify through the actual application when practical
-> final build
-> report

The goal is to build the product.

---

## 6. EXISTING PROJECT

Before changing anything:

1. Inspect the repository.
2. Understand the existing structure.
3. Identify what already works.
4. Preserve working functionality.
5. Do not rewrite working components unnecessarily.

If the repository already contains MapLibre, imagery, terrain, search, or UI work, build on it.

Do not rebuild the map from scratch simply because another implementation looks preferable.

---

## 7. DOCUMENT PRIORITY

Use:

AGENTS.md
+
MASTER_PROMPT.md
+
Existing source code
+
Current milestone

AGENTS.md defines engineering rules.

MASTER_PROMPT.md defines product requirements and execution order.

Existing code determines what is already implemented.

---

# PRODUCT REQUIREMENTS

## 8. PRODUCT VISION

Build an India-focused solar-site analysis product combining:

- geospatial mapping
- satellite imagery
- computer vision
- solar engineering
- panel layout
- terrain analysis
- shadow analysis

The interface should hide unnecessary technical complexity while keeping advanced information available when useful.

The user should not need to understand GIS terminology.

---

## 9. UI IS A CORE REQUIREMENT

The UI is not secondary and must not be postponed until the end.

The product should feel like:

Professional mapping application
+
Solar engineering software
+
Modern SaaS product

It must not feel like:

Generic admin dashboard
+
AI-generated cards
+
Random gradients
+
Huge sidebar

The map is the primary workspace.

The UI exists to help the user work with the map.

---

## 10. UI DESIGN PRINCIPLES

Use:

- clean layout
- restrained colors
- excellent typography
- consistent spacing
- consistent iconography
- clear hierarchy
- subtle borders
- subtle shadows
- compact controls
- strong interaction feedback
- deliberate animation
- responsive layouts

Avoid:

- excessive rounded cards
- excessive glassmorphism
- neon colors
- giant gradients
- unnecessary badges
- giant buttons
- excessive floating controls
- decorative animations
- generic dashboard layouts
- inconsistent spacing
- emoji as UI icons
- random component styles

The result should look engineered, calm, and professional.

---

## 11. DESIGN SYSTEM

Create reusable design tokens for:

- colors
- typography
- spacing
- radii
- shadows
- borders
- transitions
- z-index

Use CSS variables or the project's existing token system.

Use a consistent icon library.

Do not mix unrelated icon styles.

---

## 12. MAP-FIRST LAYOUT

The main screen should be map-first.

Conceptually:

Header / Search / Project controls
-----------------------------------
                    |
                    |
                    MAP
                    |
Map controls        | Contextual panel
                    |
-----------------------------------

The map should occupy most of the viewport.

Avoid permanently covering a large portion of the map with a sidebar.

Use contextual panels and drawers.

---

## 13. PRIMARY WORKFLOW

The user should understand the current stage:

Location
-> Select Area
-> Validate
-> Design
-> Analyze
-> Results

Do not turn the application into a complicated multi-page wizard.

---

## 14. HEADER

Keep the header compact.

Possible contents:

- product logo/name
- location search
- project/site name
- save action
- settings
- account/profile if needed

Do not make the header unnecessarily tall.

---

## 15. LOCATION SEARCH

Implement professional map search.

Flow:

Search
-> Type
-> Suggestions
-> Select result
-> Smooth map fly-to

Results should show useful context such as:

- name
- locality
- state
- country

Handle:

- loading
- no results
- errors
- ambiguous results

Keep the geocoder provider replaceable.

---

## 16. MAP RENDERER

Use:

MapLibre GL JS

MapLibre is the renderer.

It does not provide imagery or terrain itself.

---

## 17. SATELLITE IMAGERY

Current prototype candidate:

Esri World Imagery

Use it if it already works in the current project.

Do not assume it is automatically suitable for commercial production. Production licensing and terms must be verified separately.

Native imagery resolution matters.

If a provider has no more detailed imagery at a location:

- do not artificially upscale it
- do not pretend it is higher resolution
- do not claim rooftop-grade resolution

Keep imagery provider abstraction so another provider can be substituted later.

---

## 18. MAP CONTEXT

Use appropriate contextual layers such as:

- OpenStreetMap/OpenFreeMap
- roads
- place labels
- building footprints

Satellite imagery remains the primary visual layer.

---

## 19. TERRAIN

Use an appropriate DEM provider.

Possible sources:

- AWS terrain datasets
- SRTM
- OpenTopography
- Copernicus DEM
- another properly licensed source

Keep the terrain provider replaceable.

Do not assume a provider is permanently free.

Record resolution when available.

Do not use coarse DEM data to make false precision claims.

---

## 20. 3D TERRAIN

Where terrain data supports it:

- enable MapLibre terrain
- support pitch
- support terrain exaggeration
- provide a clear terrain toggle

3D terrain is useful for later terrain and shadow analysis.

Do not make 3D mandatory for basic rooftop selection.

---

## 21. 3D BUILDINGS

Where building data is available:

- show building footprints
- optionally extrude buildings
- keep the visualization subtle

OSM height tags are not guaranteed survey-grade.

Do not treat them as exact measurements.

---

## 22. MAP CONTROLS

Controls must be:

- compact
- consistent
- accessible
- clearly grouped

Group:

- zoom
- orientation
- location
- layers
- terrain
- 3D

Use tooltips and clear active states.

Do not place every feature as an unrelated floating button.

---

## 23. MAP LAYER UI

Normal users should not see an engineering debug console.

Normal layer controls may include:

- Satellite
- Labels
- Buildings
- Terrain
- 3D

Provider URLs and technical diagnostics belong in advanced/developer views only.

---

## 24. RESPONSIVE DESIGN

Support:

- desktop
- laptop
- tablet
- mobile

Desktop is the primary analysis environment.

Mobile must still be usable.

Do not simply shrink desktop UI.

On mobile:

- contextual panels become bottom sheets/drawers
- controls simplify
- map remains dominant
- result cards stack
- selection remains usable
- safe areas are respected

Avoid horizontal overflow.

---

## 25. ANIMATION

Use animation only to communicate state.

Good:

- panel transitions
- selection feedback
- result appearance
- loading progression
- hover/focus states

Avoid:

- constant movement
- bouncing
- flashy page transitions
- unnecessary parallax
- decorative motion

Respect reduced-motion preferences.

---

## 26. EMPTY STATE

On first open:

Do not show a giant empty dashboard.

Show the map immediately.

Provide a subtle prompt:

Find a property to begin
Search for an address or place

---

# MILESTONE 1

## 27. MILESTONE 1 GOAL

Milestone 1 is:

MAP FOUNDATION + PROFESSIONAL UI + LOCATION SEARCH

It must produce a polished map workspace.

---

## 28. MILESTONE 1 REQUIRED FUNCTIONALITY

Implement:

### Map
- MapLibre
- satellite imagery
- base/context
- labels
- buildings where available
- roads/context where useful
- terrain where supported
- 3D terrain where supported
- 3D buildings where practical

### Navigation
- pan
- zoom
- pitch where appropriate
- reset orientation

### Search
- location search
- suggestions
- map fly-to

### UI
- professional header
- map-first layout
- compact controls
- layer control
- responsive behavior
- loading states
- error states
- empty state
- polished interaction states

### Provider handling
- provider abstraction
- graceful provider failure

---

## 29. MILESTONE 1 UI QUALITY

The result must not look like a raw MapLibre demo.

It must look like a real commercial solar/geospatial product.

Check visually:

- map is dominant
- controls are aligned
- search looks polished
- typography is consistent
- spacing is consistent
- buttons are consistent
- panels do not unnecessarily cover the map
- responsive layout is intentional
- loading/error states look designed
- no generic dashboard styling

---

## 30. MILESTONE 1 SCOPE LIMIT

While completing Milestone 1, do not implement:

- rooftop segmentation
- Groq
- panel placement
- solar optimization
- shadow engine
- full generation analysis

unless a tiny placeholder/interface is necessary for architecture.

Do not move to Milestone 2.

---

# MILESTONE 2

## 31. ROOFTOP / GROUND SELECTION

Only implement when Milestone 2 is requested.

Flow:

Select Area
-> Draw polygon
-> Edit polygon
-> Calculate area
-> Calculate perimeter
-> Calculate centroid
-> Confirm

Support:

- polygon drawing
- vertex editing
- delete
- undo/cancel where practical
- clear
- confirm

Use GeoJSON.

---

## 32. GEOSPATIAL CORRECTNESS

Latitude/longitude are angular coordinates.

Never calculate metric area directly from degrees.

Transform into an appropriate projected CRS before calculating:

- area
- perimeter
- distances
- panel geometry

Validate invalid/self-intersecting geometry.

---

# MILESTONE 3

## 33. SURFACE VALIDATION

Flow:

Selected polygon
-> imagery crop
-> local segmentation
-> pixel-level mask
-> Groq Vision
-> semantic validation
-> confidence
-> warnings

Classifications:

- roof
- usable ground
- road
- water
- vegetation
- other
- unknown

Never silently modify the user's polygon.

---

## 34. SEGMENTATION

Segmentation initially runs locally.

Possible models:

- SAM 2
- dedicated roof segmentation model
- another appropriate open-source model

Create a replaceable abstraction such as:

```python
class SegmentationProvider:
    ...
```

Do not hard-wire the application to one model.

---

## 35. GROQ

Groq is for semantic visual validation.

Environment variable:

```env
GROQ_API_KEY=
```

The actual key must never be stored in:

- source code
- frontend
- AGENTS.md
- MASTER_PROMPT.md
- logs
- Git
- screenshots

Never expose it to the browser.

Architecture:

Satellite imagery
-> crop
-> local segmentation
-> pixel mask
-> Groq Vision
-> semantic validation
-> structured result

Groq is NOT the pixel-level segmentation engine.

---

## 36. VALIDATION UI

Present:

Surface assessment

Rooftop
92% confidence

87% appears suitable

Vegetation
6%

[Review]
[Continue]

Avoid gimmicky "AI score" displays.

---

## 37. SEGMENTATION INSPECTION

Provide:

- Original
- Overlay
- Mask

The overlay must preserve enough imagery detail to understand the classification.

---

# MILESTONE 4

## 38. PANEL PLACEMENT

Implement deterministic geometry.

Flow:

Validated area
-> setbacks
-> obstacles
-> panel geometry
-> packing
-> panel count
-> system capacity

Inputs:

- panel width
- panel height
- wattage
- orientation
- tilt
- row spacing
- setbacks
- walkways if applicable

Do not use an LLM to determine panel coordinates.

---

## 39. PANEL RESULTS

Prioritize:

- panel count
- system capacity
- usable area
- panel specification

Example:

42 panels
18.06 kWp
1,102 m² usable area
430 W panels

---

# MILESTONE 5

## 40. SOLAR OPTIMIZATION

Use pvlib.

Evaluate:

- tilt
- azimuth
- solar position
- irradiance
- expected generation

Do not claim one universal optimal angle.

Compare candidate configurations.

---

## 41. SOLAR RESULTS

Present:

- estimated annual generation
- system size
- irradiation
- shading impact
- assumptions
- data quality
- confidence

Never present generation as guaranteed.

---

# MILESTONE 6

## 42. SURROUNDING ANALYSIS

Analyze where practical:

- buildings
- trees
- walls
- terrain
- obstacles

Possible data:

- OSM
- satellite
- segmentation
- DEM
- building datasets

Do not claim exact building/tree heights from ordinary imagery.

Every estimate needs a method and confidence.

---

# MILESTONE 7

## 43. SHADOW ANALYSIS

Eventually combine:

- latitude
- longitude
- solar position
- obstacle geometry
- obstacle height
- terrain

Do not use hard-coded sun angles.

Support:

- time
- date
- seasonal comparison
- shaded fraction
- estimated generation impact

---

# MILESTONE 8

## 44. PRODUCTION HARDENING

Eventually implement:

- provider licensing review
- authentication if required
- persistence
- rate limiting
- monitoring
- caching
- deployment
- security review
- operational error handling

Do not introduce these prematurely.

---

# ARCHITECTURE

## 45. FRONTEND

Preferred:

React
TypeScript
Vite
MapLibre GL JS

Suggested structure:

```text
frontend/
  src/
    components/
      map/
      search/
      selection/
      analysis/
      panels/
      ui/
    pages/
    hooks/
    services/
    providers/
    types/
    styles/
```

Do not create giant components.

---

## 46. BACKEND

Preferred:

Python
FastAPI

Suggested structure:

```text
backend/
  app/
    api/
    models/
    schemas/
    services/
    providers/
    geospatial/
    vision/
    segmentation/
    solar/
    core/
```

Keep external provider integrations isolated.

---

## 47. PROVIDER ABSTRACTION

Keep external services replaceable.

Interfaces should exist for:

- ImageryProvider
- TerrainProvider
- Geocoder
- SegmentationProvider
- VisionProvider
- SolarResourceProvider
- BuildingDataProvider

Do not scatter provider URLs across components.

---

## 48. GEOSPATIAL STACK

Preferred:

- Shapely
- GeoPandas
- pyproj
- Rasterio
- NumPy
- OpenCV

---

## 49. SOLAR STACK

Preferred:

- pvlib

Do not create a simplistic custom solar engine when pvlib provides the required calculation.

---

# SECURITY

## 50. SECRETS

Required .gitignore:

```gitignore
.env
.env.*
!.env.example
```

.env.example:

```env
GROQ_API_KEY=
```

Actual key belongs only in .env.

Never expose it to frontend JavaScript.

---

## 51. FILE AND REQUEST SAFETY

Where uploads are introduced:

- validate file type
- validate size
- apply request limits
- use timeouts
- avoid logging secrets
- avoid storing unnecessary uploaded data

---

# PERFORMANCE

## 52. PERFORMANCE PRINCIPLES

Prioritize:

- responsive map
- efficient imagery
- relevant AI crops
- avoiding unnecessary segmentation
- avoiding unnecessary map rerenders
- appropriate caching

Do not download huge imagery for small selections.

---

# DATA QUALITY

## 53. ANALYSIS METADATA

Where relevant, retain:

- imagery provider
- imagery date
- imagery resolution
- DEM provider
- DEM resolution
- segmentation model
- segmentation version
- vision model
- solar resource dataset
- panel specification
- assumptions

Technical information belongs in Details/Methodology, not the primary UI.

---

## 54. NO FAKE PRECISION

Never claim:

- survey-grade geometry
- exact building height
- exact tree height
- exact shadow boundaries
- exact annual generation

unless the available data genuinely supports that precision.

---

# ERROR HANDLING

## 55. EXTERNAL PROVIDER FAILURE

If a provider:

- times out
- returns an error
- is unavailable
- blocks a request
- lacks coverage

do not start a long investigation.

Do not repeatedly retry.

Do not rewrite the application.

Instead:

1. Handle the failure gracefully.
2. Keep provider abstraction intact.
3. Continue implementation.
4. Report the limitation.

---

## 56. USER-FACING ERRORS

Bad:

Something went wrong.

Good:

Satellite imagery could not be loaded.
Try again or choose another location.

Errors must be:

- specific
- concise
- actionable
- visually consistent

---

# ENGINEERING RULES

## 57. PRESERVE WORKING CODE

Do not rewrite working code for stylistic reasons.

Make focused changes.

Do not replace a provider merely because another provider sounds better.

---

## 58. DO NOT OVERENGINEER

Do not prematurely introduce:

- Kubernetes
- microservices
- distributed queues
- complex cloud infrastructure
- unnecessary databases
- unnecessary authentication
- expensive APIs
- complex CI systems

Start simple.

---

## 59. NO UNDOCUMENTED APIs

Do not use:

- undocumented Google Maps/Earth endpoints
- scraped proprietary tiles
- reverse-engineered APIs
- browser automation to bypass restrictions
- services that prohibit the intended use

Use documented services and properly licensed data.

---

## 60. DEVELOPMENT SEQUENCE

For every milestone:

READ
-> INSPECT
-> IMPLEMENT
-> POLISH
-> BUILD
-> REPORT

Do not use:

READ
-> ASK QUESTIONS
-> TEST PROVIDERS
-> TEST AGAIN
-> DIAGNOSTIC LOOP
-> WAIT

Only ask the user if there is a genuine blocker that cannot be resolved from the repository, AGENTS.md, or this document.

---

## 61. BUILD COMMAND

Determine the project's actual build command from package.json or the existing project structure.

At the end of the milestone, run only the essential build.

Examples:

```bash
npm run build
```

or the project's equivalent.

If build succeeds:

STOP.

If build fails:

Fix the build issue, rebuild, then STOP.

Do not run unrelated tests after a successful build.

---

# FINAL MILESTONE REPORT

## 62. REPORT FORMAT

After completing the milestone, provide:

```text
Milestone X complete.

Implemented:
- ...
- ...
- ...

Build:
PASS

Known limitations:
- ...

Manual testing:
The application is ready for manual testing.
```

Do not claim that you manually tested anything unless you actually did.

---

# MILESTONE 1 FINAL CHECKLIST

## 63. BEFORE STOPPING

Confirm that the implementation contains:

- MapLibre map
- satellite imagery
- map navigation
- location search
- contextual map layers
- terrain where supported
- 3D terrain where supported
- professional map controls
- responsive UI
- loading states
- error states
- polished empty state
- provider abstraction
- professional visual hierarchy

Then run the build.

If build passes:

STOP.

Do not begin Milestone 2.

---

# 64. MANUAL TESTING HANDOFF

Tell the user to manually check:

1. Open the application.
2. Search a location.
3. Fly to the result.
4. Zoom into a property.
5. Pan around.
6. Toggle map layers.
7. Test terrain/3D.
8. Resize the browser.
9. Check mobile layout.
10. Report any visual or map issues.

Do not perform an extended automated verification loop.

---

# 65. FINAL PRODUCT STANDARD

The final application should feel:

- precise
- calm
- modern
- professional
- technically credible
- fast
- trustworthy

It should not feel:

- flashy
- cluttered
- generic
- experimental
- like an AI-generated admin template

The user should understand the workflow without reading documentation.

---

# 66. FINAL INSTRUCTION

Build a serious solar-analysis product.

Priorities:

1. Correctness
2. Professional UI
3. User experience
4. Maintainability
5. Geospatial correctness
6. Honest data quality
7. Performance

Do not let external network diagnostics, provider curl commands, or unnecessary automated testing derail implementation.

Implement the requested milestone completely.

Polish the UI.

Run the final build.

If it passes, report the result and stop.

