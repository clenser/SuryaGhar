"""SAM (Segment Anything Model) segmentation provider.

Uses Meta's Segment Anything Model for promptable segmentation.
Requires model weights to be downloaded separately.

Configuration via environment variables:
- SEGMENTATION_PROVIDER=sam
- SAM_MODEL_TYPE=vit_b (or vit_l, vit_h)
- SAM_CHECKPOINT_PATH=/path/to/sam_vit_b_01ec64.pth

Weights can be downloaded from:
- vit_b: https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
- vit_l: https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth
- vit_h: https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from affine import Affine

from app.segmentation.providers import (
    Bounds,
    SegmentationProvider,
    SegmentationResult,
    compute_affine_transform,
)

logger = logging.getLogger("solar_rooftop.segmentation.sam")

# Class definitions for roof/ground segmentation
SAM_CLASSES = [
    "roof",
    "vegetation",
    "water",
    "road",
    "bare_ground",
    "other",
]

# Color mapping for visualization
CLASS_COLORS = {
    "roof": (15, 110, 122),
    "vegetation": (46, 125, 50),
    "water": (21, 101, 192),
    "road": (117, 117, 117),
    "bare_ground": (180, 150, 100),
    "other": (255, 193, 7),
}


class SAMSegmentationProvider(SegmentationProvider):
    """SAM-based segmentation provider for satellite imagery.

    Uses bounding box prompts derived from the user's selected polygon
    to generate segmentation masks. Since SAM is promptable but not
    fully automatic for semantic classes, we use a multi-prompt strategy:
    - Box prompt from polygon bounds
    - Grid of point prompts for coverage
    - Post-process to assign semantic classes based on color/texture heuristics

    This is a pragmatic approach: SAM provides high-quality mask boundaries,
    while heuristic classification assigns semantic labels.
    """

    def __init__(
        self,
        model_type: str = "vit_b",
        checkpoint_path: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self._model_type = model_type
        self._checkpoint_path = checkpoint_path or os.environ.get("SAM_CHECKPOINT_PATH")
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._predictor = None
        self._initialized = False
        self._init_error: Optional[str] = None

    @property
    def name(self) -> str:
        return "sam"

    @property
    def model_info(self) -> dict:
        return {
            "type": "segment_anything",
            "model_type": self._model_type,
            "checkpoint": self._checkpoint_path,
            "device": self._device,
            "initialized": self._initialized,
            "error": self._init_error,
        }

    def is_available(self) -> bool:
        if not self._initialized:
            self._initialize()
        return self._initialized and self._predictor is not None

    def _initialize(self) -> None:
        """Lazy initialization of SAM model."""
        if self._initialized:
            return

        try:
            from segment_anything import sam_model_registry, SamPredictor

            if not self._checkpoint_path or not Path(self._checkpoint_path).exists():
                self._init_error = f"SAM checkpoint not found at {self._checkpoint_path}"
                logger.warning(self._init_error)
                self._initialized = True
                return

            sam = sam_model_registry[self._model_type](checkpoint=self._checkpoint_path)
            sam.to(device=self._device)
            self._predictor = SamPredictor(sam)
            self._initialized = True
            logger.info(f"SAM {self._model_type} initialized on {self._device}")

        except ImportError:
            self._init_error = "segment-anything package not installed"
            logger.warning(self._init_error)
            self._initialized = True
        except Exception as e:
            self._init_error = f"SAM initialization failed: {e}"
            logger.error(self._init_error)
            self._initialized = True

    def segment(self, image: np.ndarray, bounds: Bounds) -> SegmentationResult:
        """Segment image using SAM with box + point prompts.

        Strategy:
        1. Set image in predictor
        2. Generate box prompt from bounds (polygon extent)
        3. Generate grid of point prompts for full coverage
        4. Combine masks
        5. Classify each mask region using color/texture heuristics
        """
        if not self.is_available():
            raise RuntimeError(f"SAM not available: {self._init_error}")

        h, w = image.shape[:2]
        self._predictor.set_image(image)

        # Box prompt from bounds (covers full image)
        box = np.array([0, 0, w, h], dtype=np.float32)

        # Point grid for additional coverage
        point_coords = self._generate_point_grid(w, h, stride=64)
        point_labels = np.ones(len(point_coords), dtype=np.int32)  # All foreground

        # Get masks from box prompt
        masks_box, scores_box, _ = self._predictor.predict(
            box=box,
            multimask_output=True,
        )

        # Get masks from point prompts (batch)
        masks_points, scores_points, _ = self._predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )

        # Combine: take best mask from each approach
        best_box_idx = np.argmax(scores_box)
        best_point_idx = np.argmax(scores_points)

        mask_box = masks_box[best_box_idx]
        mask_points = masks_points[best_point_idx]

        # Combine masks (union)
        combined_mask = mask_box | mask_points

        # Classify the masked region using heuristics
        class_mask = self._classify_regions(image, combined_mask)

        # Compute class fractions
        total = class_mask.size
        class_fractions = {}
        for idx, name in enumerate(SAM_CLASSES):
            class_fractions[name] = float(np.mean(class_mask == idx))

        # Confidence based on mask quality and classification certainty
        dominant_frac = max(class_fractions.values())
        mask_confidence = float(max(scores_box[best_box_idx], scores_points[best_point_idx]))
        confidence = float(np.clip(dominant_frac * 0.9 + mask_confidence * 0.1, 0.0, 0.95))

        # Affine transform
        transform = compute_affine_transform(bounds, w, h)

        limitations = [
            "SAM provides mask boundaries; semantic classes assigned via color/texture heuristics",
            "Not fine-tuned for satellite roof segmentation; may confuse similar surfaces",
            "Requires manual checkpoint download; not bundled with package",
        ]

        return SegmentationResult(
            mask=class_mask.astype(np.int8),
            classes=SAM_CLASSES,
            class_fractions=class_fractions,
            confidence=confidence,
            image_dims=(w, h),
            transform=transform,
            crs=bounds.crs,
            provider="sam",
            model=f"sam_{self._model_type}",
            limitations=limitations,
        )

    def _generate_point_grid(self, width: int, height: int, stride: int = 64) -> np.ndarray:
        """Generate grid of point prompts."""
        xs = np.arange(stride // 2, width, stride)
        ys = np.arange(stride // 2, height, stride)
        coords = np.array([[x, y] for y in ys for x in xs], dtype=np.float32)
        return coords

    def _classify_regions(self, image: np.ndarray, sam_mask: np.ndarray) -> np.ndarray:
        """Classify SAM mask regions using color/texture heuristics.

        This is a pragmatic approach: SAM gives us good boundaries,
        we classify the content within those boundaries.
        """
        h, w = image.shape[:2]
        class_mask = np.full((h, w), SAM_CLASSES.index("other"), dtype=np.int8)

        # Only classify pixels where SAM found something
        if not sam_mask.any():
            return class_mask

        # Extract masked region
        masked_pixels = image[sam_mask]

        # Simple color-based classification (similar to heuristic but on SAM regions)
        r = masked_pixels[:, 0].astype(np.int16)
        g = masked_pixels[:, 1].astype(np.int16)
        b = masked_pixels[:, 2].astype(np.int16)
        mx = np.maximum(np.maximum(r, g), b)
        mn = np.minimum(np.minimum(r, g), b)
        sat = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1))

        # Heuristic classification
        vegetation = (g > r * 1.15) & (g > b * 1.1) & (g < 190) & (sat > 0.15)
        water = (b > r * 1.25) & (b > g * 1.05) & (sat > 0.12) & (b > 60)
        road = (np.abs(r - g) < 45) & (np.abs(g - b) < 45) & (mx > 70) & (mx < 185) & (sat < 0.22)
        roof = ((mx - mn) < 70) & (mx >= 115) & (sat < 0.35) | \
               ((r > g * 1.15) & (r > b * 1.25) & (r > 95) & (r < 200) & (sat > 0.18) & (sat < 0.6))
        roof = roof & ~vegetation & ~water
        bare_ground = (sat < 0.2) & (mx > 80) & (mx < 200) & ~roof & ~road

        # Vectorized label assignment into the masked pixels (replaces a per-pixel
        # Python loop: same semantics, workable performance). Later classes have
        # lower priority than earlier ones because they only override where prior
        # branches did not claim the pixel -- mirroring the original if/elif chain.
        labels = np.full(len(masked_pixels), SAM_CLASSES.index("other"), dtype=np.int8)
        labels[bare_ground] = SAM_CLASSES.index("bare_ground")
        labels[roof] = SAM_CLASSES.index("roof")
        labels[road] = SAM_CLASSES.index("road")
        labels[water] = SAM_CLASSES.index("water")
        labels[vegetation] = SAM_CLASSES.index("vegetation")
        # Preserve original precedence: vegetation > water > road > roof > bare > other.
        labels = np.where(vegetation, SAM_CLASSES.index("vegetation"), labels)
        labels = np.where(water & ~vegetation, SAM_CLASSES.index("water"), labels)
        labels = np.where(road & ~vegetation & ~water, SAM_CLASSES.index("road"), labels)
        labels = np.where(roof & ~vegetation & ~water & ~road, SAM_CLASSES.index("roof"), labels)
        labels = np.where(bare_ground & ~vegetation & ~water & ~road & ~roof, SAM_CLASSES.index("bare_ground"), labels)
        ys, xs = np.nonzero(sam_mask)
        class_mask[ys, xs] = labels
        return class_mask


def sam_available() -> bool:
    """Check if SAM can be initialized (package installed, weights present)."""
    try:
        import segment_anything  # noqa: F401
        checkpoint = os.environ.get("SAM_CHECKPOINT_PATH")
        return checkpoint is not None and Path(checkpoint).exists()
    except ImportError:
        return False