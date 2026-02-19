# CLI Output & Streaming Contracts

This document captures stable machine-facing output contracts.
For exact command syntax and flags, use CLI `-h` and source code.

## JSON envelope (non-stream commands)

All non-stream commands in `--json` return one envelope:

- success: `{"success":true,"data":{...}}`
- failure: `{"success":false,"error":{"code":"...","message":"...","recoverable":true|false,"suggestion":"...","details":{...}}}`

Error fields:

- `code` (required): stable machine code
- `message` (required): human-readable summary
- `recoverable` (optional): whether automated retry can be attempted after correction
- `suggestion` (optional): remediation hint
- `details` (optional): structured context

Notes:

- `payment send --json` may be accepted with `data.status` in `success|pending|failed`.
- When `--wait` is used and runtime proxy is active, response can include `data.jobId` and `data.jobState`.

## NDJSON streaming (`watch --json` and long-running streams)

Streaming commands emit NDJSON (one JSON object per line), not a single JSON document.

Representative event progression:

- `channel watch --json`: `snapshot` -> `state_change` -> `terminal`
- `payment watch --json`: `status_transition` -> `terminal`
- `node start --json`: `startup_stage` -> `node_started` -> `node_stopped`
- `runtime start --json`: `runtime_starting` -> `runtime_started` -> `runtime_alert` -> `runtime_stopping` -> `runtime_stopped`

`startup_stage` may include phases such as:

- `init`
- `binary_resolved`
- `key_initialized`
- `process_started`
- `rpc_ready`
- `bootnodes_connected`
- `startup_complete`

## Timeout behavior

Long-running watchers support timeout policy flags like `--on-timeout fail|success`.

- `fail`: exits as timeout failure
- `success`: treats timeout as successful automation completion

Choose policy based on workflow intent and whether terminal state is strictly required.

## Error catalog source

Do not duplicate static error tables in skill docs.
Use machine-readable source:

- `packages/cli/error-codes.json`
