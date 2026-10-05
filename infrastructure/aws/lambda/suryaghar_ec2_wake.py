"""SuryaGhar EC2 wake + request gateway Lambda (API Gateway HTTP API, payload 2.0).

Architecture:
    Vercel -> API Gateway HTTP API -> this Lambda -> EC2 FastAPI (Nginx :80)

The function ensures the EC2 backend is running (starting it if stopped),
waits only a short bounded window (API Gateway caps integrations at 30s),
then proxies the ORIGINAL request to the backend. If the backend is not
healthy in time it returns 503 with Retry-After so the client retries.

Environment variables (existing names, unchanged):
    INSTANCE_ID     EC2 instance to wake (required)
    DUCKDNS_DOMAIN  DuckDNS hostname to refresh (optional but expected)
    DUCKDNS_TOKEN   DuckDNS update token (optional; update skipped if absent)

Region/credentials come from the Lambda execution environment and the
instance IAM role assumptions of boto3's default chain. No secrets are
logged or returned. No EC2 stop logic lives here.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# --- budgets (seconds) -------------------------------------------------------
# API Gateway HTTP APIs time out integrations at 30s, so everything below must
# complete well inside that window.
HANDLER_DEADLINE_S = 27.0
WAIT_RUNNING_TIMEOUT_S = 6.0
WAIT_RUNNING_POLL_S = 1.0
HEALTH_TIMEOUT_S = 20.0
HEALTH_POLL_S = 1.5
HEALTH_REQUEST_TIMEOUT_S = 3.0
DUCKDNS_TIMEOUT_S = 10.0

# Request headers that must never be forwarded to the backend (hop-by-hop or
# origin-specific). Compared case-insensitively.
_DROP_HEADERS = frozenset({"host", "content-length", "connection", "transfer-encoding"})

# Response content types treated as binary for the proxy response.
_BINARY_PREFIXES = ("image/", "video/", "audio/", "font/", "application/octet-stream", "application/pdf")


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _make_ec2_client():
    """Create a boto3 EC2 client. Region/credentials resolve from the Lambda
    environment (AWS_REGION) and the execution role. Imported lazily so unit
    tests never need boto3 installed."""
    import boto3  # lazy: keeps local test collection dependency-free

    return boto3.client("ec2")


def _describe_instance(ec2_client, instance_id: str) -> dict:
    """Return {'state': <name>, 'public_ip': <ip|None>} for the instance."""
    resp = ec2_client.describe_instances(InstanceIds=[instance_id])
    reservations = resp.get("Reservations", [])
    instances = reservations[0].get("Instances", []) if reservations else []
    if not instances:
        raise RuntimeError(f"EC2 instance not found: {instance_id}")
    inst = instances[0]
    return {
        "state": inst.get("State", {}).get("Name", "unknown"),
        "public_ip": inst.get("PublicIpAddress"),
    }


def ensure_backend_running(
    ec2_client,
    instance_id: str,
    wait_timeout_s: float = WAIT_RUNNING_TIMEOUT_S,
    poll_s: float = WAIT_RUNNING_POLL_S,
    deadline: float | None = None,
) -> dict:
    """Ensure the instance reaches 'running' with a public IP.

    Starts it only when stopped. Returns the describe dict. Raises
    TimeoutError if the deadline passes first.
    """
    info = _describe_instance(ec2_client, instance_id)
    logger.info("EC2 state: %s (instance %s)", info["state"], instance_id)
    if info["state"] == "stopped":
        logger.info("EC2 stopped; calling StartInstances")
        ec2_client.start_instances(InstanceIds=[instance_id])
        logger.info("EC2 start requested")
        info = _describe_instance(ec2_client, instance_id)

    started = time.monotonic()
    while True:
        if info["state"] == "running" and info["public_ip"]:
            return info
        elapsed = time.monotonic() - started
        remaining = wait_timeout_s - elapsed
        if deadline is not None:
            remaining = min(remaining, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError(f"EC2 did not reach running in time (state={info['state']})")
        time.sleep(min(poll_s, remaining))
        info = _describe_instance(ec2_client, instance_id)
    # unreachable


def update_duckdns(domain: str | None, token: str | None, ip: str, timeout_s: float = DUCKDNS_TIMEOUT_S) -> bool:
    """Refresh the DuckDNS record. Skipped (False) when unconfigured."""
    if not domain or not token:
        logger.info("DuckDNS unconfigured; skipping update")
        return False
    query = urllib.parse.urlencode({"domains": domain, "token": "***", "ip": ip})
    # NOTE: the token itself is never logged; only the outcome is.
    url = f"https://www.duckdns.org/update?domains={urllib.parse.quote(domain)}&token={urllib.parse.quote(token)}&ip={urllib.parse.quote(ip)}"
    logger.info("Updating DuckDNS for domain %s to %s (query=%s)", domain, ip, query)
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", errors="replace").strip()
        ok = body.startswith("OK")
        logger.info("DuckDNS update result: %s", "OK" if ok else body[:80])
        return ok
    except Exception as exc:
        logger.warning("DuckDNS update failed: %s: %s", type(exc).__name__, exc)
        return False


def check_backend_health(
    public_ip: str,
    timeout_s: float = HEALTH_TIMEOUT_S,
    poll_s: float = HEALTH_POLL_S,
    deadline: float | None = None,
) -> bool:
    """Poll http://<ip>/health until 2xx or the budget is exhausted."""
    url = f"http://{public_ip}/health"
    started = time.monotonic()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=HEALTH_REQUEST_TIMEOUT_S) as resp:
                if 200 <= resp.status < 300:
                    logger.info("Backend healthy at %s", url)
                    return True
                logger.info("Backend health status %s", resp.status)
        except Exception as exc:
            logger.info("Backend health check failed: %s: %s", type(exc).__name__, exc)
        elapsed = time.monotonic() - started
        remaining = timeout_s - elapsed
        if deadline is not None:
            remaining = min(remaining, deadline - time.monotonic())
        if remaining <= 0:
            logger.info("Backend still unavailable after health window")
            return False
        time.sleep(min(poll_s, remaining))


