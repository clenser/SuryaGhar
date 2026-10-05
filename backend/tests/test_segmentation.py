"""Lightweight local tests for the segmentation provider contract (no live providers)."""
import numpy as np
import pytest

from app.segmentation.providers import Bounds
from app.segmentation.semantic_provider import DEFAULT_CLASSES, SemanticSegmentationProvider


class _FakeModel:
    """Emits fixed logits: left half 'roof', right half 'vegetation'."""

    def __call__(self, tensor):
        import torch

        n, c, h, w = tensor.shape
        logits = torch.full((1, len(DEFAULT_CLASSES), h, w), -5.0)
        logits[0, DEFAULT_CLASSES.index("roof"), :, : w // 2] = 5.0
        logits[0, DEFAULT_CLASSES.index("vegetation"), :, w // 2 :] = 5.0
        return logits

    def eval(self):
        return self


def _bounds() -> Bounds:
    return Bounds(minx=88.36, miny=22.57, maxx=88.365, maxy=22.573)


def test_semantic_provider_mask_and_fractions():
    provider = SemanticSegmentationProvider(classes=list(DEFAULT_CLASSES), model=_FakeModel())
    image = np.full((64, 128, 3), 127, dtype=np.uint8)
    result = provider.segment(image, _bounds())
    assert result.mask.shape == (64, 128)
    assert result.classes == list(DEFAULT_CLASSES)
    left_frac = result.class_fractions["roof"]
    right_frac = result.class_fractions["vegetation"]
    assert 0.45 < left_frac < 0.55
    assert 0.45 < right_frac < 0.55
    assert result.provider == "semantic_model"
    assert result.image_dims == (128, 64)
    assert result.crs == "EPSG:4326"
    assert result.mask[:, 0].tolist() == [DEFAULT_CLASSES.index("roof")] * 64
    assert result.mask[:, -1].tolist() == [DEFAULT_CLASSES.index("vegetation")] * 64


def test_semantic_provider_unavailable_without_checkpoint():
    provider = SemanticSegmentationProvider(checkpoint_path="/nonexistent/model.pt")
    assert provider.is_available() is False
    assert provider.error is not None
    image = np.full((8, 8, 3), 0, dtype=np.uint8)
    with pytest.raises(RuntimeError):
        provider.segment(image, _bounds())


def test_factory_defaults_to_heuristic_without_configuration():
    from app.core.config import Settings
    from app.segmentation.factory import get_segmentation_provider

    provider = get_segmentation_provider(Settings(segmentation_provider="heuristic"))
    assert provider.name == "heuristic"


def test_factory_falls_back_when_semantic_model_missing():
    from app.core.config import Settings
    from app.segmentation.factory import get_segmentation_provider

    provider = get_segmentation_provider(
        Settings(segmentation_provider="semantic", segmentation_model_path="/nonexistent/model.pt")
    )
    assert provider.name == "heuristic"


def test_main_import_does_not_require_torch_and_sam():
    """Production HOTOSM path must import app.main without importing SAM/torch."""
    import sys

    # Ensure a clean import path for the app package inside this process check.
    for mod in list(sys.modules):
        if mod.startswith("app.") or mod in ("torch", "segment_anything"):
            del sys.modules[mod]
    import app.main  # noqa: F401

    assert "torch" not in sys.modules
    assert "segment_anything" not in sys.modules
    assert "app.segmentation.sam_provider" not in sys.modules


def test_factory_prefers_hotosm_without_sam():
    import sys

    from app.core.config import Settings
    from app.segmentation.factory import get_segmentation_provider

    provider = get_segmentation_provider(
        Settings(segmentation_provider="hotosm_buildings")
    )
    assert provider.name in ("hotosm_dinov3s_buildings", "heuristic")
    assert "app.segmentation.sam_provider" not in sys.modules
    assert "torch" not in sys.modules
