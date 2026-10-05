"""Gemini Vision semantic validation provider (fallback)."""
from __future__ import annotations

import asyncio

from app.core.config import Settings
from app.vision.prompt import VISION_PROMPT, parse_ai_json


async def validate_with_gemini(crop_jpeg: bytes, polygon_summary: str, settings: Settings) -> dict | None:
    if not settings.gemini_api_key:
        return None

    def _call() -> dict | None:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        response = client.models.generate_content(
            model=settings.gemini_vision_model,
            contents=[
                types.Part.from_text(text=VISION_PROMPT.format(context=polygon_summary)),
                types.Part.from_bytes(data=crop_jpeg, mime_type="image/jpeg"),
            ],
        )
        if not response or not getattr(response, "text", None):
            return None
        return parse_ai_json(response.text)

    try:
        return await asyncio.to_thread(_call)
    except Exception:
        return None
