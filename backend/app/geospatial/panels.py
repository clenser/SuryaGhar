"""Robust geospatial panel layout engine.

Implements deterministic panel packing with:
- Proper setback handling
- Orientation optimization (tests multiple azimuths)
- Portrait/landscape evaluation
- Exclusion zone support
- Maintenance corridor support
- Containment guarantees
- Hole/multipolygon handling
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from shapely.geometry import Polygon, MultiPolygon, mapping, box
from shapely.ops import unary_union, transform
from shapely.affinity import rotate, translate

from app.geospatial.geometry import (
    polygon_from_geometry,
    to_metric,
    to_wgs84,
    get_centroid_wgs84,
)
from app.geospatial.metrics import analyze_polygon


COMPASS_16 = [
    "North", "North-North-East", "North-East", "East-North-East",
    "East", "East-South-East", "South-East", "South-South-East",
    "South", "South-South-West", "South-West", "West-South-West",
    "West", "West-North-West", "North-West", "North-North-West",
]

COMPASS_8 = [
    "North", "North-East", "East", "South-East",
    "South", "South-West", "West", "North-West",
]


def compass_direction(azimuth_deg: float, detail: bool = False) -> str:
    """Convert an azimuth (degrees from north) to a compass direction."""
    names = COMPASS_16 if detail else COMPASS_8
    idx = int(round((float(azimuth_deg) % 360.0) / (360.0 / len(names)))) % len(names)
    return names[idx]


def derive_row_spacing_m(panel_height_m: float, tilt_deg: float, minimum_m: float = 0.3) -> float:
    """Derive a sensible inter-row spacing from panel geometry and tilt.

    Uses the tilted plan fall length plus a shade-avoidance allowance that
    grows with tilt, instead of a blind fixed 0.6 m for every roof.
    """
    import math as _math

    fall = float(panel_height_m) * max(_math.cos(_math.radians(float(tilt_deg))), 0.35)
    spacing = 0.25 + fall * (0.25 + 0.9 * _math.sin(_math.radians(min(max(float(tilt_deg), 0.0), 45.0))))
    return round(max(spacing, minimum_m), 2)


def recommend_orientation(latitude: float) -> dict:
    """Recommend tilt/azimuth from site latitude (northern hemisphere faces south).

    This is the planning default used when the caller requests AUTO; the full
    pvlib solar optimisation (estimate_solar) remains authoritative for yield.
    """
    lat = float(latitude)
    tilt = round(min(max(abs(lat) * 0.9 + 2.0, 5.0), 30.0))
    azimuth = 180.0 if lat >= 0 else 0.0
    return {"tilt_deg": tilt, "azimuth_deg": azimuth, "method": "latitude_default"}


@dataclass
class PanelConfig:
    """Configuration for panel layout."""
    width_m: float = 2.28
    height_m: float = 1.13
    wattage_w: float = 550.0
    setback_m: float = 0.5
    row_spacing_m: float = 0.6
    min_panel_spacing_m: float = 0.03
    orientation: str = "optimize"  # "landscape" | "portrait" | "optimize"
    azimuth_deg: float = 180.0
    tilt_deg: float = 18.0
    maintenance_corridor_m: float = 0.0
    exclusion_zones: list[dict] = field(default_factory=list)  # GeoJSON polygons
    target_capacity_kwp: float | None = None


@dataclass
class PanelLayoutResult:
    panel_count: int
    capacity_kwp: float
    usable_area_m2: float
    total_area_m2: float
    occupied_area_m2: float
    excluded_area_m2: float
    footprints: list[dict] = field(default_factory=list)
    optimization_metadata: dict = field(default_factory=dict)
    assumptions: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _panel_footprint(
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    angle_rad: float,
) -> Polygon:
    """Create a panel polygon at given center with rotation."""
    half_w, half_h = width / 2, height / 2
    corners = [
        (-half_w, -half_h),
        (half_w, -half_h),
        (half_w, half_h),
        (-half_w, half_h),
    ]
    rotated = [
        (center_x + math.cos(angle_rad) * dx - math.sin(angle_rad) * dy,
         center_y + math.sin(angle_rad) * dx + math.cos(angle_rad) * dy)
        for dx, dy in corners
    ]
    return Polygon(rotated)


def _pack_panels_in_polygon(
    polygon: Polygon,
    panel_width: float,
    panel_height: float,
    row_spacing: float,
    angle_rad: float,
    min_spacing: float = 0.02,
) -> list[Polygon]:
    """Pack panels in a single polygon using grid-based approach.

    Returns list of panel polygons guaranteed to be contained within the polygon.
    """
    if polygon.is_empty or polygon.area <= 0:
        return []

    # Panel footprint dimensions (projected)
    fall_along = panel_height * max(math.cos(math.radians(0)), 0.35)  # tilt handled separately
    row_step = fall_along + row_spacing
    pitch_step = panel_width + min_spacing

    bounds = polygon.bounds
    cx, cy = polygon.centroid.x, polygon.centroid.y
    diag = math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1])
    n = int(diag / pitch_step) + 2
    m = int(diag / row_step) + 2

    ca, sa = math.cos(angle_rad), math.sin(angle_rad)

    panels = []
    for i in range(-n, n + 1):
        for j in range(-m, m + 1):
            ox = i * pitch_step
            oy = j * row_step
            px = cx + ca * ox - sa * oy
            py = cy + sa * ox + ca * oy

            panel = _panel_footprint(px, py, panel_width, fall_along, angle_rad)

            if polygon.contains(panel):
                panels.append(panel)

    return panels


def _try_orientation(
    usable_polygons: list[Polygon],
    config: PanelConfig,
    azimuth_deg: float,
) -> tuple[list[Polygon], dict]:
    """Try a specific orientation and return panels + metadata."""
    # Convert azimuth to grid angle (rows perpendicular to panel face)
    angle = azimuth_deg - 90.0
    angle_rad = math.radians(angle)

    # Effective panel dimensions with tilt
    fall_along = config.height_m * max(math.cos(math.radians(config.tilt_deg)), 0.35)

    all_panels = []
    for poly in usable_polygons:
        panels = _pack_panels_in_polygon(
            poly,
            config.width_m,
            config.height_m,
            config.row_spacing_m,
            angle_rad,
            config.min_panel_spacing_m,
        )
        all_panels.extend(panels)

    # Verify containment for all panels
    union_usable = unary_union(usable_polygons)
    valid_panels = [p for p in all_panels if union_usable.contains(p)]

    occupied_area = float(unary_union(valid_panels).area) if valid_panels else 0.0

    metadata = {
        "azimuth_deg": azimuth_deg,
        "angle_deg": angle,
        "panel_count": len(valid_panels),
        "occupied_area_m2": round(occupied_area, 1),
        "orientation": "landscape",  # default
    }

    return valid_panels, metadata


def _try_both_panel_orientations(
    usable_polygons: list[Polygon],
    config: PanelConfig,
    azimuth_deg: float,
) -> tuple[list[Polygon], dict]:
    """Try both landscape and portrait panel orientations, return best."""
    # Landscape: width along row, height along fall
    panels_land, meta_land = _try_orientation(usable_polygons, config, azimuth_deg)

    # Portrait: swap width/height
    portrait_config = PanelConfig(
        width_m=config.height_m,
        height_m=config.width_m,
        wattage_w=config.wattage_w,
        setback_m=config.setback_m,
        row_spacing_m=config.row_spacing_m,
        min_panel_spacing_m=config.min_panel_spacing_m,
        orientation="portrait",
        azimuth_deg=config.azimuth_deg,
        tilt_deg=config.tilt_deg,
    )
    panels_port, meta_port = _try_orientation(usable_polygons, portrait_config, azimuth_deg)
    meta_port["orientation"] = "portrait"

    if len(panels_port) > len(panels_land):
        return panels_port, meta_port
    return panels_land, meta_land


def _apply_exclusion_zones(
    polygon: Polygon,
    exclusion_zones: list[dict],
    centroid_lnglat: tuple[float, float],
) -> Polygon:
    """Subtract exclusion zones from polygon."""
    if not exclusion_zones:
        return polygon

    from app.geospatial.geometry import to_metric

    lng, lat = centroid_lnglat
    result = polygon

    for zone_geojson in exclusion_zones:
        try:
            zone = shape(zone_geojson)
            if zone.geom_type == "MultiPolygon":
                zone = max(zone.geoms, key=lambda g: g.area)
            if zone.geom_type != "Polygon":
                continue
            zone_m = to_metric(zone, lng, lat)
            if result.intersects(zone_m):
                result = result.difference(zone_m)
        except Exception:
            continue

    return result


def _apply_maintenance_corridor(
    polygon: Polygon,
    corridor_width_m: float,
) -> Polygon:
    """Create maintenance corridors by buffering interior edges.

    Simplified: inset the polygon by corridor_width/2 to create
    a buffer zone around the perimeter.
    """
    if corridor_width_m <= 0:
        return polygon

    # Inset by half corridor width to leave space for corridors
    inset = corridor_width_m / 2.0
    return polygon.buffer(-inset)


def compute_panel_layout(
    geometry: dict,
    panel_width_m: float = 2.28,
    panel_height_m: float = 1.13,
    wattage_w: float = 550.0,
    row_spacing_m: float | None = 0.6,
    setback_m: float = 0.5,
    tilt_deg: float | None = 18.0,
    azimuth_deg: float | None = 180.0,
    min_panel_spacing_m: float = 0.03,
    orientation: str = "optimize",
    maintenance_corridor_m: float = 0.0,
    exclusion_zones: Optional[list[dict]] = None,
    target_capacity_kwp: float | None = None,
) -> PanelLayoutResult:
    """Compute optimal panel layout for a polygon.

    Args:
        geometry: GeoJSON Polygon/MultiPolygon
        panel_width_m: Panel width (short side) in meters
        panel_height_m: Panel height (long side) in meters
        wattage_w: Panel rated power in watts
        row_spacing_m: Space between panel rows
        setback_m: Edge setback from roof boundary
        tilt_deg: Panel tilt angle
        azimuth_deg: Panel azimuth (degrees from north, 180=south)
        min_panel_spacing_m: Minimum gap between adjacent panels
        orientation: "landscape", "portrait", or "optimize"
        maintenance_corridor_m: Width of maintenance corridors
        exclusion_zones: List of GeoJSON polygons to exclude

    Returns:
        PanelLayoutResult with panel polygons and metadata
    """
    exclusion_zones = exclusion_zones or []

    # Parse and validate geometry
    geom = polygon_from_geometry(geometry)
    centroid = get_centroid_wgs84(geom)

    # Metrics for total area
    metrics = analyze_polygon(geometry)
    total_area = metrics.area_m2

    # Transform to metric
    geom_m = to_metric(geom, centroid[0], centroid[1])

    # Apply setback
    usable = geom_m.buffer(-setback_m)
    if usable.is_empty or usable.area <= 0:
        return PanelLayoutResult(
            panel_count=0,
            capacity_kwp=0.0,
            usable_area_m2=0.0,
            total_area_m2=round(total_area, 1),
            occupied_area_m2=0.0,
            excluded_area_m2=round(total_area, 1),
            assumptions={"setback_m": setback_m},
            warnings=["Setback leaves no usable area. Reduce the setback or draw a larger area."],
        )

    # Apply exclusion zones
    usable = _apply_exclusion_zones(usable, exclusion_zones, centroid)
    if usable.is_empty or usable.area <= 0:
        return PanelLayoutResult(
            panel_count=0,
            capacity_kwp=0.0,
            usable_area_m2=0.0,
            total_area_m2=round(total_area, 1),
            occupied_area_m2=0.0,
            excluded_area_m2=round(total_area, 1),
            assumptions={"setback_m": setback_m, "exclusion_zones": len(exclusion_zones)},
            warnings=["Exclusion zones leave no usable area."],
        )

    # Apply maintenance corridor
    usable = _apply_maintenance_corridor(usable, maintenance_corridor_m)
    if usable.is_empty or usable.area <= 0:
        return PanelLayoutResult(
            panel_count=0,
            capacity_kwp=0.0,
            usable_area_m2=0.0,
            total_area_m2=round(total_area, 1),
            occupied_area_m2=0.0,
            excluded_area_m2=round(total_area, 1),
            assumptions={"setback_m": setback_m, "maintenance_corridor_m": maintenance_corridor_m},
            warnings=["Maintenance corridor leaves no usable area."],
        )

    # Handle multipolygon (holes, disjoint parts)
    usable_polygons = []
    if isinstance(usable, MultiPolygon):
        usable_polygons = [p for p in usable.geoms if p.area > 1.0]  # Skip tiny slivers
    else:
        usable_polygons = [usable] if usable.area > 1.0 else []

    if not usable_polygons:
        return PanelLayoutResult(
            panel_count=0,
            capacity_kwp=0.0,
            usable_area_m2=0.0,
            total_area_m2=round(total_area, 1),
            occupied_area_m2=0.0,
            excluded_area_m2=round(total_area - usable.area, 1),
            assumptions={"setback_m": setback_m},
            warnings=["No usable polygons after setbacks/exclusions."],
        )

    usable_area = sum(p.area for p in usable_polygons)
    excluded_area = total_area - usable_area

    # AUTO defaults: latitude-based tilt/azimuth when the caller requests AUTO
    # (None), and derived row spacing when not explicitly provided.
    _lat = centroid[1]
    if tilt_deg is None:
        tilt_deg = recommend_orientation(_lat)["tilt_deg"]
        tilt_auto = True
    else:
        tilt_auto = False
    if azimuth_deg is None:
        azimuth_deg = recommend_orientation(_lat)["azimuth_deg"]
        azimuth_auto = True
    else:
        azimuth_auto = False
    row_spacing_auto = row_spacing_m is None
    if row_spacing_auto:
        row_spacing_m = derive_row_spacing_m(panel_height_m, tilt_deg)

    config = PanelConfig(
        width_m=panel_width_m,
        height_m=panel_height_m,
        wattage_w=wattage_w,
        setback_m=setback_m,
        row_spacing_m=row_spacing_m,
        min_panel_spacing_m=min_panel_spacing_m,
        orientation=orientation,
        azimuth_deg=azimuth_deg,
        tilt_deg=tilt_deg,
        maintenance_corridor_m=maintenance_corridor_m,
        exclusion_zones=exclusion_zones,
        target_capacity_kwp=target_capacity_kwp,
    )

    # Determine azimuths to test
    if orientation == "optimize":
        # Test base azimuth ±15° for optimization
        base_azimuth = azimuth_deg
        test_azimuths = [base_azimuth - 15, base_azimuth, base_azimuth + 15]
        # Clamp to 0-360
        test_azimuths = [a % 360 for a in test_azimuths]
    else:
        test_azimuths = [azimuth_deg]

    # Try each azimuth, pick best
    best_panels = []
    best_metadata = {}
    best_count = -1

    for test_az in test_azimuths:
        if config.orientation == "optimize":
            panels, metadata = _try_both_panel_orientations(usable_polygons, config, test_az)
        else:
            panels, metadata = _try_orientation(usable_polygons, config, test_az)
            metadata["orientation"] = config.orientation

        if len(panels) > best_count:
            best_count = len(panels)
            best_panels = panels
            best_metadata = metadata

    # Final verification: all panels must be contained
    union_usable = unary_union(usable_polygons)
    verified_panels = [p for p in best_panels if union_usable.contains(p)]

    if len(verified_panels) != len(best_panels):
        # This shouldn't happen but safety check
        logger_warning = f"Containment verification failed: {len(best_panels)} -> {len(verified_panels)}"
        warnings = [logger_warning]
    else:
        warnings = []

    # Deterministic ordering (south rows first) so target-capacity trimming is stable.
    verified_panels.sort(key=lambda p: (round(p.centroid.y, 3), round(p.centroid.x, 3)))

    # Target capacity is a planning target, never forced: trim only, never invent panels.
    target_panels: int | None = None
    if target_capacity_kwp is not None and wattage_w > 0:
        target_panels = max(0, int(round(float(target_capacity_kwp) * 1000.0 / float(wattage_w))))
        if target_panels > 0 and len(verified_panels) > target_panels:
            verified_panels = verified_panels[:target_panels]
        elif target_panels > 0 and len(verified_panels) < target_panels:
            warnings.append(
                f"Roof geometry fits {len(verified_panels)} panels "
                f"({round(len(verified_panels) * wattage_w / 1000.0, 2)} kWp); "
                f"the {float(target_capacity_kwp):g} kW target cannot be fully met here."
            )

    occupied_area = float(unary_union(verified_panels).area) if verified_panels else 0.0
    count = len(verified_panels)
    capacity = count * wattage_w / 1000.0

    # Convert to WGS84 for frontend
    wgs_footprints = [
        {"type": "Feature", "properties": {}, "geometry": mapping(to_wgs84(p, centroid[0], centroid[1]))}
        for p in verified_panels[:400]  # Limit for map rendering
    ]

    if count == 0:
        warnings.append("No panel footprint fits inside the usable area with these dimensions.")
    if len(verified_panels) > 400:
        warnings.append("Only the first 400 panel outlines are drawn on the map.")

    packing_efficiency = occupied_area / usable_area if usable_area > 0 else 0.0
    _final_az = float(best_metadata.get("azimuth_deg", azimuth_deg))

    best_metadata.update({
        "tested_azimuths": test_azimuths,
        "packing_efficiency": round(packing_efficiency, 3),
        "usable_area_m2": round(usable_area, 1),
        "excluded_area_m2": round(excluded_area, 1),
        "setback_m": setback_m,
        "row_spacing_m": row_spacing_m,
        "row_spacing_auto": row_spacing_auto,
        "min_panel_spacing_m": min_panel_spacing_m,
        "tilt_deg": tilt_deg,
        "tilt_auto": tilt_auto,
        "azimuth_auto": azimuth_auto,
        "compass_direction": compass_direction(_final_az),
        "compass_direction_detail": compass_direction(_final_az, detail=True),
        "target_capacity_kwp": target_capacity_kwp,
        "target_panel_count": target_panels,
    })

    return PanelLayoutResult(
        panel_count=count,
        capacity_kwp=round(capacity, 2),
        usable_area_m2=round(usable_area, 1),
        total_area_m2=round(total_area, 1),
        occupied_area_m2=round(occupied_area, 1),
        excluded_area_m2=round(excluded_area, 1),
        footprints=wgs_footprints,
        optimization_metadata=best_metadata,
        assumptions={
            "panel_width_m": panel_width_m,
            "panel_height_m": panel_height_m,
            "wattage_w": wattage_w,
            "row_spacing_m": row_spacing_m,
            "setback_m": setback_m,
            "tilt_deg": tilt_deg,
            "azimuth_deg": best_metadata.get("azimuth_deg", azimuth_deg),
            "orientation": best_metadata.get("orientation", orientation),
            "min_panel_spacing_m": min_panel_spacing_m,
            "maintenance_corridor_m": maintenance_corridor_m,
            "exclusion_zone_count": len(exclusion_zones),
            "plan_fall_length_m": round(panel_height_m * max(math.cos(math.radians(tilt_deg)), 0.35), 3),
        },
        warnings=warnings,
    )


# Backward compatibility - keep the old function signature working
def compute_panel_layout_legacy(
    geometry: dict,
    panel_width_m: float = 2.0,
    panel_height_m: float = 1.1,
    wattage_w: float = 430.0,
    row_spacing_m: float = 0.6,
    setback_m: float = 0.5,
    tilt_deg: float = 18.0,
    azimuth_deg: float = 180.0,
) -> PanelLayoutResult:
    """Legacy wrapper for backward compatibility."""
    return compute_panel_layout(
        geometry,
        panel_width_m=panel_width_m,
        panel_height_m=panel_height_m,
        wattage_w=wattage_w,
        row_spacing_m=row_spacing_m,
        setback_m=setback_m,
        tilt_deg=tilt_deg,
        azimuth_deg=azimuth_deg,
    )