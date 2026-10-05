"""Shared vision prompt and parsing for AI semantic validation.

The model is asked for semantic assessment only. It must not claim
pixel-accurate segmentation.
"""
from __future__ import annotations

import json

VISION_PROMPT = (
    "You are assessing a satellite image crop around a user-selected polygon for solar site suitability in India.\n"
    "Context: {context}\n"
    "This is a semantic validation step only; you do not provide pixel-accurate segmentation.\n"
    "Assess what you see in the crop for: rooftop / building roof, open ground, vegetation / trees, road / pavement, water, and other / uncertain.\n"
    "Respond in strict JSON only with keys:\n"
    "- primary_class: one of rooftop, open_ground, vegetation, road, water, other_uncertain\n"
    "- confidence: number 0..1\n"
    "- class_fractions: object with the same keys as primary_class values summing to ~1\n"
    "- is_suitable_for_solar: boolean\n"
    "- reason: one short sentence\n"
    "Be conservative. If uncertain, use other_uncertain with low confidence."
)


def parse_ai_json(text: str) -> dict | None:
    for chunk in [text, text[text.find("{") : text.rfind("}") + 1]]:
        try:
            parsed = json.loads(chunk)
        except (ValueError, IndexError):
            continue
        if isinstance(parsed, dict) and "primary_class" in parsed:
            return parsed
    return None
