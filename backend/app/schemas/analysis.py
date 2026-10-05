from typing import Any

from pydantic import BaseModel, Field, field_validator


class GeometryInput(BaseModel):
    """Minimal GeoJSON geometry acceptor: Polygon or MultiPolygon."""

    type: str
    coordinates: Any

    @field_validator("type")
    @classmethod
    def _check_type(cls, value: str) -> str:
        if value not in ("Polygon", "MultiPolygon"):
            raise ValueError("geometry type must be Polygon or MultiPolygon")
        return value


class MetricsRequest(BaseModel):
    geometry: GeometryInput


class MetricsResponse(BaseModel):
    area_m2: float
    perimeter_m: float
    centroid: dict[str, float]
    valid: bool
    issue: str | None
    fixed: bool


class ValidateRequest(BaseModel):
    geometry: GeometryInput


class ValidateResponse(BaseModel):
    classification: str
    confidence: float
    coverage: float
    components: dict[str, float]
    metrics: dict
    images: dict | None = None
    warnings: list[str]
    limitations: list[str] | None = None
    providers: dict | None = None
    ai: dict | None = None
    confidence_detail: dict | None = None
    legacy_confidence: float | None = None
    evidence: dict | None = None


class PanelLayoutRequest(BaseModel):
    geometry: GeometryInput
    panel_width_m: float = Field(default=2.0, ge=0.3, le=4.0)
    panel_height_m: float = Field(default=1.1, ge=0.3, le=3.0)
    wattage_w: float = Field(default=430.0, ge=100, le=800)
    row_spacing_m: float = Field(default=0.6, ge=0.0, le=5.0)
    setback_m: float = Field(default=0.5, ge=0.0, le=10.0)
    tilt_deg: float = Field(default=18.0, ge=0, le=90)
    azimuth_deg: float = Field(default=180.0, ge=0, le=360)


class PanelLayoutResponse(BaseModel):
    panel_count: int
    capacity_kwp: float
    usable_area_m2: float
    total_area_m2: float
    occupied_area_m2: float | None = None
    excluded_area_m2: float | None = None
    optimization_metadata: dict | None = None
    footprints: list[dict]
    assumptions: dict
    warnings: list[str]


class SolarRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    capacity_kwp: float = Field(gt=0, le=100000)
    tilts: list[float] | None = None
    azimuths: list[float] | None = None


class SolarResponse(BaseModel):
    annual_kwh: float | None
    specific_yield_kwh_kwp: float | None
    poa_kwh_m2: float | None
    selected: dict
    candidates: list[dict]
    confidence: str
    resource_provider: str
    assumptions: dict
    warnings: list[str]


class SurroundingsRequest(BaseModel):
    geometry: GeometryInput
    radius_m: float = Field(default=150.0, ge=25, le=1000)


class SurroundingsResponse(BaseModel):
    building_count: int
    buildings_with_height_tag: int
    median_height_m: float | None
    max_height_m: float | None
    tree_count: int
    area_m2: float
    confidence: str
    warnings: list[str]
    provider: str


class ShadowRequest(BaseModel):
    geometry: GeometryInput
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hour_utc: float = Field(ge=0, le=24)
    radius_m: float = Field(default=120.0, ge=25, le=1000)


class ShadowResponse(BaseModel):
    hour_shading_fraction: float
    hourly: list[dict]
    shadow_geojson: dict
    sun_altitude_deg: float
    sun_azimuth_deg: float
    confidence: str
    warnings: list[str]
