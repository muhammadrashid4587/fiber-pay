# fiber-pay API Reference

Complete API documentation for all fiber-pay operations, including CLI commands, programmatic API, and MCP tool definitions.

## Table of Contents

1. [CLI Commands](#cli-commands)
2. [MCP Tools](#mcp-tools)
3. [TypeScript API](#typescript-api)
4. [AgentResult Format](#agentresult-format)
5. [Data Types](#data-types)

---

## CLI Commands

All CLI commands return JSON output in the `AgentResult<T>` format for easy parsing by AI agents.

### Node Management

#### `fiber-pay download [options]`

Download the Fiber Network Node (fnn) binary.

**Options**:
- `--version <version>` - Specific version (e.g., "v0.4.0")
- `--force` - Force re-download even if exists

**Example**:
```bash
fiber-pay download
fiber-pay download --version v0.4.0
fiber-pay download --force
```

**Output**:
```json
{
  "success": true,
  "data": {
    "path": "/Users/user/.fiber-pay/bin/fnn",
    "version": "0.4.0",
    "platform": "darwin",
    "arch": "arm64"
  }
}
```

#### `fiber-pay start [options]`

Start the Fiber node in the background.

**Options**:
- `--network <testnet|mainnet>` - Network to connect to (default: testnet)
- `--rpc-port <port>` - RPC port (default: 8227)
- `--p2p-port <port>` - P2P port (default: 8228)

**Example**:
```bash
fiber-pay start
fiber-pay start --network testnet
```

**Output**:
```json
{
  "success": true,
  "data": {
    "pid": 12345,
    "rpcUrl": "http://127.0.0.1:8227",
    "p2pAddress": "/ip4/127.0.0.1/tcp/8228"
  }
}
```

#### `fiber-pay stop`

Stop the running Fiber node.

**Example**:
```bash
fiber-pay stop
```

**Output**:
```json
{
  "success": true,
  "data": {
    "message": "Fiber node stopped successfully"
  }
}
```

#### `fiber-pay status`

Check if the Fiber node is running.

**Example**:
```bash
fiber-pay status
```

**Output**:
```json
{
  "success": true,
  "data": {
    "running": true,
    "pid": 12345,
    "uptime": 3600000,
    "rpcUrl": "http://127.0.0.1:8227"
  }
}
```

#### `fiber-pay node info`

Get node information including ID, peers, and channels.

**Example**:
```bash
fiber-pay node info
```

**Output**:
```json
{
  "success": true,
  "data": {
    "nodeId": "QmXXXYYYZZZ...",
    "multiaddr": "/ip4/127.0.0.1/tcp/8228/p2p/QmXXX...",
    "publicKey": "0x02abcd1234...",
    "version": "0.4.0",
    "channelCount": 2,
    "peersCount": 1,
    "addresses": [
      "ckt1qq6pngwqn6e9vlm92th84rk0l4jp2h8lurchjmnwv8kq3rt5psf4vq..."
    ]
  }
}
```

### Payment Operations

#### `fiber-pay balance`

Get balance information across all channels.

**Example**:
```bash
fiber-pay balance
```

**Output**:
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
    "timestamp": 1738627200000,
    "policyCheck": {
      "allowed": true,
      "violations": [],
      "requiresConfirmation": false
    }
  }
}
```

#### `fiber-pay pay <invoice|options>`

Send a payment via Lightning Network.

**Pay invoice**:
```bash
fiber-pay pay fibt1qq2d77zqpvle5n2uqkgzlgw...
fiber-pay pay --invoice fibt1qq2d77zqpvle5n2uqkgzlgw...
```

**Direct payment (keysend)**:
```bash
fiber-pay pay --to QmXXXYYYZZZ... --amount 10
fiber-pay pay --to QmXXXYYYZZZ... --amount 10 --max-fee 0.1
```

**Options**:
- `--invoice <string>` - Invoice to pay
- `--to <node-id>` - Recipient node ID (for keysend)
- `--amount <ckb>` - Amount in CKB (for keysend)
- `--max-fee <ckb>` - Maximum fee willing to pay

**Output (success)**:
```json
{
  "success": true,
  "data": {
    "paymentHash": "0xabcd1234...",
    "status": "succeeded",
    "amountCkb": 10.0,
    "feeCkb": 0.001,
    "preimage": "0x5678ef...",
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

**Output (failure)**:
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance to send 100 CKB",
    "recoverable": true,
    "suggestion": "Open a channel or receive payment to increase balance"
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

#### `fiber-pay invoice create --amount <ckb> [options]`

Create an invoice to receive payment.

**Options**:
- `--amount <ckb>` - Amount to receive (required)
- `--description <text>` - Payment description
- `--expiry <minutes>` - Expiry time in minutes (default: 60)

**Example**:
```bash
fiber-pay invoice create --amount 10 --description "For coffee"
fiber-pay invoice create --amount 25.5 --expiry 120
```

**Output**:
```json
{
  "success": true,
  "data": {
    "invoice": "fibt1qq2d77zqpvle5n2uqkgzlgw...",
    "paymentHash": "0x1234abcd...",
    "amountCkb": 10.0,
    "expiresAt": 1738630800000,
    "description": "For coffee"
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

#### `fiber-pay invoice status <payment-hash>`

Check if an invoice has been paid.

**Example**:
```bash
fiber-pay invoice status 0x1234abcd...
```

**Output (unpaid)**:
```json
{
  "success": true,
  "data": {
    "paymentHash": "0x1234abcd...",
    "status": "pending",
    "amountCkb": 10.0,
    "expiresAt": 1738630800000
  }
}
```

**Output (paid)**:
```json
{
  "success": true,
  "data": {
    "paymentHash": "0x1234abcd...",
    "status": "succeeded",
    "amountCkb": 10.0,
    "paidAt": 1738628000000,
    "preimage": "0x5678ef..."
  }
}
```

#### `fiber-pay payment status <payment-hash>`

Check payment status by hash.

**Example**:
```bash
fiber-pay payment status 0xabcd1234...
```

**Output**:
```json
{
  "success": true,
  "data": {
    "paymentHash": "0xabcd1234...",
    "status": "succeeded",
    "amountCkb": 10.0,
    "feeCkb": 0.001,
    "timeTakenMs": 250
  }
}
```

### Channel Management

#### `fiber-pay channels list`

List all payment channels.

**Example**:
```bash
fiber-pay channels list
```

**Output**:
```json
{
  "success": true,
  "data": [
    {
      "channelId": "0xabc123...",
      "peerId": "QmXXXYYYZZZ...",
      "peerAddress": "ckt1qq...",
      "state": "CHANNEL_READY",
      "localBalanceCkb": 80.5,
      "remoteBalanceCkb": 19.5,
      "capacityCkb": 100.0,
      "isPublic": true,
      "createdAt": 1738620000000
    },
    {
      "channelId": "0xdef456...",
      "peerId": "QmAAABBBCCC...",
      "state": "NEGOTIATING_FUNDING",
      "localBalanceCkb": 200.0,
      "remoteBalanceCkb": 0.0,
      "capacityCkb": 200.0,
      "isPublic": true,
      "createdAt": 1738626000000
    }
  ]
}
```

**Channel States**:
- `NEGOTIATING_FUNDING` - Channel opening in progress
- `CHANNEL_READY` - Ready to send/receive payments
- `SHUTDOWN_INITIATED` - Channel closing
- `AWAIT_SHUTDOWN_SIGNATURES` - Waiting for close signatures
- `CLOSED` - Channel fully closed

#### `fiber-pay channels open --peer <multiaddr> --funding <ckb> [options]`

Open a new payment channel.

**Options**:
- `--peer <multiaddr>` - Peer multiaddress or node ID (required)
- `--funding <ckb>` - Amount to fund the channel (required)
- `--public` - Make channel public (default: true)
- `--private` - Make channel private

**Example**:
```bash
fiber-pay channels open \
  --peer /ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo... \
  --funding 200

fiber-pay channels open \
  --peer QmXXXYYYZZZ... \
  --funding 100 \
  --private
```

**Output**:
```json
{
  "success": true,
  "data": {
    "channelId": "0xnew123...",
    "temporaryChannelId": "0xtemp456...",
    "fundingAmount": 200.0,
    "peerId": "QmXXXYYYZZZ...",
    "state": "NEGOTIATING_FUNDING"
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

**Note**: Opening a channel requires on-chain CKB funds and blockchain confirmation (takes ~30 seconds on testnet).

#### `fiber-pay channels close <channel-id> [options]`

Close a payment channel.

**Options**:
- `--force` - Force close (unilateral, use only if peer unresponsive)

**Example**:
```bash
fiber-pay channels close 0xabc123...
fiber-pay channels close 0xabc123... --force
```

**Output (cooperative close)**:
```json
{
  "success": true,
  "data": {
    "channelId": "0xabc123...",
    "closeType": "cooperative",
    "state": "SHUTDOWN_INITIATED"
  }
}
```

**Output (force close)**:
```json
{
  "success": true,
  "data": {
    "channelId": "0xabc123...",
    "closeType": "unilateral",
    "state": "CLOSED",
    "settlementTxHash": "0xtx123..."
  }
}
```

### Policy Management

#### `fiber-pay policy allowance`

Get remaining spending allowance based on security policy.

**Example**:
```bash
fiber-pay policy allowance
```

**Output**:
```json
{
  "success": true,
  "data": {
    "perTransactionCkb": 100.0,
    "perWindowCkb": 1000.0,
    "remainingCkb": 850.0,
    "windowResetAt": 1738630800000,
    "transactionsRemaining": 8
  }
}
```

---

## MCP Tools

MCP (Model Context Protocol) tool definitions for integration with Claude, OpenClaw, and other MCP-compatible agents.

### Tool 1: `fiber_pay`

Pay an invoice or send CKB directly to a node.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "invoice": {
      "type": "string",
      "description": "Lightning invoice string to pay"
    },
    "recipientNodeId": {
      "type": "string",
      "description": "Recipient node ID for direct payment"
    },
    "amountCkb": {
      "type": "number",
      "description": "Amount to send in CKB (required for keysend)"
    },
    "maxFeeCkb": {
      "type": "number",
      "description": "Maximum fee willing to pay"
    }
  },
  "oneOf": [
    { "required": ["invoice"] },
    { "required": ["recipientNodeId", "amountCkb"] }
  ]
}
```

**CLI Equivalent**: `fiber-pay pay`

### Tool 2: `fiber_create_invoice`

Create an invoice to receive payment.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "amountCkb": {
      "type": "number",
      "description": "Amount to receive in CKB"
    },
    "description": {
      "type": "string",
      "description": "Description for the payer"
    },
    "expiryMinutes": {
      "type": "number",
      "description": "Invoice expiry time in minutes (default: 60)"
    }
  },
  "required": ["amountCkb"]
}
```

**CLI Equivalent**: `fiber-pay invoice create`

### Tool 3: `fiber_get_balance`

Get current balance information.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**CLI Equivalent**: `fiber-pay balance`

### Tool 4: `fiber_get_payment_status`

Check payment status by hash.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "paymentHash": {
      "type": "string",
      "description": "Payment hash to check"
    }
  },
  "required": ["paymentHash"]
}
```

**CLI Equivalent**: `fiber-pay payment status`

### Tool 5: `fiber_get_invoice_status`

Check invoice payment status.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "paymentHash": {
      "type": "string",
      "description": "Payment hash of the invoice"
    }
  },
  "required": ["paymentHash"]
}
```

**CLI Equivalent**: `fiber-pay invoice status`

### Tool 6: `fiber_list_channels`

List all payment channels.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**CLI Equivalent**: `fiber-pay channels list`

### Tool 7: `fiber_open_channel`

Open a new payment channel.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "peer": {
      "type": "string",
      "description": "Peer multiaddr or node ID"
    },
    "fundingCkb": {
      "type": "number",
      "description": "Amount of CKB to fund the channel"
    },
    "isPublic": {
      "type": "boolean",
      "description": "Whether to make the channel public (default: true)"
    }
  },
  "required": ["peer", "fundingCkb"]
}
```

**CLI Equivalent**: `fiber-pay channels open`

### Tool 8: `fiber_close_channel`

Close a payment channel.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "channelId": {
      "type": "string",
      "description": "Channel ID to close"
    },
    "force": {
      "type": "boolean",
      "description": "Force close (unilateral)"
    }
  },
  "required": ["channelId"]
}
```

**CLI Equivalent**: `fiber-pay channels close`

### Tool 9: `fiber_get_node_info`

Get node information.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**CLI Equivalent**: `fiber-pay node info`

### Tool 10: `fiber_get_spending_allowance`

Get remaining spending allowance.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**CLI Equivalent**: `fiber-pay policy allowance`

### Tool 11: `fiber_download_binary`

Download the Fiber Network Node binary.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "Specific version to download"
    },
    "force": {
      "type": "boolean",
      "description": "Force re-download"
    }
  }
}
```

**CLI Equivalent**: `fiber-pay download`

---

## TypeScript API

Use fiber-pay programmatically in your TypeScript/JavaScript code.

### Creating a FiberPay Instance

```typescript
import { createFiberPay } from 'fiber-pay';

