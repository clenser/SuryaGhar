"""Selectable segmentation models: HOTOSM default, SAM 2.1 Tiny opt-in.

Heavy SAM2 inference is never exercised here: the provider is stubbed at the
segment() boundary and the real checkpoint is never loaded by the suite.
"""
import asyncio
import io
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.segmentation.validate as validate_module
from app.main import app
from app.segmentation.factory import (
    DEFAULT_SEGMENTATION_MODEL,
    SUPPORTED_SEGMENTATION_MODELS,
    SegmentationModelUnavailableError,
    UnknownSegmentationModelError,
    resolve_segmentation_model,
)
from app.segmentation.hotosm_provider import HotosmBuildingsProvider
from app.segmentation.providers import SegmentationResult, compute_affine_transform
from app.segmentation.providers import Bounds

BACKEND_DIR = Path(__file__).resolve().parents[1]
client = TestClient(app)

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[88.3639, 22.5726], [88.3645, 22.5726], [88.3645, 22.5731], [88.3639, 22.5731], [88.3639, 22.5726]]],
}


def _minimal_response():
    return {
        "classification": "unknown",
        "confidence": 0.0,
        "coverage": 0.0,
        "components": {},
        "metrics": {"area_m2": 10.0, "perimeter_m": 12.0},
        "warnings": [],
    }


def _install_crop_and_vision_stubs(monkeypatch):
    # Production-size crop: providers assume imagery at least as large as the
    # 256 px model window.
    img = Image.fromarray(np.full((512, 512, 3), 120, dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    monkeypatch.setattr(
        validate_module, "fetch_crop", lambda geometry, size=512, timeout=12.0: (buf.getvalue(), (88.36, 22.57, 88.37, 22.58))
    )

    async def fake_osm(geometry, metric_geom):
        return {"available": False, "overlap_fraction": None, "heights_m": []}

    monkeypatch.setattr(validate_module, "_osm_building_evidence", fake_osm)

    async def fake_chain(jpeg, summary, settings):
        return None, None

    monkeypatch.setattr(validate_module, "validate_with_ai_chain", fake_chain)


def test_supported_models_keep_hotosm_default():
    assert DEFAULT_SEGMENTATION_MODEL == "hotosm_buildings"
    assert set(SUPPORTED_SEGMENTATION_MODELS) == {"hotosm_buildings", "sam2_tiny"}


def test_unknown_model_identifier_raises():
    with pytest.raises(UnknownSegmentationModelError):
        resolve_segmentation_model("unet_xl", SimpleNamespace(sam2_checkpoint_path=None))


def test_hotosm_provider_still_resolves(monkeypatch):
    monkeypatch.setattr(HotosmBuildingsProvider, "is_available", lambda self: True)
    provider = resolve_segmentation_model("hotosm_buildings", SimpleNamespace())
    assert isinstance(provider, HotosmBuildingsProvider)


def test_sam2_missing_checkpoint_is_unavailable():
    from app.segmentation.sam2_provider import SAM2TinyProvider

    provider = SAM2TinyProvider(checkpoint_path="/nonexistent/definitely-not-here.pt")
    assert provider.is_available() is False
    assert provider.unavailable_reason
    with pytest.raises(SegmentationModelUnavailableError):
        resolve_segmentation_model("sam2_tiny", SimpleNamespace(sam2_checkpoint_path="/nonexistent/definitely-not-here.pt"))


def test_app_imports_without_torch_or_sam2():
    code = (
        "import sys; from app.main import app; "
        "bad=[m for m in sys.modules if m == 'torch' or m.startswith('torch.') "
        "or m == 'sam2' or m.startswith('sam2.')]; "
        "print('BAD:', bad); assert not bad, bad; print('app import OK')"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(BACKEND_DIR))
    assert result.returncode == 0, result.stderr + result.stdout
    assert "app import OK" in result.stdout


def test_default_validation_omits_model_selection(monkeypatch):
    seen = {}

    async def fake_validate(geometry, segmentation_model=None):
        seen["model"] = segmentation_model
        return _minimal_response()

    monkeypatch.setattr(validate_module, "validate_surface", fake_validate)
    r = client.post("/selection/validate", json={"geometry": SQUARE})
    assert r.status_code == 200
    assert seen["model"] is None


def test_omitted_model_runs_real_hotosm_default(monkeypatch):
    """A. Omitted segmentation_model -> 200 via the repo-bundled HOTOSM default."""
    _install_crop_and_vision_stubs(monkeypatch)
    r = client.post("/selection/validate", json={"geometry": SQUARE})
    assert r.status_code == 200
    assert r.json()["providers"]["segmentation"] == "hotosm_dinov3s_buildings"


def test_explicit_hotosm_runs_real_provider(monkeypatch):
    """B. segmentation_model=hotosm_buildings -> 200 via HOTOSM, no fallback."""
    _install_crop_and_vision_stubs(monkeypatch)
    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "hotosm_buildings"})
    assert r.status_code == 200
    assert r.json()["providers"]["segmentation"] == "hotosm_dinov3s_buildings"


