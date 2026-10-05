from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.providers.base import Geocoder, ProviderError
from app.schemas.analysis import (
    MetricsRequest,
    MetricsResponse,
    PanelLayoutRequest,
    PanelLayoutResponse,
    ShadowRequest,
    ShadowResponse,
    SolarRequest,
    SolarResponse,
    SurroundingsRequest,
    SurroundingsResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.schemas.geocode import GeocodeRequest, GeocodeResponse
from app.services.geocoding import build_geocoder

router = APIRouter()


def get_geocoder(settings: Settings = Depends(get_settings)) -> Geocoder:
    return build_geocoder(settings)


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/config")
async def public_config(settings: Settings = Depends(get_settings)) -> dict:
    """Public, non-secret configuration only. Never returns credentials."""
    return {
        "geocoder_provider": settings.geocoder_provider,
        "imagery_provider": settings.imagery_provider,
        "terrain_provider": settings.terrain_provider,
    }


@router.post(
    "/geocode",
    response_model=GeocodeResponse,
    responses={502: {"description": "Upstream geocoding provider failed"}},
)
async def geocode_location(body: GeocodeRequest, geocoder: Geocoder = Depends(get_geocoder)):
    try:
        results = await geocoder.search(body.query)
    except ProviderError as exc:
        return JSONResponse(status_code=502, content={"error": "geocoding_failed", "detail": str(exc)})
    return GeocodeResponse(results=results, provider=geocoder.name)


@router.post("/selection/metrics", response_model=MetricsResponse)
async def selection_metrics(body: MetricsRequest):
    from app.geospatial.metrics import analyze_polygon

    try:
        result = analyze_polygon(body.geometry.model_dump())
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "invalid_geometry", "detail": str(exc)})
    return MetricsResponse(
        area_m2=round(result.area_m2, 2),
        perimeter_m=round(result.perimeter_m, 2),
        centroid={"lng": result.centroid_lnglat[0], "lat": result.centroid_lnglat[1]},
        valid=result.valid,
        issue=result.issue,
        fixed=result.fixed,
    )


@router.post("/selection/validate", response_model=ValidateResponse)
async def selection_validate(body: ValidateRequest):
    from app.segmentation.validate import validate_surface

    result = await validate_surface(body.geometry.model_dump())
    return ValidateResponse(**result)


@router.post("/panel-layout", response_model=PanelLayoutResponse)
async def panel_layout(body: PanelLayoutRequest):
    from app.geospatial.panels import compute_panel_layout

    try:
        result = compute_panel_layout(
            body.geometry.model_dump(),
            panel_width_m=body.panel_width_m,
            panel_height_m=body.panel_height_m,
            wattage_w=body.wattage_w,
            row_spacing_m=body.row_spacing_m,
            setback_m=body.setback_m,
            tilt_deg=body.tilt_deg,
            azimuth_deg=body.azimuth_deg,
        )
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "invalid_geometry", "detail": str(exc)})
    return PanelLayoutResponse(**vars(result))


@router.post("/solar-analysis", response_model=SolarResponse)
async def solar_analysis(body: SolarRequest):
    from app.solar.engine import estimate_solar

    result = estimate_solar(body.latitude, body.longitude, body.capacity_kwp, body.tilts, body.azimuths)
    return SolarResponse(**vars(result))


@router.post("/surroundings", response_model=SurroundingsResponse)
async def surroundings(body: SurroundingsRequest):
    from app.geospatial.surroundings import analyze_surroundings

    result = await analyze_surroundings(body.geometry.model_dump(), radius_m=body.radius_m)
    return SurroundingsResponse(**vars(result))


@router.post("/shadow-analysis", response_model=ShadowResponse)
async def shadow_analysis(body: ShadowRequest):
    from app.geospatial.shadows import compute_shadows, fetch_building_obstacles

    obstacles = await fetch_building_obstacles(body.geometry.model_dump(), radius_m=body.radius_m)
    result = compute_shadows(body.geometry.model_dump(), body.date, body.hour_utc, obstacles)
    return ShadowResponse(**vars(result))
