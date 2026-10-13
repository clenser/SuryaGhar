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
    # Optional explicit segmentation model ("hotosm_buildings" | "sam2_tiny").
    # Omitted -> configured default (HOTOSM). Unknown ids are rejected with 400.
    segmentation_model: str | None = None
    # Optional installation type ("rooftop" | "ground"), default rooftop
    installation_type: str | None = "rooftop"


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
    # Segmentation benchmark block: which model ran, user-facing name, actual
    # measured inference seconds (monotonic, inference only), actual device.
    segmentation: dict | None = None
    ai: dict | None = None
    confidence_detail: dict | None = None
    legacy_confidence: float | None = None
    evidence: dict | None = None


class PanelLayoutRequest(BaseModel):
    geometry: GeometryInput
    panel_width_m: float = Field(default=2.28, ge=0.3, le=4.0)
    panel_height_m: float = Field(default=1.13, ge=0.3, le=3.0)
    wattage_w: float = Field(default=550.0, ge=100, le=800)
    # None = AUTO (derived from tilt/panel geometry); explicit 0+ allowed otherwise.
    row_spacing_m: float | None = Field(default=None, ge=0.0, le=5.0)
    setback_m: float = Field(default=0.5, ge=0.0, le=10.0)
    # None = AUTO (latitude default, refined by solar optimisation where available).
    tilt_deg: float | None = Field(default=None, ge=0, le=90)
    azimuth_deg: float | None = Field(default=None, ge=0, le=360)
    target_capacity_kwp: float | None = Field(default=None, ge=0.2, le=1000)
    installation_type: str | None = "rooftop"
    mounting_type: str | None = None
    ground_clearance_m: float | None = Field(default=None, ge=0.0, le=5.0)


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
    panel: dict | None = None
    layout: dict | None = None
    orientation: dict | None = None
    solar: dict | None = None
    installation_type: str | None = None


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
