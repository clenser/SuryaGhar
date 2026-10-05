from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
import logging

logger = logging.getLogger("solar_rooftop.api")

MAX_BODY_BYTES = 8 * 1024

from app.core.config import get_settings

app = FastAPI(title="Solar Rooftop Analysis API", version="0.1.0")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


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
