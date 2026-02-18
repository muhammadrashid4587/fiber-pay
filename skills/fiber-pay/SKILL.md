---
name: fiber-pay
description: Operate Fiber Network payments on CKB through fiber-pay CLI and SDK. Use when tasks involve node lifecycle, peer connectivity, channel management, invoice/payment flows, balance checks, or building typed integrations against Fiber RPC v0.6.1.
---

# fiber-pay skill

Use this skill to execute and automate Fiber Network workflows with the current grouped CLI and the TypeScript SDK.

## Project goal

fiber-pay is an AI payment layer over Fiber Network (`fnn`) for CKB Lightning workflows, with Fiber compatibility target `v0.6.1`.

Focus areas for this skill:

- CLI-first operations for real node and payment workflows
- SDK guidance for typed RPC integrations and watchers

## Repository map (relevant)

- `packages/cli`: operator command surface (most important for execution)
- `packages/sdk`: typed RPC client, polling helpers, verification/security utilities
- `packages/node`: binary + process lifecycle substrate used by CLI/runtime

## Mandatory source-of-truth rule

Before doing any CLI task, read:

- `packages/cli/llm.txt`

This file is the authoritative and current CLI behavior reference (commands, flags, runtime defaults, env vars, multi-node setup, troubleshooting).

Do not invent command forms that are not documented there.

## CLI model

Use grouped commands only:

- `node`
- `channel`
- `invoice`
- `payment`
- `peer`
- `binary`
- `config`

Examples of valid style:

- `fiber-pay node start`
- `fiber-pay payment send <invoice>`
- `fiber-pay channel list --json`

## Output conventions

- Default output is human-readable.
- Use `--json` whenever output is consumed by another tool/agent step.
- When automating, prefer `--json` consistently for stable parsing.

## Core CLI workflows

### 1) Bootstrap a node

1. `fiber-pay binary download`
2. `fiber-pay config init --force --json`
3. `fiber-pay node start`
4. `fiber-pay node status`
5. `fiber-pay node info --json`

### 2) Receive payment (invoice flow)

1. `fiber-pay invoice create --amount 10 --description "service"`
2. Share returned invoice string
3. `fiber-pay invoice get <paymentHash> --json`
4. Optional cancel: `fiber-pay invoice cancel <paymentHash> --json`

### 3) Send payment

1. `fiber-pay node status --json`
2. `fiber-pay payment send <invoice> --json`
3. `fiber-pay payment get <paymentHash> --json`
4. Optional watch: `fiber-pay payment watch <paymentHash> --json`

### 4) Channel lifecycle

1. `fiber-pay peer connect <multiaddr> --json`
2. `fiber-pay channel open --peer <peerIdOrMultiaddr> --funding <CKB>`
3. `fiber-pay channel watch --until CHANNEL_READY --json`
4. `fiber-pay channel list --json`
5. Close when needed: `fiber-pay channel close <channelId>`

### 5) Multi-node local setup

Use one profile per node (`--profile rt-a`, `--profile rt-b`) and dedicated terminals. Follow the exact pattern in `packages/cli/llm.txt` under “Multi-Node Pattern (`--profile`)”.

## SDK usage map

Use `@fiber-pay/sdk` when building code integrations instead of shell orchestration.

Primary exports:

- `FiberRpcClient`, `FiberRpcError`
- `ChannelState`
- amount utilities: `ckbToShannons`, `shannonsToCkb`
- helpers: `InvoiceVerifier`, `PaymentProofManager`, `PolicyEngine`, `KeyManager`

For full SDK method/type coverage, read:

- `skills/fiber-pay/references/SDK.md`

For full fnn config key reference and generalized config CLI usage, read:

- `docs/configuration.md`
- `configs/fnn.reference.yml`

## Amount and encoding conventions

At RPC boundary, numeric values are typically hex-encoded shannons (`0x...`).

Operational guidance:

- CLI input flags generally use CKB units.
- SDK helper conversions:
  - `ckbToShannons(...)`
  - `shannonsToCkb(...)`

Do not mix CKB decimal values with raw RPC hex fields.

## Practical gotchas

1. ESM imports inside packages use `.js` file extensions in source imports.
2. Key formats are strict:
   - `fiber/sk` uses raw bytes
   - `ckb/key` uses hex string
3. RPC commands require a reachable node endpoint; verify with `fiber-pay node status` and `fiber-pay node info --json`.
4. On Apple Silicon, x86_64 binary fallback may require Rosetta.
5. For command updates, keep grouped semantics and output policy stable.

## Validation commands

Use these after CLI/SDK changes:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
pnpm --filter @fiber-pay/sdk test
pnpm typecheck
```

## Quick execution policy for agents

1. Read `packages/cli/llm.txt` before issuing CLI commands.
2. Use grouped command forms only.
3. Use `--json` for machine workflows.
4. Verify node readiness before RPC-dependent commands.
5. Prefer SDK polling helpers over ad-hoc loops in custom scripts.
