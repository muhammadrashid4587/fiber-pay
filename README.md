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
- Predictable grouped commands (`node/channel/invoice/payment/peer/binary/balance`)
- `--json` output for reliable parsing and tool chaining
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
fiber-pay binary download
fiber-pay node start
fiber-pay node status
```

Common workflows:

```bash
fiber-pay balance
fiber-pay channel list
fiber-pay invoice create --amount 10 --description "service"
fiber-pay payment send <invoice>
```

Use `--json` when command output will be consumed by scripts or agents.

## Copy-paste prompt for your coding agent

Use this prompt in Cursor/Claude/Copilot/other agents:

```text
Use this Fiber CLI source-of-truth document:
https://raw.githubusercontent.com/RetricSu/fiber-pay/main/packages/cli/llm.txt

Before running any Fiber command, read that URL completely and treat it as the CLI source of truth.

Then equip yourself with fiber-pay operational behavior:
- Follow the Agent Entry Protocol in llm.txt.
- Prefer grouped commands only: node/channel/invoice/payment/peer/binary/balance.
- For automation, always use --json outputs.
- Default to single-node quick start unless I explicitly ask for multi-node/custom ports.

After reading the llm.txt document, summarize:
1) startup defaults,
2) required env vars (if any),
3) exact commands you plan to run.

Then execute the task.
```

## Source of truth

- CLI behavior + command reference: `packages/cli/llm.txt`
- Maintainer alignment notes: `AGENT.md`
- Intent docs: `docs/plans/ai-payment-layer-intent.md`

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
