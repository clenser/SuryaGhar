# SuryaGhar EC2 wake/sleep Lambdas

```text
Vercel → API Gateway HTTP API → suryaghar-ec2-wake → EC2 FastAPI (Nginx :80)
EventBridge (every 1 min) → suryaghar-ec2-autostop → EC2 stop (when idle 5+ min)
```

## suryaghar-ec2-wake — API Gateway request gateway

`suryaghar_ec2_wake.py` is the single-file Lambda handler that fronts the
SuryaGhar EC2 FastAPI backend.

On each request it first stamps `/suryaghar/last_activity` in SSM Parameter
Store (so auto-stop never mistakes a fresh wake for inactivity — not even a
request that only reaches `/health`, which the backend excludes from its own
tracking), then ensures EC2 is running (starting it if stopped, refreshing
DuckDNS, waiting only a short bounded window), then proxies the original
request. If the backend is not healthy in time it returns `503` with
`Retry-After: 3` instead of holding the API Gateway 30s integration open.

## Deploy

- Runtime: Python 3.12, handler `suryaghar_ec2_wake.lambda_handler`.
- Package: zip this directory's `suryaghar_ec2_wake.py` (stdlib + boto3 from
  the Lambda runtime; no other dependencies).
- **Timeout: 28 seconds** (must stay under API Gateway's 30s integration
  timeout; the handler additionally self-budgets ~27s).
- Memory: 128–256 MB is plenty (no model inference happens here).
- API Gateway: HTTP API, `$default` route, Lambda proxy integration
  (payload format **2.0**).

## Environment variables (existing names, unchanged)

| Name            | Required | Purpose                                |
|-----------------|----------|----------------------------------------|
| `INSTANCE_ID`   | yes      | EC2 instance to wake                   |
| `DUCKDNS_DOMAIN`| no       | Hostname refreshed after start/IP read |
| `DUCKDNS_TOKEN` | no       | DuckDNS update token (never logged)    |

Region/credentials resolve from the Lambda environment and execution role;
no access keys are configured. The execution role needs, in addition to its
existing EC2 permissions (`ec2:DescribeInstances`, `ec2:StartInstances` on
the instance):

```json
{
  "Effect": "Allow",
  "Action": ["ssm:PutParameter"],
  "Resource": "arn:aws:ssm:ap-southeast-2:058190633478:parameter/suryaghar/last_activity"
}
```

Optional override: `ACTIVITY_SSM_PARAMETER` (default `/suryaghar/last_activity`).

## suryaghar-ec2-autostop — EventBridge inactivity stopper

`suryaghar_ec2_autostop.py` runs every minute and stops the instance only when
ALL hold: state is `running`, it has been running past `STARTUP_GRACE_S
(600s default, env-overridable), and the SSM activity timestamp is older than
`INACTIVITY_THRESHOLD_S` (300s default, env-overridable) — or was never
written on a long-running box. A missing launch time, an unreadable SSM
parameter (permissions/network), or any internal error resolves to "skip":
the function never stops blindly. Same `INSTANCE_ID` env name;
`ACTIVITY_SSM_PARAMETER` shared. Execution role needs
`ec2:DescribeInstances`, `ec2:StopInstances`, and `ssm:GetParameter` on the
timestamp parameter.

## Tests

No AWS access needed (boto3 and HTTP are mocked):

```bash
python -m pytest infrastructure/aws/lambda/ -q
```

## Notes

- Binary backend responses (PNG/JPEG/…) are returned base64-encoded per the
  payload-2.0 contract.
- Backend `4xx` responses are proxied through with their status/body;
  connection failures become `502`; startup-window exhaustion becomes `503`.
- This function never stops EC2 (see the separate auto-stop Lambda).
