"""AI vision validation fallback chain: Groq -> Gemini -> local heuristic."""
from __future__ import annotations

import logging

from app.core.config import Settings
from app.vision.gemini import validate_with_gemini
from app.vision.groq import validate_with_groq

logger = logging.getLogger("solar_rooftop.vision")


async def validate_with_ai_chain(crop_jpeg: bytes, polygon_summary: str, settings: Settings) -> tuple[dict | None, str]:
    """Returns (ai_result, provider_label).

    provider_label: "groq", "gemini", or "heuristic".
    """
    result = await validate_with_groq(crop_jpeg, polygon_summary, settings)
    if result is not None:
        result["provider"] = "groq"
        result["model"] = settings.groq_vision_model
        logger.info("AI validation provider: Groq Vision (model=%s)", settings.groq_vision_model)
        return result, "groq"
    logger.info("Groq Vision unavailable/failed; trying Gemini Vision")

    result = await validate_with_gemini(crop_jpeg, polygon_summary, settings)
    if result is not None:
        result["provider"] = "gemini"
        result["model"] = settings.gemini_vision_model
        logger.info("AI validation provider: Gemini Vision fallback (model=%s)", settings.gemini_vision_model)
        return result, "gemini"
    logger.info("Gemini Vision unavailable/failed; falling back to local heuristic")
    return None, "heuristic"
