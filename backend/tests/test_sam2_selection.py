"""Selectable segmentation models: HOTOSM default, SAM 2.1 Tiny opt-in.

Heavy SAM2 inference is never exercised here: the provider is stubbed at the
segment() boundary and the real checkpoint is never loaded by the suite.
"""
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
    img = Image.fromarray(np.full((32, 32, 3), 120, dtype=np.uint8))
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


def test_invalid_model_identifier_returns_400():
    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "unet_xl"})
    assert r.status_code == 400
    assert r.json()["error"] == "unknown_segmentation_model"


def test_sam2_missing_checkpoint_returns_structured_error(monkeypatch):
    monkeypatch.setattr(
        validate_module, "get_settings", lambda: SimpleNamespace(sam2_checkpoint_path="/nonexistent/definitely-not-here.pt")
    )
    r = client.post("/selection/validate", json={"geometry": SQUARE, "segmentation_model": "sam2_tiny"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "segmentation_model_unavailable"
    assert "SAM 2.1 Tiny is unavailable" in body["detail"]


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
