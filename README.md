# fiber-pay

AI Agent Payment SDK for CKB Lightning Network (Fiber Network)

**Give AI agents the ability to own and manage money autonomously—no bank account required.**

## Overview

fiber-pay is a TypeScript SDK that wraps the [Fiber Network Node](https://github.com/nervosnetwork/fiber) binary, enabling AI agents to:

- **Own funds**: Generate and control private keys autonomously
- **Send payments**: Pay invoices or send directly to other nodes
- **Receive payments**: Create invoices and track incoming payments  
- **Manage channels**: Open and close Lightning channels
- **Stay secure**: Built-in spending limits, rate limiting, and audit logging

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FiberPay (Agent Interface)              │    │
│  │   • pay() / createInvoice() / getBalance()          │    │
│  │   • Returns AgentResult<T> format for LLM parsing   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌──────────────────┐  ┌──────────────────────────────┐    │
│  │  PolicyEngine    │  │      KeyManager              │    │
│  │  • Spending caps │  │  • Key generation            │    │
│  │  • Rate limits   │  │  • AES-256-GCM encryption    │    │
│  │  • Audit logs    │  │  • Secure storage            │    │
│  └──────────────────┘  └──────────────────────────────┘    │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FiberRpcClient                          │    │
│  │   • Type-safe JSON-RPC calls to fnn node            │    │
│  │   • All Fiber Network API methods                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              ProcessManager                          │    │
│  │   • Starts/stops the fnn binary                     │    │
│  │   • Generates YAML config                           │    │
│  │   • Health monitoring                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              BinaryManager                           │    │
│  │   • Auto-downloads fnn from GitHub releases         │    │
│  │   • Platform detection (macOS/Linux/Windows)        │    │
│  │   • Rosetta 2 fallback for Apple Silicon            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         ↓
              ┌──────────────────┐
              │   fnn binary     │
              │  (Fiber Node)    │
              │  JSON-RPC :8227  │
              │  P2P      :8228  │
              └──────────────────┘
                         ↓
              ┌──────────────────┐
              │  CKB Blockchain  │
              │    (Nervos)      │
              └──────────────────┘
```

## Installation

```bash
# Install the SDK
pnpm add fiber-pay

# Or with npm
npm install fiber-pay
```

### Binary Installation

The Fiber Network Node binary is **automatically downloaded** when needed. You can also manually download it:

```bash
# Using the CLI
npx fiber-pay download

# Download specific version
npx fiber-pay download --version v0.6.0

# Check binary status
npx fiber-pay binary-info
```

Or programmatically:

```typescript
import { downloadFiberBinary, ensureFiberBinary } from 'fiber-pay';

// Download explicitly
await downloadFiberBinary({
  version: 'latest',  // or 'v0.6.0'
  onProgress: (p) => console.log(p.message),
});

// Or let it auto-download when needed
const binaryPath = await ensureFiberBinary();
```

The binary will be installed to `~/.fiber-pay/bin/fnn` by default.

**Supported platforms:**
- macOS x64 and ARM64 (Apple Silicon via Rosetta 2)
- Linux x64
- Windows x64

## Quick Start

```typescript
import { createFiberPay } from 'fiber-pay';

// Create instance (binary auto-downloads if not found)
const fiber = createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
});

// Initialize (starts the node, generates keys if needed)
await fiber.initialize();

// Check balance
const balance = await fiber.getBalance();
console.log(`Available: ${balance.data?.availableCkb} CKB`);

// Pay an invoice
const payment = await fiber.pay({
  invoice: 'fibt1qp...',
});

// Create invoice to receive payment
const invoice = await fiber.createInvoice({
  amountCkb: 10,
  description: 'Payment for AI services',
});
console.log(`Share this invoice: ${invoice.data?.invoice}`);

// Shutdown when done
await fiber.shutdown();
```

## CLI Usage

```bash
# Download binary (auto-detects platform)
fiber-pay download

# Initialize and start node
fiber-pay init

# Check balance
fiber-pay balance

# Pay an invoice
fiber-pay pay fibt1qp...

# Create invoice for 10 CKB
fiber-pay invoice 10 --description "For services"

# List channels
fiber-pay channels

# Open a channel
fiber-pay open-channel --peer /ip4/x.x.x.x/tcp/8228/p2p/QmXXX --funding 100

# View audit log
fiber-pay audit --limit 20

# Get help
fiber-pay help
```

## MCP Integration

fiber-pay provides MCP (Model Context Protocol) tool definitions for direct integration with Claude, OpenClaw, and other compatible agents:

```typescript
import { MCP_TOOLS } from 'fiber-pay';

