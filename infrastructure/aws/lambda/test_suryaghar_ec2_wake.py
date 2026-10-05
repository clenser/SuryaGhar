"""Unit tests for the suryaghar-ec2-wake gateway Lambda.

Everything external (boto3, network, sleeps) is mocked or zero-budgeted:
no AWS credentials, EC2 instance, or backend is required to run these.
"""
import base64
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import suryaghar_ec2_wake as gw


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("INSTANCE_ID", "i-1234567890abcdef0")
    monkeypatch.setenv("DUCKDNS_DOMAIN", "suryaghar-test")
    monkeypatch.setenv("DUCKDNS_TOKEN", "token-abc")
    return monkeypatch


def make_event(**overrides):
    event = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/selection/validate",
        "rawQueryString": "",
        "headers": {"content-type": "application/json", "origin": "https://surya-ghar.vercel.app"},
        "requestContext": {"http": {"method": "POST", "path": "/selection/validate"}},
        "body": json.dumps({"geometry": {"type": "Polygon", "coordinates": []}}),
        "isBase64Encoded": False,
    }
    event.update(overrides)
    return event


class FakeEC2:
    """Scripted EC2 client: states cycled per describe call."""

    def __init__(self, states, ip="3.107.167.125", instance_id="i-1234567890abcdef0"):
        self.states = list(states)
        self.ip = ip
        self.instance_id = instance_id
        self.starts = 0

    def describe_instances(self, InstanceIds):
        assert InstanceIds == [self.instance_id]
        state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        inst = {"State": {"Name": state}}
        if state == "running":
            inst["PublicIpAddress"] = self.ip
        return {"Reservations": [{"Instances": [inst]}]}

    def start_instances(self, InstanceIds):
        self.starts += 1
        return {}


class FakeHTTPResponse(io.BytesIO):
    def __init__(self, body: bytes, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self._headers = headers or {}

    @property
    def headers(self):
        class _H(dict):
            def items(self_inner):
                return super().items()

        return _H(self._headers)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def fake_urlopen_factory(monkeypatch, mapping):
    """mapping: substring of URL -> FakeHTTPResponse | Exception instance."""
    calls: list[dict] = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else req
        calls.append({"url": url, "timeout": timeout})
        for needle, result in mapping.items():
            if needle in url:
                if isinstance(result, Exception):
                    raise result
                return result
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    return calls


# --- URL / header / body helpers -------------------------------------------


def test_build_backend_url_preserves_path_and_query():
    assert gw.build_backend_url("1.2.3.4", "/selection/validate", "") == "http://1.2.3.4/selection/validate"
    assert gw.build_backend_url("1.2.3.4", "/geocode", "q=kolkata") == "http://1.2.3.4/geocode?q=kolkata"
    assert gw.build_backend_url("1.2.3.4", "/api/health", "") == "http://1.2.3.4/api/health"


def test_filter_request_headers_drops_hop_by_hop():
    out = gw.filter_request_headers(
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer x",
            "Host": "abc.execute-api.amazonaws.com",
            "Content-Length": "12",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",
            "X-Forwarded-For": "1.1.1.1",
            "X-Forwarded-Proto": "https",
            "X-Custom-Keep": "yes",
        }
    )
    assert out == {
        "Content-Type": "application/json",
        "Authorization": "Bearer x",
        "X-Custom-Keep": "yes",
    }


def test_decode_event_body_variants():
    assert gw.decode_event_body(None, False) is None
    assert gw.decode_event_body('{"a":1}', False) == b'{"a":1}'
    assert gw.decode_event_body(base64.b64encode(b"\x89PNG").decode(), True) == b"\x89PNG"


# --- EC2 ensure / DuckDNS / health ------------------------------------------


def test_ensure_stopped_starts_and_waits(monkeypatch):
    ec2 = FakeEC2(["stopped", "pending", "running"], instance_id="i-123")
    info = gw.ensure_backend_running(ec2, "i-123", wait_timeout_s=10, poll_s=0)
    assert ec2.starts == 1
    assert info == {"state": "running", "public_ip": "3.107.167.125"}


def test_ensure_running_does_not_start():
    ec2 = FakeEC2(["running"], instance_id="i-123")
    info = gw.ensure_backend_running(ec2, "i-123", wait_timeout_s=5, poll_s=0)
    assert ec2.starts == 0
    assert info["public_ip"] == "3.107.167.125"


