# Milestones 2-7 Report

Milestones 2 through 7 were implemented in one pass, following the
"continue from the next unfinished milestone" instruction.

## Implemented

Backend (FastAPI)
- `POST /selection/metrics` — shapely/pyproj metric area, perimeter, centroid,
  validity check and automatic repair of invalid geometry.
- `POST /selection/validate` — Esri imagery crop (`/export`, 3857, min extent
  padded), local heuristic segmentation (roof/vegetation/water/road/other),
  component fractions, per-class overlay PNG views, plus optional Groq Vision
  semantic review when `GROQ_API_KEY` is set (never exposed to the browser).
- `POST /panel-layout` — deterministic Shapely packing: setback buffer, rotated
  panel rows facing the azimuth, panel outlines as GeoJSON, kWp, usable area.
- `POST /solar-analysis` — pvlib + PVGIS TMY: tilt×azimuth sweep, PVWatts DC/AC,
  best configuration, specific yield, plus an explicit low-confidence benchmark
  fallback when PVGIS is unreachable.
- `POST /surroundings` — OpenStreetMap Overpass: building counts, height-tag
  stats, tree counts, explicit confidence/limitation notes.
- `POST /shadow-analysis` — pvlib solar position + Overpass building footprints
  with height tags: per-hour shaded fraction curve, shadow polygons at the
  requested time, honest plan-view limitation warnings.

Frontend (React, TypeScript, Vite, MapLibre GL JS)
- Milestone 2: polygon drawing (click points, double-click to finish), vertex
  editing by dragging, right-click to delete a vertex, undo, clear, confirm;
  UTM-projected area/perimeter/centroid; self-intersection validation.
- Stage workspace panel (Select / Validate / Design / Solar / Site tabs).
- Stage 2: surface assessment card with classification, confidence, component
  bars, Original/Overlay/Mask views, warnings, limitations, and
  Review/Continue actions.
- Stage 3: design form (panel size, wattage, setback, tilt, azimuth), panel
  count, kWp, usable area, panel outlines drawn on the map.
- Stage 4: annual yield estimate, best tilt/azimuth, tilt×azimuth bar chart,
  provider/confidence notes.
- Stage 5: surroundings stats and a shadow chart plus shadow polygons
  overlaid on the map; datetime inputs.

## Build

- Frontend: `npm run build` (tsc + vite) PASS.
- Backend: all endpoints exercised live against the local TestClient;
  Esri crop, Overpass surroundings, PVGIS simulation and shadow projection
  each returned valid results for Kolkata.

## Known limitations

- Esri anonymous endpoint is still prototype-only.
- Segmentation is a local heuristic, not SAM/SAM 2. Swapping a trained model
  in later does not change the API shape.
- Groq review only runs when a key is configured; otherwise the result is
  labelled heuristic-only.
- Shadows are a 2-D plan-view approximation; trees and terrain are ignored
  or defaulted; OSM building heights are self-reported.
- PVGIS weather-year data is a single TMY; treat as planning-grade, not
  bankable.
- No persistence, no authentication, no server-side rate limiting.

## Manual testing

The application is ready for manual testing. Start the backend (`uvicorn
app.main:app --port 8000` from `backend/`) and the frontend (`npm run dev`
from `frontend/`), then: search a place, draw a polygon, confirm, validate,
compute a panel layout, run the solar estimate, and scan surroundings/shadows.
