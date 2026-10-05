"""SAM 2.1 Tiny segmentation provider (debugging/comparison only).

Runs alongside -- never replacing -- the default HOTOSM buildings model. The
user selects it explicitly per validation request for behaviour comparison.

Startup-safety rules (Render runs on the same web service, usually CPU-only):
- NEVER import torch or sam2 at module level. All heavy imports happen inside
  the initialization/inference path, so ``from app.main import app`` works
  without torch installed.
- CUDA is preferred when present, CPU is the automatic fallback. CUDA is never
  mandatory and its absence is never fatal.

SAM2 is a promptable segmenter, not a semantic rooftop classifier: it does NOT
label pixels as roof/road/vegetation/water. The pipeline used here is:

    selected polygon -> satellite crop -> polygon bbox (crop pixels)
        -> SAM2 box prompt -> SAM2 mask -> clip to prompt box
        -> classes ["other", "building-candidate"]

The existing semantic/surface validation pipeline operates separately on top.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np

from app.segmentation.providers import (
    Bounds,
    SegmentationProvider,
    SegmentationResult,
    compute_affine_transform,
)

logger = logging.getLogger("solar_rooftop.segmentation.sam2")

import threading as _threading

BACKEND_DIR = Path(__file__).resolve().parents[2]
MODEL_DIR = BACKEND_DIR / "models"
DEFAULT_CHECKPOINT = MODEL_DIR / "sam2.1_hiera_tiny.pt"
CONFIG_RELATIVE = Path("configs") / "sam2.1" / "sam2.1_hiera_t.yaml"

CLASSES = ["other", "building"]

# Process-wide predictor cache: the 156 MB checkpoint loads once per process,
# never per request and never at import time. The semaphore bounds concurrent
# CPU inferences so parallel validations cannot exhaust a small container.
_PREDICTOR = None
_PREDICTOR_DEVICE = "cpu"
_PREDICTOR_LOADED = False
_LOAD_LOCK = _threading.Lock()
_INFERENCE_SEMAPHORE = _threading.Semaphore(2)


class SAM2TinyProvider(SegmentationProvider):
    """SAM 2.1 Tiny with a polygon-bbox box prompt."""

    #: validate.py passes prompt_box only to providers opting in.
    accepts_prompt_box = True

    def __init__(self, checkpoint_path: Optional[str] = None):
        self._checkpoint_path = checkpoint_path or os.environ.get("SAM2_CHECKPOINT_PATH") or str(DEFAULT_CHECKPOINT)
        self._unavailable_reason: Optional[str] = None

    @property
    def name(self) -> str:
        return "sam2_tiny"

    @property
    def model_info(self) -> dict:
        return {
            "type": "promptable_segmentation",
            "name": "sam2.1_hiera_tiny",
            "checkpoint": self._checkpoint_path,
            "device": _PREDICTOR_DEVICE,
            "loaded": _PREDICTOR_LOADED,
            "note": "Debugging/comparison model; promptable only, not a semantic classifier.",
        }

    @property
    def unavailable_reason(self) -> Optional[str]:
        return self._unavailable_reason

    def _resolve_config(self) -> Optional[str]:
        """Locate the sam2.1_hiera_t.yaml shipped inside the sam2 package."""
        try:
            import sam2  # lazy: never at module import time
        except ImportError:
            return None
        candidate = Path(sam2.__file__).resolve().parent / CONFIG_RELATIVE
        return str(candidate) if candidate.exists() else None

    def dependencies_available(self) -> tuple[bool, Optional[str]]:
        """Lightweight check: imports + config resolvable, weights NOT loaded."""
        try:
            import torch  # noqa: F401  (lazy)
        except ImportError:
            return False, "PyTorch is not installed"
        try:
            import sam2  # noqa: F401  (lazy)
            from sam2.build_sam import build_sam2  # noqa: F401
            from sam2.sam2_image_predictor import SAM2ImagePredictor  # noqa: F401
        except ImportError:
            return False, "sam2 package is not installed"
        if self._resolve_config() is None:
            return False, "SAM2 config sam2.1_hiera_t.yaml not found in the installed sam2 package"
        return True, None

    def is_available(self) -> bool:
        if _PREDICTOR_LOADED and _PREDICTOR is not None:
            return True
        ok, reason = self.dependencies_available()
        if not ok:
            self._unavailable_reason = reason
            return False
        if not self._checkpoint_path or not Path(self._checkpoint_path).exists():
            self._unavailable_reason = f"SAM2 checkpoint not found at {self._checkpoint_path}"
            return False
        self._unavailable_reason = None
        return True

    def _ensure_loaded(self) -> None:
        """Load weights once per process, preferring CUDA with automatic CPU fallback."""
        global _PREDICTOR, _PREDICTOR_DEVICE, _PREDICTOR_LOADED
        if _PREDICTOR_LOADED and _PREDICTOR is not None:
            return
        with _LOAD_LOCK:
            if _PREDICTOR_LOADED and _PREDICTOR is not None:
                return
            import torch  # lazy
            from sam2.build_sam import build_sam2  # lazy
            from sam2.sam2_image_predictor import SAM2ImagePredictor  # lazy

            config_file = self._resolve_config()
            if config_file is None:
                raise RuntimeError("SAM2 config sam2.1_hiera_t.yaml not found in the installed sam2 package")
            if not self._checkpoint_path or not Path(self._checkpoint_path).exists():
                raise RuntimeError(f"SAM2 checkpoint not found at {self._checkpoint_path}")

            try:
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
            model = build_sam2(config_file, self._checkpoint_path, device=device)
            _PREDICTOR = SAM2ImagePredictor(model)
            _PREDICTOR_DEVICE = device
            _PREDICTOR_LOADED = True
            logger.info("SAM 2.1 Tiny loaded on %s", device)

    def segment(
        self,
        image: np.ndarray,
        bounds: Bounds,
        prompt_box: Optional[tuple[float, float, float, float]] = None,
    ) -> SegmentationResult:
        """Run SAM2 with a box prompt; clip the mask to the prompt box."""
        if not self.is_available():
            raise RuntimeError(f"SAM2 Tiny unavailable: {self._unavailable_reason or 'unknown reason'}")
        self._ensure_loaded()

        h, w = image.shape[:2]
        if prompt_box is None:
            box = np.array([0, 0, w, h], dtype=np.float32)
        else:
            x0, y0, x1, y1 = (float(v) for v in prompt_box)
            box = np.array(
                [
                    min(max(x0, 0.0), float(w - 1)),
                    min(max(y0, 0.0), float(h - 1)),
                    min(max(x1, 1.0), float(w)),
                    min(max(y1, 1.0), float(h)),
                ],
                dtype=np.float32,
            )

        # Bounded concurrency: at most 2 CPU inferences at once so parallel
        # validations cannot exhaust a small single-service container. Waiting
        # happens in a worker thread (see validate.py), never on the event loop.
        with _INFERENCE_SEMAPHORE:
            _PREDICTOR.set_image(image)
            masks, scores, _ = _PREDICTOR.predict(box=box, multimask_output=True)
        best_idx = int(np.argmax(np.asarray(scores)))
        best = np.asarray(masks[best_idx]).astype(bool)
        score = float(np.asarray(scores)[best_idx])

        # Clip to the prompt box: SAM2 must not claim area outside the selection.
        ys, xs = np.mgrid[0:h, 0:w]
        inbox = (xs >= box[0]) & (xs < box[2]) & (ys >= box[1]) & (ys < box[3])
        building = best & inbox

        mask = np.where(building, 1, 0).astype(np.int8)
        class_fractions = {cls: float(np.mean(mask == idx)) for idx, cls in enumerate(CLASSES)}
        confidence = float(np.clip(score, 0.0, 0.95))

        return SegmentationResult(
            mask=mask,
            classes=list(CLASSES),
            class_fractions=class_fractions,
            confidence=confidence,
            image_dims=(w, h),
            transform=compute_affine_transform(bounds, w, h),
            crs=bounds.crs,
            provider=self.name,
            model="sam2.1_hiera_tiny",
            limitations=[
                "Promptable segmentation only; 'building' means the SAM2 mask region, not a semantic roof class.",
                "Box prompt comes from the selected polygon bounds; the mask is clipped to that box.",
                "CPU inference can be slow on large crops.",
            ],
        )
