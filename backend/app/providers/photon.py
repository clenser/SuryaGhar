"""Photon (komoot) geocoder fallback provider.

Public endpoint, OSM-derived data. Used only when the primary geocoder fails.
India is filtered via the Photon bbox parameter. Attribution: Photon / OpenStreetMap.
"""
from __future__ import annotations

import httpx

from app.providers.base import Geocoder, ProviderError
from app.schemas.geocode import BoundingBox, LocationResult

INDIA_BBOX = "68.1,6.7,97.4,35.5"  # Photon bbox: lon_min,lat_min,lon_max,lat_max


class PhotonGeocoder(Geocoder):
    name = "photon"

    def __init__(self, base_url: str, timeout: float, transport=None):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._transport = transport

    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        params = {"q": query, "limit": min(limit, 10), "lang": "en", "bbox": INDIA_BBOX}
        headers = {"User-Agent": "SolarRooftopAnalysis/0.2 (local development)"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(f"{self._base_url}/api/", params=params, headers=headers)
        except httpx.TimeoutException as exc:
            raise ProviderError("Location search timed out") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Location search is unreachable") from exc
        if response.status_code != 200:
            raise ProviderError(f"Location search returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Location search returned an invalid response") from exc
        features = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(features, list):
            raise ProviderError("Location search returned an unexpected payload")
        results = []
        for feat in features:
            parsed = self._parse(feat)
            if parsed is not None:
                results.append(parsed)
        return results

    @staticmethod
    def _parse(feat) -> LocationResult | None:
        if not isinstance(feat, dict):
            return None
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates")
        if geom.get("type") != "Point" or not isinstance(coords, (list, tuple)) or len(coords) != 2:
            return None
        try:
            lng, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            return None
        if not (6.0 <= lat <= 37.5 and 67.0 <= lng <= 98.0):
            return None  # India-only guard
        name = props.get("name") or props.get("city") or props.get("state") or "Unnamed place"
        locality = props.get("city") or props.get("district") or props.get("locality") or props.get("state")
        return LocationResult(
            name=str(name),
            locality=str(locality) if locality else None,
            state=props.get("state"),
            country=props.get("country"),
            latitude=lat,
            longitude=lng,
            bounds=None,
        )
