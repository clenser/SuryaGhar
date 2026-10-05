import httpx
import respx
from fastapi.testclient import TestClient

from app.main import app
from app.providers.nominatim import NominatimGeocoder
from app.services.geocoding import build_geocoder
import app.api.routes as routes

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "segmentation_provider" in r.json()
    assert "model_present" in r.json()


def test_config_never_exposes_secrets():
    r = client.get("/config")
    assert r.status_code == 200
    body = r.text.lower()
    assert "groq" not in body
    assert "api_key" not in body
    assert "key" not in body
    assert set(r.json().keys()) == {"geocoder_provider", "imagery_provider", "terrain_provider"}


def test_geocode_rejects_too_short_query():
    r = client.post("/geocode", json={"query": " a "})
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_request"


def test_geocode_rejects_overlong_query():
    r = client.post("/geocode", json={"query": "x" * 121})
    assert r.status_code == 422


def test_geocode_rejects_oversized_body():
    r = client.post("/geocode", content=b"{" + b" " * 9000 + b"}", headers={"content-type": "application/json", "content-length": "9001"})
    assert r.status_code == 413


def test_geocode_success_with_mocked_provider(monkeypatch):
    class Fake(NominatimGeocoder):
        async def search(self, query, limit=6):
            from app.schemas.geocode import LocationResult
            return [LocationResult(name="Kalna", state="West Bengal", country="India", latitude=23.2, longitude=88.36)]

    monkeypatch.setattr(routes, "build_geocoder", lambda settings: Fake(base_url="x", user_agent="y", timeout=1))
    r = client.post("/geocode", json={"query": "  Kalna  "})
    assert r.status_code == 200
    data = r.json()
    assert data["provider"] == "nominatim"
    assert data["results"][0]["name"] == "Kalna"


def test_geocode_reports_configured_fallback_provider():
    from app.core.config import Settings

    geocoder = build_geocoder(Settings(geocoder_provider="nominatim+photon"))
    assert geocoder.name == "nominatim+photon"
    assert build_geocoder(Settings(geocoder_provider="photon")).name == "photon"
    assert build_geocoder(Settings(geocoder_provider="nominatim")).name == "nominatim"


def test_geocode_upstream_failure_returns_502(monkeypatch):
    from app.providers.base import ProviderError

    class Failing(NominatimGeocoder):
        async def search(self, query, limit=6):
            raise ProviderError("Location search timed out")

    monkeypatch.setattr(routes, "build_geocoder", lambda settings: Failing(base_url="x", user_agent="y", timeout=1))
    r = client.post("/geocode", json={"query": "Delhi"})
    assert r.status_code == 502
    assert r.json() == {"error": "geocoding_failed", "detail": "Location search timed out"}
