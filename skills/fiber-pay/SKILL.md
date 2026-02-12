---
name: fiber-pay
description: Manage CKB Lightning Network payments autonomously. Send and receive cryptocurrency payments, create invoices, manage payment channels, and track transactions on the Nervos (CKB) blockchain using the Fiber Network. Use when user needs autonomous financial transactions, Lightning Network operations, peer-to-peer payments, or cryptocurrency payment processing.
license: MIT
compatibility: Requires Node.js >= 18, pnpm package manager, network access to CKB blockchain, git
metadata:
  author: nervos-community
  version: "0.1.0"
  category: payments
  blockchain: ckb
  network: lightning
  repository: https://github.com/nervosnetwork/fiber-pay
allowed-tools: Bash(*) Read Write
---

# fiber-pay: CKB Lightning Network Payments for AI Agents

Give AI agents the ability to own and manage money autonomously on the CKB Lightning Network (Fiber Network)—no bank account required.

## What is fiber-pay?

fiber-pay is a TypeScript SDK and CLI tool that wraps the Fiber Network Node binary, enabling AI agents to:

- **Own funds**: Generate and control cryptocurrency private keys
- **Send payments**: Pay Lightning invoices or send directly to other nodes
- **Receive payments**: Create invoices and track incoming payments
- **Hold invoices**: Create escrow-style invoices that settle only when you release the preimage
- **Watch payments**: Poll for payment completion, channel readiness, or invoice status changes
- **Manage channels**: Open and close Lightning payment channels
- **Stay secure**: Built-in spending limits, rate limiting, and audit logging

The Lightning Network enables instant, low-cost cryptocurrency payments by keeping transactions off-chain until settlement.

## When to Use This Skill

Use fiber-pay when the user needs to:
- Send or receive cryptocurrency payments
- Create payment invoices (standard or hold/escrow invoices)
- Check account balances
- Manage Lightning Network payment channels
- Wait for payment completion or channel readiness
- Perform autonomous financial transactions
- Process peer-to-peer payments without intermediaries

## Setup

### Prerequisites

- Node.js >= 18
- pnpm package manager (install with: `npm install -g pnpm`)
- git

### Installation

Since fiber-pay is not yet published to npm, you need to install from source:

```bash
# Clone the repository
git clone https://github.com/nervosnetwork/fiber-pay.git
cd fiber-pay

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Link the CLI globally
cd packages/cli && pnpm link --global
```

**TODO**: Once published to npm, installation will be: `npm install -g @fiber-pay/cli`

After installation, verify the CLI is available:
```bash
fiber-pay --help
```

### Binary Installation

fiber-pay requires the Fiber Network Node (`fnn`) binary. Download it:

```bash
fiber-pay download
```

This downloads the appropriate binary for your platform (macOS/Linux/Windows) from GitHub releases.

### Initialize Node

Start the Fiber node in the background:

```bash
fiber-pay start
```

The node will:
- Generate a private key (if not exists)
- Connect to the CKB testnet by default
- Start listening for P2P connections
- Expose JSON-RPC API on http://127.0.0.1:8227

Check node status:
```bash
fiber-pay status
```

To stop the node:
```bash
fiber-pay stop
```

## Core Operations

### 1. Check Balance

Get current balance and channel information:

```bash
fiber-pay balance
```

**Output format**:
```json
{
  "success": true,
  "data": {
    "totalCkb": 100.5,
    "availableToSendCkb": 80.2,
    "availableToReceiveCkb": 50.0,
    "channelCount": 2,
    "remainingAllowanceCkb": 95.0
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

**Key fields**:
- `totalCkb`: Total balance across all channels
- `availableToSendCkb`: Amount you can send
- `availableToReceiveCkb`: Amount you can receive
- `remainingAllowanceCkb`: Remaining spending limit (security policy)

### 2. Send Payment

#### Pay an invoice:
```bash
fiber-pay pay <invoice-string>
```

Example:
```bash
fiber-pay pay fibt1qq2d77zqpvle5n2uqkgzlgw...
```

#### Send directly (keysend):
```bash
fiber-pay pay --to <node-id> --amount <ckb-amount>
```

Example:
```bash
fiber-pay pay --to QmXXXYYYZZZ... --amount 10
```

**Output format**:
```json
{
  "success": true,
  "data": {
    "paymentHash": "0xabcd1234...",
    "status": "succeeded",
    "amountCkb": 10.0,
    "feeCkb": 0.001,
    "timeTakenMs": 250
  },
  "metadata": {
    "timestamp": 1738627200000,
    "policyCheck": {
      "allowed": true,
      "violations": [],
      "requiresConfirmation": false
    }
  }
}
```

**Error handling**:
If payment fails, the output includes recovery suggestions:
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance to send 100 CKB",
    "recoverable": true,
    "suggestion": "Open a channel or receive payment to increase balance"
  }
}
```

### 3. Receive Payment

Create an invoice for someone to pay you:

```bash
fiber-pay invoice create --amount <ckb-amount> --description "<text>"
```

Example:
```bash
fiber-pay invoice create --amount 10 --description "Payment for coffee"
```