def test_invalid_model_identifier_returns_400():
    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "unet_xl"})
    assert r.status_code == 400
    assert r.json()["error"] == "unknown_segmentation_model"


def test_invalid_model_rejected_before_geometry_check():
    """D. Unknown ids fail fast with 400 even when the geometry is also bad."""
    # Polygon with empty coordinates passes request-schema validation (Any)
    # but fails analysis geometry; the unknown model must still win with 400.
    bad = {"type": "Polygon", "coordinates": []}
    r = client.post("/selection/validate", json={"geometry": bad, "segmentation_model": "unet_xl"})
    assert r.status_code == 400
    assert r.json()["error"] == "unknown_segmentation_model"


def test_malformed_request_is_422_with_cors_headers():
    """E. Unrelated schema violations still 422 and still carry CORS headers."""
    bad = {"type": "Point", "coordinates": [0, 0]}
    r = client.post(
        "/selection/validate",
        json={"geometry": bad},
        headers={"Origin": "https://surya-ghar.vercel.app"},
    )
    assert r.status_code == 422
    assert r.headers.get("access-control-allow-origin") == "https://surya-ghar.vercel.app"


def test_invalid_model_400_carries_cors_headers():
    r = client.post(
        "/selection/validate",
        json={"geometry": SQUARE, "segmentation_model": "unet_xl"},
        headers={"Origin": "https://surya-ghar.vercel.app"},
    )
    assert r.status_code == 400
    assert r.headers.get("access-control-allow-origin") == "https://surya-ghar.vercel.app"


