"""Surrounding object analysis from OSM Overpass data (documented, free)."""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


@dataclass
class SurroundingsResult:
    building_count: int
    buildings_with_height_tag: int
    median_height_m: float | None
    max_height_m: float | None
    tree_count: int
    area_m2: float
    confidence: str
    warnings: list[str] = field(default_factory=list)
    provider: str = "OpenStreetMap via Overpass API"


def _parse_height(tags: dict) -> float | None:
    raw = tags.get("height")
    if raw:
        try:
            return float(str(raw).replace("m", "").strip().split(";")[0])
        except (ValueError, IndexError):
            return None
    levels = tags.get("building:levels")
    if levels:
        try:
            return float(levels) * 3.0
        except ValueError:
            return None
    return None


async def analyze_surroundings(geometry: dict, radius_m: float = 150.0, timeout: float = 10.0) -> SurroundingsResult:
    from app.geospatial.metrics import analyze_polygon, polygon_from_geometry

    geom = polygon_from_geometry(geometry)
    metrics = analyze_polygon(geometry)
    bounds = geom.bounds  # minx, miny, maxx, maxy (WGS84)
    minx, miny, maxx, maxy = bounds
    # Rough degree offset for the radius.
    import math

    dlat = radius_m / 111320.0
    dlng = radius_m / (111320.0 * max(math.cos(math.radians(geom.centroid.y)), 0.2))
    bbox = f"{miny - dlat},{minx - dlng},{maxy + dlat},{maxx + dlng}"
    query = f"""
    [out:json][timeout:{int(timeout)}];
    (
      way["building"]({bbox});
      node["natural"="tree"]({bbox});
      way["natural"="tree_row"]({bbox});
      node["landuse"="forest"]({bbox});
    );
    out tags center;
    """.strip()
    headers = {"User-Agent": "SolarRooftopAnalysis/0.2 (local development)"}
    try:
        async with httpx.AsyncClient(timeout=timeout + 2) as client:
            response = await client.post(OVERPASS_URL, data={"data": query}, headers=headers)
        if response.status_code != 200:
            raise RuntimeError(f"Overpass returned HTTP {response.status_code}")
        payload = response.json()
    except Exception as exc:
        return SurroundingsResult(
            building_count=0,
            buildings_with_height_tag=0,
            median_height_m=None,
            max_height_m=None,
            tree_count=0,
            area_m2=round(metrics.area_m2, 1),
            confidence="unknown",
            warnings=[f"Surrounding-data provider unavailable: {exc}"],
        )

    buildings = 0
    with_height = 0
    heights = []
    trees = 0
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        if "building" in tags:
            buildings += 1
            h = _parse_height(tags)
            if h is not None:
                with_height += 1
                heights.append(h)
        if tags.get("natural") in ("tree", "tree_row") or tags.get("landuse") == "forest":
            trees += 1

    import statistics

    return SurroundingsResult(
        building_count=buildings,
        buildings_with_height_tag=with_height,
        median_height_m=round(statistics.median(heights), 1) if heights else None,
        max_height_m=round(max(heights), 1) if heights else None,
        tree_count=trees,
        area_m2=round(metrics.area_m2, 1),
        confidence="low",
        warnings=[
            "Building and tree counts come from community-mapped OpenStreetMap data; completeness varies by locality.",
            "Heights come from self-reported building tags where present; treat as approximate. Typical unset buildings are assumed low-rise elsewhere.",
            "Trees are counted but not measured; their typical heights are often only a few metres to tens of metres.",
        ],
    )
