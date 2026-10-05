"""Confidence models for uncertainty propagation across analysis stages.

Provides structured confidence tracking with explicit levels, scores,
and metadata for each analysis stage.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ConfidenceLevel(Enum):
    """Discrete confidence levels."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


def score_to_level(score: float) -> ConfidenceLevel:
    """Convert numeric confidence score to level."""
    if score >= 0.8:
        return ConfidenceLevel.HIGH
    elif score >= 0.5:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def level_to_score(level: ConfidenceLevel) -> float:
    """Get representative score for a level."""
    return {
        ConfidenceLevel.HIGH: 0.9,
        ConfidenceLevel.MEDIUM: 0.65,
        ConfidenceLevel.LOW: 0.3,
    }[level]


@dataclass(frozen=True)
class StageConfidence:
    """Confidence information for a single analysis stage."""
    stage: str                    # e.g., "segmentation", "vision_validation", "geometry"
    provider: str                 # e.g., "sam", "heuristic", "groq", "pvlib"
    model: Optional[str]          # Model identifier
    confidence: float             # 0-1 numeric score
    level: ConfidenceLevel        # Discrete level
    fallback: bool                # True if this is a fallback provider
    assumptions: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize for API response."""
        return {
            "stage": self.stage,
            "provider": self.provider,
            "model": self.model,
            "confidence": round(self.confidence, 3),
            "level": self.level.value,
            "fallback": self.fallback,
            "assumptions": self.assumptions,
            "limitations": self.limitations,
        }

    @classmethod
    def from_segmentation(cls, provider: str, model: str, confidence: float,
                          fallback: bool, limitations: list[str]) -> StageConfidence:
        """Create from segmentation result."""
        return cls(
            stage="segmentation",
            provider=provider,
            model=model,
            confidence=confidence,
            level=score_to_level(confidence),
            fallback=fallback,
            limitations=limitations,
        )

    @classmethod
    def from_vision(cls, provider: str, model: str, confidence: float,
                    fallback: bool, reasoning: str) -> StageConfidence:
        """Create from AI vision validation result."""
        return cls(
            stage="vision_validation",
            provider=provider,
            model=model,
            confidence=confidence,
            level=score_to_level(confidence),
            fallback=fallback,
            assumptions=[reasoning] if reasoning else [],
        )

    @classmethod
    def from_geometry(cls, valid: bool, repaired: bool, area_m2: float) -> StageConfidence:
        """Create from geometry validation."""
        if not valid:
            return cls(
                stage="geometry",
                provider="shapely/pyproj",
                model="utm_projection",
                confidence=0.0,
                level=ConfidenceLevel.LOW,
                fallback=False,
                limitations=["Invalid geometry"],
            )
        conf = 0.95
        level = ConfidenceLevel.HIGH
        limitations = []
        if repaired:
            conf = 0.75
            level = ConfidenceLevel.MEDIUM
            limitations.append("Geometry was repaired (self-intersection or ring closure)")
        if area_m2 < 20:
            conf = min(conf, 0.6)
            level = ConfidenceLevel.MEDIUM
            limitations.append("Very small polygon; resolution marginal")
        return cls(
            stage="geometry",
            provider="shapely/pyproj",
            model="utm_projection",
            confidence=conf,
            level=level,
            fallback=False,
            limitations=limitations,
        )

    @classmethod
    def from_panel_layout(cls, panel_count: int, usable_area_m2: float,
                          total_area_m2: float, has_exclusions: bool) -> StageConfidence:
        """Create from panel layout result."""
        if panel_count == 0:
            return cls(
                stage="panel_layout",
                provider="geometry_engine",
                model="grid_packing",
                confidence=0.3,
                level=ConfidenceLevel.LOW,
                fallback=False,
                limitations=["No panels fit in usable area"],
            )
        efficiency = usable_area_m2 / max(total_area_m2, 1e-6)
        conf = 0.7 + 0.2 * min(efficiency, 1.0)
        if has_exclusions:
            conf *= 0.9
        return cls(
            stage="panel_layout",
            provider="geometry_engine",
            model="grid_packing",
            confidence=conf,
            level=score_to_level(conf),
            fallback=False,
            assumptions=[f"Packing efficiency: {efficiency:.1%}"],
            limitations=["Deterministic grid packing; not globally optimal"] if not has_exclusions else
                        ["Deterministic grid packing; not globally optimal", "Exclusion zones applied"],
        )

    @classmethod
    def from_solar(cls, resource_provider: str, has_tmy: bool) -> StageConfidence:
        """Create from solar analysis result."""
        if has_tmy:
            return cls(
                stage="solar_analysis",
                provider=resource_provider,
                model="pvlib_pvwatts",
                confidence=0.8,
                level=ConfidenceLevel.MEDIUM,
                fallback=False,
                assumptions=["PVWatts DC model", "SAPM temperature model", "Isotropic transposition"],
                limitations=["No soiling losses", "No shading losses (separate analysis)", "Single weather year"],
            )
        return cls(
            stage="solar_analysis",
            provider="benchmark",
            model="india_ghi_benchmark",
            confidence=0.4,
            level=ConfidenceLevel.LOW,
            fallback=True,
            limitations=["Uses regional GHI benchmark, not site-specific weather data"],
        )


@dataclass(frozen=True)
class AggregatedConfidence:
    """Aggregated confidence across all analysis stages."""
    overall_level: ConfidenceLevel
    overall_score: float
    stages: list[StageConfidence]
    limitations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize for API response."""
        return {
            "overall_level": self.overall_level.value,
            "overall_score": round(self.overall_score, 3),
            "stages": [s.to_dict() for s in self.stages],
            "limitations": self.limitations,
        }


