"""Backend readiness state: liveness vs. readiness.

``GET /health`` is liveness (the process answers). ``GET /ready`` is
readiness: the backend has finished all one-time initialization required to
accept a normal analysis request without further blocking setup.

State starts NOT ready and flips exactly once via ``mark_ready()`` from the
FastAPI lifespan startup hook. If startup initialization fails, the process
stays not ready (still live) and the failure is logged at the call site.

What "ready" means here: settings load and the configured default
segmentation provider resolves *and* reports available (e.g. the heuristic
provider is always available; a configured HOTOSM/SAM/SAM2 path proves its
checkpoint/dependencies exist). Provider *weights* are never loaded by this
module — inference-time lazy loading is unchanged — so checking readiness is
cheap and ``/ready`` itself never triggers model initialization.
"""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger("solar_rooftop.readiness")

_LOCK = threading.Lock()

_ready: bool = False
_detail: str | None = None


def is_ready() -> bool:
    """True only after successful startup initialization. Never raises."""
    with _LOCK:
        return _ready


def readiness_detail() -> str | None:
    """Small diagnostic recorded at mark_ready() time (never a secret)."""
    with _LOCK:
        return _detail


def mark_ready(detail: str | None = None) -> None:
    """Record successful initialization; the backend may now serve analysis."""
    global _ready, _detail
    with _LOCK:
        _ready = True
        _detail = detail
    logger.info("Backend ready (%s)", detail or "initialization complete")


def reset_readiness() -> None:
    """Return to the initial not-ready state. Tests only — never called by
    the application itself."""
    global _ready, _detail
    with _LOCK:
        _ready = False
        _detail = None


def perform_startup_checks(settings) -> str:
    """Run the required one-time initialization checks.

    Resolves the configured default segmentation provider (the same factory
    the analysis path uses) and requires it to report available, so a normal
    analysis request cannot hit a broken or still-initializing default path.
    Returns a short detail string for /ready. Raises on failure; the caller
    logs and stays not ready. Never loads model weights and never touches
    optional/selectable SAM2 variants beyond the configured path.
    """
    from app.segmentation.factory import get_segmentation_provider

    provider = get_segmentation_provider(settings)
    if not provider.is_available():
        raise RuntimeError(
            f"Configured segmentation provider '{provider.name}' is unavailable."
        )
    return f"segmentation={provider.name}"
