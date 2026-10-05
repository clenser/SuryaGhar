"""Inactivity tracking for EC2 auto-stop.

Every meaningful API request updates a UTC "last activity" timestamp in a
small JSON file. A separate AWS Lambda later reads that file: if no API
request arrived for 5 minutes, the EC2 instance is considered inactive.

Design notes:
- File-based (not in-memory) so the timestamp survives FastAPI restarts.
- Atomic write (temp file + os.replace) plus a threading lock, safe for
  normal multi-threaded FastAPI usage.
- Recording never raises and never alters responses; failures only log.
- Health/config polling and CORS preflights are NOT activity, otherwise the
  wake/health mechanism itself would prevent the 5-minute shutdown.

Path resolution: explicit argument, then the ACTIVITY_FILE environment
variable, then backend/runtime/last_activity.json (created on demand).
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

#: Requests to these paths are infrastructure polling, not user activity.
EXCLUDED_PATHS = frozenset({"/health", "/config"})

_LOCK = threading.Lock()


def resolve_activity_path(explicit: str | Path | None = None) -> Path:
    """Return the activity file path without touching the filesystem."""
    if explicit:
        return Path(explicit)
    configured = os.environ.get(ENV_VAR)
    if configured:
        return Path(configured)
    return DEFAULT_ACTIVITY_FILE


def record_activity(explicit_path: str | Path | None = None) -> Path | None:
    """Stamp the current UTC time as last activity. Never raises.

    Returns the file written, or None if writing failed (already logged).
    """
    path = resolve_activity_path(explicit_path)
    payload = {"last_activity_utc": datetime.now(timezone.utc).isoformat()}
    try:
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(tmp, path)
        return path
    except Exception as exc:
        logger.warning("Could not record activity timestamp at %s: %s", path, exc)
        return None


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
