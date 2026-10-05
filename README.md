# Solar Site Analysis Platform

India-focused solar rooftop and ground analysis. See `AGENTS.md` (engineering rules) and
`MASTER_PROMPT.md` (product and UI brief).

**Current status: Milestones 1-7 implemented** (map, polygon selection, surface validation,
panel layout, solar estimates, surroundings, shadows). See
`docs/MILESTONES_2_TO_7_REPORT.md` for what was built and verified.

## Layout

```
backend/    FastAPI, geocoder abstraction, Pydantic schemas, pytest suite
frontend/   React + TypeScript + Vite + MapLibre GL JS, Vitest suite
scripts/    Playwright helpers (test-site verification, screenshots)
docs/       Milestone report and screenshots
```

## Run locally

Backend (Python 3.12):

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api is proxied to the backend
```

## Test

```bash
cd backend && . .venv/bin/activate && python -m pytest -q
cd frontend && npm test && npm run build
```

## Configuration

Copy `.env.example` to `.env` (ignored by Git). Groq is not used yet in Milestone 1.
`GROQ_API_KEY` is loaded only by the backend and is never returned by any endpoint or
included in the frontend bundle (verified by a build scan).

Set `NOMINATIM_USER_AGENT` to a value with real contact details before any real use;
the OpenStreetMap Nominatim usage policy requires an identifying User-Agent and at most one request per second.

## Provider notes

- Imagery: Esri World Imagery, anonymous endpoint, **prototype only**. Verify terms before production.
- Terrain: AWS Terrain Tiles (Terrarium). Coarse; not suitable for building-height claims.
- Context: OpenFreeMap vector tiles (OpenStreetMap data).
- Geocoding: OSM Nominatim, India-restricted, through the backend.
