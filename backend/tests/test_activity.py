"""Inactivity tracking for EC2 auto-stop.

The activity timestamp must be file-based (survives restarts), exclude
health/config polling and OPTIONS preflights, and never alter responses.
"""
import json
import threading
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.core.activity import (
    is_tracked_request,
    read_last_activity,
    record_activity,
    resolve_activity_path,
)
from app.main import app

client = TestClient(app)

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[88.3639, 22.5726], [88.3645, 22.5726], [88.3645, 22.5731], [88.3639, 22.5731], [88.3639, 22.5726]]],
}


def _use_tmp_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTIVITY_FILE", str(tmp_path / "last_activity.json"))
    return tmp_path / "last_activity.json"


def test_record_creates_timestamp_file(monkeypatch, tmp_path):
    target = _use_tmp_file(monkeypatch, tmp_path)
    assert not target.exists()

    assert record_activity() == target
    assert target.exists()

    stored = read_last_activity()
    assert stored is not None
    assert stored.tzinfo is not None  # UTC-aware
    now = datetime.now(timezone.utc)
    assert (now - stored).total_seconds() >= 0
    assert (now - stored).total_seconds() < 60


def test_record_updates_existing_timestamp(monkeypatch, tmp_path):
    _use_tmp_file(monkeypatch, tmp_path)
    record_activity()
    first = read_last_activity()
    record_activity()
    second = read_last_activity()
    assert first is not None and second is not None
    assert second >= first


def test_explicit_path_override(monkeypatch, tmp_path):
    other = tmp_path / "other.json"
    record_activity(explicit_path=str(other))
    assert other.exists()
    assert read_last_activity(explicit_path=str(other)) is not None


def test_record_failure_never_raises(monkeypatch, tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory")
    # Parent is a regular file, so mkdir must fail; record must swallow it.
    assert record_activity(explicit_path=str(blocker / "x.json")) is None


def test_concurrent_records_stay_valid(monkeypatch, tmp_path):
    _use_tmp_file(monkeypatch, tmp_path)
    threads = [threading.Thread(target=record_activity) for _ in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    raw = json.loads((tmp_path / "last_activity.json").read_text(encoding="utf-8"))
    datetime.fromisoformat(raw["last_activity_utc"])  # raises if corrupted


def test_is_tracked_request_rules():
    assert is_tracked_request("GET", "/health") is False
    assert is_tracked_request("GET", "/config") is False
    assert is_tracked_request("OPTIONS", "/selection/validate") is False
    assert is_tracked_request("OPTIONS", "/health") is False
    assert is_tracked_request("options", "/geocode") is False  # method match is case-insensitive
    assert is_tracked_request("POST", "/geocode") is True
    assert is_tracked_request("POST", "/selection/validate") is True
    assert is_tracked_request("POST", "/selection/metrics") is True


def test_health_does_not_touch_activity_file(monkeypatch, tmp_path):
    target = _use_tmp_file(monkeypatch, tmp_path)
    r = client.get("/health")
    assert r.status_code == 200
    assert not target.exists()


def test_config_does_not_touch_activity_file(monkeypatch, tmp_path):
    target = _use_tmp_file(monkeypatch, tmp_path)
    r = client.get("/config")
    assert r.status_code == 200
    assert "available_segmentation_models" in r.json()
    assert not target.exists()


def test_normal_api_request_updates_activity(monkeypatch, tmp_path):
    target = _use_tmp_file(monkeypatch, tmp_path)
    # /selection/metrics is pure local computation (no network, no models).
    r = client.post("/selection/metrics", json={"geometry": SQUARE})
    assert r.status_code == 200
    assert "area_m2" in r.json()
    stored = read_last_activity()
    assert stored is not None
    assert (datetime.now(timezone.utc) - stored).total_seconds() < 60


def test_options_does_not_touch_activity_file(monkeypatch, tmp_path):
    target = _use_tmp_file(monkeypatch, tmp_path)
    client.options(
        "/selection/validate",
        headers={
            "Origin": "https://surya-ghar.vercel.app",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert not target.exists()


def test_activity_module_imports_without_torch():
    """activity.py must stay dependency-light: importing it (fresh process)
    must not pull in torch."""
    import subprocess
    import sys
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parents[1]
    code = (
        "import sys; import app.core.activity as m; "
        "assert 'torch' not in sys.modules, 'torch leaked in'; "
        "assert m.BACKEND_DIR.name == 'backend'; print('ok')"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(backend_dir))
    assert result.returncode == 0, result.stderr + result.stdout


def test_resolve_activity_path_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTIVITY_FILE", str(tmp_path / "custom.json"))
    assert resolve_activity_path() == tmp_path / "custom.json"
    assert resolve_activity_path(explicit="/x/y.json").name == "y.json"
