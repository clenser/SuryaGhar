"""SAM 2.1 segmentation providers (local debugging/comparison only).

Runs alongside -- never replacing -- the default HOTOSM buildings model. The
user selects a variant explicitly per validation request for behaviour and
speed comparison (Tiny vs Base+ vs Large).

Supported variants (official SAM 2.1 configs, no custom architectures):
- sam2_tiny:      sam2.1_hiera_tiny.pt      + configs/sam2.1/sam2.1_hiera_t.yaml
- sam2_base_plus: sam2.1_hiera_base_plus.pt + configs/sam2.1/sam2.1_hiera_b+.yaml
- sam2_large:     sam2.1_hiera_large.pt     + configs/sam2.1/sam2.1_hiera_l.yaml

Startup-safety rules (Render runs on the same web service, usually CPU-only):
- NEVER import torch or sam2 at module level. All heavy imports happen inside
  the initialization/inference path, so ``from app.main import app`` works
  without torch installed.
- CUDA is preferred when present, CPU is the automatic fallback. CUDA is never
  mandatory and its absence is never fatal.

Memory rules (RTX 3050 / small containers):
- Each variant's predictor loads lazily and is cached after first use.
- Selecting a variant never loads the others; switching releases the
  previously loaded variant first (del + gc + cuda.empty_cache) so VRAM
  pressure cannot accumulate. Only one SAM2 variant is resident at a time.

SAM2 is a promptable segmenter, not a semantic rooftop classifier: it does NOT
label pixels as roof/road/vegetation/water. The pipeline used here is:

    selected polygon -> satellite crop -> polygon bbox (crop pixels)
        -> SAM2 box prompt -> SAM2 mask -> clip to prompt box
        -> classes ["other", "building-candidate"]

The existing semantic/surface validation pipeline operates separately on top.
The SAME polygon/crop/preprocessing feeds every variant (fair comparison).
"""
from __future__ import annotations

import gc
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

from app.segmentation.providers import HEAVY_INFERENCE_SEMAPHORE

BACKEND_DIR = Path(__file__).resolve().parents[2]
MODEL_DIR = BACKEND_DIR / "models"

SAM2_VARIANTS: dict[str, dict[str, str]] = {
    "sam2_tiny": {
        "checkpoint": "sam2.1_hiera_tiny.pt",
        "config": "sam2.1_hiera_t.yaml",
        "display_name": "SAM 2.1 Tiny",
        "tagline": "Fastest · Lightweight",
        "env_var": "SAM2_TINY_CHECKPOINT_PATH",
    },
    "sam2_base_plus": {
        "checkpoint": "sam2.1_hiera_base_plus.pt",
        "config": "sam2.1_hiera_b+.yaml",
        "display_name": "SAM 2.1 Base+",
        "tagline": "Balanced · Higher quality",
        "env_var": "SAM2_BASE_PLUS_CHECKPOINT_PATH",
    },
    "sam2_large": {
        "checkpoint": "sam2.1_hiera_large.pt",
        "config": "sam2.1_hiera_l.yaml",
        "display_name": "SAM 2.1 Large",
        "tagline": "Highest quality · Slowest",
        "env_var": "SAM2_LARGE_CHECKPOINT_PATH",
    },
}

# Backwards-compatible default (Tiny) for existing imports/tests.
DEFAULT_CHECKPOINT = MODEL_DIR / SAM2_VARIANTS["sam2_tiny"]["checkpoint"]

CLASSES = ["other", "building"]

# Process-wide per-variant predictor cache. Only ONE variant is resident at a
# time (see _ensure_loaded): checkpoints load lazily, never at import time and
# never all at startup.
_PREDICTORS: dict[str, object] = {}
_PREDICTOR_DEVICES: dict[str, str] = {}
_LOAD_LOCK = _threading.Lock()


def _release_all_variants() -> None:
    """Drop every cached predictor and reclaim GPU memory (best effort)."""
    global _PREDICTORS
    _PREDICTORS = {}
    _PREDICTOR_DEVICES.clear()
    gc.collect()
    try:
        import torch  # lazy; no-op if never imported

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


