"""Validation semantics: the AI providers own classification and confidence.

HOTOSM, OSM and the pixel heuristic must remain supporting evidence only, and a
vision-chain failure must never produce a fabricated surface classification.
"""
import asyncio
import io

import numpy as np
import pytest
from PIL import Image

import app.segmentation.validate as validate_module
from app.segmentation.providers import SegmentationResult, compute_affine_transform

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[88.3639, 22.5726], [88.3645, 22.5726], [88.3645, 22.5731], [88.3639, 22.5731], [88.3639, 22.5726]]],
}


class _StubProvider:
    """Deterministic segmentation stub: 60% building pixels, rest 'other'."""

    name = "hotosm_dinov3s_buildings"
    model = "stub-building-model"

    def segment(self, image, bounds):
        h, w = image.shape[:2]
        classes = ["other", "building"]
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[:, : int(w * 0.6)] = 1
        return SegmentationResult(
            mask=mask,
            classes=classes,
            class_fractions={"other": 0.4, "building": 0.6},
            confidence=0.8,
            image_dims=(w, h),
            transform=compute_affine_transform(bounds, w, h),
            crs="EPSG:4326",
            provider=self.name,
            model=self.model,
            limitations=["stub"],
        )


def _install_stubs(monkeypatch, ai_result):
    img = Image.fromarray(np.full((8, 8, 3), 120, dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")

    monkeypatch.setattr(validate_module, "fetch_crop", lambda geometry, size=512, timeout=12.0: (buf.getvalue(), (88.36, 22.57, 88.37, 22.58)))
    monkeypatch.setattr(validate_module, "get_segmentation_provider", lambda settings: _StubProvider())

    async def fake_osm(geometry, metric_geom):
        return {"available": True, "overlap_fraction": 0.9, "heights_m": []}

    monkeypatch.setattr(validate_module, "_osm_building_evidence", fake_osm)

    async def fake_chain(jpeg, summary, settings):
        return ai_result, "groq" if ai_result else None

    monkeypatch.setattr(validate_module, "validate_with_ai_chain", fake_chain)


def test_ai_result_owns_classification_and_confidence(monkeypatch):
    _install_stubs(
        monkeypatch,
        {
            "primary_class": "rooftop",
            "confidence": 0.82,
            "is_suitable_for_solar": True,
            "reason": "Flat concrete roof with no visible obstructions.",
            "class_fractions": {"rooftop": 0.8, "open_ground": 0.05},
            "provider": "groq",
            "model": "vision-model",
        },
    )

    result = asyncio.run(validate_module.validate_surface(SQUARE))

    assert result["classification"] == "roof"
    assert result["coverage"] == 0.85
    assert result["confidence"] == 0.82
    assert result["evidence"]["semantic_available"] is True
    assert result["evidence"]["vision"]["provider"] == "groq"
    assert result["evidence"]["vision"]["reason"] == "Flat concrete roof with no visible obstructions."


def test_ai_confidence_is_not_raised_by_supporting_evidence(monkeypatch):
    """Strong building/OSM support must not inflate a modest AI confidence."""
    _install_stubs(
        monkeypatch,
        {
            "primary_class": "rooftop",
            "confidence": 0.55,
            "is_suitable_for_solar": True,
            "reason": "Looks like a roof.",
            "class_fractions": {"rooftop": 0.5},
            "provider": "groq",
            "model": "vision-model",
        },
    )

    result = asyncio.run(validate_module.validate_surface(SQUARE))

    assert result["confidence"] == 0.55
    assert result["evidence"]["supporting"]["hotosm_building_fraction"] == 0.6
    assert result["evidence"]["supporting"]["osm_overlap_fraction"] == 0.9


def test_no_ai_providers_reports_unavailable_not_heuristic_class(monkeypatch):
    _install_stubs(monkeypatch, None)

    result = asyncio.run(validate_module.validate_surface(SQUARE))

    assert result["classification"] == "unknown"
    assert result["confidence"] == 0.0
    assert result["coverage"] == 0.0
    assert result["providers"]["vision"] == "unavailable"
    assert result["evidence"]["semantic_available"] is False
    assert any("Semantic surface validation could not be completed" in w for w in result["warnings"])
    # Building pixels remain available as diagnostics.
    assert result["components"]["building"] == 0.6


def test_coverage_is_zero_without_ai_class_fractions(monkeypatch):
    _install_stubs(
        monkeypatch,
        {
            "primary_class": "rooftop",
            "confidence": 0.9,
            "is_suitable_for_solar": True,
            "reason": "Roof.",
            "provider": "groq",
            "model": "vision-model",
        },
    )

    result = asyncio.run(validate_module.validate_surface(SQUARE))

    assert result["coverage"] == 0.0