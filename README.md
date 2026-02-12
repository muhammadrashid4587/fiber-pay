# fiber-pay

AI payment layer for CKB Lightning (Fiber Network), anchored to Fiber `v0.6.1`.

## Project intent

fiber-pay is built as an **AI payment layer** first.

`@fiber-pay/sdk`, `@fiber-pay/node`, and `@fiber-pay/cli` are exposed as foundational layers so this payment layer is practical to build, run, and debug.

In short:

- Product center: AI-facing payment orchestration
- Support layers: SDK + Node + CLI
- Protocol anchor: Fiber `v0.6.1`

## Current status

`@fiber-pay/agent` is functional, but **not fully aligned** with its target role yet (orchestration runtime with stronger flow/state/governance boundaries). A focused refactor is planned after docs alignment.

## Package roles

| Package | Role |
|---|---|
| `@fiber-pay/sdk` | Protocol/domain primitives (RPC client, types, verification, policy/lifecycle helpers) |
| `@fiber-pay/node` | Binary + process lifecycle substrate for local `fnn` runtime |
| `@fiber-pay/cli` | Operator surface for lifecycle/status workflows |
| `@fiber-pay/agent` | LLM-facing orchestration surface and MCP tool schemas |

## Quick start (operator path)

Prerequisites:

- Node.js `>=20`
- `pnpm`

```bash
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

```bash
# Bootstrap runtime
fiber-pay binary download
fiber-pay node start
fiber-pay node status

# Basic workflows
fiber-pay balance
fiber-pay channel list
fiber-pay invoice create --amount 10 --description "service"
fiber-pay payment send <invoice>
```

Use `--json` for machine parsing.

## Quick start (agent API path)

```ts
import { createFiberPay } from '@fiber-pay/agent';

const fiber = createFiberPay({
  dataDir: `${process.env.HOME}/.fiber-pay`,
  network: 'testnet',
});

const init = await fiber.initialize();
if (!init.success) throw new Error(init.error?.message ?? 'init failed');

const balance = await fiber.getBalance();
console.log(balance.data);

await fiber.shutdown();
```

## CLI source of truth

CLI runtime behavior, command surface, and output conventions are maintained in:

- `packages/cli/llm.txt`

Design policy:

- grouped commands only (`node/channel/invoice/payment/peer/binary/balance`)
- human-readable output by default
- `--json` for automation and downstream parsing

## MCP note

`@fiber-pay/agent/mcp` exports MCP tool definitions (schemas and types).

Host-side MCP runtime execution wiring is still required in your integration layer.

## Documentation map

- Project intent baseline: `docs/plans/ai-payment-layer-intent.md`
- Docs rewrite plan: `docs/plans/docs-rewrite.md`
- Agent package doc: `packages/agent/README.md`
- CLI canonical guide: `packages/cli/llm.txt`
- Maintainer guide: `AGENT.md`

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

Useful package-scoped checks:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
pnpm --filter @fiber-pay/sdk test
```

## Roadmap direction

Near-term focus:

1. finish docs alignment to intent baseline
2. refactor `@fiber-pay/agent` to target runtime role
3. refresh `skills/fiber-pay/*` after architecture/docs settle
