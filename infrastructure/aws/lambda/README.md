# suryaghar-ec2-wake — API Gateway request gateway

`suryaghar_ec2_wake.py` is the single-file Lambda handler that fronts the
SuryaGhar EC2 FastAPI backend:

```text
Vercel → API Gateway HTTP API → suryaghar-ec2-wake → EC2 FastAPI (Nginx :80)
```

On each request it ensures EC2 is running (starting it if stopped, refreshing
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
no access keys are configured. The execution role keeps its existing EC2
permissions (`ec2:DescribeInstances`, `ec2:StartInstances` on the instance).

## Tests

No AWS access needed (boto3 and HTTP are mocked):

```bash
python -m pytest infrastructure/aws/lambda/test_suryaghar_ec2_wake.py -q
```

## Notes

- Binary backend responses (PNG/JPEG/…) are returned base64-encoded per the
  payload-2.0 contract.
- Backend `4xx` responses are proxied through with their status/body;
  connection failures become `502`; startup-window exhaustion becomes `503`.
- This function never stops EC2 (see the separate auto-stop Lambda).
