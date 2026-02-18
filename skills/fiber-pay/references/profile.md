# Profile & Multi-Node Guide

## What is a profile

A profile is an isolated data directory. Each profile gets its own `config.yml`, `profile.json`, binary, keys, PID files, and runtime state.

- `--profile <name>` → `~/.fiber-pay/profiles/<name>/`
- No `--profile` → `~/.fiber-pay/` (default profile)

## Data directory layout

```
<data-dir>/
├── config.yml          # fnn node config (fiber/rpc/ckb sections)
├── profile.json        # CLI-only overrides (binaryPath, keyPassword)
├── bin/fnn             # downloaded binary
├── fiber/sk            # secret key (auto-generated)
├── runtime.pid         # runtime process PID (transient)
├── runtime.meta.json   # runtime metadata (transient)
├── runtime-state.json  # runtime snapshot state
├── runtime-jobs.db     # job orchestration database
└── fnn.pid             # node process PID (transient)
```

## profile.json scope

Only two CLI-level keys:

| Key | Description |
|-----|-------------|
| `binaryPath` | Path to fnn binary (overrides default `<data-dir>/bin/fnn`) |
| `keyPassword` | Keystore encryption password |

Manage with:
```
fiber-pay config profile show
fiber-pay config profile set <key> <value>
fiber-pay config profile unset <key>
```

`profile.json` does **not** store node runtime settings — those live in `config.yml`.

## Key resolution priority

| Setting | Priority order |
|---------|---------------|
| `binaryPath` | CLI flag → profile.json → env `FIBER_BINARY_PATH` |
| `keyPassword` | CLI flag → profile.json → env `FIBER_KEY_PASSWORD` |
| `network` | CLI flag → env `FIBER_NETWORK` → config.yml → default `testnet` |
| `rpcUrl` | CLI flag → env `FIBER_RPC_URL` → config.yml → default `127.0.0.1:8227` |
| `dataDir` | CLI flag → env `FIBER_DATA_DIR` → default `~/.fiber-pay` |

## Default (no profile)

When no `--profile` or `--data-dir` is provided:
- Data dir: `~/.fiber-pay/`
- Ports: RPC `8227`, P2P `8228`, runtime proxy `8229`
- Single-node operation, no port conflict concerns

## Multi-node setup

Each node needs unique ports for: RPC, P2P, and runtime proxy.

### Minimal steps to add a second node

```bash
# 1. Init config with non-conflicting ports
fiber-pay --profile b config init --network testnet --rpc-port 8327 --p2p-port 8328

# 2. Start node (binary auto-downloads if missing)
fiber-pay --profile b node start --runtime-proxy-listen 127.0.0.1:8329
```

### What `node start` auto-handles

- Binary: downloads if missing or version mismatch (via `ensureFiberBinary`)
- Config: generates default `config.yml` if missing (via `ensureNodeConfigFile`)
- Keys: generates `fiber/sk` if missing
- Runtime: starts embedded runtime proxy + job orchestration

### What `node start` does NOT auto-handle

- **Port conflicts**: auto-generated config uses default ports, so the second node will collide. Always run `config init --rpc-port --p2p-port` first for additional profiles.
- **Runtime proxy port**: defaults to `127.0.0.1:8229` every time, not persisted. Must pass `--runtime-proxy-listen` explicitly each start for non-default ports.
- **Profile-level proxy port**: not yet stored in `profile.json` — see `docs/runtime-proxy-listen-gap.md`.

### Recommended port scheme

| Profile | RPC | P2P | Runtime Proxy |
|---------|-----|-----|---------------|
| (default) | 8227 | 8228 | 8229 |
| `b` | 8327 | 8328 | 8329 |
| `c` | 8427 | 8428 | 8429 |

### Two-node example (full)

```bash
# Terminal 1: node A (default profile)
fiber-pay node start

# Terminal 2: node B
fiber-pay --profile b config init --network testnet --rpc-port 8327 --p2p-port 8328
fiber-pay --profile b node start --runtime-proxy-listen 127.0.0.1:8329

# Terminal 3: connect and open channel
A_ADDR="$(fiber-pay node status --json | jq -r '.data.multiaddr')"
B_ADDR="$(fiber-pay --profile b node status --json | jq -r '.data.multiaddr')"
fiber-pay peer connect "$B_ADDR" --json
fiber-pay --profile b peer connect "$A_ADDR" --json
fiber-pay channel open --peer "$B_ADDR" --funding 200 --json
```

### All commands are profile-scoped

Every `fiber-pay` subcommand respects `--profile`. Always pair the profile with the command that targets that node:

```bash
fiber-pay --profile b channel list --json
fiber-pay --profile b node stop
```
