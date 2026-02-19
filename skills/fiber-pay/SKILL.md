---
name: fiber-pay
description: Operate CKB Lightning payments through fiber-pay CLI. Use when tasks involve node lifecycle, channel management, invoice/payment flows, config tuning, or multi-node orchestration on Fiber Network v0.6.1.
---

# fiber-pay

fiber-pay is an AI payment layer over Fiber Network for CKB Lightning. It provides an AI-friendly SDK and CLI to manage node lifecycle, channels, invoices, payments, and more.

## CLI usage principle

### Learn progressively with `-h`

Do NOT memorize every flag:

1. `fiber-pay -h` → discover command groups
2. `fiber-pay <group> -h` → discover subcommands (e.g. `fiber-pay channel -h`)
3. `fiber-pay <group> <cmd> -h` → discover flags (e.g. `fiber-pay channel open -h`)

This saves tokens and guarantees correct, up-to-date flag usage. When unsure about a command's options, run `-h` first.

### Be proactive

Try bootstrap the node, prepare channels, and get the payment network ready end-to-end without waiting for step-by-step instructions.

Only ask users for missing pieces of information that they would know but you don't (e.g. "what's the multiaddr of the peer you want to connect to?", "Do you want custom password or default one?", "Please deposit some CKB to my funding address: <funding-address>") instead of asking for every single command or flag.

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
```

## Output convention

Always use `--json` when output is consumed by agents or scripts.

## References

- **Full fnn config keys**: Read [references/config.md](references/config.md) for structured key/value/default tables across all config sections (`fiber`, `rpc`, `ckb`, `cch`).
- **Profile & multi-node**: Read [references/profile.md](references/profile.md) for how profiles work, data directory layout, multi-node port scheme, and what `node start` does/doesn't auto-handle.
- **Logs & black-box debugging**: Read [references/logs-troubleshooting.md](references/logs-troubleshooting.md) first when startup/channel/payment issues are unclear. Prefer `job trace <jobId>` and `job events --with-data` before guessing root causes.