const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
  rpcUrl: 'http://127.0.0.1:8227',
  
  // Optional: Custom security policy
  policy: {
    enabled: true,
    spending: {
      maxPerTransaction: '0x174876e800',  // 100 CKB
      maxPerWindow: '0xe8d4a51000',       // 1000 CKB
      windowMs: 3600000,                  // 1 hour
      currentSpent: '0x0',
      windowStart: Date.now(),
    },
    rateLimit: {
      maxTransactions: 10,
      windowMs: 60000,                    // 1 minute
      minTimeBetweenMs: 100,
      currentCount: 0,
      windowStart: Date.now(),
      lastTransaction: 0,
    },
    auditLog: {
      enabled: true,
      maxEntries: 1000,
    },
  },
});
```

### API Methods

#### `fiber.initialize()`

Initialize the Fiber node (download binary, start node).

```typescript
const result = await fiber.initialize({
  onDownloadProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.message}`);
  },
});

if (result.success) {
  console.log('Node initialized:', result.data);
}
```

#### `fiber.getBalance()`

Get balance information.

```typescript
const result = await fiber.getBalance();

if (result.success) {
  const { totalCkb, availableToSendCkb, channelCount } = result.data;
  console.log(`Balance: ${totalCkb} CKB across ${channelCount} channels`);
}
```

#### `fiber.pay(params)`

Send a payment.

```typescript
// Pay invoice
const result = await fiber.pay({
  invoice: 'fibt1qq2d77zqpvle5n2uqkgzlgw...',
});

// Or keysend
const result = await fiber.pay({
  recipientNodeId: 'QmXXXYYYZZZ...',
  amountCkb: 10,
  maxFeeCkb: 0.1,
});

if (result.success) {
  console.log('Payment hash:', result.data.paymentHash);
  console.log('Fee:', result.data.feeCkb);
} else {
  console.error('Payment failed:', result.error.message);
  console.log('Suggestion:', result.error.suggestion);
}
```

#### `fiber.createInvoice(params)`

Create an invoice.

```typescript
const result = await fiber.createInvoice({
  amountCkb: 10,
  description: 'For coffee',
  expiryMinutes: 60,
});

if (result.success) {
  console.log('Share this invoice:', result.data.invoice);
  console.log('Payment hash:', result.data.paymentHash);
}
```

#### `fiber.listChannels()`

List all channels.

```typescript
const result = await fiber.listChannels();

if (result.success) {
  result.data.forEach(channel => {
    console.log(`Channel ${channel.channelId}:`);
    console.log(`  State: ${channel.state}`);
    console.log(`  Balance: ${channel.localBalanceCkb} CKB`);
  });
}
```

#### `fiber.openChannel(params)`

Open a channel.

```typescript
const result = await fiber.openChannel({
  peer: '/ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo...',
  fundingCkb: 200,
  isPublic: true,
});

if (result.success) {
  console.log('Channel ID:', result.data.channelId);
}
```

#### `fiber.closeChannel(params)`

Close a channel.

```typescript
const result = await fiber.closeChannel({
  channelId: '0xabc123...',
  force: false,
});

if (result.success) {
  console.log('Channel closing:', result.data);
}
```

---

## AgentResult Format

All operations return results in the `AgentResult<T>` format for easy AI agent parsing.

### TypeScript Definition

```typescript
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

### Success Response

```json
{
  "success": true,
  "data": { /* operation-specific data */ },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance to send 100 CKB",
    "recoverable": true,
    "suggestion": "Open a channel or receive payment to increase balance"
  },
  "metadata": {
    "timestamp": 1738627200000
  }
}
```

### Policy Check

When a security policy check is performed:

```json
{
  "success": true,
  "data": { /* operation result */ },
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

If policy violation occurs:

```json
{
  "success": false,
  "error": {
    "code": "POLICY_VIOLATION",
    "message": "Amount 150 CKB exceeds per-transaction limit of 100 CKB",
    "recoverable": false,
    "suggestion": "Reduce payment amount or adjust security policy"
  },
  "metadata": {
    "policyCheck": {
      "allowed": false,
      "violations": [
        {
          "type": "SPENDING_LIMIT_PER_TX",
          "message": "Amount 150 exceeds per-transaction limit of 100",
          "details": {
            "requested": "0x22ecb25c00",
            "limit": "0x174876e800"
          }
        }
      ],
      "requiresConfirmation": false
    }
  }
}
```

---

## Data Types

### BalanceInfo

```typescript
{
  totalCkb: number;              // Total balance across channels
  availableToSendCkb: number;    // Amount available to send
  availableToReceiveCkb: number; // Capacity to receive
  channelCount: number;          // Number of channels
  remainingAllowanceCkb: number; // Remaining spending limit
}
```

### PaymentResult

```typescript
{
  paymentHash: string;           // Hex string
  status: 'pending' | 'succeeded' | 'failed';
  amountCkb: number;
  feeCkb?: number;
  preimage?: string;             // Hex string (when paid)
  timeTakenMs?: number;
}
```

### InvoiceResult

```typescript
{
  invoice: string;               // Invoice string (fibt1...)
  paymentHash: string;           // Hex string
  amountCkb: number;
  description?: string;
  expiresAt: number;             // Unix timestamp
  status?: 'pending' | 'succeeded' | 'expired';
  paidAt?: number;               // Unix timestamp (when paid)
}
```

### ChannelSummary

```typescript
{
  channelId: string;             // Hex string
  peerId: string;                // Node ID (QmXXX...)
  peerAddress?: string;          // CKB address (ckt1...)
  state: ChannelState;
  localBalanceCkb: number;       // Your balance
  remoteBalanceCkb: number;      // Peer's balance
  capacityCkb: number;           // Total channel capacity
  isPublic: boolean;
  createdAt: number;             // Unix timestamp
}
```

### ChannelState

```typescript
type ChannelState =
  | 'NEGOTIATING_FUNDING'        // Opening in progress
  | 'CHANNEL_READY'              // Ready for payments
  | 'SHUTDOWN_INITIATED'         // Closing started
  | 'AWAIT_SHUTDOWN_SIGNATURES'  // Waiting for signatures
  | 'CLOSED';                    // Fully closed
```

### Error Codes

| Code | Description | Recoverable |
|------|-------------|-------------|
| `INSUFFICIENT_BALANCE` | Not enough funds to send | Yes |
| `POLICY_VIOLATION` | Security policy blocked operation | No |
| `CHANNEL_NOT_FOUND` | Invalid channel ID | No |
| `NODE_NOT_RUNNING` | Fiber node not started | Yes |
| `RPC_ERROR` | RPC communication error | Yes |
| `PEER_UNREACHABLE` | Cannot connect to peer | Yes |
| `INVOICE_EXPIRED` | Payment invoice expired | No |
| `INVOICE_INVALID` | Malformed invoice string | No |
| `PAYMENT_TIMEOUT` | Payment took too long | Yes |
| `PAYMENT_FAILED` | Payment failed for unknown reason | Yes |
| `BINARY_NOT_FOUND` | fnn binary not installed | Yes |
| `BINARY_DOWNLOAD_FAILED` | Failed to download binary | Yes |

---

## RPC Client Methods

Lower-level RPC client for advanced usage:

```typescript
import { FiberRpcClient } from 'fiber-pay';

const client = new FiberRpcClient('http://127.0.0.1:8227');

// Send payment
await client.sendPayment({
  invoice: 'fibt1...',
  max_fee_amount: '0x64',
  timeout: 60,
});

// Get channels
const channels = await client.listChannels({});

// Open channel
await client.openChannel({
  peer_id: 'QmXXX...',
  funding_amount: '0xb1a2bc2ec50000',
  public: true,
});

// Close channel
await client.shutdownChannel({
  channel_id: '0xabc123...',
  close_script: { /* ... */ },
  fee_rate: '0x3e8',
});
```

For complete RPC method documentation, see the [Fiber Network API docs](https://github.com/nervosnetwork/fiber).

---

## Utility Functions

### Amount Conversion

```typescript
import { ckbToShannons, shannonsToCkb } from 'fiber-pay';

// Convert CKB to Shannon (smallest unit)
const shannons = ckbToShannons(100);  // 100 CKB → 10000000000n

// Convert Shannon to CKB
const ckb = shannonsToCkb(10000000000n);  // 10000000000 → 100

// Hex conversion
import { toHex, fromHex } from 'fiber-pay';

const hex = toHex(100n);        // 100n → '0x64'
const num = fromHex('0x64');    // '0x64' → 100n
```

### Random Hash Generation

```typescript
import { randomBytes32 } from 'fiber-pay';

const hash = randomBytes32();  // '0xabc123...' (64 hex chars)
```

---

For more details on security policies, see [SECURITY.md](SECURITY.md).
For troubleshooting, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
