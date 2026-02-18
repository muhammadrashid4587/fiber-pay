# @fiber-pay/runtime

Polling monitor and alert runtime for Fiber Network nodes (`fnn v0.6.1`).

## Features

- Poll channel / invoice / payment / peer state
- Reverse proxy interception of `new_invoice` and `send_payment`
- Alert backends: stdout, webhook, websocket
- Persistent state snapshots (file-backed memory store)
- SQLite-backed job orchestration (`payment`, `invoice`, `channel`)
- In-process `JobManager` with retry + idempotency support

## Usage (programmatic)

```ts
import { startRuntimeService } from '@fiber-pay/runtime';

const runtime = await startRuntimeService({
  fiberRpcUrl: 'http://127.0.0.1:8227',
  proxy: { enabled: true, listen: '127.0.0.1:8229' },
  jobs: {
    enabled: true,
    dbPath: './runtime-jobs.db',
  },
});

const signal = await runtime.waitForShutdownSignal();
console.log(`received ${signal}, stopping...`);
await runtime.stop();
```

## Usage (CLI)

Start runtime with job endpoints enabled:

```bash
fiber-pay runtime start --daemon --proxy-listen 127.0.0.1:8229 --json
fiber-pay runtime status --json
```

Operate jobs through CLI (requires active runtime proxy for the profile/rpc url):

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job events <jobId> --json
fiber-pay job cancel <jobId> --json
```

## Monitor endpoints

- `GET /monitor/status`
- `GET /monitor/list_tracked_invoices`
- `GET /monitor/list_tracked_payments`
- `GET /monitor/list_alerts`

## Job endpoints (when `jobs.enabled = true`)

- `POST /jobs/payment`
- `POST /jobs/invoice`
- `POST /jobs/channel`
- `GET /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/events`
- `DELETE /jobs/:id`

Example request body (`POST /jobs/payment`):

```json
{
  "params": {
    "invoice": "fibt1...",
    "sendPaymentParams": { "invoice": "fibt1..." }
  },
  "options": {
    "idempotencyKey": "fibt1...",
    "maxRetries": 3
  }
}
```

`/monitor/list_alerts` query params:

- `limit=<number>`
- `min_priority=critical|high|medium|low`
- `type=<alert_type>`
- `source=<monitor_name>`
