# AGENT.md - AI Maintainer Guide

This document helps AI agents understand and maintain the fiber-pay codebase.

## Project Purpose

fiber-pay is a TypeScript SDK that enables AI agents to autonomously manage Lightning Network payments on the CKB (Nervos) blockchain. It wraps the Fiber Network Node (`fnn`) binary.

## Quick Context

- **Language**: TypeScript (ES2022, ESM modules)
- **Runtime**: Node.js 20+
- **Package Manager**: pnpm (workspaces monorepo)
- **Build Tool**: tsup (per-package)
- **Test Framework**: vitest
- **Validation**: zod v4

## Directory Structure

fiber-pay is a monorepo with four packages under `packages/`:

```
packages/
├── sdk/                    # @fiber-pay/sdk — Core SDK
│   ├── src/
│   │   ├── rpc/
│   │   │   └── client.ts   # FiberRpcClient — type-safe JSON-RPC
│   │   ├── types/
│   │   │   ├── rpc.ts      # All RPC request/response types
│   │   │   ├── policy.ts   # Policy schemas (zod)
│   │   │   └── index.ts
│   │   ├── security/
│   │   │   ├── policy-engine.ts  # Spending limits, rate limiting
│   │   │   └── key-manager.ts    # Key generation
│   │   ├── verification/
│   │   │   ├── invoice-verifier.ts  # Cryptographic invoice validation
│   │   │   └── payment-proof.ts     # Payment proof tracking & audit
│   │   ├── funds/
│   │   │   └── liquidity-analyzer.ts # Channel health & rebalancing
│   │   ├── proxy/
│   │   │   └── cors-proxy.ts
│   │   ├── utils.ts        # Hex/shannon conversion helpers
│   │   ├── address.ts      # Bech32m address encoding
│   │   └── index.ts        # Public exports
│   └── tests/              # Unit tests
│       ├── policy-engine.test.ts
│       ├── rpc-utils.test.ts
│       └── invoice-verifier.test.ts
├── node/                   # @fiber-pay/node — Node management
│   └── src/
│       ├── binary/
│       │   └── manager.ts  # BinaryManager — downloads fnn from GitHub
│       ├── process/
│       │   ├── manager.ts  # ProcessManager — starts/stops fnn binary
│       │   └── yaml.ts     # Config file generator
│       └── index.ts
├── agent/                  # @fiber-pay/agent — AI agent interface
│   └── src/
│       ├── fiber-pay.ts    # Main FiberPay class — the primary API
│       ├── mcp-tools.ts    # MCP tool definitions for Claude/OpenClaw
│       └── index.ts
└── cli/                    # @fiber-pay/cli — Command-line tool
  ├── llm.txt             # CLI source-of-truth usage & maintenance guide
  └── src/
    ├── index.ts        # CLI entry point / root command wiring
    ├── commands/       # Command groups (node/channel/invoice/payment/...)
    └── lib/            # Shared CLI helpers (config/rpc/format/pid/bootnode)

skills/
└── fiber-pay/              # Agent Skills integration (agentskills.io)
    ├── SKILL.md
    ├── references/
    │   ├── API.md
    │   ├── SECURITY.md
    │   └── TROUBLESHOOTING.md
    └── assets/
        ├── policy-example.json
        └── config-example.yml
```

### Package Dependencies

```
@fiber-pay/agent  →  @fiber-pay/sdk + @fiber-pay/node
@fiber-pay/cli    →  @fiber-pay/sdk + @fiber-pay/node
@fiber-pay/sdk    →  zod (only external dep)
@fiber-pay/node   →  (no dependencies)
```

## Key Files to Understand

### 1. `packages/agent/src/fiber-pay.ts` - Main Interface
The `FiberPay` class is the primary API. All methods return `AgentResult<T>`:

```typescript
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;  // Hints for AI
}
```

**Key methods**: 
- Payment: `pay()`, `createInvoice()`, `getPaymentStatus()`, `getInvoiceStatus()`
- Balance: `getBalance()`, `canSend()`
- Channels: `listChannels()`, `openChannel()`, `closeChannel()`
- Verification: `validateInvoice()`, `getPaymentProof()`
- Liquidity: `analyzeLiquidity()`, `canSend()`

### 2. `packages/sdk/src/rpc/client.ts` - RPC Client
Type-safe JSON-RPC client for all Fiber Network API methods. Uses hex encoding for amounts (shannons).

**Important**: 1 CKB = 100,000,000 shannons (10^8)

### 3. `packages/sdk/src/security/policy-engine.ts` - Security Sandbox
Enforces spending limits outside LLM control. Cannot be bypassed via prompts.

