"""Google Maps Geocoding API provider, India-restricted.

Uses the official Google Geocoding REST endpoint with region=in and
components=country:IN filtering, bounded in-memory caching, and structured
LocationResult parsing (including viewport/bounds for accurate map framing).
"""
from __future__ import annotations

import time
import httpx

from app.providers.base import Geocoder, ProviderError
from app.schemas.geocode import BoundingBox, LocationResult

_CACHE_TTL_S = 3600 * 24
_CACHE_MAX = 512

_SKIP_NAME_TYPES = frozenset({"plus_code", "postal_code", "postal_code_prefix", "street_number", "country"})
_LOCALITY_TYPES = (
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "administrative_area_level_2",
)


class GoogleGeocoder(Geocoder):
    name = "google"

    _cache: dict[str, tuple[float, list[LocationResult]]] = {}

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://maps.googleapis.com/maps/api/geocode/json",
        timeout: float = 6.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._api_key = (api_key or "").strip()
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._transport = transport

    def _cache_get(self, key: str) -> list[LocationResult] | None:
        entry = self._cache.get(key)
        if entry and (time.monotonic() - entry[0]) < _CACHE_TTL_S:
            return entry[1]
        return None

    def _cache_set(self, key: str, results: list[LocationResult]) -> None:
        if len(self._cache) > _CACHE_MAX:
            oldest = min(self._cache.items(), key=lambda kv: kv[1][0])[0]
            self._cache.pop(oldest, None)
        self._cache[key] = (time.monotonic(), results)

    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        if not self._api_key:
            raise ProviderError("Google Geocoding API key is not configured")

        cache_key = f"{query.strip().lower()}|{limit}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        params = {
            "address": query,
            "region": "in",
            "components": "country:IN",
            "language": "en",
            "key": self._api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(self._base_url, params=params)
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

        if not isinstance(payload, dict):
            raise ProviderError("Location search returned an unexpected payload")

        status = payload.get("status")
        if status == "ZERO_RESULTS":
            self._cache_set(cache_key, [])
            return []
        if status != "OK":
            raise ProviderError(f"Google Geocoding returned status {status or 'UNKNOWN'}")

        raw_results = payload.get("results")
        if not isinstance(raw_results, list):
            raise ProviderError("Location search returned an unexpected payload")

        results: list[LocationResult] = []
        for item in raw_results:
            parsed = self._parse(item)
            if parsed is not None:
                results.append(parsed)
                if len(results) >= limit:
                    break

        self._cache_set(cache_key, results)
        return results

    @staticmethod
    def _parse(item: dict) -> LocationResult | None:
        if not isinstance(item, dict):
            return None

        geometry = item.get("geometry")
        if not isinstance(geometry, dict):
            return None
        location = geometry.get("location")
        if not isinstance(location, dict):
            return None

        try:
            lat = float(location["lat"])
            lng = float(location["lng"])
        except (KeyError, TypeError, ValueError):
            return None

        components = item.get("address_components")
        if not isinstance(components, list):
            components = []

        state: str | None = None
        country: str | None = None
        country_code: str | None = None
        candidate_names: list[str] = []
        locality_candidates: list[str] = []

        for comp in components:
            if not isinstance(comp, dict):
                continue
            long_name = str(comp.get("long_name") or "").strip()
            short_name = str(comp.get("short_name") or "").strip()
            types = comp.get("types")
            if not long_name or not isinstance(types, list):
                continue
            type_set = {str(t) for t in types}

            if "country" in type_set:
                country = long_name
                country_code = short_name.upper() if short_name else None
            if "administrative_area_level_1" in type_set and not state:
                state = long_name
            if not (type_set <= _SKIP_NAME_TYPES):
                candidate_names.append(long_name)
            if any(t in type_set for t in _LOCALITY_TYPES):
                locality_candidates.append(long_name)

        # Keep India-only guard consistent with Nominatim/Photon providers
        if country_code and country_code != "IN":
            return None
        if not country_code and not (6.0 <= lat <= 37.5 and 67.0 <= lng <= 98.0):
            return None

        formatted = str(item.get("formatted_address") or "").strip()
        formatted_head = formatted.split(",")[0].strip() if formatted else ""
        name = candidate_names[0] if candidate_names else (formatted_head or "Unnamed place")

        locality: str | None = None
        for loc in locality_candidates:
            if loc != name and loc != state:
                locality = loc
                break
        if locality is None and locality_candidates:
            locality = locality_candidates[0]

        bounds: BoundingBox | None = None
        raw_bounds = geometry.get("bounds") or geometry.get("viewport")
        if isinstance(raw_bounds, dict):
            ne = raw_bounds.get("northeast")
            sw = raw_bounds.get("southwest")
            if isinstance(ne, dict) and isinstance(sw, dict):
                try:
                    south = float(sw["lat"])
                    north = float(ne["lat"])
                    west = float(sw["lng"])
                    east = float(ne["lng"])
                    bounds = BoundingBox(south=south, north=north, west=west, east=east)
                except (KeyError, TypeError, ValueError):
                    bounds = None

        return LocationResult(
            name=name,
            locality=locality,
            state=state,
            country=country or "India",
            latitude=lat,
            longitude=lng,
            bounds=bounds,
        )