def filter_request_headers(headers: dict) -> dict:
    """Keep relevant headers; drop hop-by-hop/origin-specific ones."""
    kept: dict[str, str] = {}
    for key, value in (headers or {}).items():
        if value is None:
            continue
        low = key.lower()
        if low in _DROP_HEADERS or low.startswith("x-forwarded-"):
            continue
        kept[key] = value
    return kept


def build_backend_url(public_ip: str, raw_path: str, raw_query: str) -> str:
    """Reconstruct the backend URL without ever adding an /api prefix."""
    url = f"http://{public_ip}{raw_path or '/'}"
    if raw_query:
        url += f"?{raw_query}"
    return url


def decode_event_body(body, is_base64: bool):
    """Return request bytes (or None) from a payload-2.0 body."""
    if body is None:
        return None
    if is_base64:
        return base64.b64decode(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    return bytes(body)


def _is_binary_content(content_type: str) -> bool:
    mime = (content_type or "").split(";")[0].strip().lower()
    return mime.startswith(_BINARY_PREFIXES)


def forward_request(
    public_ip: str,
    method: str,
    raw_path: str,
    raw_query: str,
    headers: dict,
    data,
    timeout_s: float,
) -> dict:
    """Proxy one request to the backend; map the reply to payload 2.0."""
    url = build_backend_url(public_ip, raw_path, raw_query)
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            status = resp.status
            raw_body = resp.read()
            resp_headers = dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        # Backend answered with an error status: proxy it through, not a 502.
        status = exc.code
        raw_body = exc.read() if hasattr(exc, "read") else b""
        try:
            resp_headers = dict(exc.headers.items()) if exc.headers else {}
        except Exception:
            resp_headers = {}
    except Exception as exc:
        logger.warning("Backend connection failed: %s: %s", type(exc).__name__, exc)
        return _json_response(
            502,
            {"error": "backend_unreachable", "message": "SuryaGhar backend is unreachable."},
        )
    return _raw_response(status, resp_headers, raw_body)


def _raw_response(status: int, headers: dict, body: bytes) -> dict:
    """Map a backend reply to API Gateway payload format 2.0."""
    out_headers: dict[str, str] = {}
    for key, value in (headers or {}).items():
        low = key.lower()
        # Hop-by-hop and framing headers are owned by API Gateway, not proxied.
        if low in ("content-length", "transfer-encoding", "connection", "keep-alive"):
            continue
        out_headers[key] = value
    content_type = ""
    for key, value in out_headers.items():
        if key.lower() == "content-type":
            content_type = value
            break
    if _is_binary_content(content_type):
        return {
            "statusCode": status,
            "headers": out_headers,
            "body": base64.b64encode(body or b"").decode("ascii"),
            "isBase64Encoded": True,
        }
    try:
        text = (body or b"").decode("utf-8")
    except UnicodeDecodeError:
        return {
            "statusCode": status,
            "headers": out_headers,
            "body": base64.b64encode(body or b"").decode("ascii"),
            "isBase64Encoded": True,
        }
    return {"statusCode": status, "headers": out_headers, "body": text, "isBase64Encoded": False}


def _json_response(status: int, payload: dict, extra_headers: dict | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(payload),
        "isBase64Encoded": False,
    }


def lambda_handler(event: dict, context) -> dict:
    """API Gateway HTTP API (payload 2.0) entry point."""
    started = time.monotonic()
    deadline = started + HANDLER_DEADLINE_S

    http_ctx = (event.get("requestContext") or {}).get("http", {}) if isinstance(event, dict) else {}
    method = str(http_ctx.get("method", "GET"))
    raw_path = event.get("rawPath", "/") if isinstance(event, dict) else "/"
    raw_query = event.get("rawQueryString", "") if isinstance(event, dict) else ""
    headers = (event.get("headers") or {}) if isinstance(event, dict) else {}
    body = event.get("body") if isinstance(event, dict) else None
    is_b64 = bool(event.get("isBase64Encoded")) if isinstance(event, dict) else False
    logger.info("Incoming %s %s", method, raw_path)

    try:
        instance_id = _env("INSTANCE_ID")
    except RuntimeError as exc:
        logger.error("Configuration error: %s", exc)
        return _json_response(500, {"error": "misconfigured", "message": "Gateway is not configured."})

    try:
        ec2 = _make_ec2_client()
        info = ensure_backend_running(ec2, instance_id, deadline=deadline)
        public_ip = info["public_ip"]
        logger.info("Backend public IP: %s", public_ip)

        update_duckdns(
            os.environ.get("DUCKDNS_DOMAIN"),
            os.environ.get("DUCKDNS_TOKEN"),
            public_ip,
        )

        healthy = check_backend_health(public_ip, deadline=deadline)
        logger.info("Backend health: %s", "healthy" if healthy else "unavailable")
        if not healthy:
            return _json_response(
                503,
                {"error": "backend_starting", "message": "SuryaGhar backend is starting. Retry shortly."},
                extra_headers={"Retry-After": "3"},
            )

        remaining = deadline - time.monotonic()
        if remaining < 5:
            logger.info("Insufficient budget left to proxy; asking client to retry")
            return _json_response(
                503,
                {"error": "backend_starting", "message": "SuryaGhar backend is starting. Retry shortly."},
                extra_headers={"Retry-After": "3"},
            )
        data = decode_event_body(body, is_b64)
        fwd_headers = filter_request_headers(headers)
        result = forward_request(
            public_ip,
            method,
            raw_path,
            raw_query,
            fwd_headers,
            data,
            timeout_s=max(1.0, remaining - 1.0),
        )
        logger.info("Proxy result: %s", result.get("statusCode"))
        return result
    except TimeoutError as exc:
        logger.info("Startup window exhausted: %s", exc)
        return _json_response(
            503,
            {"error": "backend_starting", "message": "SuryaGhar backend is starting. Retry shortly."},
            extra_headers={"Retry-After": "3"},
        )
    except Exception as exc:
        logger.error("Gateway failure: %s: %s", type(exc).__name__, exc)
        return _json_response(500, {"error": "gateway_error", "message": "Gateway failed to reach the backend."})
