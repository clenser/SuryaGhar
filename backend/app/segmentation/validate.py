"""Surface validation pipeline: imagery crop -> segmentation -> AI vision review.

Uses the segmentation provider abstraction (SAM -> heuristic fallback)
and confidence propagation for structured uncertainty tracking.
"""
from __future__ import annotations

import base64
import io
import logging

import httpx
import numpy as np
import pyproj
from PIL import Image
from shapely.geometry import shape

from app.core.config import get_settings
from app.geospatial.geometry import prepare_analysis_geometry
from app.segmentation.providers import create_bounds_from_polygon
from app.geospatial.metrics import analyze_polygon
from app.segmentation.factory import (
    SegmentationModelUnavailableError,
    UnknownSegmentationModelError,
    display_name_for_provider,
    get_segmentation_provider,
    resolve_segmentation_model,
)
from app.segmentation.providers import Bounds
from app.vision.chain import validate_with_ai_chain
from app.confidence import (
    StageConfidence,
    aggregate_confidence,
    ConfidenceLevel,
)

logger = logging.getLogger("solar_rooftop.validation")

# Esri imagery export endpoint (documented ArcGIS REST endpoint).
EXPORT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"

# Extended class colors for visualization (includes bare_ground)
CLASS_COLORS = {
    "roof": (15, 110, 122),
    "vegetation": (46, 125, 50),
    "water": (21, 101, 192),
    "road": (117, 117, 117),
    "bare_ground": (180, 150, 100),
    "building": (15, 110, 122),
    "other": (255, 193, 7),
}


def shape_bounds(geometry: dict) -> tuple[float, float, float, float]:
    return shape(geometry).bounds


def _polygon_ring(geometry: dict) -> list[tuple[float, float]]:
    from shapely.geometry import shape as _shape

    geom = _shape(geometry)
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon":
        return []
    ring = list(geom.exterior.coords)
    if ring and ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring


