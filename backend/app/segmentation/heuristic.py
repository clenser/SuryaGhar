"""Local heuristic segmentation of a satellite crop.

Deterministic, dependency-light pixel classifier. It is honest about being a
heuristic: confidence is capped and the limitations are surfaced in the API
response and UI. The SegmentationProvider abstraction keeps SAM/other models
replaceable later.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from affine import Affine

from app.segmentation.providers import (
    Bounds,
    SegmentationProvider,
    SegmentationResult,
    compute_affine_transform,
)

CLASSES = ["roof", "vegetation", "water", "road", "other", "bare_ground"]


@dataclass
class LegacySegmentationResult:
    """Legacy result format for backward compatibility."""
    components: dict[str, float]
    mask: np.ndarray  # HxW int8 class index
    confidence: float
    classes: list[str] = field(default_factory=lambda: list(CLASSES))
    limitations: list[str] = field(default_factory=list)


def classify_pixels(image_rgb: np.ndarray) -> np.ndarray:
    """Returns an HxW int8 array of class indices for the classes above."""
    r = image_rgb[..., 0].astype(np.int16)
    g = image_rgb[..., 1].astype(np.int16)
    b = image_rgb[..., 2].astype(np.int16)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1))

    vegetation = (g > r * 1.15) & (g > b * 1.1) & (g < 190) & (sat > 0.15)
    water = (b > r * 1.25) & (b > g * 1.05) & (sat > 0.12) & (b > 60)
    road = (np.abs(r - g) < 45) & (np.abs(g - b) < 45) & (mx > 70) & (mx < 185) & (sat < 0.22)
    roof = ((mx - mn) < 70) & (mx >= 115) & (sat < 0.35) | ((r > g * 1.15) & (r > b * 1.25) & (r > 95) & (r < 200) & (sat > 0.18) & (sat < 0.6))
    roof = roof & ~vegetation & ~water
    bare_ground = (sat < 0.2) & (mx > 80) & (mx < 200) & ~roof & ~road

    mask = np.full(image_rgb.shape[:2], CLASSES.index("other"), dtype=np.int8)
    mask[roof] = CLASSES.index("roof")
    mask[road] = CLASSES.index("road")
    mask[vegetation] = CLASSES.index("vegetation")
    mask[water] = CLASSES.index("water")
    mask[bare_ground] = CLASSES.index("bare_ground")
    return mask


def segment_crop(image_rgb: np.ndarray) -> LegacySegmentationResult:
    """Legacy function for backward compatibility.

    Returns the old SegmentationResult format.
    """
    mask = classify_pixels(image_rgb)
    total = mask.size
    components = {}
    for idx, name in enumerate(CLASSES):
        components[name] = float(np.mean(mask == idx))
    dominant = max(components.values())
    # Confidence is driven by how much of the selection one class explains,
    # capped because this is a heuristic, not a trained model.
    confidence = float(np.clip(dominant * 1.1, 0.0, 0.82))
    limitations = [
        "Heuristic pixel classifier, not a trained segmentation model.",
        "Class separation depends on imagery brightness, season, and resolution.",
        "Semi-transparent roofing, shadows and sensor noise can shift classes.",
    ]
    return LegacySegmentationResult(
        components=components,
        mask=mask,
        confidence=confidence,
        limitations=limitations,
    )


class HeuristicSegmentationProvider(SegmentationProvider):
    """Heuristic segmentation provider implementing the standard interface."""

    @property
    def name(self) -> str:
        return "heuristic"

    @property
    def model_info(self) -> dict:
        return {
            "type": "heuristic_color_based",
            "version": "1.0",
            "classes": CLASSES,
        }

    def segment(self, image: np.ndarray, bounds: Bounds) -> SegmentationResult:
        """Segment image using color-based heuristics."""
        mask = classify_pixels(image)
        h, w = image.shape[:2]

        # Compute class fractions
        class_fractions = {}
        for idx, name in enumerate(CLASSES):
            class_fractions[name] = float(np.mean(mask == idx))

        dominant = max(class_fractions.values())
        confidence = float(np.clip(dominant * 1.1, 0.0, 0.82))

        limitations = [
            "Heuristic pixel classifier, not a trained segmentation model.",
            "Class separation depends on imagery brightness, season, and resolution.",
            "Semi-transparent roofing, shadows and sensor noise can shift classes.",
            "Confidence capped at 0.82 to reflect heuristic nature.",
        ]

        transform = compute_affine_transform(bounds, w, h)

        return SegmentationResult(
            mask=mask.astype(np.int8),
            classes=CLASSES,
            class_fractions=class_fractions,
            confidence=confidence,
            image_dims=(w, h),
            transform=transform,
            crs=bounds.crs,
            provider="heuristic",
            model="color_heuristic_v1",
            limitations=limitations,
        )