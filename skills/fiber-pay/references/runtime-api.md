# Runtime Proxy API (Conceptual Contract)

This document captures stable runtime API concepts used by runtime-backed CLI orchestration.
For transport/auth hardening and deployment policy, follow environment-specific operational rules.

## Runtime proxy basics

- Runtime proxy is plain HTTP/JSON.
- Default listen is profile-dependent (commonly `127.0.0.1:8229` for default profile).
- In local workflows, proxy is typically started by `node start`.

## Job submission

Runtime-backed writes are submitted as jobs:

- `POST /jobs/payment`
- `POST /jobs/invoice`
- `POST /jobs/channel`

Requests include `params` and optional `options` (for example idempotency and retry hints).

## Job management

- `GET /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/events`
- `DELETE /jobs/:id` (cancel)

These endpoints back CLI job observability (`job list/get/events/trace`).

## Monitoring endpoints

- `GET /monitor/status`
- `GET /monitor/list_alerts`
- `GET /monitor/list_tracked_invoices`
- `GET /monitor/list_tracked_payments`

Use monitor endpoints for health/status context, not as a replacement for command-level validation.

## Job state model

Canonical progression:

`pending` -> `running` -> `succeeded|failed|cancelled`

- terminal states are permanent
- retry/backoff behavior is managed by runtime orchestration policy

## Practical usage guidance

- Prefer CLI grouped commands for normal operations.
- Use runtime API directly only when building custom clients or integrations.
- For correctness, pair runtime API usage with JSON/NDJSON contract expectations in `contracts.md`.