def test_ensure_timeout_raises():
    ec2 = FakeEC2(["pending"], instance_id="i-123")
    with pytest.raises(TimeoutError):
        gw.ensure_backend_running(ec2, "i-123", wait_timeout_s=0, poll_s=0)


def test_duckdns_skipped_without_token():
    assert gw.update_duckdns("example", None, "1.2.3.4") is False
    assert gw.update_duckdns(None, "tok", "1.2.3.4") is False


def test_check_health_true_and_false(monkeypatch):
    fake_urlopen_factory(monkeypatch, {"health": FakeHTTPResponse(b"ok", 200)})
    assert gw.check_backend_health("1.2.3.4", timeout_s=5, poll_s=0) is True

    fake_urlopen_factory(monkeypatch, {"health": FakeHTTPResponse(b"no", 503)})
    assert gw.check_backend_health("1.2.3.4", timeout_s=0, poll_s=0) is False


# --- forward mapping ----------------------------------------------------------


def test_forward_binary_response_is_base64(monkeypatch):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    fake_urlopen_factory(
        monkeypatch, {"1.2.3.4/mask": FakeHTTPResponse(png, 200, {"Content-Type": "image/png"})}
    )
    out = gw.forward_request("1.2.3.4", "GET", "/mask", "", {}, None, timeout_s=5)
    assert out["statusCode"] == 200
    assert out["isBase64Encoded"] is True
    assert base64.b64decode(out["body"]) == png
    assert out["headers"]["Content-Type"] == "image/png"


def test_forward_json_passthrough_and_error_status(monkeypatch):
    fake_urlopen_factory(
        monkeypatch,
        {
            "/good": FakeHTTPResponse(b'{"a":1}', 200, {"Content-Type": "application/json"}),
            "/bad": urllib.error.HTTPError(
                "http://x/bad", 422, "Unprocessable", {"Content-Type": "application/json"}, io.BytesIO(b'{"e":1}')
            ),
        },
    )
    ok = gw.forward_request("1.2.3.4", "GET", "/good", "", {}, None, timeout_s=5)
    assert (ok["statusCode"], ok["isBase64Encoded"], ok["body"]) == (200, False, '{"a":1}')
    err = gw.forward_request("1.2.3.4", "GET", "/bad", "", {}, None, timeout_s=5)
    assert (err["statusCode"], err["body"]) == (422, '{"e":1}')


def test_forward_connection_failure_is_502(monkeypatch):
    fake_urlopen_factory(monkeypatch, {"1.2.3.4": ConnectionRefusedError("down")})
    out = gw.forward_request("1.2.3.4", "GET", "/health", "", {}, None, timeout_s=5)
    assert out["statusCode"] == 502
    assert json.loads(out["body"])["error"] == "backend_unreachable"


# --- handler wiring -------------------------------------------------------------


def test_handler_proxies_when_running(monkeypatch, env):
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    fake_urlopen_factory(
        monkeypatch,
        {
            "duckdns": FakeHTTPResponse(b"OK", 200),
            "health": FakeHTTPResponse(b"ok", 200),
            "selection/validate": FakeHTTPResponse(b'{"classification":"roof"}', 200, {"Content-Type": "application/json"}),
        },
    )
    out = gw.lambda_handler(make_event(), None)
    assert ec2.starts == 0
    assert out["statusCode"] == 200
    assert json.loads(out["body"]) == {"classification": "roof"}
    assert out["isBase64Encoded"] is False


