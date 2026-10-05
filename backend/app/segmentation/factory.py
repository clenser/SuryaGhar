"""Segmentation provider factory.

Selects and initializes the appropriate segmentation provider
based on configuration and availability.
"""
from __future__ import annotations

import logging

from app.core.config import Settings
from app.segmentation.providers import SegmentationProvider
from app.segmentation.heuristic import HeuristicSegmentationProvider
from app.segmentation.hotosm_provider import HotosmBuildingsProvider

# NOTE: optional providers (SAM, semantic) are imported lazily inside their
# selection branches so the HOTOSM/heuristic path does not require torch.

logger = logging.getLogger("solar_rooftop.segmentation.factory")


def get_segmentation_provider(settings: Settings) -> SegmentationProvider:
    """Get the configured segmentation provider with fallback.

    Priority:
    1. SAM (if configured and available)
    2. Heuristic (always available)

    Args:
        settings: Application settings

    Returns:
        SegmentationProvider instance
    """
    provider_name = getattr(settings, "segmentation_provider", "heuristic").lower()
    model_path = getattr(settings, "segmentation_model_path", None) or getattr(settings, "sam_checkpoint_path", None)

    if provider_name in ("hotosm", "dinov3s_buildings", "hotosm_buildings") or (
        provider_name == "auto" and model_path and str(model_path).endswith(".onnx")
    ):
        import os

        if model_path:
            os.environ.setdefault("SEGMENTATION_MODEL_PATH", str(model_path))
        provider = HotosmBuildingsProvider()
        if provider.is_available():
            logger.info("Using HOTOSM dinov3s-buildings ONNX provider (building mask)")
            return provider
        logger.warning("HOTOSM ONNX model path not found; falling back to heuristic")

    # The semantic model (per-pixel classes) takes precedence when explicitly configured
    # or selected, because SAM is not a semantic segmenter.
    if provider_name == "semantic" or (provider_name == "auto"):
        from app.segmentation.semantic_provider import SemanticSegmentationProvider, semantic_available

        if provider_name == "semantic" or semantic_available():
            provider = SemanticSegmentationProvider(
                checkpoint_path=getattr(settings, "segmentation_model_path", None),
            )
            if provider.is_available():
                logger.info("Using semantic segmentation provider")
                return provider
            logger.warning("Semantic segmentation requested but unavailable: %s", provider.error)

    if provider_name == "sam" or provider_name == "auto":
        try:
            from app.segmentation.sam_provider import SAMSegmentationProvider, sam_available
        except ImportError as exc:
            sam_available_fn = False
            sam_available_err = exc
            SAMSegmentationProvider = None
            if provider_name == "sam":
                logger.error(
                    "SEGMENTATION_PROVIDER=sam but SAM dependencies are missing (%s). "
                    "Install torch + segment-anything or choose hotosm_buildings/heuristic.",
                    sam_available_err,
                )
        else:
            try:
                available = sam_available()
            except Exception:
                available = False
            if provider_name == "sam" and available:
                logger.info("Using SAM segmentation provider (structural; classes are color-assisted)")
                return SAMSegmentationProvider(
                    model_type=getattr(settings, "sam_model_type", "vit_b"),
                    checkpoint_path=getattr(settings, "sam_checkpoint_path", None),
                )
            if provider_name == "sam" and not available:
                logger.warning("SAM requested but not available (missing package or weights); falling back to heuristic")

    logger.info("Using heuristic segmentation provider")
    return HeuristicSegmentationProvider()


def get_segmentation_provider_name(settings: Settings) -> str:
    """Get the name of the provider that would be selected."""
    provider_name = getattr(settings, "segmentation_provider", "heuristic").lower()

    if provider_name in ("hotosm", "dinov3s_buildings", "hotosm_buildings"):
        return "hotosm_dinov3s_buildings"
    if provider_name == "semantic":
        from app.segmentation.semantic_provider import SemanticSegmentationProvider

        provider = SemanticSegmentationProvider(
            checkpoint_path=getattr(settings, "segmentation_model_path", None),
        )
        return "semantic_model" if provider.is_available() else "heuristic"
    if provider_name == "sam":
        try:
            from app.segmentation.sam_provider import sam_available

            return "sam" if sam_available() else "heuristic"
        except ImportError:
            return "heuristic"
    return "heuristic"