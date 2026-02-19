---
name: fiber-pay
description: Operate CKB Lightning payments through fiber-pay CLI. Use when tasks involve node lifecycle, channel management, invoice/payment flows, config tuning, or multi-node orchestration on Fiber Network v0.6.1.
---

# fiber-pay

fiber-pay is an AI payment layer over Fiber Network for CKB Lightning. It provides an AI-friendly SDK and CLI to manage node lifecycle, channels, invoices, payments, and more.

## Document Metadata

Last updated: 2026-02-19
Fiber node target: v0.6.1
Primary RPC reference:
https://github.com/nervosnetwork/fiber/blob/v0.6.1/crates/fiber-lib/src/rpc/README.md

## Scope

This skill is the canonical knowledge layer for:

- core operational workflow (smoke-test style end-to-end flow)
- CLI architecture and runtime orchestration model
- machine-consumed output contracts and runtime API semantics
- troubleshooting and profile/multi-node operating practices

Operational model: fiber-pay primarily controls the local `fnn` binary and interacts through RPC; most CLI atomic commands are direct mappings or thin orchestration wrappers over RPC methods.

This skill is not a static command/flag catalog.

For exact command syntax and latest flags, always use CLI progressive help and implementation code.

## Install

For local installation and CLI linking workflow, read [references/install.md](references/install.md).

## CLI usage principle

### Learn progressively with `-h`

Do NOT memorize every flag:

1. `fiber-pay -h` → discover command groups
2. `fiber-pay <group> -h` → discover subcommands (e.g. `fiber-pay channel -h`)
3. `fiber-pay <group> <cmd> -h` → discover flags (e.g. `fiber-pay channel open -h`)

This saves tokens and guarantees correct, up-to-date flag usage. When unsure about a command's options, run `-h` first.

For deeper command truth, read implementation under `packages/cli/src/commands/**`.

### Be proactive

Try bootstrap the node, prepare channels, and get the payment network ready end-to-end without waiting for step-by-step instructions.

Only ask users for missing pieces of information that they would know but you don't (e.g. "what's the multiaddr of the peer you want to connect to?", "Do you want custom password or default one?", "Please deposit some CKB to my funding address: <funding-address>") instead of asking for every single command or flag.

### Readiness gate before sending payments

Before `payment send`, verify all of the following:

- node process is running
- RPC is reachable
- runtime proxy is available
- at least one usable channel/liquidity path exists

Suggested preflight checks:

```bash
fiber-pay node ready --json
fiber-pay runtime status --json
fiber-pay channel list --state ChannelReady --json
```

### Bootstrap

```
fiber-pay node start --daemon
fiber-pay node ready --json
```

Notes:
1. start node in a background session
2. only use foreground `node start` for interactive/manual debugging
3. `node start` auto-handles: binary download, config generation, key creation, runtime proxy startup.

### Payment cycle

```
fiber-pay peer connect <multiaddr> --json
fiber-pay channel open --peer <addr> --funding <CKB> --json
fiber-pay channel watch --until CHANNEL_READY --json
fiber-pay payment send <invoice> --wait --json
```

When a payment fails, classify by `error.code`, apply recovery, and retry with bounded attempts.

### Receive

```
fiber-pay invoice create --amount <CKB> --description "..." --json
fiber-pay invoice get <paymentHash> --json
```

### Inspect

```
fiber-pay channel list --json
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay logs --source all --tail 80
fiber-pay logs --source runtime --follow
```

## CLI architecture model

Think in layers:

1. **Atomic command layer**: grouped commands (`node/channel/invoice/payment/job/...`) provide user/operator entry points.
2. **Runtime orchestration layer**: job lifecycle, retries, event history, and monitoring.
3. **Runtime proxy API layer**: HTTP API used by runtime-backed command paths.

In runtime-active scenarios, write operations are generally job-first and then observable via `job list/get/events/trace`.

## Output convention

Always use `--json` when output is consumed by agents or scripts.

For command output and stream contracts, read `references/contracts.md`.
For runtime HTTP endpoints and job semantics, read `references/runtime-api.md`.

## References

- **Install & local linking**: Read [references/install.md](references/install.md) for clone/build/link setup (`pnpm install`, `pnpm build`, `pnpm link --global`).
- **Full fnn config keys**: Read [references/config.md](references/config.md) for structured key/value/default tables across all config sections (`fiber`, `rpc`, `ckb`, `cch`).
- **Profile & multi-node**: Read [references/profile.md](references/profile.md) for how profiles work, data directory layout, multi-node port scheme, and what `node start` does/doesn't auto-handle.
- **Logs & black-box debugging**: Read [references/logs-troubleshooting.md](references/logs-troubleshooting.md) first when startup/channel/payment issues are unclear. Prefer `job trace <jobId>` and `job events --with-data` before guessing root causes.
- **Output contracts**: Read [references/contracts.md](references/contracts.md) for JSON envelope, NDJSON stream events, and timeout semantics.
- **Runtime API**: Read [references/runtime-api.md](references/runtime-api.md) for `/jobs/*` and `/monitor/*` endpoints and state model.
