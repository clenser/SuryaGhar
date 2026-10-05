import httpx
import pytest

from app.providers.base import ProviderError
from app.providers.nominatim import NominatimGeocoder

BASE = "https://nominatim.test"

SAMPLE = [
    {
        "lat": "22.5726",
        "lon": "88.3639",
        "name": "Kolkata",
        "display_name": "Kolkata, West Bengal, India",
        "boundingbox": ["22.4", "22.7", "88.2", "88.5"],
        "address": {"city": "Kolkata", "state": "West Bengal", "country": "India"},
    },
    {
        "lat": "22.9",
        "lon": "88.4",
        "display_name": "Salt Lake, Kolkata, West Bengal, India",
        "address": {"suburb": "Salt Lake", "state": "West Bengal", "country": "India"},
    },
]


def make_geocoder(handler):
    return NominatimGeocoder(
        base_url=BASE,
        user_agent="test-agent/1.0",
        timeout=2.0,
        transport=httpx.MockTransport(handler),
    )


async def test_parses_results_and_sends_user_agent_and_india_filter():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json=SAMPLE)

    results = await make_geocoder(handler).search("Kolkata")

    request = captured["request"]
    assert request.headers["User-Agent"] == "test-agent/1.0"
    assert "countrycodes=in" in str(request.url)
    assert len(results) == 2
    assert results[0].name == "Kolkata"
    assert results[0].bounds is not None and results[0].bounds.north == 22.7
    assert results[1].locality == "Salt Lake"
    assert results[1].name == "Salt Lake"


async def test_timeout_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ProviderError, match="timed out"):
        await make_geocoder(handler).search("Delhi")


async def test_non_200_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    with pytest.raises(ProviderError, match="HTTP 503"):
        await make_geocoder(handler).search("Mumbai")


async def test_invalid_json_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>")

    with pytest.raises(ProviderError, match="invalid response"):
        await make_geocoder(handler).search("Bengaluru")


async def test_unexpected_payload_shape_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "nope"})

    with pytest.raises(ProviderError, match="unexpected payload"):
        await make_geocoder(handler).search("Kalna")


async def test_malformed_items_are_skipped_not_fatal():
    payload = [{"lat": "abc", "lon": "1"}, "garbage", {"lat": "12.9", "lon": "77.6", "display_name": "Bengaluru, Karnataka"}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    results = await make_geocoder(handler).search("Bengaluru")
    assert len(results) == 1
    assert results[0].name == "Bengaluru"


async def test_bad_bounding_box_is_dropped_without_failing():
    payload = [{"lat": "28.6", "lon": "77.2", "name": "Delhi", "boundingbox": ["x", "y", "z", "w"]}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    results = await make_geocoder(handler).search("Delhi")
    assert results[0].bounds is None
