"""OpenStreetMap Nominatim geocoder, India-restricted. Sends an identifying User-Agent per usage policy.

Production considerations implemented here, not in route handlers:
- Server-side cache of successful results (bounded, short TTL).
- A shared asyncio lock throttling outbound requests to >=1s apart.
- Bounded exponential backoff with Retry-After respect on HTTP 429.
"""
import asyncio
import time

import httpx

from app.providers.base import Geocoder, ProviderError
from app.schemas.geocode import BoundingBox, LocationResult

_REQUEST_INTERVAL_S = 1.1  # Nominatim usage policy: at most 1 request/second
_CACHE_TTL_S = 3600 * 24  # successful lookups are stable; cache for a day
_CACHE_MAX = 512


class NominatimGeocoder(Geocoder):
    name = "nominatim"

    _last_request_at: float = 0.0
    _rate_lock: asyncio.Lock = asyncio.Lock()
    _cache: dict[str, tuple[float, list[LocationResult]]] = {}

    def __init__(
        self,
        base_url: str,
        user_agent: str,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._headers = {"User-Agent": user_agent, "Accept-Language": "en"}
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

    async def _throttle(self) -> None:
        async with self._rate_lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < _REQUEST_INTERVAL_S:
                await asyncio.sleep(_REQUEST_INTERVAL_S - elapsed)
            self._last_request_at = time.monotonic()

    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        cache_key = f"{query.strip().lower()}|{limit}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        params = {
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": limit,
            "countrycodes": "in",
        }

        attempts = 0
        max_attempts = 3
        while True:
            attempts += 1
            try:
                async with self._rate_lock:
                    now = time.monotonic()
                    if now - self._last_request_at < _REQUEST_INTERVAL_S:
                        await asyncio.sleep(_REQUEST_INTERVAL_S - (now - self._last_request_at))
                    self._last_request_at = time.monotonic()
                    async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                        response = await client.get(f"{self._base_url}/search", params=params, headers=self._headers)
            except httpx.TimeoutException as exc:
                raise ProviderError("Location search timed out") from exc
            except httpx.HTTPError as exc:
                raise ProviderError("Location search is unreachable") from exc

            if response.status_code == 429 and attempts < max_attempts:
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else min(2.0 ** attempts, 8.0)
                except ValueError:
                    delay = min(2.0 ** attempts, 8.0)
                await asyncio.sleep(delay)
                continue

            if response.status_code != 200:
                raise ProviderError(f"Location search returned HTTP {response.status_code}")
            break

        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Location search returned an invalid response") from exc

        try:
            results = self._parse_payload(payload)
        except ValueError as exc:
            raise ProviderError(str(exc)) from exc
        self._cache_set(cache_key, results)
        return results

    def _parse_payload(self, payload) -> list[LocationResult]:
        if not isinstance(payload, list):
            raise ValueError("Location search returned an unexpected payload")
        return [parsed for parsed in (self._parse(item) for item in payload) if parsed is not None]

    @staticmethod
    def _parse(item: dict) -> LocationResult | None:
        if not isinstance(item, dict):
            return None
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            return None

        address = item.get("address") or {}
        locality = (
            address.get("suburb")
            or address.get("neighbourhood")
            or address.get("city_district")
            or address.get("town")
            or address.get("village")
            or address.get("city")
        )
        display = item.get("display_name") or ""
        name = item.get("name") or display.split(",")[0].strip() or "Unnamed place"

        bounds = None
        raw_bbox = item.get("boundingbox")
        if isinstance(raw_bbox, list) and len(raw_bbox) == 4:
            try:
                south, north, west, east = (float(v) for v in raw_bbox)
                bounds = BoundingBox(south=south, north=north, west=west, east=east)
            except (TypeError, ValueError):
                bounds = None

        return LocationResult(
            name=name,
            locality=locality,
            state=address.get("state"),
            country=address.get("country"),
            latitude=lat,
            longitude=lon,
            bounds=bounds,
        )
