from abc import ABC, abstractmethod

from app.schemas.geocode import LocationResult


class ProviderError(Exception):
    """Upstream provider failed, timed out, or returned unusable data."""


class Geocoder(ABC):
    """Replaceable geocoding provider (AGENTS.md sections 8 and 21)."""

    name: str

    @abstractmethod
    async def search(self, query: str, limit: int = 6) -> list[LocationResult]:
        raise NotImplementedError
