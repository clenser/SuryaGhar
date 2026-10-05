from app.core.config import Settings
from app.providers.base import Geocoder
from app.providers.nominatim import NominatimGeocoder


def build_geocoder(settings: Settings, transport=None) -> Geocoder:
    """Select the geocoder from configuration. Only this module knows concrete provider classes."""
    if settings.geocoder_provider == "nominatim":
        return NominatimGeocoder(
            base_url=settings.nominatim_base_url,
            user_agent=settings.nominatim_user_agent,
            timeout=settings.provider_timeout_seconds,
            transport=transport,
        )
    raise ValueError(f"Unknown geocoder provider: {settings.geocoder_provider}")