async def _osm_building_evidence(geometry: dict, metric_geom) -> dict:
    """Return supporting OSM building evidence for the selection (non-fatal if unavailable)."""
    try:
        from app.geospatial.shadows import fetch_building_obstacles
        from app.geospatial.geometry import to_metric
        from shapely.geometry import shape as _shape

        # Tagged heights only: never present the assumed low-rise default as evidence.
        obstacles = await fetch_building_obstacles(geometry, assume_default_height=False)
        if not obstacles:
            return {"available": False, "overlap_fraction": None, "heights_m": []}
        selected = geom = _shape(geometry)
        selected_m = to_metric(selected, selected.centroid.x, selected.centroid.y)
        footprints = []
        heights: list[float] = []
        for footprint, height in obstacles:
            footprint_m = to_metric(footprint, selected.centroid.x, selected.centroid.y)
            if not footprint_m.intersects(selected_m):
                continue
            footprints.append(footprint_m)
            if height is not None:  # None means untagged in OSM; never assume a height here.
                heights.append(float(height))
        if not footprints:
            return {"available": True, "overlap_fraction": 0.0, "heights_m": []}
        from shapely.ops import unary_union

        overlap = float(unary_union(footprints).intersection(selected_m).area) / max(float(selected_m.area), 1e-6)
        return {
            "available": True,
            "overlap_fraction": round(min(max(overlap, 0.0), 1.0), 3),
            "buildings_overlapping": len(footprints),
            "buildings_with_tagged_height": len(heights),
            "median_height_m": round(float(sorted(heights)[len(heights) // 2]), 1) if heights else None,
            "max_height_m": round(max(heights), 1) if heights else None,
            "height_source": "osm_tag" if heights else "unavailable",
        }
    except Exception as exc:
        logger.info("OSM building evidence unavailable: %s", exc)
        return {"available": False, "overlap_fraction": None, "heights_m": []}


_WEB_MERCATOR_WORLD_M = 40075016.68557849


def _fetch_google_static_crop(
    geometry: dict,
    api_key: str,
    base_url: str,
    size: int = 512,
    timeout: float = 12.0,
) -> tuple[bytes, tuple[float, float, float, float]]:
    """Fetch satellite crop via Google Static Maps API with exact EPSG:3857/WGS84 bounds."""
    minx, miny, maxx, maxy = shape_bounds(geometry)
    dx = (maxx - minx) * 0.12
    dy = (maxy - miny) * 0.12

    tf = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    minx2, miny2 = tf.transform(minx - dx, miny - dy)
    maxx2, maxy2 = tf.transform(maxx + dx, maxy + dy)

    cx = (minx2 + maxx2) / 2.0
    cy = (miny2 + maxy2) / 2.0
    required_span_m = max(maxx2 - minx2, maxy2 - miny2, 120.0)

    # Google Static Maps max non-scaled size is 640x640; clamp logical size
    logical_size = min(max(int(size), 256), 640)

    chosen_zoom = 19
    for z in range(20, 12, -1):
        m_per_px_3857 = _WEB_MERCATOR_WORLD_M / (256.0 * (2 ** z))
        span_m = logical_size * m_per_px_3857
        if span_m >= required_span_m:
            chosen_zoom = z
            break

    m_per_px_3857 = _WEB_MERCATOR_WORLD_M / (256.0 * (2 ** chosen_zoom))
    half_span = (logical_size * m_per_px_3857) / 2.0
    crop_west, crop_south = tf.transform(cx - half_span, cy - half_span, direction="INVERSE")
    crop_east, crop_north = tf.transform(cx + half_span, cy + half_span, direction="INVERSE")
    center_lng, center_lat = tf.transform(cx, cy, direction="INVERSE")

    params = {
        "center": f"{center_lat:.7f},{center_lng:.7f}",
        "zoom": str(chosen_zoom),
        "size": f"{logical_size}x{logical_size}",
        "maptype": "satellite",
        "format": "jpg",
        "key": api_key.strip(),
    }
    with httpx.Client(timeout=timeout) as client:
        response = client.get(base_url, params=params)
    if response.status_code != 200 or "image" not in response.headers.get("content-type", ""):
        raise RuntimeError(f"Google Static Maps returned HTTP {response.status_code}")
    return response.content, (crop_west, crop_south, crop_east, crop_north)


def fetch_crop(geometry: dict, size: int = 512, timeout: float = 12.0) -> tuple[bytes, tuple[float, float, float, float]]:
    """Fetch satellite imagery crop; returns (jpeg_bytes, crop_wgs84(W,S,E,N))."""
    settings = get_settings()
    google_key = (settings.google_static_maps_api_key or "").strip()
    if google_key:
        try:
            return _fetch_google_static_crop(
                geometry=geometry,
                api_key=google_key,
                base_url=settings.google_static_maps_base_url,
                size=size,
                timeout=timeout,
            )
        except Exception as exc:
            logger.warning("Google Static Maps crop failed (%s); falling back to Esri export", exc)

    minx, miny, maxx, maxy = shape_bounds(geometry)
    dx = (maxx - minx) * 0.08
    dy = (maxy - miny) * 0.08

    tf = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    minx2, miny2 = tf.transform(minx - dx, miny - dy)
    maxx2, maxy2 = tf.transform(maxx + dx, maxy + dy)

    # The Esri export endpoint rejects very small extents; guarantee a minimum ~160 m across.
    min_span_m = 160.0
    if (maxx2 - minx2) < min_span_m:
        mid = (maxx2 + minx2) / 2
        minx2, maxx2 = mid - min_span_m / 2, mid + min_span_m / 2
    if (maxy2 - miny2) < min_span_m:
        mid = (maxy2 + miny2) / 2
        miny2, maxy2 = mid - min_span_m / 2, mid + min_span_m / 2
    # Inverse-project the padded 3857 bbox to WGS84 so the vision image can be
    # annotated with the selected polygon in pixel coordinates.
    crop_west, crop_south = tf.transform(minx2, miny2, direction="INVERSE")
    crop_east, crop_north = tf.transform(maxx2, maxy2, direction="INVERSE")
    crop_wgs84 = (crop_west, crop_south, crop_east, crop_north)

    bbox = f"{minx2},{miny2},{maxx2},{maxy2}"
    params = {
        "bbox": bbox,
        "bboxSR": "3857",
        "imageSR": "3857",
        "size": f"{size},{size}",
        "format": "jpg",
        "f": "image",
    }
    with httpx.Client(timeout=timeout) as client:
        response = client.get(EXPORT_URL, params=params)
    if response.status_code != 200 or "image" not in response.headers.get("content-type", ""):
        raise RuntimeError("Imagery crop could not be retrieved")
    return response.content, crop_wgs84


def _overlay(image_rgb: np.ndarray, mask: np.ndarray, classes: list[str], alpha: float = 0.42) -> np.ndarray:
    """Create colored overlay for visualization."""
    overlay = image_rgb.copy().astype(np.float32)
    tint = np.zeros_like(overlay)
    for idx, name in enumerate(classes):
        color = CLASS_COLORS.get(name, (128, 128, 128))
        tint[mask == idx] = color
    blended = overlay * (1 - alpha) + tint * alpha
    return blended.astype(np.uint8)


def _png_b64(image_rgb: np.ndarray) -> str:
    buffer = io.BytesIO()
    Image.fromarray(image_rgb).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _overlay_mask_only(mask: np.ndarray, classes: list[str]) -> np.ndarray:
    color = np.zeros((*mask.shape, 3), dtype=np.uint8)
    for idx, name in enumerate(classes):
        color[mask == idx] = CLASS_COLORS.get(name, (128, 128, 128))
    return color


def _polygon_building_fraction(seg_result, polygon_px: list, width: int, height: int) -> float:
    """Share of building-mask pixels inside the selected polygon.

    Falls back to the crop-wide class fraction only when the polygon cannot be
    rasterized (too few points) or the mask has no building-like class.
    """
    classes = list(seg_result.classes or [])
    target_idx = None
    for name in ("building", "roof"):
        if name in classes:
            target_idx = classes.index(name)
            break
    if target_idx is None or len(polygon_px) < 3 or width <= 0 or height <= 0:
        fractions = seg_result.class_fractions or {}
        return float(fractions.get("building", fractions.get("roof", 0.0)))
    try:
        from PIL import Image as _Image
        from PIL import ImageDraw as _ImageDraw

        raster = _Image.new("L", (width, height), 0)
        _ImageDraw.Draw(raster).polygon([(float(x), float(y)) for x, y in polygon_px], fill=1)
        inside = np.asarray(raster, dtype=bool)
        if not inside.any():
            return 0.0
        return float(np.mean(np.asarray(seg_result.mask)[inside] == target_idx))
    except Exception:
        fractions = seg_result.class_fractions or {}
        return float(fractions.get("building", fractions.get("roof", 0.0)))


def _polygon_bbox_px(
    geometry: dict,
    crop_wgs84: tuple[float, float, float, float],
    width: int,
    height: int,
) -> tuple[float, float, float, float] | None:
    """Selected-polygon bounding box in crop pixel coordinates (for box prompts)."""
    west, south, east, north = crop_wgs84
    xs: list[float] = []
    ys: list[float] = []
    for lng, lat in _polygon_ring(geometry):
        xs.append((lng - west) / max(east - west, 1e-12) * (width - 1))
        ys.append((north - lat) / max(north - south, 1e-12) * (height - 1))
    if len(xs) < 3:
        return None
    return (max(min(xs), 0.0), max(min(ys), 0.0), min(max(xs), float(width)), min(max(ys), float(height)))


async def validate_surface(geometry: dict, segmentation_model: str | None = None) -> dict:
    """Returns the structured validation payload for the API and UI.

    Pipeline:
    1. Validate and repair geometry
    2. Fetch satellite imagery crop
    3. Run segmentation (explicit model choice, else configured default) as supporting evidence
    4. Run AI semantic validation (Groq -> Gemini -> unavailable)
    5. Aggregate supporting confidence and return structured result with metadata

    The final classification and confidence come only from AI semantic
    validation. Segmentation, OSM and pixel heuristics are supporting evidence.

    An explicit segmentation_model is never silently replaced: unknown ids and
    unavailable/failed models raise instead of falling back.
    """
    settings = get_settings()
    warnings: list[str] = []
    logger.info("validate: polygon received, validating geometry")

    # Fail fast on the explicit model choice: unknown ids raise before any
    # geometry/imagery work, and unavailable models never silently fall back.
    explicit_model = segmentation_model is not None
    selected_provider = None
    if explicit_model:
        selected_provider = resolve_segmentation_model(segmentation_model, settings)

    # Stage 1: Geometry validation
    try:
        validated_geom, centroid_lnglat, metric_geom = prepare_analysis_geometry(geometry)
    except ValueError as exc:
        return {
            "classification": "unknown",
            "confidence": 0.0,
            "coverage": 0.0,
            "components": {},
            "warnings": [f"Selection is not a usable polygon: {exc}"],
            "metrics": {"area_m2": 0.0, "perimeter_m": 0.0},
            "confidence_detail": {
                "overall_level": "low",
                "overall_score": 0.0,
                "stages": [],
                "limitations": [str(exc)],
            },
        }

    geom_confidence = StageConfidence.from_geometry(
        valid=True,
        repaired=metric_geom.polygon is not None,  # Always true if we get here
        area_m2=metric_geom.area_m2,
    )

    logger.info("validate: geometry OK, area=%.1fm2; fetching satellite crop", metric_geom.area_m2)
    # Stage 2: Fetch imagery
    try:
        crop_bytes, crop_wgs84 = fetch_crop(geometry)
    except Exception as exc:
        logger.warning(f"Imagery fetch failed: {exc}")
        return {
            "classification": "unknown",
            "confidence": 0.0,
            "coverage": 0.0,
            "components": {},
            "warnings": [f"Imagery crop could not be retrieved: {exc}"],
            "metrics": {
                "area_m2": round(metric_geom.area_m2, 1),
                "perimeter_m": round(metric_geom.perimeter_m, 1),
                "centroid": {"lng": centroid_lnglat[0], "lat": centroid_lnglat[1]},
            },
            "confidence_detail": {
                "overall_level": "low",
                "overall_score": 0.0,
                "stages": [geom_confidence.to_dict()],
                "limitations": [f"Imagery unavailable: {exc}"],
            },
        }

    image = np.asarray(Image.open(io.BytesIO(crop_bytes)).convert("RGB"))
    h, w = image.shape[:2]
    logger.info("validate: crop fetched %dx%d; osm evidence", w, h)

    # OSM supporting evidence: does the selected polygon overlap an OSM building?
    osm_evidence = await _osm_building_evidence(geometry, metric_geom)

    # Stage 3: Segmentation (explicit per-request model or configured default).
    # Blocking inference (notably CPU SAM2) runs in a worker thread so slow
    # validations never freeze /geocode, /health, or other endpoints.
    import time as _time

    from starlette.concurrency import run_in_threadpool

    provider = selected_provider if selected_provider is not None else get_segmentation_provider(settings)
    logger.info("validate: running segmentation provider=%s", provider.name)
    bounds = create_bounds_from_polygon(validated_geom)

    prompt_box = None
    if getattr(provider, "accepts_prompt_box", False):
        prompt_box = _polygon_bbox_px(geometry, crop_wgs84, w, h)

    # Actual model-analysis time (monotonic): inference only, excluding
    # imagery fetch, vision review, and response rendering.
    _seg_start = _time.perf_counter()
    try:
        if prompt_box is not None:
            seg_result = await run_in_threadpool(provider.segment, image, bounds, prompt_box=prompt_box)
        else:
            seg_result = await run_in_threadpool(provider.segment, image, bounds)
    except (UnknownSegmentationModelError, SegmentationModelUnavailableError):
        raise
    except Exception as exc:
        if explicit_model:
            raise SegmentationModelUnavailableError(
                f"Selected segmentation model failed: {exc}"
            ) from exc
        logger.warning(f"Segmentation failed: {exc}, using heuristic fallback")
        from app.segmentation.heuristic import HeuristicSegmentationProvider
        fallback_provider = HeuristicSegmentationProvider()
        provider = fallback_provider
        seg_result = await run_in_threadpool(fallback_provider.segment, image, bounds)
    inference_time_seconds = round(_time.perf_counter() - _seg_start, 2)
    logger.info(
        "validate: segmentation done provider=%s inference_time_seconds=%.2f",
        provider.name,
        inference_time_seconds,
    )

    overlay = _overlay(image, seg_result.mask, seg_result.classes)
    mask_only = _overlay_mask_only(seg_result.mask, seg_result.classes)

    # Annotate the selected polygon on a copy of the crop for vision review.
    from PIL import ImageDraw

    annotated = Image.open(io.BytesIO(crop_bytes)).convert("RGB")
    draw = ImageDraw.Draw(annotated)
    west, south, east, north = crop_wgs84
    pts = []
    for lng, lat in _polygon_ring(geometry):
        px = (lng - west) / max(east - west, 1e-12) * (w - 1)
        py = (north - lat) / max(north - south, 1e-12) * (h - 1)
        pts.append((px, py))
    if len(pts) >= 3:
        draw.polygon(pts, outline=(255, 214, 0), width=4)
        for px, py in pts:
            draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=(255, 214, 0))
    ann_buf = io.BytesIO()
    annotated.save(ann_buf, format="JPEG", quality=90)
    annotated_jpeg = ann_buf.getvalue()

    # Stage 4: AI semantic validation
    polygon_summary = (
        f"Selected area ≈ {metric_geom.area_m2:.0f} m², centroid {centroid_lnglat[1]:.5f}, {centroid_lnglat[0]:.5f}. "
        "The selected polygon is outlined in bright yellow on the image; judge what lies inside it, "
        "using surrounding context (roads, vegetation, nearby buildings) for interpretation."
    )
    logger.info("validate: segmentation done (provider=%s); calling vision chain", seg_result.provider)
    ai_result, ai_provider = await validate_with_ai_chain(annotated_jpeg, polygon_summary, settings)

    ai_class_map = {
        "rooftop": "roof",
        "open_ground": "usable_ground",
        "vegetation": "vegetation",
        "road": "road",
        "water": "water",
        "other_uncertain": "unknown",
    }

    vision_fallback = False
    vision_confidence = 0.5
    reasoning = ""

    if ai_result is not None:
        primary = str(ai_result.get("primary_class", "other_uncertain")).lower()
        classification = ai_class_map.get(primary, "unknown")
        try:
            vision_confidence = round(min(max(float(ai_result.get("confidence", 0.5)), 0.0), 1.0), 2)
        except (ValueError, TypeError):
            vision_confidence = 0.5
        fractions = ai_result.get("class_fractions")
        if isinstance(fractions, dict):
            try:
                coverage = float(fractions.get("rooftop", 0) or 0) + float(fractions.get("open_ground", 0) or 0)
            except (ValueError, TypeError):
                coverage = 0.0
        else:
            coverage = 0.0  # never derive semantic coverage from heuristic pixels
        reasoning = ai_result.get("reason", "")
        if reasoning:
            warnings.append(reasoning)
        vision_label = "groq" if ai_provider == "groq" else "gemini_fallback"
        vision_model = ai_result.get("model")
    else:
        # Both semantic providers failed. Do NOT fabricate a semantic classification
        # from the heuristic pixel fallback; report it as unavailable instead.
        classification = "unknown"
        vision_confidence = 0.0
        coverage = 0.0
        warnings.append(
            "Semantic surface validation could not be completed (Groq and Gemini unavailable). "
            "No surface classification has been made."
        )
        vision_label = "unavailable"
        vision_model = None
        vision_fallback = True
        warnings.append("Heuristic pixel analysis is available under Technical diagnostics only.")

    # Stage 4 confidence
    vision_confidence_obj = StageConfidence.from_vision(
        provider=vision_label,
        model=vision_model or "unknown",
        confidence=vision_confidence,
        fallback=vision_fallback,
        reasoning=reasoning,
    )

    # Segmentation confidence
    seg_confidence_obj = StageConfidence.from_segmentation(
        provider=seg_result.provider,
        model=seg_result.model,
        confidence=seg_result.confidence,
        fallback=(seg_result.provider == "heuristic"),
        limitations=seg_result.limitations,
    )

    # Additional warnings
    if metric_geom.area_m2 < 20:
        warnings.append("Selected area is very small; resolution is marginal for small polygons.")
    if vision_fallback:
        warnings.append(
            "Pixel-heuristic estimates below are diagnostics only and do not classify the surface."
        )
        if seg_result.class_fractions.get("vegetation", 0.0) > 0.15:
            warnings.append(f"Heuristic estimate: roughly {seg_result.class_fractions['vegetation'] * 100:.0f}% of the area resembles vegetation.")
        if seg_result.class_fractions.get("water", 0.0) > 0.1:
            warnings.append(f"Heuristic estimate: roughly {seg_result.class_fractions['water'] * 100:.0f}% resembles water.")
        if seg_result.class_fractions.get("road", 0.0) > 0.25:
            warnings.append(f"Heuristic estimate: roughly {seg_result.class_fractions['road'] * 100:.0f}% resembles a hard grey surface.")

    # Supporting-evidence confidence (geometry + segmentation) is still reported for
    # transparency, but it must NOT determine the semantic result.
    all_stages = [geom_confidence, seg_confidence_obj, vision_confidence_obj]
    aggregated = aggregate_confidence(all_stages)
    logger.info("validate: vision done provider=%s; building response", vision_label)

    # HOTOSM / OSM / pixel heuristics are supporting evidence only.
    # Building evidence is the share of building-mask pixels *inside the selected
    # polygon* (predicted_building_pixels_inside_polygon / polygon_pixels), not a
    # crop-wide fraction and never inflated by vision/OSM/confidence signals.
    hotosm_building = _polygon_building_fraction(seg_result, pts, w, h)
    osm_overlap = osm_evidence.get("overlap_fraction")
    supporting = {
        "hotosm_building_fraction": round(float(hotosm_building), 3),
        "osm_overlap_fraction": osm_overlap,
        "geometry_confidence": round(float(geom_confidence.confidence), 2),
        "segmentation_confidence": round(float(seg_confidence_obj.confidence), 2),
    }
    if (osm_overlap or 0) >= 0.5 and hotosm_building >= 0.3:
        supporting["note"] = "OSM footprint and building pixels agree with a roof-like selection."

    # Final classification and confidence come only from AI semantic validation.
    semantic_available = bool(ai_result)
    if semantic_available:
        final_confidence = round(min(max(float(vision_confidence), 0.0), 1.0), 2)
        if not supporting.get("note") and hotosm_building >= 0.3:
            supporting["note"] = "Building pixels support, but do not determine, the AI classification."
    else:
        final_confidence = 0.0

    evidence = {
        "semantic_available": semantic_available,
        "hotosm_building_fraction": round(float(hotosm_building), 3),
        "osm": osm_evidence,
        "supporting": supporting,
        "vision": {
            "classification": classification,
            "confidence": vision_confidence,
            "provider": vision_label,
            "model": vision_model,
            "reason": reasoning or None,
        },
    }

    # Build response
    return {
        "classification": classification,
        "confidence": round(final_confidence, 2),
        "confidence_detail": aggregated.to_dict(),  # New structured confidence
        "legacy_confidence": round(final_confidence, 2),  # Backward compat
        "coverage": round(min(max(float(coverage), 0.0), 1.0), 2),
        "components": {k: round(v, 3) for k, v in seg_result.class_fractions.items()},
        "metrics": {
            "area_m2": round(metric_geom.area_m2, 1),
            "perimeter_m": round(metric_geom.perimeter_m, 1),
            "centroid": {"lng": centroid_lnglat[0], "lat": centroid_lnglat[1]},
        },
        "images": {
            "original": _png_b64(image),
            "overlay": _png_b64(overlay),
            "mask": _png_b64(mask_only),
        },
        "warnings": warnings,
        "limitations": aggregated.limitations,
        "evidence": evidence,
        "providers": {
            "imagery": "Google Static Maps" if (settings.google_static_maps_api_key or "").strip() else "Esri World Imagery (prototype)",
            "segmentation": seg_result.provider,
            "segmentation_model": seg_result.model,
            "vision": vision_label,
        },
        "segmentation": {
            "model": seg_result.provider,
            "display_name": display_name_for_provider(seg_result.provider),
            "inference_time_seconds": inference_time_seconds,
            "device": getattr(provider, "current_device", "cpu"),
        },
        "ai": {
            "provider": ai_result.get("provider") if ai_result else None,
            "model": ai_result.get("model") if ai_result else None,
            "primary_class": ai_result.get("primary_class") if ai_result else None,
            "is_suitable_for_solar": ai_result.get("is_suitable_for_solar") if ai_result else None,
        } if ai_result is not None else None,
    }
