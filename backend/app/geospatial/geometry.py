"""Robust geometry and CRS utilities for geospatial operations.

Centralizes all coordinate reference system handling, polygon validation,
and metric calculations to ensure consistency across the pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pyproj import CRS, Transformer
from shapely.geometry import Polygon, MultiPolygon, shape, mapping
from shapely.ops import transform, unary_union
from shapely.validation import explain_validity, make_valid


# Constants for size limits (in square meters)
MIN_POLYGON_AREA_M2 = 1.0
MAX_POLYGON_AREA_M2 = 10_000_000.0  # 10 km²


@dataclass(frozen=True)
class ValidationResult:
    """Result of polygon validation."""
    is_valid: bool
    issue: Optional[str] = None
    repaired: Optional[Polygon] = None
    was_repaired: bool = False


@dataclass(frozen=True)
class MetricGeometry:
    """Geometry with precomputed metric properties."""
    polygon: Polygon  # In metric CRS
    area_m2: float
    perimeter_m: float
    centroid_xy: tuple[float, float]  # In metric CRS
    crs: str


def get_utm_crs(lng: float, lat: float) -> CRS:
    """Get appropriate UTM CRS for a WGS84 coordinate.

    Args:
        lng: Longitude in degrees (WGS84)
        lat: Latitude in degrees (WGS84)

    Returns:
        pyproj.CRS object for the UTM zone
    """
    zone = int((lng + 180.0) // 6.0) + 1
    south = lat < 0
    epsg_code = 32700 + zone if south else 32600 + zone
    return CRS.from_epsg(epsg_code)


def get_local_projected_crs(geometry: Polygon | MultiPolygon) -> CRS:
    """Get best-fit projected CRS for a geometry.

    Uses the geometry's centroid to determine the appropriate UTM zone.

    Args:
        geometry: Shapely geometry in WGS84 (EPSG:4326)

    Returns:
        pyproj.CRS object for the local UTM zone
    """
    centroid = geometry.centroid
    return get_utm_crs(centroid.x, centroid.y)


def transform_geometry(geometry: Polygon | MultiPolygon, from_crs: CRS, to_crs: CRS) -> Polygon | MultiPolygon:
    """Transform geometry from one CRS to another.

    Args:
        geometry: Shapely geometry
        from_crs: Source CRS
        to_crs: Target CRS

    Returns:
        Transformed geometry
    """
    transformer = Transformer.from_crs(from_crs, to_crs, always_xy=True)
    return transform(transformer.transform, geometry)


def to_metric(geometry_wgs84: Polygon | MultiPolygon, lng: Optional[float] = None, lat: Optional[float] = None) -> Polygon | MultiPolygon:
    """Transform WGS84 geometry to local metric CRS (UTM).

    Args:
        geometry_wgs84: Geometry in EPSG:4326
        lng: Optional longitude for CRS selection (uses centroid if not provided)
        lat: Optional latitude for CRS selection (uses centroid if not provided)

    Returns:
        Geometry in local UTM metric CRS
    """
    if lng is None or lat is None:
        centroid = geometry_wgs84.centroid
        lng, lat = centroid.x, centroid.y
    utm_crs = get_utm_crs(lng, lat)
    return transform_geometry(geometry_wgs84, CRS.from_epsg(4326), utm_crs)


def to_wgs84(geometry_metric: Polygon | MultiPolygon, lng: float, lat: float) -> Polygon | MultiPolygon:
    """Transform metric geometry back to WGS84.

    Args:
        geometry_metric: Geometry in local UTM CRS
        lng: Longitude of centroid (for CRS determination)
        lat: Latitude of centroid (for CRS determination)

    Returns:
        Geometry in EPSG:4326
    """
    utm_crs = get_utm_crs(lng, lat)
    return transform_geometry(geometry_metric, utm_crs, CRS.from_epsg(4326))


def validate_polygon(geometry: Polygon | MultiPolygon) -> ValidationResult:
    """Validate a polygon geometry.

    Checks:
    - Valid geometry (no self-intersections, proper ring orientation)
    - Non-empty
    - Reasonable area bounds
    - Handles MultiPolygon by taking largest polygon

    Args:
        geometry: Shapely geometry (Polygon or MultiPolygon)

    Returns:
        ValidationResult with validity status and repaired geometry if applicable
    """
    # Handle MultiPolygon by taking the largest polygon
    if isinstance(geometry, MultiPolygon):
        if not geometry.geoms:
            return ValidationResult(False, "Empty MultiPolygon", None, False)
        geometry = max(geometry.geoms, key=lambda g: g.area)

    if not isinstance(geometry, Polygon):
        return ValidationResult(False, f"Expected Polygon, got {geometry.geom_type}", None, False)

    if geometry.is_empty:
        return ValidationResult(False, "Empty polygon", None, False)

    if not geometry.is_valid:
        issue = explain_validity(geometry)
        repaired = make_valid(geometry)
        if isinstance(repaired, Polygon) and repaired.area > 0:
            return ValidationResult(True, f"Repaired: {issue}", repaired, True)
        elif isinstance(repaired, MultiPolygon) and repaired.area > 0:
            largest = max(repaired.geoms, key=lambda g: g.area)
            if largest.area > 0:
                return ValidationResult(True, f"Repaired (MultiPolygon->Polygon): {issue}", largest, True)
        return ValidationResult(False, f"Invalid geometry: {issue}", None, False)

    return ValidationResult(True, None, geometry, False)


def enforce_size_limits(
    geometry: Polygon,
    min_area_m2: float = MIN_POLYGON_AREA_M2,
    max_area_m2: float = MAX_POLYGON_AREA_M2,
    lng: Optional[float] = None,
    lat: Optional[float] = None
) -> ValidationResult:
    """Enforce minimum and maximum area limits on a polygon.

    Args:
        geometry: Polygon in WGS84
        min_area_m2: Minimum allowed area in square meters
        max_area_m2: Maximum allowed area in square meters
        lng: Optional longitude for metric transformation
        lat: Optional latitude for metric transformation

    Returns:
        ValidationResult indicating if geometry passes size checks
    """
    if lng is None or lat is None:
        centroid = geometry.centroid
        lng, lat = centroid.x, centroid.y

    geom_metric = to_metric(geometry, lng, lat)
    area = geom_metric.area

    if area < min_area_m2:
        return ValidationResult(False, f"Polygon too small: {area:.1f} m² < {min_area_m2} m²", None, False)
    if area > max_area_m2:
        return ValidationResult(False, f"Polygon too large: {area:.1f} m² > {max_area_m2} m²", None, False)

    return ValidationResult(True, None, geometry, False)


def calculate_area_m2(geometry: Polygon, lng: Optional[float] = None, lat: Optional[float] = None) -> float:
    """Calculate polygon area in square meters.

    Args:
        geometry: Polygon in WGS84
        lng: Optional longitude for CRS selection
        lat: Optional latitude for CRS selection

    Returns:
        Area in square meters
    """
    if lng is None or lat is None:
        centroid = geometry.centroid
        lng, lat = centroid.x, centroid.y
    geom_m = to_metric(geometry, lng, lat)
    return float(geom_m.area)


def calculate_perimeter_m(geometry: Polygon, lng: Optional[float] = None, lat: Optional[float] = None) -> float:
    """Calculate polygon perimeter in meters.

    Args:
        geometry: Polygon in WGS84
        lng: Optional longitude for CRS selection
        lat: Optional latitude for CRS selection

    Returns:
        Perimeter in meters
    """
    if lng is None or lat is None:
        centroid = geometry.centroid
        lng, lat = centroid.x, centroid.y
    geom_m = to_metric(geometry, lng, lat)
    return float(geom_m.length)


def get_centroid_wgs84(geometry: Polygon) -> tuple[float, float]:
    """Get centroid in WGS84 coordinates.

    Args:
        geometry: Polygon in WGS84

    Returns:
        (longitude, latitude) tuple
    """
    centroid = geometry.centroid
    return (centroid.x, centroid.y)


def polygon_from_geometry(geometry: dict) -> Polygon:
    """Convert GeoJSON geometry dict to Shapely Polygon.

    Handles both Polygon and MultiPolygon (takes largest).

    Args:
        geometry: GeoJSON geometry dict

    Returns:
        Shapely Polygon

    Raises:
        ValueError: If geometry type is not Polygon or MultiPolygon
    """
    geom = shape(geometry)
    if geom.geom_type == "MultiPolygon":
        if not geom.geoms:
            raise ValueError("Empty MultiPolygon")
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon":
        raise ValueError(f"Geometry must be a Polygon or MultiPolygon, got {geom.geom_type}")
    return geom


def prepare_analysis_geometry(geometry: dict) -> tuple[Polygon, tuple[float, float], MetricGeometry]:
    """Full pipeline: parse, validate, repair, enforce limits, compute metrics.

    This is the main entry point for endpoints that need a validated,
    metric-ready geometry.

    Args:
        geometry: GeoJSON geometry dict

    Returns:
        Tuple of (validated_wgs84_polygon, centroid_lnglat, metric_geometry)

    Raises:
        ValueError: If geometry is invalid or fails size limits
    """
    geom = polygon_from_geometry(geometry)

    # Validate and repair
    validation = validate_polygon(geom)
    if not validation.is_valid:
        raise ValueError(validation.issue)
    if validation.was_repaired:
        geom = validation.repaired

    # Size limits
    centroid = geom.centroid
    size_check = enforce_size_limits(geom, lng=centroid.x, lat=centroid.y)
    if not size_check.is_valid:
        raise ValueError(size_check.issue)

    # Metric geometry
    geom_m = to_metric(geom, centroid.x, centroid.y)

    metric = MetricGeometry(
        polygon=geom_m,
        area_m2=float(geom_m.area),
        perimeter_m=float(geom_m.length),
        centroid_xy=(geom_m.centroid.x, geom_m.centroid.y),
        crs=get_utm_crs(centroid.x, centroid.y).to_epsg()
    )

    return geom, (centroid.x, centroid.y), metric


def buffer_with_metric(geometry: Polygon, distance_m: float, lng: float, lat: float) -> Polygon:
    """Buffer a WGS84 polygon by a metric distance.

    Args:
        geometry: Polygon in WGS84
        distance_m: Buffer distance in meters (negative for inset)
        lng: Longitude for CRS selection
        lat: Latitude for CRS selection

    Returns:
        Buffered polygon in WGS84
    """
    geom_m = to_metric(geometry, lng, lat)
    buffered_m = geom_m.buffer(distance_m)
    return to_wgs84(buffered_m, lng, lat)


def get_affine_transform(geometry: Polygon, image_width: int, image_height: int) -> tuple[float, ...]:
    """Compute affine transform from image pixel coordinates to WGS84.

    Used for georeferencing segmentation masks.

    Args:
        geometry: Polygon in WGS84 representing the image bounds
        image_width: Image width in pixels
        image_height: Image height in pixels

    Returns:
        Affine transform coefficients (a, b, c, d, e, f) for rasterio
        where x' = a*x + b*y + c, y' = d*x + e*y + f
    """
    from affine import Affine

    bounds = geometry.bounds  # minx, miny, maxx, maxy (WGS84)
    minx, miny, maxx, maxy = bounds

    # Pixel coordinates: (0, 0) at top-left, x right, y down
    # WGS84: x = lng, y = lat
    a = (maxx - minx) / image_width
    b = 0.0
    c = minx
    d = 0.0
    e = -(maxy - miny) / image_height  # Negative because image y increases downward
    f = maxy

    return Affine(a, b, c, d, e, f)