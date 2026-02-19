# fiber-pay

AI-friendly SDK + CLI for CKB Lightning on Fiber Network.

Fiber target: `v0.6.1`

## Positioning

`fiber-pay` is built to make Fiber programmable for both humans and AI agents:

- `@fiber-pay/sdk`: typed building blocks for Fiber RPC, verification, and policy logic
- `@fiber-pay/cli`: stable operator + automation interface with machine-readable output
- `@fiber-pay/node`: local runtime substrate for managing the `fnn` binary lifecycle

This repository currently emphasizes SDK + CLI quality and agent usability through clear command contracts.

## Why this repo is AI-friendly

- Canonical CLI guide for agents: `packages/cli/llm.txt`
- Predictable grouped commands (`node/channel/invoice/payment/job/peer/binary/config/graph/runtime`)
- Uniform `--json` envelopes for reliable parsing and tool chaining
- NDJSON stream events for `watch --json` commands
- Explicit defaults for startup, ports, binary path, and key password behavior

## Quick start

Prerequisites:

- Node.js `>=20`
- `pnpm`

```bash
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

```bash
fiber-pay --help
fiber-pay --profile local-a binary download
# foreground process (run in its own terminal)
fiber-pay --profile local-a node start
# detached background mode (also enables runtime daemon)
fiber-pay --profile local-a node start --daemon
# suppress fnn stream mirroring while keeping logs persisted to files
fiber-pay --profile local-a node start --quiet-fnn
fiber-pay --profile local-a node status
fiber-pay --profile local-a node ready --json
```

Common workflows:

```bash
fiber-pay node status
fiber-pay runtime start --daemon
fiber-pay channel list
fiber-pay invoice create --amount 10 --description "service"
fiber-pay payment send <invoice>
fiber-pay job list
```

## Minimal runtime-backed orchestration (single node, default config)

Use this when you want the simplest CLI path with runtime job orchestration, without `--profile`.

Terminal A (keep running):

```bash
fiber-pay binary download --version v0.6.1
fiber-pay node start
```

Terminal B:

```bash
# 1) Connect to a reachable peer (replace with a real peer multiaddr)
PEER_MULTIADDR="<peer-multiaddr>"
fiber-pay peer connect "$PEER_MULTIADDR" --json

# 2) Open channel and wait until ChannelReady
fiber-pay channel open --peer "$PEER_MULTIADDR" --funding 200 --json
fiber-pay channel watch --state ChannelReady --timeout 180 --on-timeout fail --json

# 3) Preflight after channel is ready
fiber-pay node ready --json

# 4) Submit payment through runtime job path and wait for terminal state
fiber-pay payment send <invoice> --wait --json

