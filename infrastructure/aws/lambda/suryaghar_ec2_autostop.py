"""SuryaGhar EC2 auto-stop Lambda (EventBridge, every 1 minute).

Stops the backend EC2 instance only after genuine inactivity. The stop rule is:

    state == running
    AND running for at least STARTUP_GRACE_S (launch-time safety)
    AND no activity timestamp newer than INACTIVITY_THRESHOLD_S
    -> stop EC2.

The launch-time guard is what makes wake vs. autostop race-safe: a freshly
started instance (cold backend, models still loading, user still orienting)
is never stopped merely because SSM still holds an old timestamp. The wake
gateway additionally refreshes SSM on every real request, so in the normal
case the timestamp is already fresh.

Environment variables:
    INSTANCE_ID              EC2 instance to stop (required, same name as wake)
    ACTIVITY_SSM_PARAMETER   SSM timestamp parameter (default /suryaghar/last_activity)
    INACTIVITY_THRESHOLD_S   idle seconds before stopping (default 300)
    STARTUP_GRACE_S          minimum running seconds before evaluating (default 600)

The execution role needs: ec2:DescribeInstances + ec2:StopInstances on the
instance, and ssm:GetParameter on the timestamp parameter. Failures and
unparseable state always resolve to "skip" (never stop blindly), except a
missing parameter on a long-running box, which means no activity was ever
recorded.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

DEFAULT_ACTIVITY_PARAMETER = "/suryaghar/last_activity"
DEFAULT_INACTIVITY_THRESHOLD_S = 300.0
DEFAULT_STARTUP_GRACE_S = 600.0


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _make_ec2_client():
    """Lazy boto3 client so unit tests never need AWS credentials."""
    import boto3  # lazy: keeps local test collection dependency-free

    return boto3.client("ec2")


def _make_ssm_client():
    """Lazy boto3 client so unit tests never need AWS credentials."""
    import boto3  # lazy: keeps local test collection dependency-free

    return boto3.client("ssm")


def read_activity_timestamp(ssm_client, parameter: str) -> datetime | None:
    """Return the SSM activity timestamp, or None when never recorded.

    A missing parameter means no wake/backend request has ever stamped it.
    Any other failure (permissions, network) raises so the caller can
    fail safe (skip) instead of stopping on ignorance.
    """
    try:
        resp = ssm_client.get_parameter(Name=parameter)
        return _as_utc(datetime.fromisoformat(resp["Parameter"]["Value"]))
    except Exception as exc:
        # botocore ParameterNotFound carries this name; avoid importing botocore.
        if "ParameterNotFound" in type(exc).__name__ or "ParameterNotFound" in str(exc):
            logger.info("SSM parameter %s not present yet; treating as no recorded activity", parameter)
            return None
        raise


def decide_autostop(
    *,
    now: datetime,
    state: str,
    launch_time: datetime | None,
    last_activity: datetime | None,
    inactivity_threshold_s: float = DEFAULT_INACTIVITY_THRESHOLD_S,
    startup_grace_s: float = DEFAULT_STARTUP_GRACE_S,
) -> tuple[str, str]:
    """Pure stop/skip decision. Returns (action, reason).

    Actions: "stop" | "skip". Stopping requires ALL of: running state, past
    the startup grace window, and activity older than (or absent with) the
    inactivity threshold.
    """
    now = _as_utc(now)
    if state != "running":
        return "skip", f"instance state is '{state}', nothing to stop"
    if launch_time is None:
        return "skip", "launch time unknown; refusing to stop blindly"
    launch_age_s = (now - _as_utc(launch_time)).total_seconds()
    if launch_age_s < startup_grace_s:
        return (
            "skip",
            f"running for {launch_age_s:.0f}s < {startup_grace_s:.0f}s grace; too recently started to evaluate",
        )
    if last_activity is None:
        return "stop", "no activity ever recorded and past the startup grace window"
    idle_s = (now - _as_utc(last_activity)).total_seconds()
    if idle_s >= inactivity_threshold_s:
        return "stop", f"inactive for {idle_s:.0f}s >= {inactivity_threshold_s:.0f}s threshold"
    return "skip", f"active {idle_s:.0f}s ago (< {inactivity_threshold_s:.0f}s threshold)"


def lambda_handler(event: dict, context) -> dict:
    """EventBridge entry point. Never raises; failures resolve to skip."""
    try:
        instance_id = _env("INSTANCE_ID")
    except RuntimeError as exc:
        logger.error("Configuration error: %s", exc)
        return {"action": "error", "reason": str(exc)}

    parameter = os.environ.get("ACTIVITY_SSM_PARAMETER", "").strip() or DEFAULT_ACTIVITY_PARAMETER
    inactivity_threshold_s = _env_float("INACTIVITY_THRESHOLD_S", DEFAULT_INACTIVITY_THRESHOLD_S)
    startup_grace_s = _env_float("STARTUP_GRACE_S", DEFAULT_STARTUP_GRACE_S)
    logger.info(
        "Autostop check: instance=%s parameter=%s idle>%ss grace>%ss",
        instance_id,
        parameter,
        inactivity_threshold_s,
        startup_grace_s,
    )

    try:
        ec2 = _make_ec2_client()
        resp = ec2.describe_instances(InstanceIds=[instance_id])
        reservations = resp.get("Reservations", [])
        instances = reservations[0].get("Instances", []) if reservations else []
        if not instances:
            logger.error("EC2 instance not found: %s", instance_id)
            return {"action": "error", "reason": "instance not found"}
        inst = instances[0]
        state = inst.get("State", {}).get("Name", "unknown")
        launch_time = inst.get("LaunchTime")
        logger.info("EC2 state: %s", state)
        if state != "running":
            logger.info("Instance not running; nothing to stop")
            return {"action": "skip", "reason": f"instance state is '{state}', nothing to stop"}

        ssm = _make_ssm_client()
        try:
            last_activity = read_activity_timestamp(ssm, parameter)
        except Exception as exc:
            logger.warning("SSM read failed, skipping stop: %s: %s", type(exc).__name__, exc)
            return {"action": "skip", "reason": "activity unreadable; refusing to stop blindly"}
        logger.info(
            "Launch: %s; last activity: %s",
            launch_time.isoformat() if launch_time else None,
            last_activity.isoformat() if last_activity else None,
        )

        action, reason = decide_autostop(
            now=_utcnow(),
            state=state,
            launch_time=launch_time,
            last_activity=last_activity,
            inactivity_threshold_s=inactivity_threshold_s,
            startup_grace_s=startup_grace_s,
        )
        logger.info("Autostop decision: %s (%s)", action, reason)
        if action != "stop":
            return {"action": "skip", "reason": reason}
        ec2.stop_instances(InstanceIds=[instance_id])
        logger.info("EC2 stop requested for %s", instance_id)
        return {"action": "stopped", "reason": reason}
    except Exception as exc:
        logger.error("Autostop failure: %s: %s", type(exc).__name__, exc)
        return {"action": "error", "reason": "internal failure; instance left untouched"}
