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
from app.segmentation.factory import get_segmentation_provider_name
from app.services.geocoding import build_geocoder

router = APIRouter()


def get_geocoder(settings: Settings = Depends(get_settings)) -> Geocoder:
    return build_geocoder(settings)


@router.get("/health")
async def health() -> dict:
    segmentation = get_segmentation_provider_name(get_settings())
    import os
    from pathlib import Path

    settings = get_settings()
    candidates = [settings.segmentation_model_path, os.environ.get("SEGMENTATION_MODEL_PATH")]
    backend_dir = Path(__file__).resolve().parents[2]
    candidates += [str(backend_dir / c) for c in candidates if c and not Path(c).is_absolute()]
    model_present = any(bool(c and Path(c).exists()) for c in candidates)
    return {"status": "ok", "segmentation_provider": segmentation, "model_present": model_present}


@router.get("/config")
async def public_config(settings: Settings = Depends(get_settings)) -> dict:
    """Public, non-secret configuration only. Never returns credentials."""
    from app.segmentation.factory import segmentation_model_status

    return {
        "geocoder_provider": settings.geocoder_provider,
        "imagery_provider": settings.imagery_provider,
        "terrain_provider": settings.terrain_provider,
        "available_segmentation_models": segmentation_model_status(settings),
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


@router.post(
    "/selection/validate",
    response_model=ValidateResponse,
    responses={
        400: {"description": "Unknown segmentation_model identifier"},
        422: {"description": "Selected segmentation model unavailable"},
    },
)
async def selection_validate(body: ValidateRequest):
    from app.segmentation.factory import (
        SegmentationModelUnavailableError,
        UnknownSegmentationModelError,
    )
    from app.segmentation.validate import validate_surface

    try:
        result = await validate_surface(
            body.geometry.model_dump(), segmentation_model=body.segmentation_model
        )
    except UnknownSegmentationModelError as exc:
        return JSONResponse(status_code=400, content={"error": "unknown_segmentation_model", "detail": str(exc)})
    except SegmentationModelUnavailableError as exc:
        return JSONResponse(status_code=422, content={"error": "segmentation_model_unavailable", "detail": str(exc)})
    return ValidateResponse(**result)


@router.post("/panel-layout", response_model=PanelLayoutResponse)
async def panel_layout(body: PanelLayoutRequest):
    from app.geospatial.panels import compute_panel_layout, compass_direction
    from app.solar.engine import estimate_solar

    try:
        geometry = body.geometry.model_dump()
        # Resolve AUTO orientation from the solar engine when the caller did not
        # provide explicit tilt/azimuth. estimate_solar is authoritative for the
        # recommended angles; the latitude default inside compute_panel_layout
        # is only the fallback when solar data is unavailable.
        tilt = body.tilt_deg
        azimuth = body.azimuth_deg
        optimization_method = "manual"
        solar_payload: dict | None = None
        if tilt is None or azimuth is None:
            try:
                from app.geospatial.metrics import analyze_polygon

                metrics = analyze_polygon(geometry)
                lng, lat = metrics.centroid_lnglat
                # Probe with 1 kWp; selected angles do not depend on capacity.
                probe = estimate_solar(lat, lng, 1.0)
                if probe.selected.get("tilt_deg") is not None:
                    if tilt is None:
                        tilt = float(probe.selected["tilt_deg"])
                    if azimuth is None:
                        azimuth = float(probe.selected.get("azimuth_deg", 180.0))
                    optimization_method = (
                        "pvlib_pvgis" if probe.confidence == "medium" else "benchmark_latitude"
                    )
                else:
                    optimization_method = "latitude_default"
            except Exception:
                optimization_method = "latitude_default"
        result = compute_panel_layout(
            geometry,
            panel_width_m=body.panel_width_m,
            panel_height_m=body.panel_height_m,
            wattage_w=body.wattage_w,
            row_spacing_m=body.row_spacing_m,
            setback_m=body.setback_m,
            tilt_deg=tilt if tilt is not None else 18.0,
            azimuth_deg=azimuth if azimuth is not None else 180.0,
            target_capacity_kwp=body.target_capacity_kwp,
        )
        final_tilt = float(result.assumptions.get("tilt_deg", tilt or 18.0))
        final_az = float(result.assumptions.get("azimuth_deg", azimuth or 180.0))
        result.optimization_metadata = {
            **(result.optimization_metadata or {}),
            "optimization_method": optimization_method,
        }
        # Yield estimate for the realised capacity (not the probe).
        try:
            from app.geospatial.metrics import analyze_polygon as _metrics

            _m = _metrics(geometry)
            _lng, _lat = _m.centroid_lnglat
            if result.capacity_kwp > 0:
                est = estimate_solar(
                    _lat, _lng, result.capacity_kwp,
                    tilts=[final_tilt], azimuths=[final_az],
                )
                solar_payload = {
                    "annual_generation_kwh": est.annual_kwh,
                    "specific_yield_kwh_kwp": est.specific_yield_kwh_kwp,
                    "optimization_method": optimization_method,
                    "resource_provider": est.resource_provider,
                    "confidence": est.confidence,
                }
        except Exception:
            solar_payload = None
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "invalid_geometry", "detail": str(exc)})
    payload = vars(result)
    payload["panel"] = {
        "width_m": body.panel_width_m,
        "height_m": body.panel_height_m,
        "wattage_w": body.wattage_w,
    }
    payload["layout"] = {
        "panel_count": result.panel_count,
        "installed_capacity_kwp": result.capacity_kwp,
        "panels": result.footprints,
        "usable_area_m2": result.usable_area_m2,
        "occupied_area_m2": result.occupied_area_m2,
    }
    payload["orientation"] = {
        "tilt_deg": final_tilt,
        "azimuth_deg": final_az,
        "compass_direction": compass_direction(final_az),
    }
    payload["solar"] = solar_payload
    return PanelLayoutResponse(**payload)


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