# 5) Inspect orchestration result
fiber-pay job list --type payment --json
fiber-pay job get <jobId> --json
fiber-pay job events <jobId> --json
```

Notes:

- `payment send --wait --json` uses runtime job orchestration when runtime proxy is active (default with `node start`).
- `payment send` does not auto-open channels; open and verify `ChannelReady` first as shown above.

### Runtime routing matrix (current)

When runtime proxy is active (same profile + same RPC URL), CLI resolves RPC to proxy automatically.

- **Job-first (writes)**
	- `payment send` → `/jobs/payment` (fallback to direct `send_payment` if job endpoint unavailable)
	- `invoice create|cancel|settle` → `/jobs/invoice` (fallback to direct RPC)
	- `channel open|close|accept|abandon|update` → `/jobs/channel` (fallback to direct RPC)
- **Proxy-forward RPC (no job record)**
	- `invoice get|parse`
	- `payment get|watch`
	- `channel list|get|watch`
	- `peer *`, `graph *`, `node info|status|ready`

Tip: use `fiber-pay job list --type payment|invoice|channel --json` to inspect orchestration records and `fiber-pay job events <jobId> --json` for state transitions.
Use `fiber-pay job trace <jobId>` to aggregate job status, timeline, and related persisted logs in one view.
Use `fiber-pay logs --source all --tail 80` (or `fiber-pay log`) to inspect persisted logs directly without `cat`.
Use `fiber-pay logs --source runtime --follow` for live tailing in terminal.

Debug tip (black-box channel open/close):

- `fiber-pay job events <jobId> --with-data` shows per-step runtime context (action/channelId/peerId/retry/error).
- `fiber-pay` now persists logs under `<data-dir>/logs/`:
	- `fnn.stdout.log`
	- `fnn.stderr.log`
	- `runtime.alerts.jsonl`
- quick view: `fiber-pay logs --source runtime|fnn-stdout|fnn-stderr|all --tail 80`
- live follow: `fiber-pay logs --source runtime --follow --interval-ms 1000`
- `runtime.meta.json` includes these log file paths for agent/file-based diagnostics.

Use `--json` when command output is consumed by scripts or agents.
Non-stream commands emit a single envelope (`success + data|error`), while watch commands emit NDJSON events.
JSON failures include stable fields (`error.code`, `error.message`) and may include `error.recoverable`, `error.suggestion`, `error.details`.
`fiber-pay node start --json` emits staged NDJSON lifecycle events before `node_started` for deterministic automation.
For automation, long-running watchers support timeout policies such as `--on-timeout success`.
Machine-readable error code catalog is available at `packages/cli/error-codes.json`.

## Copy-paste prompt for your coding agent

Use this prompt in Cursor/Claude/Copilot/other agents:

```text
Follow this document https://raw.githubusercontent.com/RetricSu/fiber-pay/master/packages/cli/llm.txt to equip yourself with a p2p payment system.
```

## Source of truth

- CLI behavior + command reference: `packages/cli/llm.txt`
- Maintainer alignment notes: `AGENT.md`
- Intent docs: `docs/plans/ai-payment-layer-intent.md`
- Config docs: `docs/configuration.md`
- Config artifact: `configs/fnn.reference.yml` (full commented reference)

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

Package-scoped checks:

```bash
pnpm --filter @fiber-pay/sdk test
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

## E2E dual-node script

Run:

```bash
node scripts/e2e-testnet-dual-node.mjs
```

The script drives: peer connect → channel open → invoice create → payment send → channel close.

Useful env overrides:

- `SKIP_BUILD=1`
- `SKIP_DEPOSIT=1`
- `SKIP_BINARY_DOWNLOAD=1`
- `FIBER_BINARY_VERSION=v0.6.1`
- `CHANNEL_FUNDING_CKB`, `INVOICE_AMOUNT_CKB`, `DEPOSIT_AMOUNT_CKB`
- `NODE_A_RPC_PORT`, `NODE_A_P2P_PORT`, `NODE_B_RPC_PORT`, `NODE_B_P2P_PORT`

## E2E runtime orchestration script (job path)

Reusable regression for runtime job orchestration (`/jobs/channel`, `/jobs/invoice`, `/jobs/payment`):

```bash
pnpm e2e:runtime-jobs
```

It validates this flow through runtime jobs: peer connect → channel open → invoice create → payment send → channel shutdown.

Useful env overrides:

- `PROFILE_A`, `PROFILE_B` (default `rt-a`, `rt-b`)
- `PROXY_A_URL`, `PROXY_B_URL` (default `http://127.0.0.1:9729`, `http://127.0.0.1:9829`)
- `CHANNEL_FUNDING_CKB`, `INVOICE_AMOUNT_CKB`, `INVOICE_CURRENCY`
- `JOB_TIMEOUT_SEC`, `POLL_INTERVAL_MS`, `PEER_CONNECT_TIMEOUT_SEC`
- `FIBER_PAY_BIN` (optional; by default script uses local `packages/cli/dist/cli.js` via current Node)

Machine-readable output:

```bash
pnpm e2e:runtime-jobs -- --json
```

## TODO

- [x] alert new channel to accept and add funding (`new_inbound_channel_request`)
- [x] alert new invoice coming (`incoming_payment_received`)
- [x] alert new payment coming (`new_pending_tlc`, `channel_balance_changed`)
- [x] channel status snapshot check (`channel_became_ready`, channel diff)
- [x] alert channel closed (`channel_closing`)
