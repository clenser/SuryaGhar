"""WGS84 polygon metric calculations via a UTM projection (never degrees-as-metres).

Refactored to use the centralized geometry module for consistency.
"""
from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import shape
from shapely.validation import explain_validity, make_valid

from app.geospatial.geometry import (
    get_centroid_wgs84,
    calculate_area_m2,
    calculate_perimeter_m,
    polygon_from_geometry,
    validate_polygon,
    to_metric,
    to_wgs84,
)


@dataclass
class Metrics:
    area_m2: float
    perimeter_m: float
    centroid_lnglat: tuple[float, float]
    valid: bool
    issue: str | None
    fixed: bool


def analyze_polygon(geometry: dict) -> Metrics:
    """Returns metric area/perimeter/centroid plus a validity verdict.

    Uses the centralized geometry validation and metric calculation.
    """
    geom = polygon_from_geometry(geometry)

    validation = validate_polygon(geom)
    if not validation.is_valid:
        return Metrics(
            0.0, 0.0,
            get_centroid_wgs84(geom) if not geom.is_empty else (0.0, 0.0),
            False,
            validation.issue,
            False,
        )

    geom = validation.repaired if validation.was_repaired else geom
    centroid = get_centroid_wgs84(geom)

    area_m2 = calculate_area_m2(geom, centroid[0], centroid[1])
    perimeter_m = calculate_perimeter_m(geom, centroid[0], centroid[1])

    if area_m2 <= 0:
        return Metrics(0.0, 0.0, centroid, False, "Degenerate polygon", validation.was_repaired)

    return Metrics(
        area_m2=area_m2,
        perimeter_m=perimeter_m,
        centroid_lnglat=centroid,
        valid=True,
        issue="Geometry was repaired (self-intersection or ring closure)" if validation.was_repaired else None,
        fixed=validation.was_repaired,
    )


# Re-export for backward compatibility
__all__ = [
    "Metrics",
    "analyze_polygon",
    "polygon_from_geometry",
    "to_metric",
    "to_wgs84",
]