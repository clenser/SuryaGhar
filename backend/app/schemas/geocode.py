from pydantic import BaseModel, Field, field_validator


class BoundingBox(BaseModel):
    """WGS84 degrees."""

    south: float
    north: float
    west: float
    east: float


class GeocodeRequest(BaseModel):
    query: str = Field(min_length=2, max_length=120)

    @field_validator("query")
    @classmethod
    def normalise(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Query must contain at least 2 non-space characters")
        return cleaned


class LocationResult(BaseModel):
    name: str
    locality: str | None = None
    state: str | None = None
    country: str | None = None
    latitude: float
    longitude: float
    bounds: BoundingBox | None = None


class GeocodeResponse(BaseModel):
    results: list[LocationResult]
    provider: str