### 4. `packages/node/src/binary/manager.ts` - Binary Download
Auto-downloads `fnn` binary from GitHub releases. Handles platform detection and Rosetta 2 fallback.

### 5. `packages/sdk/src/types/rpc.ts` - Type Definitions
All JSON-RPC types. Reference when adding new RPC methods.

### 6. `packages/sdk/src/verification/invoice-verifier.ts` - Invoice Validation
Cryptographically validates invoices before payment. Checks format, expiry, amount, preimage, and peer connectivity. Returns detailed verification results with trust scores and recommendations.

### 7. `packages/sdk/src/verification/payment-proof.ts` - Payment Proof Tracking
Records and stores payment proofs for audit trail. Validates preimage hashes, maintains payment history, and exports audit reports. Proofs stored in JSON at `<dataDir>/payment-proofs.json`.

### 8. `packages/sdk/src/funds/liquidity-analyzer.ts` - Liquidity Management
Analyzes channel health, identifies liquidity gaps, generates rebalancing recommendations. Calculates health scores, detects imbalances, and estimates funding needs.

### 9. `packages/cli/llm.txt` - CLI Canonical Guide
Authoritative guide for CLI runtime behavior, command surface, output conventions, troubleshooting flow, and maintenance workflow.

## Common Tasks

### Adding a New RPC Method

1. Add types to `packages/sdk/src/types/rpc.ts`:
```typescript
export interface NewMethodParams { ... }
export interface NewMethodResult { ... }
```

2. Add method to `packages/sdk/src/rpc/client.ts`:
```typescript
async newMethod(params: NewMethodParams): Promise<NewMethodResult> {
  return this.call('new_method', params);
}
```

3. Add wrapper to `packages/agent/src/fiber-pay.ts`:
```typescript
async newMethod(params): Promise<AgentResult<T>> {
  // Add policy check if needed
  // Call RPC
  // Return AgentResult
}
```

4. Add MCP tool to `packages/agent/src/mcp-tools.ts` if agent-facing.

### Adding a CLI Command

Read this file first:

- `packages/cli/llm.txt`

`packages/cli/llm.txt` is the canonical CLI operations guide. It defines:
- runtime behavior (node start, bootnode auto-connect, optional CORS proxy)
- command groups
- output decisions (`human-readable` vs `--json`)
- troubleshooting checklist for agents/operators

CLI command maintenance follows modular architecture:

1. Add or update command logic in `packages/cli/src/commands/<group>.ts`
2. Reuse shared helpers in `packages/cli/src/lib/*`
3. Wire grouped commands in `packages/cli/src/index.ts`
4. Keep output policy consistent:
  - human-readable default
  - `--json` machine output
5. Update `packages/cli/llm.txt` when command behavior, guidance, or command surface changes

Validate:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

### Modifying Security Policy

Edit `packages/sdk/src/types/policy.ts` for schema changes.
Edit `packages/sdk/src/security/policy-engine.ts` for enforcement logic.

## Testing

```bash
pnpm test                          # Run all tests
pnpm --filter @fiber-pay/sdk test  # SDK tests only
```

Tests are in `packages/sdk/tests/`. Current tests:
- `policy-engine.test.ts` - Policy enforcement
- `rpc-utils.test.ts` - Utility functions
- `invoice-verifier.test.ts` - Invoice verification

## Building

```bash
pnpm build       # Build all packages (in dependency order)
pnpm typecheck   # Type check all packages
pnpm clean       # Remove all dist/ folders
```

Build order: sdk + node (parallel) → agent → cli

Each package outputs to its own `dist/` directory.

## Important Patterns

### Hex Encoding for Amounts
All amounts in RPC use hex-encoded shannons:
```typescript
import { ckbToShannons, toHex } from '@fiber-pay/sdk';
const hexAmount = ckbToShannons(10); // "0x3b9aca00"
```

### Error Handling
Always return `AgentResult`:
```typescript
return {
  success: false,
  error: 'What went wrong',
  suggestion: 'What the AI should try next'
};
```

### Policy Checks
Before any spending operation:
```typescript
const check = this.policy.checkTransaction(amountShannons, recipient);
if (!check.allowed) {
  return { success: false, error: check.reason };
}
```

## External Dependencies

### Fiber Network Node (fnn)
- Binary from: https://github.com/nervosnetwork/fiber
- JSON-RPC API on port 8227
- P2P network on port 8228
- Config file: YAML format

### CKB Blockchain
- Testnet RPC: https://testnet.ckbapp.dev/
- Mainnet RPC: https://mainnet.ckbapp.dev/

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `FIBER_BINARY_PATH` | Override fnn binary location |
| `FIBER_DATA_DIR` | Data directory |
| `FIBER_NETWORK` | `testnet` or `mainnet` |
| `FIBER_RPC_URL` | Fiber node RPC URL (default: `http://127.0.0.1:8227`) |
| `FIBER_KEY_PASSWORD` | Key encryption password (passed to fiber node as `FIBER_SECRET_KEY_PASSWORD`) |

