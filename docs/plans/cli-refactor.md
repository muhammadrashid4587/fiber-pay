# CLI Refactor Plan (Fiber v0.6.1)

## Context & Constraints

- `@fiber-pay/cli` should prefer `@fiber-pay/sdk` for business logic and RPC access.
- Fiber Node implementation is anchored to **v0.6.1**.
- Canonical RPC reference:
  - https://github.com/nervosnetwork/fiber/blob/v0.6.1/crates/fiber-lib/src/rpc/README.md
- Primary UX focus: status visibility and operational workflows for:
  - channels
  - invoices
  - payments

## Goals

1. Make channel / invoice / payment status checks first-class CLI workflows.
2. Improve maintainability by moving away from hand-rolled argument parsing.
3. Keep backward compatibility for commonly used legacy commands where practical.
4. Keep implementation aligned with current SDK types and RPC wrappers.

## Current Issues (Observed)

- Single large `packages/cli/src/cli.ts` file (~1300 lines).
- Manual parsing of `process.argv` and options.
- Missing direct status commands:
  - single channel detail query
  - invoice status query (`get_invoice`)
  - payment status query/watch (`get_payment`, waiting)
- JSON-only output is machine-friendly but not operator-friendly.

## Implementation Strategy

### Phase 1 (Start now)

- Introduce Commander.js as CLI framework.
- Keep existing behavior while routing commands through Commander.
- Add high-value status commands backed by SDK RPC client:
  - `channel get`
  - `invoice get`
  - `invoice cancel`
  - `invoice settle`
  - `payment get`
  - `payment watch`

### Phase 2

- Restructure into command modules (`commands/`) and shared helpers (`lib/`).
- Add consistent output layer:
  - human-readable default
  - `--json` mode for automation/agents
- Consolidate aliases and normalize command naming.

### Phase 2 Status (2026-02-12)

- ✅ Completed: `commands/*` + `lib/*` modular architecture is now the primary CLI implementation.
- ✅ Completed: default human-readable output with `--json` support across core workflows:
  - channel / invoice / payment status commands
  - node info
  - peer list/connect/disconnect
  - balance
  - binary info/download
- ✅ Completed: command surface consolidation by trimming low-value duplicate legacy aliases while retaining high-value compatibility aliases (`start`, `stop`, `status`, `info`, `channels`, `watch-channels`, `pay`, `open-channel`, `close-channel`, `abandon-channel`, `download`, `binary-info`, `create-invoice`, `verify-invoice`, `invoice-get`, `payment-get`, `payment-watch`).

### Phase 3 (Deferred)

- ⏸ Deferred by decision on 2026-02-12.
- Scope remains unchanged and will be resumed later:
  - richer channel/payment failure diagnostics
  - contextual next-step suggestions (liquidity/channel state blockers)
  - broader CLI validation and test coverage expansion

### Phase 3

- Add richer diagnostics for channel lifecycle operations.
- Add contextual suggestions when an action fails (e.g., liquidity/channel state blockers).
- Expand tests around command argument validation and status workflows.

## Candidate Command Topology (Target)

- `fiber-pay node ...`
- `fiber-pay channel list|get|open|close|watch|abandon|update`
- `fiber-pay invoice create|get|parse|cancel|settle`
- `fiber-pay payment send|get|watch`
- `fiber-pay peer list|connect|disconnect`
- `fiber-pay binary download|info`
- `fiber-pay balance`

## Notes

- Prefer existing SDK methods before adding any direct raw RPC calls.
- Keep Fiber v0.6.1 compatibility explicit in CLI docs/help.
- Preserve current env var compatibility (`FIBER_RPC_URL`, `FIBER_NETWORK`, etc.).
