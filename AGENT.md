# AGENT.md - AI Maintainer Guide

This document helps maintainers and coding agents keep `fiber-pay` aligned with project intent.

## Project purpose (authoritative)

fiber-pay is an **AI payment layer** on top of Fiber Network (`fnn`) for CKB Lightning workflows.

Repository layers exist to support that product goal:

- `@fiber-pay/sdk`: protocol/domain primitives
- `@fiber-pay/node`: binary + process lifecycle substrate
- `@fiber-pay/cli`: operator/troubleshooting surface
- `@fiber-pay/agent`: LLM-facing orchestration surface

Protocol compatibility target: Fiber `v0.6.1`.

## Current alignment status

`@fiber-pay/agent` is currently usable, but not fully aligned with its target role yet.

Target role of `@fiber-pay/agent`:

1. intent-to-action orchestration (not only RPC passthrough)
2. policy/safety guardrails in the decision path
3. stateful execution for long-running payment/channel flows
4. standardized `AgentResult` outcomes for tooling integration
5. first-class observability and auditability

When docs or APIs are ambiguous, prefer this target model over legacy framing.

## Source of truth

- CLI behavior and command surface: `packages/cli/llm.txt`
- Agent runtime API: `packages/agent/src/fiber-pay.ts`
- MCP tool schemas: `packages/agent/src/mcp-tools.ts`
- Intent baseline: `docs/plans/ai-payment-layer-intent.md`
- Docs rewrite tracker: `docs/plans/docs-rewrite.md`

## Repository structure

```
packages/
├── sdk/      # protocol/domain layer
├── node/     # fnn binary + process lifecycle
├── cli/      # grouped operator commands
└── agent/    # LLM-facing orchestration API + MCP schemas

skills/       # deferred for later refresh (after core docs/runtime alignment)
docs/plans/   # architecture/doc intent and execution plans
```

## Runtime and UX invariants

1. Fiber target stays explicit: `v0.6.1`
2. CLI uses grouped commands only (`node/channel/invoice/payment/peer/binary/balance`)
3. CLI output policy remains stable:
   - default: human-readable
   - `--json`: machine-readable
4. Avoid over-promising unimplemented capabilities in docs
5. Prefer shared helpers/modules over duplicated command logic

## Agent result contract

`@fiber-pay/agent` operations should use:

```ts
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    suggestion?: string;
  };
  metadata?: {
    timestamp: number;
    policyCheck?: PolicyCheckResult;
  };
}
```

Guideline:

- prefer returning `AgentResult` over throwing in business paths
- reserve throws for truly unrecoverable internal faults
- include recovery suggestions for common operator/agent errors

## Common maintenance tasks

### Add a new RPC capability

1. add request/response types in `packages/sdk/src/types/rpc.ts`
2. add method in `packages/sdk/src/rpc/client.ts`
3. expose via `packages/sdk/src/index.ts` if public
4. add orchestration wrapper in `packages/agent/src/fiber-pay.ts` when agent-facing
5. add/update CLI commands only if operator surface is required

### Add/update CLI behavior

1. read `packages/cli/llm.txt` first
2. update command module in `packages/cli/src/commands/<group>.ts`
3. reuse shared helpers in `packages/cli/src/lib/*`
4. preserve output policy (human default + `--json`)
5. update `packages/cli/llm.txt` when behavior changes

Validation:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

### Modify policy/security behavior

- schemas: `packages/sdk/src/types/policy.ts`
- enforcement: `packages/sdk/src/security/policy-engine.ts`
- audit-sensitive changes should keep backward-compatible event semantics where practical

## Build/test commands

```bash
pnpm typecheck
pnpm test
pnpm build
```

Focused checks:

```bash
pnpm --filter @fiber-pay/sdk test
pnpm --filter @fiber-pay/agent typecheck
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

## Practical gotchas

1. ESM imports require `.js` extension in source imports
2. Amounts are hex-encoded shannons at RPC boundary
3. key file formats are strict (`fiber/sk` raw bytes, `ckb/key` hex string)
4. Apple Silicon may use x86_64 binary fallback via Rosetta depending on release artifacts
5. in async lifecycle code, re-check runtime state after awaits before acting

## Deferred scope note

Priority decision:

- MCP runtime support is deferred indefinitely.
- Skill-facing usability/documentation has higher priority than MCP expansion.

As agreed, `@fiber-pay/agent` refactor scope should avoid new MCP runtime commitments unless this decision is explicitly revisited.