class SAM2TinyProvider(SegmentationProvider):
    """SAM 2.1 variant provider with a polygon-bbox box prompt.

    Despite the historical class name, `variant` selects Tiny, Base+ or Large.
    """

    #: validate.py passes prompt_box only to providers opting in.
    accepts_prompt_box = True

    def __init__(self, checkpoint_path: Optional[str] = None, variant: str = "sam2_tiny"):
        if variant not in SAM2_VARIANTS:
            raise ValueError(f"Unknown SAM2 variant '{variant}'. Supported: {sorted(SAM2_VARIANTS)}.")
        self._variant = variant
        spec = SAM2_VARIANTS[variant]
        self._checkpoint_path = (
            checkpoint_path or os.environ.get(spec["env_var"]) or os.environ.get("SAM2_CHECKPOINT_PATH") or str(MODEL_DIR / spec["checkpoint"])
        )
        self._unavailable_reason: Optional[str] = None

    @property
    def variant(self) -> str:
        return self._variant

    @property
    def display_name(self) -> str:
        return SAM2_VARIANTS[self._variant]["display_name"]

    @property
    def name(self) -> str:
        return self._variant

    @property
    def current_device(self) -> str:
        """Actual device of the resident predictor for this variant ("cuda"/"cpu")."""
        return _PREDICTOR_DEVICES.get(self._variant, "cpu")

    @property
    def model_info(self) -> dict:
        return {
            "type": "promptable_segmentation",
            "name": SAM2_VARIANTS[self._variant]["checkpoint"].removesuffix(".pt"),
            "checkpoint": self._checkpoint_path,
            "device": self.current_device,
            "loaded": self._variant in _PREDICTORS,
            "note": "Debugging/comparison model; promptable only, not a semantic classifier.",
        }

    @property
    def unavailable_reason(self) -> Optional[str]:
        return self._unavailable_reason

    def _resolve_config(self) -> Optional[str]:
        """Locate the variant's official config shipped inside the sam2 package.

        Returns the absolute filesystem path, used only as an existence gate
        so missing configs fail with a clear error instead of a Hydra error.
        """
        try:
            import sam2  # lazy: never at module import time
        except ImportError:
            return None
        candidate = Path(sam2.__file__).resolve().parent / "configs" / "sam2.1" / SAM2_VARIANTS[self._variant]["config"]
        return str(candidate) if candidate.exists() else None

    def _hydra_config_name(self) -> str:
        """Config name for ``build_sam2``, relative to the sam2 package.

        ``build_sam2`` forwards this to Hydra's ``compose(config_name=...)``,
        and the sam2 package registers itself (``pkg://sam2``) as the config
        search path on import. An absolute filesystem path is NOT a valid
        Hydra config name: it fails with "Cannot find primary config" on some
        platforms/versions even when the file exists. This is the official
        usage (e.g. ``configs/sam2.1/sam2.1_hiera_t.yaml``).
        """
        return f"configs/sam2.1/{SAM2_VARIANTS[self._variant]['config']}"

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
            return False, f"SAM2 config {SAM2_VARIANTS[self._variant]['config']} not found in the installed sam2 package"
        return True, None

    def is_available(self) -> bool:
        if self._variant in _PREDICTORS:
            return True
        ok, reason = self.dependencies_available()
        if not ok:
            self._unavailable_reason = reason
            return False
        if not self._checkpoint_path or not Path(self._checkpoint_path).exists():
            self._unavailable_reason = (
                f"{self.display_name} is unavailable: checkpoint not found at {self._checkpoint_path}"
            )
            return False
        self._unavailable_reason = None
        return True

    def _ensure_loaded(self) -> None:
        """Load this variant once; release any other resident variant first."""
        if self._variant in _PREDICTORS:
            return
        with _LOAD_LOCK:
            if self._variant in _PREDICTORS:
                return
            import torch  # lazy
            from sam2.build_sam import build_sam2  # lazy
            from sam2.sam2_image_predictor import SAM2ImagePredictor  # lazy

            if self._resolve_config() is None:
                raise RuntimeError(
                    f"SAM2 config {SAM2_VARIANTS[self._variant]['config']} not found in the installed sam2 package"
                )
            if not self._checkpoint_path or not Path(self._checkpoint_path).exists():
                raise RuntimeError(f"SAM2 checkpoint not found at {self._checkpoint_path}")

            # VRAM safety: only one variant resident at a time.
            if _PREDICTORS:
                logger.info("Releasing %s before loading %s", list(_PREDICTORS), self._variant)
                _release_all_variants()

            try:
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
            if device == "cuda":
                try:
                    gpu = torch.cuda.get_device_name(0)
                except Exception:
                    gpu = "unknown CUDA device"
                logger.info("SAM 2.1 %s selected on CUDA (%s)", self._variant, gpu)
            model = build_sam2(self._hydra_config_name(), self._checkpoint_path, device=device)
            _PREDICTORS[self._variant] = SAM2ImagePredictor(model)
            _PREDICTOR_DEVICES[self._variant] = device
            logger.info("SAM 2.1 variant '%s' loaded on %s", self._variant, device)

    def segment(
        self,
        image: np.ndarray,
        bounds: Bounds,
        prompt_box: Optional[tuple[float, float, float, float]] = None,
    ) -> SegmentationResult:
        """Run SAM2 with a box prompt; clip the mask to the prompt box."""
        if not self.is_available():
            raise RuntimeError(f"{self.display_name} unavailable: {self._unavailable_reason or 'unknown reason'}")
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

        import torch  # lazy (already imported by _ensure_loaded)

        predictor = _PREDICTORS[self._variant]
        # Bounded concurrency shared with the other heavyweight model, so
        # parallel validations cannot exhaust a small single-service container.
        # Waiting happens in a worker thread (see validate.py), never on the
        # event loop.
        try:
            with HEAVY_INFERENCE_SEMAPHORE:
                predictor.set_image(image)
                masks, scores, _ = predictor.predict(box=box, multimask_output=True)
        except torch.cuda.OutOfMemoryError:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            raise RuntimeError(
                f"{self.display_name} ran out of GPU memory on this crop. "
                f"Try the Tiny variant or a smaller selection."
            )
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
            model=SAM2_VARIANTS[self._variant]["checkpoint"].removesuffix(".pt"),
            limitations=[
                "Promptable segmentation only; 'building' means the SAM2 mask region, not a semantic roof class.",
                "Box prompt comes from the selected polygon bounds; the mask is clipped to that box.",
                "CPU inference can be slow on large crops.",
            ],
        )
