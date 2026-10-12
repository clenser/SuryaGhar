from app.core.config import Settings
from app.providers.base import Geocoder, ProviderError
from app.providers.google import GoogleGeocoder
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


def _make_google(settings: Settings, transport=None) -> GoogleGeocoder:
    return GoogleGeocoder(
        api_key=settings.google_geocoding_api_key or "",
        base_url=settings.google_geocoding_base_url,
        timeout=settings.provider_timeout_seconds,
        transport=transport,
    )


def _make_nominatim(settings: Settings, transport=None) -> NominatimGeocoder:
    return NominatimGeocoder(
        base_url=settings.nominatim_base_url,
        user_agent=settings.nominatim_user_agent,
        timeout=settings.provider_timeout_seconds,
        transport=transport,
    )


def _make_photon(settings: Settings, transport=None) -> PhotonGeocoder:
    return PhotonGeocoder(
        base_url=settings.photon_base_url,
        timeout=settings.provider_timeout_seconds,
        transport=transport,
    )


def build_geocoder(settings: Settings, transport=None) -> Geocoder:
    """Select the geocoder from configuration. Only this module knows concrete provider classes."""
    provider = (settings.geocoder_provider or "auto").strip().lower()
    has_google_key = bool((settings.google_geocoding_api_key or "").strip())

    if provider == "google":
        return _make_google(settings, transport)
    if provider == "google+nominatim":
        return FallbackGeocoder(_make_google(settings, transport), _make_nominatim(settings, transport))
    if provider == "google+photon":
        return FallbackGeocoder(_make_google(settings, transport), _make_photon(settings, transport))
    if provider == "google+nominatim+photon":
        return FallbackGeocoder(
            _make_google(settings, transport),
            FallbackGeocoder(_make_nominatim(settings, transport), _make_photon(settings, transport)),
        )
    if provider == "auto":
        osm_chain = FallbackGeocoder(_make_nominatim(settings, transport), _make_photon(settings, transport))
        if has_google_key:
            return FallbackGeocoder(_make_google(settings, transport), osm_chain)
        return osm_chain
    if provider in ("nominatim", "nominatim+photon"):
        primary = _make_nominatim(settings, transport)
        if provider != "nominatim":
            return FallbackGeocoder(primary, _make_photon(settings, transport))
        return primary
    if provider == "photon":
        return _make_photon(settings, transport)
    raise ValueError(f"Unknown geocoder provider: {settings.geocoder_provider}")

