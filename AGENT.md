# AGENT.md

Maintainer and coding-agent operating guide for `fiber-pay`.

## Project position (authoritative)

`fiber-pay` is an AI-friendly SDK + CLI for CKB Lightning on Fiber Network (`fnn`).

Protocol target: Fiber `v0.6.1`.

Primary layers in active scope:

- `@fiber-pay/sdk`: typed Fiber RPC/domain layer
- `@fiber-pay/cli`: operator and automation interface
- `@fiber-pay/node`: local binary/process lifecycle support

## Source-of-truth order

When executing real tasks, follow this order:

1. `skills/fiber-pay/SKILL.md` and `skills/fiber-pay/references/**` (canonical workflow, architecture, and contracts)
2. code in `packages/cli/src/**` and `packages/sdk/src/**` (authoritative command and behavior details)
3. intent docs in `docs/plans/**`

If docs and code disagree, treat current code as authoritative and update skills docs accordingly.

## Operating rules for coding agents

1. Read `skills/fiber-pay/SKILL.md` before running `fiber-pay` workflows.
2. Use grouped commands only: `node`, `channel`, `invoice`, `payment`, `peer`, `binary`, `balance`.
3. Use `--json` whenever output is consumed by tools/scripts.
4. Default to single-node startup unless multi-node/custom ports are explicitly requested.
5. For exact syntax and flags, use progressive CLI help (`fiber-pay -h`, subgroup `-h`) and command source code.
6. Do not invent undocumented flags, command aliases, or response schemas.

## Copy-paste bootstrap prompt (for external agents)

```text
Use this Fiber skill source-of-truth document:
https://raw.githubusercontent.com/RetricSu/fiber-pay/main/skills/fiber-pay/SKILL.md

Read that URL first and treat it as workflow/architecture source of truth.

For exact command syntax and flags, learn progressively with CLI help:
- fiber-pay -h
- fiber-pay <group> -h
- fiber-pay <group> <cmd> -h

Then equip yourself with fiber-pay behavior:
- obey the readiness gates and contracts in SKILL references,
- use grouped commands only (node/channel/invoice/payment/peer/binary/config/graph/runtime/job),
- prefer --json for automation,
- use single-node quick start by default unless I ask otherwise.

Before executing actions, summarize:
1) startup defaults,
2) required env vars (if any),
3) exact commands you will run.

Then execute the requested task.
```

## Contribution focus

Prioritize improvements that strengthen SDK + CLI reliability and AI usability:

- stable command semantics
- clear machine-readable outputs
- explicit runtime defaults
- minimal ambiguity in docs/examples

Avoid adding new top-level abstractions unless they are required for SDK/CLI workflows.

## Change checklist

For CLI changes:

1. update command implementation in `packages/cli/src/commands/**`
2. keep output policy consistent (human default + `--json`)
3. update `skills/fiber-pay/SKILL.md` and related `skills/fiber-pay/references/**` docs for workflow/contract changes
4. run:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

For SDK changes:

1. update types in `packages/sdk/src/types/**` as needed
2. update RPC client or helpers in `packages/sdk/src/**`
3. keep exports consistent in `packages/sdk/src/index.ts`
4. run:

```bash
pnpm --filter @fiber-pay/sdk test
pnpm --filter @fiber-pay/sdk typecheck
```

## Repository-wide validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Practical notes

- ESM imports require `.js` extension in source imports.
- Fiber RPC amounts are typically hex-encoded shannons at the boundary.
- Apple Silicon may require x86_64 fallback binaries depending on upstream release artifacts.
- In lifecycle code, re-check process/rpc readiness after awaited operations.
