import httpx
import pytest

from app.providers.base import ProviderError
from app.providers.nominatim import NominatimGeocoder
from app.providers.photon import PhotonGeocoder
from app.services.geocoding import FallbackGeocoder

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


PHOTON_PAYLOAD = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [88.3639, 22.5726]},
            "properties": {"name": "Kolkata", "city": "Kolkata", "state": "West Bengal", "country": "India"},
        },
        {  # Outside the India bbox guard: must be dropped.
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [2.3522, 48.8566]},
            "properties": {"name": "Paris"},
        },
        {  # Malformed geometry: must be skipped without failing.
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[88.3, 22.5], [88.4, 22.6]]},
            "properties": {"name": "line"},
        },
    ],
}


def make_photon(handler):
    return PhotonGeocoder(base_url="https://photon.test", timeout=2.0, transport=httpx.MockTransport(handler))


async def test_photon_parses_features_and_applies_india_bbox():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json=PHOTON_PAYLOAD)

    results = await make_photon(handler).search("Kolkata")

    assert "bbox=68.1%2C6.7%2C97.4%2C35.5" in str(captured["request"].url)
    assert len(results) == 1
    assert results[0].name == "Kolkata"
    assert results[0].locality == "Kolkata"
    assert results[0].state == "West Bengal"


async def test_photon_failure_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    with pytest.raises(ProviderError, match="HTTP 429"):
        await make_photon(handler).search("Delhi")


async def test_fallback_uses_secondary_only_after_primary_failure():
    calls = []

    def primary(request: httpx.Request) -> httpx.Response:
        calls.append("primary")
        return httpx.Response(200, json=SAMPLE)

    def secondary(request: httpx.Request) -> httpx.Response:
        calls.append("secondary")
        return httpx.Response(200, json=PHOTON_PAYLOAD)

    geocoder = FallbackGeocoder(
        make_geocoder(primary),
        make_photon(secondary),
    )
    results = await geocoder.search("Siliguri")
    assert calls == ["primary"]
    assert results[0].name == "Kolkata"

    def failing(request: httpx.Request) -> httpx.Response:
        calls.append("primary")
        return httpx.Response(429)

    # A distinct query avoids the Nominatim 24h cache, so the primary is really called.
    # The primary retries on 429 before the secondary is used.
    calls.clear()
    geocoder = FallbackGeocoder(make_geocoder(failing), make_photon(secondary))
    results = await geocoder.search("Kalna")
    assert calls[-1] == "secondary"
    assert calls.count("primary") >= 1
    assert calls.index("secondary") > calls.index("primary")
    assert results[0].name == "Kolkata"


async def test_photon_results_carry_no_bounds():
    """Photon does not return a bounding box; the schema must stay optional."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=PHOTON_PAYLOAD)

    results = await make_photon(handler).search("Kolkata")
    assert results[0].bounds is None
    assert results[0].country == "India"


async def test_photon_timeout_and_bad_payload_raise():
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ProviderError, match="timed out"):
        await make_photon(slow).search("Delhi")

    def garbage(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>")

    with pytest.raises(ProviderError, match="invalid response"):
        await make_photon(garbage).search("Delhi")

    def wrong_shape(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "nope"})

    with pytest.raises(ProviderError, match="unexpected payload"):
        await make_photon(wrong_shape).search("Delhi")


async def test_fallback_propagates_secondary_failure():
    def primary(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    def secondary(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    geocoder = FallbackGeocoder(make_geocoder(primary), make_photon(secondary))
    with pytest.raises(ProviderError, match="HTTP 500"):
        await geocoder.search("Mumbai")