## Gotchas & Warnings

1. **zod v4 syntax**: Use `z.record(z.string(), z.unknown())` not `z.record(z.unknown())`

2. **ESM imports**: Always use `.js` extension in imports even for `.ts` files

3. **Key file formats**: The fiber node expects different formats for different keys:
   - `fiber/sk`: raw 32 bytes (binary)
   - `ckb/key`: hex-encoded 32 bytes (64 character string, no 0x prefix)
   
   The KeyManager generates these formats automatically. The fiber node requires `FIBER_SECRET_KEY_PASSWORD` env var and encrypts the keys on first startup.

4. **Async state**: After async operations, re-check state before accessing:
```typescript
// Bad: this.state might have changed
await someAsyncOp();
if (this.state === 'running') { ... }

// Good: cast explicitly if you know it's safe
if ((this.state as ProcessState) === 'running') { ... }
```

5. **Binary names vary**: GitHub release assets use patterns like `fnn_v0.6.1-x86_64-darwin-portable.tar.gz`, not consistent naming

6. **ARM64 macOS**: No native binary yet, uses x86_64 via Rosetta 2

## Testnet Verification

The SDK has been verified on CKB testnet:
- ✅ Binary download (fnn v0.6.1) 
- ✅ Node startup with proper key encryption
- ✅ Channel open with testnet bootnode (200 CKB)
- ✅ Channel ready state with available balance
- ✅ Channel close with funds returned on-chain

Testnet bootnode: `/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy`

## Roadmap Items (Not Yet Implemented)

- MCP server (actual server, not just tool definitions)
- HD wallet / BIP39 mnemonics
- UDT (User Defined Token) support
- Cross-chain via CCH
- Multi-sig

## Agent Skills Integration

The project includes an [Agent Skills](https://agentskills.io) integration in `skills/fiber-pay/`.

### What is Agent Skills?

Agent Skills is an open standard for packaging knowledge and workflows that AI agents can discover and use on demand. It uses **progressive disclosure** for context efficiency.

### Skill Structure

```
skills/fiber-pay/
├── SKILL.md              # Main skill (agents read this first)
├── references/
│   ├── API.md            # Detailed API docs (loaded on demand)
│   ├── SECURITY.md       # Security policy details
│   └── TROUBLESHOOTING.md
└── assets/
    ├── policy-example.json
    └── config-example.yml
```

### Updating the Skill

When making changes to fiber-pay:

1. **New CLI commands**: Update `skills/fiber-pay/SKILL.md` with usage examples
2. **New MCP tools**: Update `skills/fiber-pay/references/API.md` with tool schema
3. **New error codes**: Update `skills/fiber-pay/references/TROUBLESHOOTING.md`
4. **Policy changes**: Update `skills/fiber-pay/references/SECURITY.md`

### Skill Validation Checklist

- [ ] `SKILL.md` has valid YAML frontmatter with `name` and `description`
- [ ] `name` field matches directory name (`fiber-pay`)
- [ ] `description` contains keywords for agent task matching
- [ ] SKILL.md is under ~500 lines (efficient context loading)
- [ ] All CLI examples are accurate and tested

## Local CLI Testing

To test the CLI locally without publishing to npm:

### Method 1: pnpm link (recommended for active development)

```bash
# Build all packages
pnpm build

# Link CLI globally
cd packages/cli && pnpm link --global

# CLI now uses your local build
fiber-pay --help

# Unlink when done
pnpm unlink --global
```

### Method 2: Run directly from dist/

```bash
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js download
node packages/cli/dist/cli.js start
```

## Useful Commands

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @fiber-pay/sdk build

# Start node (after linking CLI globally)
fiber-pay node start

# In another terminal:
fiber-pay node status    # Check if running
fiber-pay node info      # Node info
fiber-pay balance        # Balance
fiber-pay channel list   # List channels

# Stop node
fiber-pay node stop

# Binary management
fiber-pay binary download
fiber-pay binary info

# Test fnn directly
~/.fiber-pay/bin/fnn --version

# View SDK exports
grep "^export" packages/sdk/src/index.ts
```

## Code Quality Checklist

Before committing changes:
- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds
- [ ] New methods have proper TypeScript types
- [ ] New agent methods return `AgentResult<T>`
- [ ] Security-sensitive operations have policy checks
- [ ] CLI help is updated if adding commands
- [ ] Exports are added to the package's `index.ts` if public
