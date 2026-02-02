# AGENT.md - AI Maintainer Guide

This document helps AI agents understand and maintain the fiber-pay codebase.

## Project Purpose

fiber-pay is a TypeScript SDK that enables AI agents to autonomously manage Lightning Network payments on the CKB (Nervos) blockchain. It wraps the Fiber Network Node (`fnn`) binary.

## Quick Context

- **Language**: TypeScript (ES2022, ESM modules)
- **Runtime**: Node.js 18+
- **Package Manager**: pnpm
- **Build Tool**: tsup
- **Test Framework**: vitest
- **Validation**: zod v4

## Directory Structure

```
src/
├── agent/              # AI-facing interface (START HERE for agent features)
│   ├── fiber-pay.ts    # Main FiberPay class - the primary API
│   ├── mcp-tools.ts    # MCP tool definitions for Claude/OpenClaw
│   └── index.ts
├── binary/             # Binary download management
│   ├── manager.ts      # BinaryManager - downloads fnn from GitHub
│   └── index.ts
├── process/            # Process lifecycle
│   ├── manager.ts      # ProcessManager - starts/stops fnn binary
│   ├── yaml.ts         # Config file generator
│   └── index.ts
├── rpc/                # JSON-RPC client
│   ├── client.ts       # FiberRpcClient - all RPC methods
│   └── index.ts
├── security/           # Security components
│   ├── policy-engine.ts # Spending limits, rate limiting
│   ├── key-manager.ts   # Key generation (fiber node handles encryption)
│   └── index.ts
├── types/              # Type definitions
│   ├── rpc.ts          # All RPC request/response types
│   ├── policy.ts       # Policy schemas (zod)
│   └── index.ts
├── cli.ts              # Command-line interface
└── index.ts            # Public exports
```

## Key Files to Understand

### 1. `src/agent/fiber-pay.ts` - Main Interface
The `FiberPay` class is the primary API. All methods return `AgentResult<T>`:

```typescript
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;  // Hints for AI
}
```

**Key methods**: `initialize()`, `pay()`, `createInvoice()`, `getBalance()`, `listChannels()`

### 2. `src/rpc/client.ts` - RPC Client
Type-safe JSON-RPC client for all Fiber Network API methods. Uses hex encoding for amounts (shannons).

**Important**: 1 CKB = 100,000,000 shannons (10^8)

### 3. `src/security/policy-engine.ts` - Security Sandbox
Enforces spending limits outside LLM control. Cannot be bypassed via prompts.

### 4. `src/binary/manager.ts` - Binary Download
Auto-downloads `fnn` binary from GitHub releases. Handles platform detection and Rosetta 2 fallback.

### 5. `src/types/rpc.ts` - Type Definitions
All JSON-RPC types. Reference when adding new RPC methods.

## Common Tasks

### Adding a New RPC Method

1. Add types to `src/types/rpc.ts`:
```typescript
export interface NewMethodParams { ... }
export interface NewMethodResult { ... }
```

2. Add method to `src/rpc/client.ts`:
```typescript
async newMethod(params: NewMethodParams): Promise<NewMethodResult> {
  return this.call('new_method', params);
}
```

3. Add wrapper to `src/agent/fiber-pay.ts`:
```typescript
async newMethod(params): Promise<AgentResult<T>> {
  // Add policy check if needed
  // Call RPC
  // Return AgentResult
}
```

4. Add MCP tool to `src/agent/mcp-tools.ts` if agent-facing.

### Adding a CLI Command

Edit `src/cli.ts`:

1. **For read-only commands** (info, balance, etc.):
   - Add to `handleRpcCommand()` function
   - Add command name to `rpcOnlyCommands` array in `main()`
   - These commands connect to a running node via RPC

2. **For write operations** (pay, invoice, etc.):
   - Add to `handleCommand()` function  
   - Add command name to `needsInit` array in `main()`
   - These commands auto-start the node, execute, then stop

3. **For standalone commands** (download, binary-info, etc.):
   - Add to `handleStandaloneCommand()` function
   - Add command name to `standaloneCommands` array in `main()`
   - These don't need a running node

4. Update `printHelp()` with the new command

### Modifying Security Policy

Edit `src/types/policy.ts` for schema changes.
Edit `src/security/policy-engine.ts` for enforcement logic.

## Testing

```bash
pnpm test        # Watch mode
pnpm test:run    # Single run
```

Tests are in `tests/` directory. Current tests:
- `policy-engine.test.ts` - Policy enforcement
- `rpc-utils.test.ts` - Utility functions

## Building

```bash
pnpm build       # Build to dist/
pnpm typecheck   # Type check only
```

Output:
- `dist/index.js` - Library entry
- `dist/cli.js` - CLI entry (has shebang)
- `dist/*.d.ts` - Type declarations

## Important Patterns

### Hex Encoding for Amounts
All amounts in RPC use hex-encoded shannons:
```typescript
import { ckbToShannons, toHex } from './rpc/index.js';
const hexAmount = toHex(ckbToShannons(10)); // "0x3b9aca00"
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

## Roadmap Items (Not Yet Implemented)

- MCP server (actual server, not just tool definitions)
- HD wallet / BIP39 mnemonics
- UDT (User Defined Token) support
- Cross-chain via CCH
- Multi-sig

## Useful Commands

```bash
# Start node (runs in foreground)
./dist/cli.js start

# In another terminal:
./dist/cli.js status      # Check if running
./dist/cli.js info        # Node info
./dist/cli.js balance     # Balance
./dist/cli.js channels    # List channels

# Stop node
./dist/cli.js stop

# Binary management
./dist/cli.js download
./dist/cli.js binary-info

# Test fnn directly
~/.fiber-pay/bin/fnn --version

# View all exports
grep "^export" src/index.ts
```

## Code Quality Checklist

Before committing changes:
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:run` passes
- [ ] `pnpm build` succeeds
- [ ] New methods have proper TypeScript types
- [ ] New agent methods return `AgentResult<T>`
- [ ] Security-sensitive operations have policy checks
- [ ] CLI help is updated if adding commands