def test_preflight_allows_validate_post():
    """F. CORS preflight for the frontend origin succeeds."""
    r = client.options(
        "/selection/validate",
        headers={
            "Origin": "https://surya-ghar.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "https://surya-ghar.vercel.app"
    assert "POST" in r.headers.get("access-control-allow-methods", "")


def test_sam2_missing_checkpoint_returns_structured_error(monkeypatch):
    monkeypatch.setattr(
        validate_module, "get_settings", lambda: SimpleNamespace(sam2_checkpoint_path="/nonexistent/definitely-not-here.pt")
    )
    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "sam2_tiny"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "segmentation_model_unavailable"
    assert "SAM 2.1 Tiny is unavailable" in body["detail"]


async def test_blocking_segmentation_runs_off_event_loop(monkeypatch):
    """G. provider.segment is dispatched to a worker thread, not the loop."""
    import threading
    import time

    caller_ident = threading.get_ident()
    seen: dict = {}

    class SlowProvider:
        name = "slow_stub"
        accepts_prompt_box = False

        @property
        def model_info(self):
            return {}

        def segment(self, image, bounds):
            seen["ident"] = threading.get_ident()
            time.sleep(0.5)
            h, w = image.shape[:2]
            mask = np.zeros((h, w), dtype=np.int8)
            return SegmentationResult(
                mask=mask,
                classes=["other", "building"],
                class_fractions={"other": 1.0, "building": 0.0},
                confidence=0.5,
                image_dims=(w, h),
                transform=compute_affine_transform(bounds, w, h),
                crs="EPSG:4326",
                provider="slow_stub",
                model="stub",
                limitations=[],
            )

    monkeypatch.setattr(validate_module, "resolve_segmentation_model", lambda model_id, settings: SlowProvider())
    _install_crop_and_vision_stubs(monkeypatch)

    ticks = 0

    async def ticker():
        nonlocal ticks
        for _ in range(10):
            await asyncio.sleep(0.1)
            ticks += 1

    tick_task = asyncio.create_task(ticker())
    result = await validate_module.validate_surface(SQUARE, segmentation_model="slow_stub")
    await tick_task

    assert seen["ident"] != caller_ident
    assert ticks == 10  # the loop kept ticking during blocking inference
    assert result["providers"]["segmentation"] == "slow_stub"


async def test_geocode_responsive_during_slow_validation(monkeypatch):
    """H. /geocode answers while a slow validation is still running."""
    import time

    import httpx

    class SlowProvider:
        name = "slow_stub"
        accepts_prompt_box = False

        @property
        def model_info(self):
            return {}

        def segment(self, image, bounds):
            time.sleep(3)
            h, w = image.shape[:2]
            mask = np.zeros((h, w), dtype=np.int8)
            return SegmentationResult(
                mask=mask,
                classes=["other", "building"],
                class_fractions={"other": 1.0, "building": 0.0},
                confidence=0.5,
                image_dims=(w, h),
                transform=compute_affine_transform(bounds, w, h),
                crs="EPSG:4326",
                provider="slow_stub",
                model="stub",
                limitations=[],
            )

    monkeypatch.setattr(validate_module, "resolve_segmentation_model", lambda model_id, settings: SlowProvider())
    _install_crop_and_vision_stubs(monkeypatch)

    from app.api import routes as routes_module
    from app.schemas.geocode import LocationResult as GeoResult

    class FastGeocoder:
        name = "test"

        async def search(self, query, limit=6):
            return [GeoResult(name="Kolkata", state="West Bengal", country="India", latitude=22.57, longitude=88.36)]

    app.dependency_overrides[routes_module.get_geocoder] = lambda: FastGeocoder()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            val_task = asyncio.create_task(
                ac.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "slow_stub"})
            )
            await asyncio.sleep(0.5)
            started = time.monotonic()
            geo = await ac.post("/geocode", json={"query": "kolkata"})
            geo_elapsed = time.monotonic() - started
            assert geo.status_code == 200
            assert not val_task.done()  # slow validation still crunching
            assert geo_elapsed < 2.0  # geocode did not wait for it
            val = await val_task
            assert val.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_explicit_sam2_reaches_sam2_provider(monkeypatch):
    from app.segmentation import sam2_provider as sam2_module

    if not sam2_module.SAM2TinyProvider().is_available():
        pytest.skip("SAM2 dependencies/checkpoint unavailable in this environment")

    def fake_segment(self, image, bounds, prompt_box=None):
        h, w = image.shape[:2]
        assert prompt_box is not None  # polygon bbox must drive the box prompt
        mask = np.zeros((h, w), dtype=np.int8)
        mask[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4] = 1
        return SegmentationResult(
            mask=mask,
            classes=["other", "building"],
            class_fractions={"other": 0.75, "building": 0.25},
            confidence=0.8,
            image_dims=(w, h),
            transform=compute_affine_transform(bounds or Bounds(0, 0, 1, 1), w, h),
            crs="EPSG:4326",
            provider="sam2_tiny",
            model="sam2.1_hiera_tiny",
            limitations=["stub"],
        )

    monkeypatch.setattr(sam2_module.SAM2TinyProvider, "segment", fake_segment)
    _install_crop_and_vision_stubs(monkeypatch)

    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "sam2_tiny"})
    assert r.status_code == 200
    body = r.json()
    assert body["providers"]["segmentation"] == "sam2_tiny"
    assert body["providers"]["segmentation_model"] == "sam2.1_hiera_tiny"
    assert set(body["components"]) == {"other", "building"}
