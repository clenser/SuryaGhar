"""Readiness contract: GET /health is liveness, GET /ready is readiness.

- /ready returns 503 {"status": "starting"} until startup initialization
  completes, then 200 {"status": "ready"}.
- /health answers 200 independently of readiness.
- /ready never triggers model initialization and never counts as activity.
- Failed startup initialization never marks the backend ready.
"""
import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.core import readiness
from app.main import app


@pytest.fixture(autouse=True)
def _reset_readiness():
    readiness.reset_readiness()
    yield
    readiness.reset_readiness()


def test_readiness_initially_false():
    assert readiness.is_ready() is False
    assert readiness.readiness_detail() is None


def test_ready_returns_503_while_not_ready():
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "starting"}
    assert r.headers["cache-control"] == "no-store"


def test_ready_returns_200_after_mark_ready():
    readiness.mark_ready("segmentation=heuristic")
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "detail": "segmentation=heuristic"}
    assert r.headers["cache-control"] == "no-store"


def test_health_remains_200_independently_of_readiness():
    client = TestClient(app, raise_server_exceptions=False)
    assert readiness.is_ready() is False
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_ready_does_not_trigger_model_loading(monkeypatch):
    """Neither the 503 nor the 200 path may resolve/initialize providers."""
    import app.segmentation.factory as factory

    calls: list = []
    original = factory.get_segmentation_provider

    def spy(settings):
        calls.append(True)
        return original(settings)

    monkeypatch.setattr(factory, "get_segmentation_provider", spy)
    client = TestClient(app, raise_server_exceptions=False)
    client.get("/ready")
    readiness.mark_ready("segmentation=heuristic")
    client.get("/ready")
    assert calls == []


def test_ready_is_excluded_from_activity_tracking():
    from app.core.activity import is_tracked_request

    assert is_tracked_request("GET", "/ready") is False
    assert is_tracked_request("GET", "/health") is False
    # Real analysis traffic still counts.
    assert is_tracked_request("POST", "/selection/validate") is True


def test_successful_initialization_marks_ready():
    """Entering the app lifespan (as uvicorn does) flips readiness on."""
    assert readiness.is_ready() is False
    with TestClient(app, raise_server_exceptions=False) as client:
        assert readiness.is_ready() is True
        r = client.get("/ready")
        assert r.status_code == 200
        assert r.json()["status"] == "ready"


def test_failed_initialization_never_marks_ready(monkeypatch, caplog):
    def boom(settings):
        raise RuntimeError("checkpoint disk unreadable")

    monkeypatch.setattr(main_module, "perform_startup_checks", boom)
    with caplog.at_level("ERROR", logger="solar_rooftop.api"):
        with TestClient(app, raise_server_exceptions=False) as client:
            # The app stays live (health answers) but never ready.
            assert readiness.is_ready() is False
            assert client.get("/ready").status_code == 503
            assert client.get("/health").status_code == 200
    assert any("staying not ready" in record.message for record in caplog.records)


def test_startup_checks_report_configured_provider():
    from app.core.config import get_settings

    detail = readiness.perform_startup_checks(get_settings())
    assert detail.startswith("segmentation=")
    assert len(detail) < 80


def test_startup_checks_raise_when_provider_unavailable(monkeypatch):
    import app.segmentation.factory as factory
    from app.core.config import get_settings

    class Dead:
        name = "dead"

        def is_available(self):
            return False

    monkeypatch.setattr(factory, "get_segmentation_provider", lambda settings: Dead())
    with pytest.raises(RuntimeError):
        readiness.perform_startup_checks(get_settings())
