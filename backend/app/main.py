from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from contextlib import asynccontextmanager

from app.api.routes import router
from app.core.activity import is_tracked_request, record_activity
from app.core.readiness import mark_ready, perform_startup_checks
import logging

logger = logging.getLogger("solar_rooftop.api")

MAX_BODY_BYTES = 8 * 1024

from app.core.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup completes the required one-time initialization, then marks
    the backend ready. Any failure is logged and the process stays live but
    NOT ready (GET /health keeps answering; GET /ready keeps returning 503).
    """
    try:
        detail = perform_startup_checks(settings)
    except Exception as exc:
        logger.error(
            "Backend startup initialization failed; staying not ready: %s: %s",
            type(exc).__name__,
            exc,
        )
    else:
        mark_ready(detail)
    yield


app = FastAPI(title="Solar Rooftop Analysis API", version="0.1.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def track_activity(request: Request, call_next):
    # Recorded on arrival (before handling) so even a failing request counts
    # as activity, and recording can never alter the response. Health/config
    # polling and OPTIONS preflights are excluded by is_tracked_request.
    if is_tracked_request(request.method, request.url.path):
        record_activity()
    return await call_next(request)


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"error": "payload_too_large", "detail": "Request body too large"})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    messages = "; ".join(str(err.get("msg", "invalid")) for err in exc.errors())
    return JSONResponse(status_code=422, content={"error": "invalid_request", "detail": messages})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    # Keep the CORS middleware effective on 5xx: a bare exception would otherwise
    # bubble past it and lose the Access-Control-Allow-Origin header.
    logger.error("unhandled error: %s: %s", type(exc).__name__, exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": "The analysis service encountered an internal error."},
    )


app.include_router(router)
