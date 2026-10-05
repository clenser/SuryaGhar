"""OpenStreetMap Nominatim geocoder, India-restricted. Sends an identifying User-Agent per usage policy."""
import httpx

from app.providers.base import Geocoder, ProviderError
from app.schemas.geocode import BoundingBox, LocationResult


class NominatimGeocoder(Geocoder):
    name = "nominatim"

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

    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        params = {
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": limit,
            "countrycodes": "in",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(f"{self._base_url}/search", params=params, headers=self._headers)
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

        if not isinstance(payload, list):
            raise ProviderError("Location search returned an unexpected payload")

        results = [parsed for parsed in (self._parse(item) for item in payload) if parsed is not None]
        return results

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