# Weight for each stage in overall aggregation
STAGE_WEIGHTS = {
    "segmentation": 0.30,
    "vision_validation": 0.30,
    "geometry": 0.20,
    "panel_layout": 0.10,
    "solar_analysis": 0.10,
}

# Stages that can cap overall confidence if LOW
CRITICAL_STAGES = {"segmentation", "vision_validation", "geometry"}


def aggregate_confidence(stages: list[StageConfidence]) -> AggregatedConfidence:
    """Aggregate stage confidences into overall confidence.

    Strategy:
    - Weighted average of scores
    - If any CRITICAL stage is LOW -> overall capped at MEDIUM
    - If segmentation is fallback (heuristic) -> overall capped at MEDIUM
    - Limitations collected from all stages
    """
    if not stages:
        return AggregatedConfidence(
            overall_level=ConfidenceLevel.LOW,
            overall_score=0.0,
            stages=[],
            limitations=["No confidence stages provided"],
        )

    # Weighted score
    total_weight = 0.0
    weighted_sum = 0.0
    for stage in stages:
        weight = STAGE_WEIGHTS.get(stage.stage, 0.1)
        weighted_sum += stage.confidence * weight
        total_weight += weight

    overall_score = weighted_sum / total_weight if total_weight > 0 else 0.0

    # Check for caps
    cap_at_medium = False
    limitations = []

    for stage in stages:
        limitations.extend(stage.limitations)

        # Critical stage LOW caps overall
        if stage.stage in CRITICAL_STAGES and stage.level == ConfidenceLevel.LOW:
            cap_at_medium = True
            limitations.append(f"Critical stage '{stage.stage}' has low confidence")

        # Heuristic segmentation fallback caps overall
        if stage.stage == "segmentation" and stage.fallback:
            cap_at_medium = True
            limitations.append("Segmentation used heuristic fallback (not model-based)")

    # Apply caps
    if cap_at_medium and overall_score > 0.65:
        overall_score = 0.65

    overall_level = score_to_level(overall_score)

    # Deduplicate limitations
    unique_limitations = list(dict.fromkeys(limitations))

    return AggregatedConfidence(
        overall_level=overall_level,
        overall_score=overall_score,
        stages=stages,
        limitations=unique_limitations,
    )