# @fiber-pay/runtime

Polling monitor and alert runtime for Fiber Network nodes (`fnn v0.6.1`).

## Features

- Poll channel / invoice / payment / peer state
- Reverse proxy interception of `new_invoice` and `send_payment`
- Alert backends: stdout, webhook, websocket
- Persistent state snapshots (file-backed memory store)

## Usage (programmatic)

```ts
import { startRuntimeService } from '@fiber-pay/runtime';

const runtime = await startRuntimeService({
  fiberRpcUrl: 'http://127.0.0.1:8227',
  proxy: { enabled: true, listen: '127.0.0.1:8228' },
});

const signal = await runtime.waitForShutdownSignal();
console.log(`received ${signal}, stopping...`);
await runtime.stop();
```

## Monitor endpoints

- `GET /monitor/status`
- `GET /monitor/list_tracked_invoices`
- `GET /monitor/list_tracked_payments`
- `GET /monitor/list_alerts`

`/monitor/list_alerts` query params:

- `limit=<number>`
- `min_priority=critical|high|medium|low`
- `type=<alert_type>`
- `source=<monitor_name>`