// Register tools with your MCP server
for (const tool of Object.values(MCP_TOOLS)) {
  mcpServer.registerTool(tool);
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `fiber_pay` | Pay invoice or send directly |
| `fiber_create_invoice` | Create invoice to receive payment |
| `fiber_get_balance` | Get current balance |
| `fiber_get_payment_status` | Check payment status |
| `fiber_get_invoice_status` | Check invoice status |
| `fiber_list_channels` | List all channels |
| `fiber_open_channel` | Open new channel |
| `fiber_close_channel` | Close channel |
| `fiber_get_node_info` | Get node information |
| `fiber_get_spending_allowance` | Get remaining spending allowance |
| `fiber_download_binary` | Download fnn binary |

## Security

### AI-Agent Friendly Response Format

All methods return `AgentResult<T>` - a structured format optimized for LLM parsing:

```typescript
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;  // Hints for the AI on what to do next
}
```

### Spending Limits (PolicyEngine)

The SDK enforces spending limits that **cannot be bypassed via prompts**:

```typescript
const fiber = createFiberPay({
  policy: {
    maxPerTransaction: 100,      // Max 100 CKB per payment
    maxPerWindow: 1000,          // Max 1000 CKB per hour
    windowDurationMs: 3600000,   // 1 hour window
    allowedRecipients: [...],    // Optional whitelist
    blockedRecipients: [...],    // Optional blacklist
  }
});
```

### Key Management

- Keys are encrypted at rest using **scrypt + AES-256-GCM**
- Set password via `FIBER_KEY_PASSWORD` environment variable
- Keys are **never exposed** to LLM context
- Auto-generation on first run (configurable)

### Audit Logging

All operations are logged for accountability:

```typescript
const log = fiber.getAuditLog({ limit: 100 });
// Returns: timestamp, action, success, details, policy violations
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FIBER_BINARY_PATH` | Path to fnn binary | Auto-downloads to `~/.fiber-pay/bin/fnn` |
| `FIBER_DATA_DIR` | Data directory | `~/.fiber-pay` |
| `FIBER_NETWORK` | Network (testnet/mainnet) | `testnet` |
| `FIBER_KEY_PASSWORD` | Key encryption password | - |
| `FIBER_RPC_URL` | CKB RPC URL | `https://testnet.ckbapp.dev/` |

### Programmatic Configuration

```typescript
const fiber = createFiberPay({
  binaryPath: '/path/to/fnn',     // Optional - auto-downloads if not set
  dataDir: '/path/to/data',
  network: 'testnet',
  ckbRpcUrl: 'https://testnet.ckbapp.dev/',
  rpcPort: 8227,
  p2pPort: 8228,
  keyPassword: process.env.KEY_PASSWORD,
  bootnodes: ['/ip4/54.179.226.154/tcp/8228/p2p/Qmes...'],
  autoStart: true,
  policy: { /* ... */ },
});
```

## API Reference

### FiberPay Class

#### Lifecycle
- `initialize()` - Start node and connect (auto-downloads binary if needed)
- `shutdown()` - Stop node gracefully

#### Payments
- `pay({ invoice?, recipientNodeId?, amountCkb?, maxFeeCkb? })` - Send payment
- `createInvoice({ amountCkb, description?, expiryMinutes? })` - Create invoice
- `getPaymentStatus(paymentHash)` - Check payment status
- `getInvoiceStatus(paymentHash)` - Check invoice status

#### Balance & Info
- `getBalance()` - Get balance information
- `getNodeInfo()` - Get node information
- `getSpendingAllowance()` - Get remaining spending limits

#### Channels
- `listChannels()` - List all channels
- `openChannel({ peer, fundingCkb, isPublic? })` - Open channel
- `closeChannel({ channelId, force? })` - Close channel

#### Audit
- `getAuditLog({ limit?, since? })` - Get audit log entries

## Project Structure

```
fiber-pay/
├── src/
│   ├── agent/           # AI-friendly interface
│   │   ├── fiber-pay.ts # Main FiberPay class
│   │   └── mcp-tools.ts # MCP tool definitions
│   ├── binary/          # Binary download manager
│   │   └── manager.ts   # BinaryManager class
│   ├── process/         # fnn process lifecycle
│   │   ├── manager.ts   # ProcessManager class
│   │   └── yaml.ts      # Config file generation
│   ├── rpc/             # JSON-RPC client
│   │   └── client.ts    # FiberRpcClient class
│   ├── security/        # Security components
│   │   ├── policy-engine.ts  # Spending limits
│   │   └── key-manager.ts    # Key encryption
│   ├── types/           # TypeScript type definitions
│   │   ├── rpc.ts       # RPC types
│   │   └── policy.ts    # Policy schemas
│   ├── cli.ts           # Command-line interface
│   └── index.ts         # Public exports
├── tests/               # Unit tests
├── dist/                # Built output
└── package.json
```

## Project Roadmap

### Phase 1: Base Tool ✅ (Current)
- ✅ Process management for fnn binary
- ✅ Auto binary download for all platforms
- ✅ Type-safe RPC client
- ✅ AI-friendly interface with AgentResult
- ✅ Security policy engine
- ✅ Key management with encryption
- ✅ CLI tool
- ✅ MCP tool definitions

### Phase 2: Agent Skills
- [ ] MCP server implementation
- [ ] Claude Desktop integration
- [ ] OpenClaw skill package
- [ ] Multi-agent coordination
- [ ] Payment request/approval workflows

### Phase 3: Advanced Features
- [ ] HD wallet support
- [ ] Multi-currency (UDT) support
- [ ] Cross-chain payments (BTC via CCH)
- [ ] Payment streaming
- [ ] Recurring payments
- [ ] Escrow contracts

### Phase 4: Production Hardening
- [ ] Mainnet support
- [ ] Hardware security module integration
- [ ] Distributed key management
- [ ] Anomaly detection
- [ ] Multi-sig requirements for large payments

## Contributing

Contributions welcome! Please read our contributing guidelines first.

## License

MIT

## Acknowledgments

- [Nervos Network](https://www.nervos.org/) for CKB and Fiber Network
- [Fiber Network](https://github.com/nervosnetwork/fiber) team for the node implementation
