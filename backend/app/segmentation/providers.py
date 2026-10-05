"""Segmentation provider abstraction for roof/ground surface classification.

Defines the interface that all segmentation providers must implement,
allowing seamless swapping between models (SAM, heuristic, future models).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import threading as _threading

import numpy as np
from affine import Affine

#: Minimum container RAM (MB) required to run the heavyweight segmentation
#: models (219 MB HOTOSM ONNX / 156 MB SAM2 + runtimes). Measured peak for a
#: single 512 px HOTOSM inference is ~450 MB on top of the app baseline, so
#: 512 MB containers cannot survive it. Below this limit the factory refuses
#: heavy models with a structured error (or heuristic fallback on the default
#: path) instead of letting the worker be OOM-killed.
HEAVY_MODEL_MIN_CONTAINER_MB = 768

#: Bounds concurrent heavyweight inferences process-wide so parallel
#: validations cannot exhaust a small single-service container. Waiting happens
#: in worker threads, never on the event loop.
HEAVY_INFERENCE_SEMAPHORE = _threading.Semaphore(2)


def container_memory_limit_mb() -> float | None:
    """Container RAM limit in MB, or None when it cannot be determined.

    Reads cgroup v2 (memory.max) then v1 (memory.limit_in_bytes). A value of
    "max" or an unreadable file means unknown, never zero.
    """
    candidates = (
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    )
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read().strip()
            if not raw or raw == "max":
                continue
            return float(int(raw)) / (1024 * 1024)
        except (OSError, ValueError):
            continue
    return None


@dataclass(frozen=True)
class SegmentationResult:
    """Result of a segmentation operation.

    Attributes:
        mask: HxW numpy array of class indices (int8)
        classes: List of class names, index corresponds to mask values
        class_fractions: Dict mapping class name to pixel fraction (0-1)
        confidence: Overall confidence score (0-1)
        image_dims: Tuple of (width, height) in pixels
        transform: Affine transform from pixel coords to geographic coords
        crs: CRS of the transform (typically EPSG:4326)
        provider: Name of the segmentation provider
        model: Model identifier/version
        limitations: List of known limitations/caveats
    """
    mask: np.ndarray
    classes: list[str]
    class_fractions: dict[str, float]
    confidence: float
    image_dims: tuple[int, int]
    transform: Affine
    crs: str
    provider: str
    model: str
    limitations: list[str] = field(default_factory=list)

    def get_dominant_class(self) -> tuple[str, float]:
        """Return the dominant class and its fraction."""
        if not self.class_fractions:
            return "unknown", 0.0
        dominant = max(self.class_fractions.items(), key=lambda kv: kv[1])
        return dominant

    def get_class_mask(self, class_name: str) -> np.ndarray:
        """Get binary mask for a specific class."""
        if class_name not in self.classes:
            return np.zeros(self.mask.shape, dtype=bool)
        idx = self.classes.index(class_name)
        return self.mask == idx


@dataclass(frozen=True)
class Bounds:
    """Geographic bounds of the imagery."""
    minx: float  # min longitude
    miny: float  # min latitude
    maxx: float  # max longitude
    maxy: float  # max latitude
    crs: str = "EPSG:4326"


class SegmentationProvider(ABC):
    """Abstract base class for segmentation providers.

    All providers must implement the segment() method and provide
    name/model_info properties for metadata tracking.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Short provider name (e.g., 'sam', 'heuristic')."""
        pass

    @property
    @abstractmethod
    def model_info(self) -> dict:
        """Model metadata: type, version, weights source, etc."""
        pass

    @abstractmethod
    def segment(self, image: np.ndarray, bounds: Bounds) -> SegmentationResult:
        """Segment an image into semantic classes.

        Args:
            image: RGB image as numpy array (H, W, 3), uint8
            bounds: Geographic bounds of the image

        Returns:
            SegmentationResult with mask, classes, fractions, confidence
        """
        pass

    def is_available(self) -> bool:
        """Check if provider is available (weights loaded, dependencies met)."""
        return True


def create_bounds_from_polygon(polygon, padding_factor: float = 0.08) -> Bounds:
    """Create Bounds from a shapely polygon with optional padding.

    Args:
        polygon: Shapely geometry in WGS84
        padding_factor: Fractional padding around bounds (0.08 = 8%)

    Returns:
        Bounds object
    """
    minx, miny, maxx, maxy = polygon.bounds
    dx = (maxx - minx) * padding_factor
    dy = (maxy - miny) * padding_factor
    return Bounds(
        minx=minx - dx,
        miny=miny - dy,
        maxx=maxx + dx,
        maxy=maxy + dy
    )


def compute_affine_transform(bounds: Bounds, width: int, height: int) -> Affine:
    """Compute affine transform from pixel to geographic coordinates.

    Args:
        bounds: Geographic bounds
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        Affine transform
    """
    a = (bounds.maxx - bounds.minx) / width
    b = 0.0
    c = bounds.minx
    d = 0.0
    e = -(bounds.maxy - bounds.miny) / height  # Negative for image Y-down
    f = bounds.maxy
    return Affine(a, b, c, d, e, f)