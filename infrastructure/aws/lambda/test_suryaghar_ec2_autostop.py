"""Unit tests for the suryaghar-ec2-autostop Lambda.

Everything external (boto3, network, clocks) is faked: no AWS credentials,
EC2 instance, or SSM access is required to run these.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import suryaghar_ec2_autostop as auto


def utcnow_minus(**kwargs):
    return datetime.now(timezone.utc) - timedelta(**kwargs)


class ParameterNotFound(Exception):
    """Mimics botocore's ParameterNotFound by name (detected without botocore)."""


class FakeEC2:
    def __init__(self, state="running", launch_time=None):
        self.state = state
        self.launch_time = launch_time
        self.stops = 0

    def describe_instances(self, InstanceIds):
        inst = {"State": {"Name": self.state}}
        if self.launch_time is not None:
            inst["LaunchTime"] = self.launch_time
        return {"Reservations": [{"Instances": [inst]}]}

    def start_instances(self, InstanceIds):
        raise AssertionError("autostop must never start instances")

    def stop_instances(self, InstanceIds):
        self.stops += 1
        return {}


class FakeSSM:
    def __init__(self, value=None, error=None):
        self.value = value
        self.error = error
        self.reads = 0

    def get_parameter(self, Name):
        self.reads += 1
        assert Name == "/suryaghar/last_activity"
        if self.error is not None:
            raise self.error
        if self.value is None:
            raise ParameterNotFound("Parameter /suryaghar/last_activity not found.")
        return {"Parameter": {"Value": self.value}}


def run_handler(monkeypatch, ec2, ssm, extra_env=None):
    monkeypatch.setenv("INSTANCE_ID", "i-1234567890abcdef0")
    for key, value in (extra_env or {}).items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(auto, "_make_ec2_client", lambda: ec2)
    monkeypatch.setattr(auto, "_make_ssm_client", lambda: ssm)
    return auto.lambda_handler({}, None)


# --- decide_autostop: pure decision matrix ------------------------------------


def test_fresh_start_with_stale_ssm_is_not_stopped():
    """The core race: instance launched 2 min ago, SSM 10 min old → skip."""
    action, reason = auto.decide_autostop(
        now=datetime.now(timezone.utc),
        state="running",
        launch_time=utcnow_minus(minutes=2),
        last_activity=utcnow_minus(minutes=10),
    )
    assert action == "skip"
    assert "grace" in reason


def test_genuinely_inactive_instance_is_stopped():
    action, _ = auto.decide_autostop(
        now=datetime.now(timezone.utc),
        state="running",
        launch_time=utcnow_minus(minutes=20),
        last_activity=utcnow_minus(minutes=7),
    )
    assert action == "stop"


def test_recent_activity_prevents_stop():
    action, _ = auto.decide_autostop(
        now=datetime.now(timezone.utc),
        state="running",
        launch_time=utcnow_minus(minutes=20),
        last_activity=utcnow_minus(seconds=30),
    )
    assert action == "skip"


def test_health_freshness_counts_as_activity():
    """A wake request that only reached /health still stamps SSM; a 1-minute
    old stamp with an old launch must not stop."""
    action, _ = auto.decide_autostop(
        now=datetime.now(timezone.utc),
        state="running",
        launch_time=utcnow_minus(minutes=20),
        last_activity=utcnow_minus(minutes=1),
    )
    assert action == "skip"


def test_non_running_states_never_stop():
    now = datetime.now(timezone.utc)
    for state in ("stopped", "pending", "stopping", "shutting-down", "terminated", "unknown"):
        action, _ = auto.decide_autostop(
            now=now,
            state=state,
            launch_time=utcnow_minus(minutes=60),
            last_activity=utcnow_minus(minutes=60),
        )
        assert action == "skip", state


def test_missing_launch_time_never_stops():
    action, _ = auto.decide_autostop(
        now=datetime.now(timezone.utc),
        state="running",
        launch_time=None,
        last_activity=utcnow_minus(minutes=60),
    )
    assert action == "skip"


def test_boundary_inactivity_threshold():
    now = datetime.now(timezone.utc)
    action, _ = auto.decide_autostop(
        now=now,
        state="running",
        launch_time=utcnow_minus(minutes=20),
        last_activity=now - timedelta(seconds=300),
    )
    assert action == "stop"
    action, _ = auto.decide_autostop(
        now=now,
        state="running",
        launch_time=utcnow_minus(minutes=20),
        last_activity=now - timedelta(seconds=299),
    )
    assert action == "skip"


# --- handler wiring --------------------------------------------------------------


def test_handler_stops_idle_box(monkeypatch):
    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=20))
    ssm = FakeSSM(value=utcnow_minus(minutes=7).isoformat())
    out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "stopped"
    assert ec2.stops == 1


def test_handler_skips_fresh_box_with_stale_ssm(monkeypatch):
    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=2))
    ssm = FakeSSM(value=utcnow_minus(minutes=30).isoformat())
    out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "skip"
    assert ec2.stops == 0


def test_handler_skips_when_ssm_unreadable(monkeypatch):
    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=60))
    ssm = FakeSSM(error=RuntimeError("AccessDenied"))
    out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "skip"
    assert ec2.stops == 0


def test_handler_stops_when_parameter_never_written(monkeypatch):
    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=60))
    ssm = FakeSSM(value=None)
    out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "stopped"
    assert ec2.stops == 1


def test_handler_skips_stopped_instance_without_touching_ssm(monkeypatch):
    ec2 = FakeEC2(state="stopped", launch_time=utcnow_minus(minutes=60))
    ssm = FakeSSM(value=utcnow_minus(minutes=60).isoformat())
    out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "skip"
    assert ec2.stops == 0
    assert ssm.reads == 0


def test_handler_missing_instance_id_errors_safely(monkeypatch):
    monkeypatch.delenv("INSTANCE_ID", raising=False)
    out = auto.lambda_handler({}, None)
    assert out["action"] == "error"


def test_no_secrets_in_autostop_output(monkeypatch, caplog):
    import json
    import logging

    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=20))
    ssm = FakeSSM(value=utcnow_minus(minutes=30).isoformat())
    with caplog.at_level(logging.INFO):
        out = run_handler(monkeypatch, ec2, ssm)
    assert out["action"] == "stopped"
    assert "token" not in json.dumps(out).lower()


def test_custom_thresholds_via_env(monkeypatch):
    ec2 = FakeEC2(state="running", launch_time=utcnow_minus(minutes=20))
    ssm = FakeSSM(value=utcnow_minus(minutes=7).isoformat())
    out = run_handler(monkeypatch, ec2, ssm, extra_env={"INACTIVITY_THRESHOLD_S": "3600"})
    assert out["action"] == "skip"
    assert ec2.stops == 0
