"""HOTOSM dinov3s-buildings ONNX segmentation provider.

Building-footprint masks only. This model does NOT distinguish roof/vegetation/
road/water classes; it returns a per-pixel building candidate mask. Semantic
meaning is provided downstream by the Groq/Gemini vision chain.

Documented inference contract (hotosm/fAIr dinov3s_buildings):
- RGB input tile normalized to the HOT mean/std
- 256 px window, sliding with 192 px stride
- Decoder logits [1, C, 256, 256]; probability via sigmoid on channel 0
- Default probability threshold: 0.4371

Configuration:
    SEGMENTATION_MODEL_PATH=/abs/path/to/model.onnx
    SEGMENTATION_BUILDING_THRESHOLD=0.4371
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

from app.segmentation.providers import (
    Bounds,
    SegmentationProvider,
    SegmentationResult,
    compute_affine_transform,
)

logger = logging.getLogger("solar_rooftop.segmentation.hotosm")

WINDOW = 256
STRIDE = 192
HOT_MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
HOT_STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
CLASSES = ["other", "building"]


class HotosmBuildingsProvider(SegmentationProvider):
    @property
    def name(self) -> str:
        return "hotosm_dinov3s_buildings"

    @property
    def model_info(self) -> dict:
        return {
            "type": "building_footprint",
            "name": "dinov3s_buildings",
            "framework": "onnx",
            "window_px": WINDOW,
            "stride_px": STRIDE,
            "threshold": self._threshold(),
            "semantic_classes": False,
            "note": "Buildings-only footprint model; not a semantic classifier.",
        }

    def _threshold(self) -> float:
        try:
            from app.core.config import get_settings

            return float(get_settings().segmentation_building_threshold)
        except Exception:
            return 0.4371

    def _model_path(self) -> str | None:
        candidates: list[str] = []
        try:
            from app.core.config import get_settings

            p = get_settings().segmentation_model_path
            if p:
                candidates.append(str(p))
        except Exception:
            pass
        env = os.environ.get("SEGMENTATION_MODEL_PATH")
        if env:
            candidates.append(env)
        # Base candidates on the repo's backend/ directory so relative paths resolve
        # whether the process starts in /app, /app/backend, or another cwd. The repo
        # is structured as backend/app/segmentation/, so parents[2] is backend/.
        backend_dir = Path(__file__).resolve().parents[2]
        candidates.extend(str(backend_dir / p) for p in list(candidates) if not Path(p).is_absolute())
        for candidate in candidates:
            if Path(candidate).exists():
                return candidate
        return candidates[0] if candidates else None

    def is_available(self) -> bool:
        path = self._model_path()
        return path is not None and Path(path).exists()

    def _session(self):
        if getattr(self, "_sess", None) is not None:
            return self._sess
        import onnxruntime as ort

        path = self._model_path()
        if not path or not Path(path).exists():
            raise RuntimeError("SEGMENTATION_MODEL_PATH does not exist")
        self._sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        return self._sess

    def _windows(self, size: int) -> list[int]:
        if size <= WINDOW:
            return [0]
        starts = list(range(0, size - WINDOW + 1, STRIDE))
        if starts[-1] != size - WINDOW:
            starts.append(size - WINDOW)
        return starts

    def building_probability(self, image: np.ndarray) -> np.ndarray:
        h, w = image.shape[:2]
        acc = np.zeros((h, w), dtype=np.float64)
        counts = np.zeros((h, w), dtype=np.float64)
        sess = self._session()

        pad_h = max(0, WINDOW - h)
        pad_w = max(0, WINDOW - w)
        canvas = np.pad(image, ((0, pad_h), (0, pad_w), (0, 0))) if pad_h or pad_w else image
        H, W = canvas.shape[:2]

        for y in self._windows(H):
            for x in self._windows(W):
                window = canvas[y : y + WINDOW, x : x + WINDOW]
                tensor = ((window.transpose(2, 0, 1).astype(np.float32) / 255.0 - HOT_MEAN) / HOT_STD).astype(np.float32)
                logits = sess.run(None, {"image": tensor[None, ...]})[0]
                prob = 1.0 / (1.0 + np.exp(-logits[0, 0]))
                acc[y : y + WINDOW, x : x + WINDOW] += prob
                counts[y : y + WINDOW, x : x + WINDOW] += 1
        counts[counts == 0] = 1.0
        return (acc / counts)[:h, :w].astype(np.float32)

    def segment(self, image: np.ndarray, bounds: Bounds) -> SegmentationResult:
        prob = self.building_probability(image)
        threshold = self._threshold()
        building = prob >= threshold
        mask = np.where(building, 1, 0).astype(np.int8)
        h, w = image.shape[:2]
        class_fractions = {cls: float(np.mean(mask == idx)) for idx, cls in enumerate(CLASSES)}
        building_pixels = prob[building]
        confidence = float(np.clip(building_pixels.mean() if building_pixels.size else 0.0, 0.0, 0.95))
        return SegmentationResult(
            mask=mask,
            classes=list(CLASSES),
            class_fractions=class_fractions,
            confidence=confidence,
            image_dims=(w, h),
            transform=compute_affine_transform(bounds, w, h),
            crs=bounds.crs,
            provider=self.name,
            model="dinov3s_buildings.onnx",
            limitations=[
                "Buildings-only footprint model, not multi-class semantic segmentation.",
                "Confidence is the mean sigmoid probability of building pixels; not calibrated.",
                "Building candidates still require Groq/Gemini semantic validation and geometric checks.",
            ],
        )
