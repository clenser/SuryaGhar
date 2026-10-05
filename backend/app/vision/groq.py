"""Groq Vision semantic validation provider.

Groq is one of the AI vision providers in the fallback chain. It never
replaces the pixel mask; it only comments on the crop semantically.
"""
from __future__ import annotations

import base64
import json

import httpx

from app.core.config import Settings
from app.vision.prompt import VISION_PROMPT, parse_ai_json

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


async def validate_with_groq(crop_jpeg: bytes, polygon_summary: str, settings: Settings) -> dict | None:
    if not settings.groq_api_key:
        return None
    body = {
        "model": settings.groq_vision_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VISION_PROMPT.format(context=polygon_summary)},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(crop_jpeg).decode("ascii")},
                    },
                ],
            }
        ],
        "max_tokens": 500,
        "temperature": 0,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(GROQ_URL, headers={"Authorization": f"Bearer {settings.groq_api_key}"}, json=body)
        if response.status_code != 200:
            return None
        payload = response.json()
        text = payload["choices"][0]["message"]["content"]
        return parse_ai_json(text)
    except Exception:
        return None