**Output format**:
```json
{
  "success": true,
  "data": {
    "invoice": "fibt1qq2d77zqpvle5n2uqkgzlgw...",
    "paymentHash": "0x1234abcd...",
    "amountCkb": 10.0,
    "expiresAt": 1738630800000,
    "description": "Payment for coffee"
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

Share the `invoice` string with the payer. They can pay it using:
```bash
fiber-pay pay <invoice-string>
```

#### Check invoice status:
```bash
fiber-pay invoice status <payment-hash>
```

### 4. Manage Channels

Lightning payments require payment channels between nodes.

#### List channels:
```bash
fiber-pay channels list
```

**Output format**:
```json
{
  "success": true,
  "data": [
    {
      "channelId": "0xabc123...",
      "peerId": "QmXXX...",
      "state": "CHANNEL_READY",
      "localBalanceCkb": 80.5,
      "remoteBalanceCkb": 19.5,
      "capacityCkb": 100.0
    }
  ]
}
```

**Channel states**:
- `NEGOTIATING_FUNDING`: Channel opening in progress
- `CHANNEL_READY`: Ready to send/receive payments
- `SHUTDOWN_INITIATED`: Channel closing

#### Open a channel:
```bash
fiber-pay channels open --peer <peer-multiaddr> --funding <ckb-amount>
```

Example:
```bash
fiber-pay channels open \
  --peer /ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo24vH... \
  --funding 200
```

**Note**: Opening a channel requires on-chain CKB funds. The transaction must be confirmed on the CKB blockchain (takes a few minutes).

#### Close a channel:
```bash
fiber-pay channels close <channel-id>
```

Example:
```bash
fiber-pay channels close 0xabc123...
```

Use `--force` flag only if the peer is unresponsive (unilateral close):
```bash
fiber-pay channels close 0xabc123... --force
```

### 5. Node Information

Get node ID and connection info:

```bash
fiber-pay node info
```

**Output format**:
```json
{
  "success": true,
  "data": {
    "nodeId": "QmXXX...",
    "multiaddr": "/ip4/127.0.0.1/tcp/8228/p2p/QmXXX...",
    "publicKey": "0x02abcd...",
    "version": "0.4.0",
    "channelCount": 2,
    "peersCount": 1
  }
}
```

Share your `multiaddr` with others so they can open channels to your node.

## Security Policies

fiber-pay includes a built-in security policy engine to protect against unauthorized spending. These policies **cannot be bypassed via prompts**.

### Default Security Limits

- **Per-transaction limit**: 100 CKB
- **Per-hour limit**: 1,000 CKB
- **Rate limit**: 10 transactions per minute

### Check Remaining Allowance

```bash
fiber-pay policy allowance
```

### Configure Custom Policies

See [references/SECURITY.md](references/SECURITY.md) for detailed policy configuration.

## Understanding the Output Format

All CLI commands return JSON in the `AgentResult<T>` format, optimized for AI agent parsing:

```typescript
{
  success: boolean,           // true if operation succeeded
  data?: T,                   // Result data (if success)
  error?: {                   // Error details (if !success)
    code: string,             // Error code (e.g., "INSUFFICIENT_BALANCE")
    message: string,          // Human-readable message
    recoverable: boolean,     // Can this be fixed?
    suggestion?: string       // How to fix it
  },
  metadata?: {
    timestamp: number,        // Unix timestamp
    policyCheck?: {           // Security policy check result
      allowed: boolean,
      violations: [],
      requiresConfirmation: boolean
    }
  }
}
```

## Common Workflows

### Workflow 1: First-Time Setup
```bash
# 1. Download binary
fiber-pay download

# 2. Start node
fiber-pay start

# 3. Check node info
fiber-pay node info

# 4. Check balance (will be 0 initially)
fiber-pay balance
```

### Workflow 2: Receive Payment
```bash
# 1. Create invoice
fiber-pay invoice create --amount 10 --description "For services"

# 2. Share invoice string with payer

# 3. Check invoice status
fiber-pay invoice status <payment-hash>
```

### Workflow 3: Send Payment
```bash
# 1. Check balance first
fiber-pay balance

# 2. Pay the invoice
fiber-pay pay <invoice-string>

# 3. Verify payment succeeded (check output JSON)
```

### Workflow 4: Open Channel and Send
```bash
# 1. Open channel to a peer
fiber-pay channels open --peer <peer-multiaddr> --funding 200

# 2. Wait for channel to reach CHANNEL_READY state
fiber-pay channels list

