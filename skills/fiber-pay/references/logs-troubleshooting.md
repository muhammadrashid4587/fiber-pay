# Logs Troubleshooting Playbook

Use this when `fiber-pay node start` / channel open-close / payment execution feels like a black box.

## 0) Default run mode for agents

Prefer background/daemon-style operation in automation:

- run `fiber-pay node start --json --quiet-fnn` in a background terminal/session
- if node is up but runtime is down, run `fiber-pay runtime start --daemon --json`
- avoid blocking foreground sessions unless doing manual interactive debugging

## 1) Know where logs live

Per profile/data-dir, runtime and fnn persist logs under:

- `<data-dir>/logs/fnn.stdout.log`
- `<data-dir>/logs/fnn.stderr.log`
- `<data-dir>/logs/runtime.alerts.jsonl`

Runtime metadata file:

- `<data-dir>/runtime.meta.json` (contains runtime/log paths)

## 2) Quick health triage

Run in order:

```bash
fiber-pay node status --json
fiber-pay node ready --json
fiber-pay runtime status --json
```

Interpretation:

- `running=false` → process-level issue (startup/config/port/binary)
- `rpcResponsive=false` with `running=true` → node unhealthy or blocked init
- `recommendation=INSTALL_BINARY` → run `fiber-pay binary download`

## 3) Job-first debugging (recommended)

For channel/payment/invoice workflows, always pivot from job ID:

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job events <jobId> --with-data
fiber-pay job trace <jobId>
```

What to look at:

- `state` transitions (`queued -> ... -> failed/succeeded`)
- `event.data` fields (`action`, `channelId`, `peerId`, `retryCount`, `error`)
- `job trace` matched log lines in fnn/runtime logs

## 4) Startup failure triage

If `node start` exits early:

1. Read `fnn.stderr.log` first
2. Then `fnn.stdout.log`
3. Then runtime alerts (`runtime.alerts.jsonl`)

Common symptom:

- Config parse errors (invalid `code_hash`/`tx_hash`/`args` length) indicate malformed `config.yml`.

## 5) Noise control

`node start` supports both streaming and persistence:

- default: mirror fnn logs to console + persist to files
- `--quiet-fnn`: persist only, no fnn console/json-event mirroring

## 6) Safe smoke-test pattern (isolated dir)

Avoid contaminating default profile while debugging:

```bash
fiber-pay --data-dir ~/.fiber-pay-smoke config init --network testnet --force --json
fiber-pay --data-dir ~/.fiber-pay-smoke binary download --json
fiber-pay --data-dir ~/.fiber-pay-smoke node start --json
fiber-pay --data-dir ~/.fiber-pay-smoke node status --json
fiber-pay --data-dir ~/.fiber-pay-smoke node stop --json
```
