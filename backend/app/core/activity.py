"""Inactivity tracking for EC2 auto-stop.

Every meaningful API request updates a UTC "last activity" timestamp in two
places:
1. A small local JSON file (fallback/debugging, survives restarts).
2. AWS SSM Parameter Store (readable by the future auto-stop Lambda even
   when this EC2 instance is stopped).

Design notes:
- File write is atomic (temp file + os.replace) plus a threading lock, safe
  for normal multi-threaded FastAPI usage.
- Recording never raises and never alters responses; failures only log.
- Health/config polling and CORS preflights are NOT activity, otherwise the
  wake/health mechanism itself would prevent the 5-minute shutdown.
- boto3 is imported lazily and the SSM client is cached; without boto3 (or
  without credentials) the file path keeps working untouched. The EC2
  instance IAM role supplies credentials automatically — no access keys.
- Exactly one SSM PutParameter per tracked request; no retry loops.

Path resolution: explicit argument, then the ACTIVITY_FILE environment
variable, then backend/runtime/last_activity.json (created on demand).
SSM parameter: ACTIVITY_SSM_PARAMETER env var, default /suryaghar/last_activity.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("solar_rooftop.activity")

# This file is backend/app/core/activity.py, so parents[2] is backend/.
BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_ACTIVITY_FILE = BACKEND_DIR / "runtime" / "last_activity.json"
ENV_VAR = "ACTIVITY_FILE"

#: SSM parameter holding the timestamp. Configurable; matches the IAM role's
#: PutParameter permission.
DEFAULT_SSM_PARAMETER = "/suryaghar/last_activity"
SSM_PARAMETER_ENV_VAR = "ACTIVITY_SSM_PARAMETER"
#: Region for the SSM client. boto3 would also resolve this from the EC2
#: instance metadata; the explicit default matches the role's region.
DEFAULT_AWS_REGION = "ap-southeast-2"

#: Requests to these paths are infrastructure polling, not user activity.
#: /ready joins /health and /config: readiness probes must neither count as
#: activity nor delay auto-stop (and /ready never records activity itself).
EXCLUDED_PATHS = frozenset({"/health", "/config", "/ready"})

_LOCK = threading.Lock()

# Lazily created SSM client (None = unavailable). Cached so credentials and
# client construction happen once, not per request.
_SSM_CLIENT: object | None = None
_SSM_CLIENT_READY = False


def resolve_activity_path(explicit: str | Path | None = None) -> Path:
    """Return the activity file path without touching the filesystem."""
    if explicit:
        return Path(explicit)
    configured = os.environ.get(ENV_VAR)
    if configured:
        return Path(configured)
    return DEFAULT_ACTIVITY_FILE


def resolve_ssm_parameter(explicit: str | None = None) -> str:
    """Return the SSM parameter name without any AWS calls."""
    if explicit:
        return explicit
    configured = os.environ.get(SSM_PARAMETER_ENV_VAR)
    if configured:
        return configured
    return DEFAULT_SSM_PARAMETER


def _get_ssm_client() -> object | None:
    """Return the cached SSM client, creating it once. Never raises.

    boto3 is imported lazily so the app and tests run without it installed.
    Credentials come from the standard chain (EC2 instance IAM role in
    production); no access keys are configured here. Returns None when boto3
    is missing or the client cannot be constructed.
    """
    global _SSM_CLIENT, _SSM_CLIENT_READY
    if _SSM_CLIENT_READY:
        return _SSM_CLIENT
    with _LOCK:
        if _SSM_CLIENT_READY:
            return _SSM_CLIENT
        try:
            import boto3  # lazy: keeps startup and tests dependency-free

            region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or DEFAULT_AWS_REGION
            _SSM_CLIENT = boto3.client("ssm", region_name=region)
        except Exception as exc:
            logger.info("SSM unavailable (%s); activity stays file-local.", exc)
            _SSM_CLIENT = None
        _SSM_CLIENT_READY = True
        return _SSM_CLIENT


def publish_activity_ssm(timestamp_iso: str, parameter: str | None = None) -> bool:
    """Publish one timestamp to SSM Parameter Store. Never raises.

    Single PutParameter call (Overwrite, String type), no retry loops.
    Returns True on success, False otherwise (already logged).
    """
    name = resolve_ssm_parameter(parameter)
    try:
        client = _get_ssm_client()
        if client is None:
            return False
        client.put_parameter(Name=name, Value=timestamp_iso, Type="String", Overwrite=True)  # type: ignore[attr-defined]
        return True
    except Exception as exc:
        logger.warning("Could not publish activity timestamp to SSM %s: %s", name, exc)
        return False


def record_activity(explicit_path: str | Path | None = None) -> Path | None:
    """Stamp the current UTC time as last activity, file first, then SSM.

    Never raises and never alters the caller's response; either sink failing
    only logs. Returns the file written, or None if the file write failed
    (already logged).
    """
    path = resolve_activity_path(explicit_path)
    timestamp_iso = datetime.now(timezone.utc).isoformat()
    payload = {"last_activity_utc": timestamp_iso}
    try:
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(tmp, path)
    except Exception as exc:
        logger.warning("Could not record activity timestamp at %s: %s", path, exc)
        return None
    publish_activity_ssm(timestamp_iso)
    return path


def read_last_activity(explicit_path: str | Path | None = None) -> datetime | None:
    """Read the stored timestamp (used by tests and the future Lambda).

    Returns None when the file is missing or unreadable.
    """
    try:
        raw = json.loads(resolve_activity_path(explicit_path).read_text(encoding="utf-8"))
        parsed = datetime.fromisoformat(raw["last_activity_utc"])
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def is_tracked_request(method: str, path: str) -> bool:
    """True when a request counts as user activity for auto-stop purposes."""
    if method.upper() == "OPTIONS":
        return False
    return path not in EXCLUDED_PATHS
