"""Backend configuration. Secrets are read from environment only and never exposed."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # Provider selection (AGENTS.md section 21)
    geocoder_provider: str = "nominatim"
    imagery_provider: str = "esri"
    terrain_provider: str = "aws-terrarium"

    # Outbound request policy
    provider_timeout_seconds: float = 6.0
    # Nominatim usage policy requires an identifying User-Agent and at most 1 request/second.
    nominatim_user_agent: str = "SolarRooftopAnalysis/0.1 (local-dev)"  # set NOMINATIM_USER_AGENT with a real contact
    nominatim_base_url: str = "https://nominatim.openstreetmap.org"

    # Comma-separated allowed CORS origins for the deployed frontend.
    # Default keeps local dev working; set CORS_ORIGINS on Render for production.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,https://surya-ghar.vercel.app"

    # Groq / Gemini are backend-only. Keys are loaded from the environment and never
    # returned by any endpoint or sent to the frontend.
    groq_api_key: str | None = None
    groq_vision_model: str = "qwen/qwen3.8-27b"
    gemini_api_key: str | None = None
    gemini_vision_model: str = "gemini-3.8-flash"

    # Segmentation provider selection. Default keeps the lightweight heuristic
    # unless a trained model is configured. SAM requires
    # SEGMENTATION_PROVIDER=sam + SAM_CHECKPOINT_PATH (see app/segmentation/sam_provider.py).
    segmentation_provider: str = "heuristic"
    sam_model_type: str = "vit_b"
    sam_checkpoint_path: str | None = None
    segmentation_model_path: str | None = None
    segmentation_model_classes: str | None = None
    segmentation_building_threshold: float = 0.4371


@lru_cache
def get_settings() -> Settings:
    return Settings()
