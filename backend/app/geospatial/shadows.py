"""Geometric shadow approximation from sun position and OSM building heights.

A 2-D plan-view approximation: each building casts a rectangular-shear shadow
footprint of length height / tan(altitude) in the direction opposite the sun.
It ignores terrain and the third dimension of neighboring objects, so results
are an orientation aid, not a survey-grade simulation. The confidence notes
explain this to the user.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import httpx
import shapely

from app.geospatial.metrics import polygon_from_geometry, to_metric, to_wgs84

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


@dataclass
class ShadowResult:
    hour_shading_fraction: float
    hourly: list[dict]
    shadow_geojson: dict
    sun_altitude_deg: float
    sun_azimuth_deg: float
    confidence: str
    warnings: list[str] = field(default_factory=list)


def _sun_position(latitude: float, longitude: float, when_utc) -> tuple[float, float]:
    import pvlib

    loc = pvlib.location.Location(latitude, longitude, tz="UTC")
    sp = loc.get_solarposition([when_utc])
    return float(sp["apparent_elevation"].iloc[0]), float(sp["azimuth"].iloc[0])


async def fetch_building_obstacles(geometry: dict, radius_m: float = 120.0, timeout: float = 10.0):
    """Returns list of (footprint Polygon in WGS84, height_m)."""
    geom = polygon_from_geometry(geometry)
    minx, miny, maxx, maxy = geom.bounds
    dlat = radius_m / 111320.0
    dlng = radius_m / (111320.0 * max(math.cos(math.radians(geom.centroid.y)), 0.2))
    bbox = f"{miny - dlat},{minx - dlng},{maxy + dlat},{maxx + dlng}"
    query = f"""
    [out:json][timeout:{int(timeout)}];
    (way["building"]({bbox}););
    out geom;
    """.strip()
    try:
        async with httpx.AsyncClient(timeout=timeout + 2) as client:
            response = await client.post(OVERPASS_URL, data={"data": query}, headers={"User-Agent": "SolarRooftopAnalysis/0.2"})
        payload = response.json()
    except Exception:
        return []
    obstacles = []
    for element in payload.get("elements", []):
        nodes = element.get("geometry")
        if not nodes:
            continue
        ring = [(n["lon"], n["lat"]) for n in nodes]
        try:
            footprint = shapely.geometry.Polygon(ring)
        except Exception:
            continue
        if not footprint.is_valid or footprint.is_empty:
            continue
        raw_height = element.get("tags", {}).get("height")
        levels = element.get("tags", {}).get("building:levels")
        height = None
        if raw_height:
            try:
                height = float(str(raw_height).replace("m", "").strip().split(";")[0])
            except (ValueError, IndexError):
                height = None
        if height is None and levels:
            try:
                height = float(levels) * 3.0
            except ValueError:
                height = None
        if height is None:
            height = 6.0  # assumed low-rise
        obstacles.append((footprint, height))
    return obstacles


def compute_shadows(
    geometry: dict,
    date: str,
    hour: float,
    obstacles: list[tuple[object, float]],
) -> ShadowResult:
    import pandas as pd

    geom = polygon_from_geometry(geometry)
    centroid = geom.centroid
    geom_m = to_metric(geom, centroid.x, centroid.y)

    def shadow_fraction(when_utc) -> tuple[float, float, float, list[object]]:
        altitude, azimuth = _sun_position(centroid.y, centroid.x, when_utc)
        if altitude <= 2.0:
            return 1.0, altitude, azimuth, []  # sun below horizon; no direct generation possible
        from shapely.affinity import translate
        from shapely.ops import unary_union

        shadow_polys = []
        occupied_by_buildings = []
        for footprint, height in obstacles:
            footprint_m = to_metric(footprint, centroid.x, centroid.y)
            if footprint_m.intersects(geom_m):
                # The building itself occupies part of the selection; count it as blocked.
                occupied_by_buildings.append(footprint_m)
                continue
            length = height / math.tan(math.radians(altitude))
            dx = -length * math.sin(math.radians(azimuth))
            dy = -length * math.cos(math.radians(azimuth))
            shadow = footprint_m.union(translate(footprint_m, xoff=dx, yoff=dy))
            shadow_polys.append(shadow)
        blockers = shadow_polys + occupied_by_buildings
        if not blockers:
            return 0.0, altitude, azimuth, []
        shaded_area = float(unary_union(blockers).intersection(geom_m).area)
        return shaded_area / max(float(geom_m.area), 1e-6), altitude, azimuth, shadow_polys

    # Hour treated in UTC; the frontend passes a UTC hour converted from local.
    when = pd.Timestamp(date) + pd.Timedelta(hours=hour)
    when = when.tz_localize("UTC")
    fraction, altitude, azimuth, shadow_polys = shadow_fraction(when)

    hourly = []
    for h in range(6, 19):
        when_h = (pd.Timestamp(date) + pd.Timedelta(hours=h)).tz_localize("UTC")
        f_h, alt_h, az_h, _ = shadow_fraction(when_h)
        hourly.append({"hour_utc": h, "shaded_fraction": round(f_h, 3), "sun_altitude_deg": round(alt_h, 1), "sun_azimuth_deg": round(az_h, 1)})

    from shapely.geometry import mapping

    shadow_features = []
    for s in shadow_polys[:200]:
        try:
            shadow_features.append({"type": "Feature", "properties": {}, "geometry": mapping(to_wgs84(s, centroid.x, centroid.y))})
        except Exception:
            continue

    return ShadowResult(
        hour_shading_fraction=round(fraction, 3),
        hourly=hourly,
        shadow_geojson={"type": "FeatureCollection", "features": shadow_features},
        sun_altitude_deg=round(altitude, 1),
        sun_azimuth_deg=round(azimuth, 1),
        confidence="low",
        warnings=[
            "Plan-view approximation: neighbouring buildings cast idealised shadow polygons; terrain, wall details and tree canopies are ignored or handled with defaults.",
            "OSM building heights are self-reported where present; buildings without tags are assumed 6 m.",
            "Hours in the table are UTC for the site; add the site's local offset (India is UTC+5:30 year-round).",
        ],
    )
