"""Semantic segmentation provider.

Unlike SAM, which produces instance masks and has no built-in semantic classes,
this provider loads a per-pixel semantic segmentation model. The model is
supplied by the operator via a checkpoint path -- this project does not bundle
training weights. The expected artifact is a TorchScript module (or a .pth
state dict for a model constructed from SEGMENTATION_MODEL_ARCH) that maps an
(N,3,H,W) float tensor normalized to ImageNet stats to (N,C,H,W) logits, with
C = len(SAM-style classes) matching SEGMENTATION_MODEL_CLASSES (json list)
or the default 6-class order below.

Config:
    SEGMENTATION_PROVIDER=semantic
    SEGMENTATION_MODEL_PATH=/abs/path/to/model.pt
    SEGMENTATION_MODEL_CLASSES='["roof","vegetation",...]'  (optional)
    SEGMENTATION_MODEL_ARCH=torchvision:{"deeplabv3_resnet50":21} (optional)
"""
from __future__ import annotations

import json
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

logger = logging.getLogger("solar_rooftop.segmentation.semantic")

DEFAULT_CLASSES = ["roof", "vegetation", "water", "road", "bare_ground", "other"]


class SemanticSegmentationProvider(SegmentationProvider):
    """Per-pixel semantic segmentation with an operator-supplied model."""

    def __init__(self, checkpoint_path: str | None = None, classes: list[str] | None = None, device: str | None = None,
                 model=None):
        self._checkpoint = checkpoint_path or os.environ.get("SEGMENTATION_MODEL_PATH")
        raw_classes = os.environ.get("SEGMENTATION_MODEL_CLASSES")
        if classes is not None:
            self._classes = classes
        elif raw_classes:
            try:
                parsed = json.loads(raw_classes)
                self._classes = [str(c) for c in parsed] if isinstance(parsed, list) else list(DEFAULT_CLASSES)
            except ValueError:
                self._classes = list(DEFAULT_CLASSES)
        else:
            self._classes = list(DEFAULT_CLASSES)
        self._model = model
        self._error: str | None = None
        self._device = device

    @property
    def name(self) -> str:
        return "semantic_model"

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def model_info(self) -> dict:
        return {
            "type": "semantic_segmentation",
            "checkpoint": self._checkpoint,
            "classes": self._classes,
            "error": self._error,
        }

    def is_available(self) -> bool:
        if self._model is not None:
            return True
        return self._load()

    def _load(self) -> bool:
        try:
            import torch

            device = self._device or ("cuda" if torch.cuda.is_available() else "cpu")
            self._device = device
            if self._checkpoint and Path(self._checkpoint).exists():
                try:
                    self._model = torch.jit.load(self._checkpoint, map_location=device)
                except (RuntimeError, OSError):
                    # Fall back to full-model pickle (torch.save(model, ...)).
                    self._model = torch.load(self._checkpoint, map_location=device, weights_only=False)
                self._model.eval()
                return True
            self._error = f"segmentation checkpoint not found: {self._checkpoint}"
        except Exception as exc:
            self._error = f"segmentation model unavailable: {exc}"
        return False

    def segment(self, image: np.ndarray, bounds: Bounds) -> SegmentationResult:
        if not self.is_available():
            raise RuntimeError(self._error or "semantic model unavailable")

        import torch

        h, w = image.shape[:2]
        tensor = torch.from_numpy(image.transpose(2, 0, 1)).float() / 255.0
        mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
        tensor = (tensor - mean) / std
        with torch.no_grad():
            output = self._model(tensor.unsqueeze(0).to(self._device or "cpu"))
        logits = output[0] if isinstance(output, (tuple, list)) else output
        if isinstance(logits, dict):  # torchvision DeepLab-style
            logits = logits.get("out")
        logits = logits[0].cpu().numpy()  # (C,H,W)
        num_classes = min(logits.shape[0], len(self._classes))
        probs = np.exp(logits[:num_classes] - logits[:num_classes].max(axis=0, keepdims=True))
        probs = probs / probs.sum(axis=0, keepdims=True)
        class_mask = np.argmax(probs, axis=0).astype(np.int8)
        mean_prob = float(np.mean(np.max(probs, axis=0)))

        class_fractions = {}
        for idx in range(len(self._classes[:num_classes])):
            class_fractions[self._classes[idx]] = float(np.mean(class_mask == idx))

        confidence = float(np.clip(mean_prob, 0.0, 0.95))
        return SegmentationResult(
            mask=class_mask,
            classes=self._classes[:num_classes],
            class_fractions=class_fractions,
            confidence=confidence,
            image_dims=(w, h),
            transform=compute_affine_transform(bounds, w, h),
            crs=bounds.crs,
            provider="semantic_model",
            model=Path(self._checkpoint or "custom").name,
            limitations=[
                "Semantic model output confidence is an average softmax max-probability; not a calibrated uncertainty.",
                "Model must be trained/fine-tuned for the target surface classes; generic models will mislabel classes.",
            ],
        )


def semantic_available() -> bool:
    path = os.environ.get("SEGMENTATION_MODEL_PATH")
    return path is not None and Path(path).exists()