def test_handler_starts_stopped_instance_and_updates_duckdns(monkeypatch, env):
    ec2 = FakeEC2(["stopped", "pending", "running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    calls = fake_urlopen_factory(
        monkeypatch,
        {
            "duckdns": FakeHTTPResponse(b"OK", 200),
            "health": FakeHTTPResponse(b"ok", 200),
            "geocode": FakeHTTPResponse(b'{"results":[]}', 200, {"Content-Type": "application/json"}),
        },
    )
    out = gw.lambda_handler(make_event(rawPath="/geocode", body=None), None)
    assert ec2.starts == 1
    assert any("duckdns" in c["url"] for c in calls)
    assert out["statusCode"] == 200


def test_handler_returns_503_with_retry_after_when_unhealthy(monkeypatch, env):
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    monkeypatch.setattr(gw, "check_backend_health", lambda *a, **k: False)
    out = gw.lambda_handler(make_event(), None)
    assert out["statusCode"] == 503
    assert out["headers"]["Retry-After"] == "3"
    assert json.loads(out["body"])["error"] == "backend_starting"


def test_handler_missing_instance_id_is_500(monkeypatch):
    monkeypatch.delenv("INSTANCE_ID", raising=False)
    out = gw.lambda_handler(make_event(), None)
    assert out["statusCode"] == 500
    assert json.loads(out["body"])["error"] == "misconfigured"


def test_handler_forwards_base64_body(monkeypatch, env):
    seen: dict = {}
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else req
        if "duckdns" in url or "health" in url:
            return FakeHTTPResponse(b"OK" if "duckdns" in url else b"ok", 200)
        seen["data"] = req.data
        return FakeHTTPResponse(b"{}", 200, {"Content-Type": "application/json"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    raw = base64.b64encode(b"\x89PNG-DATA").decode()
    out = gw.lambda_handler(make_event(body=raw, isBase64Encoded=True), None)
    assert out["statusCode"] == 200
    # Base64 event body must arrive at the backend as the original bytes.
    # (Framing headers are recomputed by urllib itself at send time.)
    assert seen["data"] == b"\x89PNG-DATA"


def _patch_boto3_ssm(monkeypatch, puts, fail=False):
    """Fake boto3 module whose SSM client records PutParameter calls."""

    class FakeSSM:
        def put_parameter(self, **kwargs):
            puts.append(kwargs)
            if fail:
                raise RuntimeError("ssm down")
            return {"Version": 1}

    class FakeBoto3:
        def client(self, name, **kwargs):
            assert name == "ssm"
            return FakeSSM()

    monkeypatch.setitem(sys.modules, "boto3", FakeBoto3())


def test_wake_records_ssm_activity_immediately(monkeypatch, env):
    """The wake request stamps /suryaghar/last_activity BEFORE startup work,
    with the backend UTC ISO-8601 format — even for /health requests."""
    from datetime import datetime

    puts: list = []
    _patch_boto3_ssm(monkeypatch, puts)
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    fake_urlopen_factory(
        monkeypatch,
        {
            "duckdns": FakeHTTPResponse(b"OK", 200),
            "health": FakeHTTPResponse(b"ok", 200),
        },
    )
    out = gw.lambda_handler(make_event(rawPath="/health", body=None), None)
    assert out["statusCode"] == 200
    assert len(puts) == 1
    assert puts[0]["Name"] == "/suryaghar/last_activity"
    assert puts[0]["Type"] == "String"
    assert puts[0]["Overwrite"] is True
    datetime.fromisoformat(puts[0]["Value"])  # valid ISO-8601


def test_wake_ssm_failure_does_not_break_request(monkeypatch, env):
    puts: list = []
    _patch_boto3_ssm(monkeypatch, puts, fail=True)
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    fake_urlopen_factory(
        monkeypatch,
        {
            "duckdns": FakeHTTPResponse(b"OK", 200),
            "health": FakeHTTPResponse(b"ok", 200),
            "geocode": FakeHTTPResponse(b"{}", 200, {"Content-Type": "application/json"}),
        },
    )
    out = gw.lambda_handler(make_event(rawPath="/geocode", body=None), None)
    assert out["statusCode"] == 200
    assert len(puts) == 1  # attempted exactly once, no retries


def test_wake_respects_custom_activity_parameter(monkeypatch, env):
    puts: list = []
    _patch_boto3_ssm(monkeypatch, puts)
    monkeypatch.setenv("ACTIVITY_SSM_PARAMETER", "/custom/activity")
    ec2 = FakeEC2(["running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    fake_urlopen_factory(
        monkeypatch,
        {
            "duckdns": FakeHTTPResponse(b"OK", 200),
            "health": FakeHTTPResponse(b"ok", 200),
        },
    )
    gw.lambda_handler(make_event(rawPath="/health", body=None), None)
    assert puts[0]["Name"] == "/custom/activity"


def test_no_secrets_in_handler_output(monkeypatch, env):
    ec2 = FakeEC2(["stopped", "pending", "running"])
    monkeypatch.setattr(gw, "_make_ec2_client", lambda: ec2)
    monkeypatch.setattr(gw, "check_backend_health", lambda *a, **k: False)
    fake_urlopen_factory(monkeypatch, {"duckdns": FakeHTTPResponse(b"OK", 200)})
    out = gw.lambda_handler(make_event(), None)
    blob = json.dumps(out)
    assert "token-abc" not in blob
    assert out["statusCode"] == 503
