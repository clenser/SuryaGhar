from app.core.config import Settings
from app.providers.base import Geocoder, ProviderError
from app.providers.nominatim import NominatimGeocoder
from app.providers.photon import PhotonGeocoder
from app.schemas.geocode import LocationResult


class FallbackGeocoder(Geocoder):
    """Tries the primary geocoder, falling back to the secondary only on failure."""

    def __init__(self, primary: Geocoder, fallback: Geocoder):
        self._primary = primary
        self._fallback = fallback
        self.name = f"{primary.name}+{fallback.name}"

    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        try:
            return await self._primary.search(query, limit)
        except ProviderError:
            return await self._fallback.search(query, limit)


def build_geocoder(settings: Settings, transport=None) -> Geocoder:
    """Select the geocoder from configuration. Only this module knows concrete provider classes."""
    if settings.geocoder_provider in ("nominatim", "nominatim+photon", "auto"):
        primary = NominatimGeocoder(
            base_url=settings.nominatim_base_url,
            user_agent=settings.nominatim_user_agent,
            timeout=settings.provider_timeout_seconds,
            transport=transport,
        )
        if settings.geocoder_provider != "nominatim":
            return FallbackGeocoder(
                primary,
                PhotonGeocoder(
                    base_url=settings.photon_base_url,
                    timeout=settings.provider_timeout_seconds,
                    transport=transport,
                ),
            )
        return primary
    if settings.geocoder_provider == "photon":
        return PhotonGeocoder(base_url=settings.photon_base_url, timeout=settings.provider_timeout_seconds, transport=transport)
    raise ValueError(f"Unknown geocoder provider: {settings.geocoder_provider}")