# 3. Send payment
fiber-pay pay --to <node-id> --amount 10
```

### Workflow 5: Hold Invoice (Escrow)
```typescript
// 1. Seller creates hold invoice (preimage stays secret until goods delivered)
const hold = await fiber.createHoldInvoice({
  amountCkb: 10,
  description: 'Escrow for delivery',
});
// 2. Share hold.invoice with buyer — buyer pays it
// 3. Invoice enters 'accepted' state (funds locked, not yet settled)
const accepted = await fiber.waitForPayment(hold.paymentHash, { timeout: 120000 });
// 4. Seller delivers goods, then settles the invoice
const settled = await fiber.settleInvoice(hold.paymentHash, hold.preimage);
```

### Workflow 6: Wait for Payment Confirmation
```typescript
// After sending a payment, wait until it completes
const result = await fiber.pay({ invoice: 'fibt1...' });
if (result.success) {
  const confirmed = await fiber.waitForPayment(result.data.paymentHash, { timeout: 60000 });
}
```

## Environment Variables

Configure fiber-pay behavior with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `FIBER_DATA_DIR` | Data directory for keys and database | `~/.fiber-pay` |
| `FIBER_NETWORK` | Network to use (`testnet` or `mainnet`) | `testnet` |
| `FIBER_RPC_URL` | RPC endpoint URL | `http://127.0.0.1:8227` |
| `FIBER_BINARY_PATH` | Custom path to fnn binary | (auto-download) |
| `FIBER_KEY_PASSWORD` | Password for key encryption | (interactive) |

Example:
```bash
export FIBER_NETWORK=mainnet
export FIBER_DATA_DIR=/custom/path
fiber-pay start
```

## Testnet Resources

For testing on CKB testnet:

1. **Faucet**: Get free testnet CKB at https://faucet.nervos.org/
2. **Bootnode peer**: Connect to the testnet bootnode to open your first channel:
   ```
   /ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo24vH5WfAGQCvGnSDKP4H3cpF8jQNSYxJAv
   ```
3. **Explorer**: View transactions at https://pudge.explorer.nervos.org/

## Error Handling

All errors include:
- `error.code`: Machine-readable error code
- `error.message`: Human-readable description
- `error.recoverable`: Whether the error can be fixed
- `error.suggestion`: Recommended action to resolve

Common error codes:
- `INSUFFICIENT_BALANCE`: Not enough funds to send
- `POLICY_VIOLATION`: Security policy blocked transaction
- `CHANNEL_NOT_FOUND`: Invalid channel ID
- `NODE_NOT_RUNNING`: Fiber node not started
- `PEER_UNREACHABLE`: Cannot connect to peer
- `INVOICE_EXPIRED`: Payment invoice expired

See [references/TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) for detailed error solutions.

## Advanced Usage

### Programmatic API

Use fiber-pay as a TypeScript library instead of CLI:

```typescript
import { createFiberPay } from '@fiber-pay/agent';

const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
  // Custom security policy
  policy: {
    enabled: true,
    spending: {
      maxPerTransaction: '0x174876e800', // 100 CKB in hex
      maxPerWindow: '0xe8d4a51000',     // 1000 CKB in hex
      windowMs: 3600000,                // 1 hour
    },
  },
});

// Send payment
const result = await fiber.pay({
  invoice: 'fibt1qq2d77zqpvle5n2uqkgzlgw...',
});

if (result.success) {
  console.log('Payment hash:', result.data.paymentHash);
} else {
  console.error('Payment failed:', result.error.message);
  console.log('Suggestion:', result.error.suggestion);
}
```

### Full API Reference

See [references/API.md](references/API.md) for complete API documentation including:
- All 15 MCP tools with schemas (including hold invoice, settle, wait-for-payment, wait-for-channel)
- Input/output types
- Code examples
- RPC client methods (including polling helpers and router APIs)

### Security Configuration

See [references/SECURITY.md](references/SECURITY.md) for:
- Policy engine architecture
- Spending limit configuration
- Rate limiting
- Audit logging
- Key management

## Additional Resources

- **References**:
  - [API.md](references/API.md) - Complete API reference
  - [SECURITY.md](references/SECURITY.md) - Security policy details
  - [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) - Error solutions

- **Assets**:
  - [policy-example.json](assets/policy-example.json) - Sample security policy
  - [config-example.yml](assets/config-example.yml) - Node configuration template

- **External**:
  - Fiber Network: https://github.com/nervosnetwork/fiber
  - CKB Blockchain: https://nervos.org
  - Lightning Network: https://lightning.network

## Tips for AI Agents

1. **Always check balance first** before attempting payments
2. **Parse the `success` field** to determine if operation succeeded
3. **Read `error.suggestion`** for recovery steps on failure
4. **Monitor `remainingAllowanceCkb`** to avoid policy violations
5. **Use `waitForChannelReady()`** instead of polling `channels list` manually
6. **Use `waitForPayment()`** to confirm payment completion instead of manual polling
7. **Use hold invoices** for escrow/conditional payment flows
8. **Use testnet for development** to avoid risking real funds
9. **Check `policyCheck.violations`** to understand spending limits

## Troubleshooting Quick Ref

| Issue | Solution |
|-------|----------|
| `NODE_NOT_RUNNING` | Run `fiber-pay start` |
| `INSUFFICIENT_BALANCE` | Open channel or receive payment |
| `POLICY_VIOLATION` | Check `fiber-pay policy allowance` |
| Binary download fails | Check network connection, run `fiber-pay download --force` |
| Channel stuck opening | Wait for CKB blockchain confirmation (~30 seconds) |
| Payment timeout | Check peer connectivity, channel state |

For detailed troubleshooting, see [references/TROUBLESHOOTING.md](references/TROUBLESHOOTING.md).
