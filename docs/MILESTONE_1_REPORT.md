# Milestone 1 Report: Map Foundation and Location Search

## Status

Code complete and tested for everything that can be tested in the build environment.
**Not yet verified:** live satellite tiles, OSM vector context, DEM terrain and 3D
buildings. The build sandbox could not reach the tile servers (HTTP 403 with no CORS
headers), so those were verified by configuration and mocked tests only. Please run
`npm run dev` on a machine with internet access and confirm the items in
"Manual checks still required" before Milestone 2 is treated as started.

Milestone 2 (polygon selection) has **not** been started, per the instruction to proceed one milestone at a time.

## Repository state before work

Only `AGENTS.md`, `MASTER_PROMPT.md`, `_env` and `_gitignore` were uploaded. No map
prototype or repository existed, so this was built from scratch, following Milestone 1
and the first-session steps in MASTER_PROMPT section 53.

## Implemented

Backend (FastAPI)
- `GET /health`, `GET /config` (public, non-secret), `POST /geocode`.
- Geocoder abstraction (`Geocoder` base class), Nominatim implementation restricted to India
  with a configurable User-Agent. Selection happens in `services/geocoding.py`.
- Input validation: query normalised and length-limited (2–120 chars), 8 KB request-size limit,
  structured error responses, and upstream failures mapped to HTTP 502 with a readable detail.
- Secrets: `GROQ_API_KEY` is read into settings only. No endpoint returns it.

Frontend (React, TypeScript, Vite, MapLibre GL JS 4.7)
- Map-first workspace: compact header with search, full-viewport map, floating control groups,
  contextual place card, onboarding prompt, and status bar with coordinates, scale and zoom.
- Provider abstractions: `ImageryProvider` (Esri World Imagery), `TerrainProvider`
  (AWS Terrarium DEM, with recorded resolution limits), and the OSM/OpenFreeMap basemap
  (roads, labels, 3D building extrusions hidden by default).
- Location search: debounced (350 ms), keyboard navigable (arrows, Enter, Escape), loading, empty,
  error with retry, and abort on new input. Results show name plus locality, state and country.
- Map controls: zoom, reset north (disabled when already north), 3D tilt toggle, terrain toggle,
  layers. Active states use `aria-pressed`, not colour alone.
- Layers panel: display toggles, plus an Advanced mode with opacity and exaggeration tuning,
  provider diagnostics, the five Indian test sites, and a map-event log.
- Honest provider messaging: an imagery failure shows a banner stating analysis accuracy may
  differ, and failures are logged with a classification, never the request URL.
- Design tokens (`styles/tokens.css`), restrained neutral palette with a single teal primary and
  amber accent, reduced-motion support, responsive breakpoint at 760 px with bottom sheets.

## Tests run and results

| Check | Result |
|---|---|
| Backend pytest (provider mocks via respx, API tests, validation, size limit, secret-free `/config`) | **14 passed** |
| Frontend Vitest (providers, geocoding client, search combobox, map controls, scale math, App smoke with mocked MapLibre) | **38 passed** |
| TypeScript strict typecheck | Pass |
| Production build (`vite build`) | Pass, MapLibre split into its own chunk |
| Bundle secret scan (`GROQ_API_KEY` value and the string "groq") | Clean |
| Real-browser check: all 5 Indian test sites (Kolkata, Kalna, New Delhi, Mumbai, Bengaluru) move the live MapLibre map to the correct coordinates | **5/5 correct**, zero uncaught page errors |
| Screenshot review, desktop 1440×900 and mobile 390×844 | Reviewed, issues fixed (see below) |

Note: the Vitest run uses a mocked MapLibre because jsdom has no WebGL. The real-browser check
uses the real MapLibre instance; its centre readout comes from the map itself.

## Issues found in review and fixed

1. Header "Advanced" opened no visible panel. It now also opens the layers panel where the diagnostics live.
2. Clicking Retry in the search error state blurred the input, which closed the list before the click landed. The panel now keeps focus during pointer interaction.
3. The attribution control was added twice. Now one control.
4. The "3D" label was overlaid on its icon. Now a clear text control.
5. On mobile, the onboarding card sat under the map control stack. It now sits clear of the controls and the attribution, and the step strip is hidden on small screens.
6. The layers panel covered the attribution. It now stops above it.
7. Advanced toggle had no accessible name. It now has one.
8. Test-fixture and expectation mistakes corrected (not product behaviour).

## Manual checks still required (need internet access)

- Esri satellite tiles render at Kolkata, Kalna, New Delhi, Mumbai and Bengaluru.
- OSM roads and place labels appear over imagery.
- Terrain relief and 3D buildings render (tilt above 0°, zoom 14+ for buildings).
- Browser console shows no tile-load errors on a normal session.
- Search returns results for real Indian localities through Nominatim.

## Known limitations

- Esri anonymous endpoint is prototype-only. Its terms must be verified before any production use.
- Nominatim requires at most 1 request per second. Only client-side debounce and a small in-memory
  cache exist. Server-side rate limiting is not implemented yet. Set `NOMINATIM_USER_AGENT`
  to a real contact before use.
- Imagery resolution is not known per location. The UI says so but does not measure it.
- No hillshade layer. Light theme only. No ESLint configured; typecheck is used instead.
- Groq is not integrated yet (Milestone 3).
- The `_env` file contained a live Groq key. It was copied to the local `.env`, excluded from the
  delivered zip, and never written to any shipped file. **Rotate this key**, because it has now appeared in
  an uploaded file and this conversation.
