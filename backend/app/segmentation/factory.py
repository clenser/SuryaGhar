"""Segmentation provider factory.

Selects and initializes the appropriate segmentation provider
based on configuration and availability.
"""
from __future__ import annotations

import logging

from app.core.config import Settings
from app.segmentation.providers import (
    HEAVY_MODEL_MIN_CONTAINER_MB,
    SegmentationProvider,
    effective_memory_limit_mb,
)
from app.segmentation.heuristic import HeuristicSegmentationProvider
from app.segmentation.hotosm_provider import HotosmBuildingsProvider

# NOTE: optional providers (SAM, semantic) are imported lazily inside their
# selection branches so the HOTOSM/heuristic path does not require torch.

logger = logging.getLogger("solar_rooftop.segmentation.factory")

#: Selectable segmentation models (per validation request). HOTOSM stays default.
DEFAULT_SEGMENTATION_MODEL = "hotosm_buildings"
SUPPORTED_SEGMENTATION_MODELS = ("hotosm_buildings", "sam2_tiny", "sam2_base_plus", "sam2_large")
SEGMENTATION_MODEL_DISPLAY_NAMES = {
    "hotosm_buildings": "HOTOSM Buildings",
    "sam2_tiny": "SAM 2.1 Tiny",
    "sam2_base_plus": "SAM 2.1 Base+",
    "sam2_large": "SAM 2.1 Large",
}
SEGMENTATION_MODEL_TAGLINES = {
    "hotosm_buildings": "Default",
    "sam2_tiny": "Fastest · Lightweight",
    "sam2_base_plus": "Balanced · Higher quality",
    "sam2_large": "Highest quality · Slowest",
}


def display_name_for_provider(provider_name: str | None) -> str:
    """User-facing model name for a provider name (never leaks internals)."""
    if provider_name == "hotosm_dinov3s_buildings":
        return SEGMENTATION_MODEL_DISPLAY_NAMES["hotosm_buildings"]
    if provider_name in SEGMENTATION_MODEL_DISPLAY_NAMES:
        return SEGMENTATION_MODEL_DISPLAY_NAMES[provider_name]
    return "Heuristic"


class UnknownSegmentationModelError(ValueError):
    """An explicitly requested segmentation model identifier is not supported."""


class SegmentationModelUnavailableError(RuntimeError):
    """An explicitly requested model cannot run (missing deps/checkpoint or failed)."""


def _ensure_heavy_model_memory(model_id: str) -> None:
    """Refuse heavyweight models unless the container can provably survive them.

    A single 512 px HOTOSM inference peaks near ~450 MB above baseline and
    SAM2 needs a comparable spike; on a 512 MB container the worker is
    OOM-killed (surfacing as a proxy 502 with no CORS headers, and taking
    every other endpoint down with it). The limit is the container cap when one
    applies (production) and total host RAM otherwise (local development), so
    laptops/desktops are judged on their real memory while small containers
    stay guarded.
    """
    limit = effective_memory_limit_mb()
    if limit is None:
        logger.info("Memory limit unknown; assuming adequate host for '%s'.", model_id)
        return
    if limit < HEAVY_MODEL_MIN_CONTAINER_MB:
        raise SegmentationModelUnavailableError(
            f"Segmentation model '{model_id}' needs at least "
            f"{HEAVY_MODEL_MIN_CONTAINER_MB} MB of container memory, but only "
            f"{int(limit)} MB is available. Use a larger service plan."
        )


def resolve_segmentation_model(model_id: str | None, settings: Settings) -> SegmentationProvider:
    """Resolve an explicit per-request model choice (no silent fallback).

    Raises:
        UnknownSegmentationModelError: identifier not in SUPPORTED_SEGMENTATION_MODELS.
        SegmentationModelUnavailableError: model known but cannot run.
    """
    name = (model_id or DEFAULT_SEGMENTATION_MODEL).strip().lower()
    if name not in SUPPORTED_SEGMENTATION_MODELS:
        raise UnknownSegmentationModelError(
            f"Unknown segmentation_model '{model_id}'. "
            f"Supported: {', '.join(SUPPORTED_SEGMENTATION_MODELS)}."
        )
    if name.startswith("sam2_"):
        from app.segmentation.sam2_provider import SAM2TinyProvider

        # The legacy single-checkpoint setting applies to Tiny only; Base+ and
        # Large resolve via their own env vars or repo defaults (see provider).
        override = getattr(settings, "sam2_checkpoint_path", None) if name == "sam2_tiny" else None
        provider = SAM2TinyProvider(checkpoint_path=override, variant=name)
        if not provider.is_available():
            raise SegmentationModelUnavailableError(
                provider.unavailable_reason or f"{provider.display_name} is unavailable."
            )
        _ensure_heavy_model_memory(name)
        logger.info("Using %s provider (explicit selection)", provider.display_name)
        return provider
    _ensure_heavy_model_memory("hotosm_buildings")
    provider = HotosmBuildingsProvider()
    if not provider.is_available():
        raise SegmentationModelUnavailableError(
            "HOTOSM Buildings is unavailable: model.onnx checkpoint not found."
        )
    logger.info("Using HOTOSM dinov3s-buildings ONNX provider (explicit selection)")
    return provider


def segmentation_model_status(settings: Settings) -> list[dict]:
    """Availability of each selectable model (for /config; never raises)."""
    items: list[dict] = []
    try:
        hotosm = HotosmBuildingsProvider()
        hotosm_ok = hotosm.is_available()
    except Exception:
        hotosm_ok = False
    items.append(
        {
            "id": "hotosm_buildings",
            "display_name": SEGMENTATION_MODEL_DISPLAY_NAMES["hotosm_buildings"],
            "available": hotosm_ok,
            "default": True,
        }
    )
    try:
        from app.segmentation.sam2_provider import SAM2TinyProvider

        for variant in ("sam2_tiny", "sam2_base_plus", "sam2_large"):
            override = getattr(settings, "sam2_checkpoint_path", None) if variant == "sam2_tiny" else None
            sam2 = SAM2TinyProvider(checkpoint_path=override, variant=variant)
            sam2_ok = sam2.is_available()
            items.append(
                {
                    "id": variant,
                    "display_name": SEGMENTATION_MODEL_DISPLAY_NAMES[variant],
                    "tagline": SEGMENTATION_MODEL_TAGLINES[variant],
                    "available": sam2_ok,
                    "unavailable_reason": None if sam2_ok else sam2.unavailable_reason,
                    "default": False,
                }
            )
    except Exception as exc:
        for variant in ("sam2_tiny", "sam2_base_plus", "sam2_large"):
            items.append(
                {
                    "id": variant,
                    "display_name": SEGMENTATION_MODEL_DISPLAY_NAMES[variant],
                    "tagline": SEGMENTATION_MODEL_TAGLINES[variant],
                    "available": False,
                    "unavailable_reason": str(exc),
                    "default": False,
                }
            )
    return items


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
            try:
                _ensure_heavy_model_memory("hotosm_buildings")
            except SegmentationModelUnavailableError as exc:
                logger.warning("%s Falling back to heuristic.", exc)
            else:
                logger.info("Using HOTOSM dinov3s-buildings ONNX provider (building mask)")
                return provider
        else:
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