# fiber-pay Security Reference

Comprehensive documentation for fiber-pay's security architecture, policy engine, spending limits, and audit logging.

## Table of Contents

1. [Security Overview](#security-overview)
2. [Policy Engine Architecture](#policy-engine-architecture)
3. [Spending Limits](#spending-limits)
4. [Rate Limiting](#rate-limiting)
5. [Channel Operation Policies](#channel-operation-policies)
6. [Recipient Control](#recipient-control)
7. [Audit Logging](#audit-logging)
8. [Key Management](#key-management)
9. [Configuration Examples](#configuration-examples)
10. [Best Practices](#best-practices)

---

## Security Overview

fiber-pay includes a **policy engine** that operates at the SDK level to enforce security policies for autonomous AI agents. These policies **cannot be bypassed via prompts** and provide:

- **Spending limits**: Per-transaction and time-window limits
- **Rate limiting**: Transaction frequency controls
- **Channel policies**: Restrictions on opening/closing channels
- **Recipient controls**: Allowlist/blocklist for recipients
- **Audit logging**: Complete transaction history
- **Key management**: Encrypted key storage with AES-256-GCM

### Security Philosophy

The security model is designed for **autonomous agent operation** where:
1. **Policies are enforced at the code level**, not the prompt level
2. **All operations are audited** for accountability
3. **Spending limits prevent runaway costs** from agent errors
4. **Rate limits prevent abuse** and DoS attacks
5. **Keys are encrypted at rest** and never logged

---

## Policy Engine Architecture

The `PolicyEngine` class enforces all security policies before any payment or channel operation.

### Policy Check Flow

```
User Request
    ↓
FiberPay API
    ↓
PolicyEngine.checkPayment()
    ├─ Check spending limits (per-tx, per-window)
    ├─ Check rate limits (frequency, cooldown)
    ├─ Check recipient (allowlist/blocklist)
    └─ Check confirmation threshold
    ↓
Policy Violations? ──Yes──> Reject with detailed error
    │
    No
    ↓
Execute Payment
    ↓
PolicyEngine.recordPayment()
    ├─ Update spending state
    ├─ Update rate limit state
    └─ Add audit log entry
```

### PolicyCheckResult

Every policy check returns:

```typescript
{
  allowed: boolean;              // Can operation proceed?
  violations: PolicyViolation[]; // What policies were violated?
  requiresConfirmation: boolean; // Does this need confirmation?
}
```

### PolicyViolation Types

| Type | Description | Recoverable |
|------|-------------|-------------|
| `SPENDING_LIMIT_PER_TX` | Single transaction too large | No |
| `SPENDING_LIMIT_PER_WINDOW` | Window limit would be exceeded | Yes (wait) |
| `RATE_LIMIT_EXCEEDED` | Too many transactions in window | Yes (wait) |
| `RATE_LIMIT_COOLDOWN` | Cooldown period not elapsed | Yes (wait) |
| `RECIPIENT_BLOCKED` | Recipient is blocklisted | No |
| `RECIPIENT_NOT_ALLOWED` | Recipient not in allowlist | No |
| `REQUIRES_CONFIRMATION` | Amount exceeds confirmation threshold | N/A |
| `CHANNEL_OPEN_NOT_ALLOWED` | Opening channels disabled | No |
| `CHANNEL_CLOSE_NOT_ALLOWED` | Closing channels disabled | No |
| `CHANNEL_FUNDING_EXCEEDS_MAX` | Channel funding too large | No |
| `CHANNEL_FUNDING_BELOW_MIN` | Channel funding too small | No |
| `MAX_CHANNELS_REACHED` | Maximum channel count reached | No |

---

## Spending Limits

Spending limits control how much CKB can be spent in a single transaction and within a time window.

### Configuration

```typescript
spending: {
  maxPerTransaction: string;  // Hex string (e.g., '0x174876e800' = 100 CKB)
  maxPerWindow: string;       // Hex string (e.g., '0xe8d4a51000' = 1000 CKB)
  windowSeconds: number;      // Time window in seconds (e.g., 3600 = 1 hour)
  currentSpent: string;       // Current spending in window (internal state)
  windowStart: number;        // Window start timestamp (internal state)
}
```

### Default Limits

```typescript
spending: {
  maxPerTransaction: '0x174876e800',  // 100 CKB
  maxPerWindow: '0xe8d4a51000',       // 1,000 CKB
  windowSeconds: 3600,                // 1 hour
}
```

### How It Works

1. **Per-Transaction Check**: Each payment is checked against `maxPerTransaction`
2. **Window Tracking**: Cumulative spending is tracked within rolling time windows
3. **Window Reset**: When the window expires, spending resets to zero
4. **Remaining Allowance**: Can be queried via `getRemainingAllowance()`

### Example: Spending Limits in Action

```typescript
// Policy: 100 CKB per tx, 500 CKB per hour

// Transaction 1: 80 CKB
checkPayment({ amount: '0x11c37937e08000' })  // ✅ Allowed
// Remaining: 420 CKB in window

// Transaction 2: 150 CKB  
checkPayment({ amount: '0x20f5b89d5f0000' })  // ❌ Rejected
// Violation: SPENDING_LIMIT_PER_TX (exceeds 100 CKB)

// Transaction 3: 90 CKB
checkPayment({ amount: '0x13fbe85edc9000' })  // ✅ Allowed
// Remaining: 330 CKB in window

// Transaction 4: 400 CKB
checkPayment({ amount: '0x58d15e17628000' })  // ❌ Rejected  
// Violation: SPENDING_LIMIT_PER_WINDOW (would exceed 500 CKB)

// After 1 hour...
// Window resets, can spend another 500 CKB
```

### Checking Remaining Allowance

**CLI**:
```bash
fiber-pay policy allowance
```

**TypeScript**:
```typescript
const result = await fiber.getSpendingAllowance();
console.log(`Remaining: ${result.remainingCkb} CKB`);
```

**Output**:
```json
{
  "perTransactionCkb": 100.0,
  "perWindowCkb": 1000.0,
  "remainingCkb": 850.0,
  "windowResetAt": 1738630800000,
  "transactionsRemaining": 8
}
```

---

## Rate Limiting

Rate limiting controls transaction frequency to prevent abuse and DoS attacks.

### Configuration

```typescript
rateLimit: {
  maxTransactions: number;    // Max transactions per window
  windowSeconds: number;      // Time window in seconds
  cooldownSeconds: number;    // Minimum time between transactions
  currentCount: number;       // Current transaction count (internal state)
  windowStart: number;        // Window start timestamp (internal state)
  lastTransaction: number;    // Last transaction timestamp (internal state)
}
```

### Default Limits

```typescript
rateLimit: {
  maxTransactions: 10,        // 10 transactions per minute
  windowSeconds: 60,          // 1 minute window
  cooldownSeconds: 1,         // 1 second between transactions
}
```

### How It Works

1. **Transaction Counting**: Each payment increments the transaction counter
2. **Window Tracking**: Counter resets when window expires
3. **Cooldown Enforcement**: Minimum time between consecutive transactions
4. **Automatic Reset**: Windows reset automatically after expiry

### Example: Rate Limiting in Action

```typescript
// Policy: 5 transactions per minute, 2 second cooldown

// Transactions 1-5: All allowed (2+ seconds apart)
// ✅ ✅ ✅ ✅ ✅

// Transaction 6: Rejected
// ❌ Violation: RATE_LIMIT_EXCEEDED (5 transactions in window)

// After 60 seconds...
// Window resets, can send 5 more transactions

// Transaction attempt at t+0.5s after last:
// ❌ Violation: RATE_LIMIT_COOLDOWN (need 2 seconds between)
```

### Rate Limit Strategies

**Conservative (for production)**:
```typescript
rateLimit: {
  maxTransactions: 10,
  windowSeconds: 60,
  cooldownSeconds: 5,  // 5 seconds between transactions
}
```

**Moderate (for testing)**:
```typescript
rateLimit: {
  maxTransactions: 20,
  windowSeconds: 60,
  cooldownSeconds: 1,
}
```

**Permissive (for development)**:
```typescript
rateLimit: {
  maxTransactions: 100,
  windowSeconds: 60,
  cooldownSeconds: 0,
}
```

---

## Channel Operation Policies

Control which channel operations agents can perform.

### Configuration

```typescript
channels: {
  allowOpen: boolean;         // Can open new channels?
  allowClose: boolean;        // Can close channels cooperatively?
  allowForceClose: boolean;   // Can force-close channels?
  maxChannels?: number;       // Maximum total channels
  minFundingAmount?: string;  // Minimum channel funding (hex)
  maxFundingAmount?: string;  // Maximum channel funding (hex)
}
```

### Default Policy

```typescript
channels: {
  allowOpen: true,
  allowClose: true,
  allowForceClose: false,  // Requires manual approval
  maxChannels: 10,
  minFundingAmount: '0x2386f26fc10000',   // 10 CKB
  maxFundingAmount: '0x152d02c7e14af6800000',  // 100,000 CKB
}
```

### Policy Examples

**Restrictive (agent can only use existing channels)**:
```typescript
channels: {
  allowOpen: false,
  allowClose: false,
  allowForceClose: false,
}
```

**Moderate (can open small channels)**:
```typescript
channels: {
  allowOpen: true,
  allowClose: true,
  allowForceClose: false,
  maxChannels: 5,
  minFundingAmount: '0x2386f26fc10000',      // 10 CKB
  maxFundingAmount: '0x6124fee993bc0000',    // 1,000 CKB
}
```

**Permissive (full control)**:
```typescript
channels: {
  allowOpen: true,
  allowClose: true,
  allowForceClose: true,
  // No funding limits
}
```

---

## Recipient Control

Control which recipients agents can send payments to.

### Configuration

```typescript
recipients: {
  allowlist?: string[];       // Allowed recipient addresses/node IDs
  blocklist?: string[];       // Blocked recipient addresses/node IDs
  allowUnknown: boolean;      // Allow recipients not in allowlist?
}
```

### Allowlist Mode (Whitelist)

Only allow payments to specific recipients:

```typescript
recipients: {
  allowlist: [
    'QmXXXYYYZZZ...',                           // Node ID
    'ckt1qq6pngwqn6e9vlm92th84rk0l4jp2h...',  // CKB address
  ],
  allowUnknown: false,  // Reject anyone not in allowlist
}
```

### Blocklist Mode (Blacklist)

Block specific recipients, allow everyone else:

```typescript
recipients: {
  blocklist: [
    'QmBADBOYBADBOY...',  // Known scammer
    'ckt1qq1234...',       // Suspicious address
  ],
  allowUnknown: true,     // Allow anyone not blocklisted
}
```

### Open Mode (No Restrictions)

```typescript
recipients: {
  allowUnknown: true,
}
```

### Use Cases

1. **Testing**: Allowlist only testnet addresses
2. **Known Partners**: Allowlist business partner addresses
3. **Security**: Blocklist known malicious actors
4. **Compliance**: Implement regulatory restrictions

---

## Audit Logging

Complete audit trail of all operations for accountability and debugging.

### Configuration

```typescript
auditLogging: boolean;  // Enable/disable audit logging
```

### Audit Log Entry Format

```typescript
{
  timestamp: number;              // Unix timestamp
  action: AuditAction;            // What operation was performed
  success: boolean;               // Did it succeed?
  details: Record<string, any>;   // Operation-specific details
  policyViolations?: PolicyViolation[];  // Any policy violations
}
```

### Audit Actions

| Action | Description |
|--------|-------------|
| `PAYMENT_SENT` | Payment was sent |
| `PAYMENT_FAILED` | Payment attempt failed |
| `INVOICE_CREATED` | Invoice was created |
| `CHANNEL_OPENED` | Channel was opened |
| `CHANNEL_CLOSED` | Channel was closed |
| `POLICY_UPDATED` | Security policy was updated |
| `KEY_GENERATED` | Private key was generated |
| `NODE_STARTED` | Fiber node started |
| `NODE_STOPPED` | Fiber node stopped |

### Retrieving Audit Logs

**TypeScript**:
```typescript
const policyEngine = fiber.getPolicyEngine();

// Get all logs
const allLogs = policyEngine.getAuditLog();

// Get last 10 logs
const recentLogs = policyEngine.getAuditLog({ limit: 10 });

// Get logs since timestamp
const recentLogs = policyEngine.getAuditLog({ 
  since: Date.now() - 3600000  // Last hour
});
```

### Example Audit Log Entries

**Successful Payment**:
```json
{
  "timestamp": 1738627200000,
  "action": "PAYMENT_SENT",
  "success": true,
  "details": {
    "paymentHash": "0xabcd1234...",
    "amountCkb": 10.0,
    "recipient": "QmXXXYYYZZZ...",
    "feeCkb": 0.001
  },
  "policyViolations": []
}
```

**Failed Payment (Policy Violation)**:
```json
{
  "timestamp": 1738627201000,
  "action": "PAYMENT_FAILED",
  "success": false,
  "details": {
    "amountCkb": 150.0,
    "recipient": "QmXXXYYYZZZ..."
  },
  "policyViolations": [
    {
      "type": "SPENDING_LIMIT_PER_TX",
      "message": "Amount 150 CKB exceeds per-transaction limit of 100 CKB",
      "details": {
        "requested": "0x20f5b89d5f0000",
        "limit": "0x174876e800"
      }
    }
  ]
}
```

### Log Retention

- Maximum 1,000 entries stored in memory
- Oldest entries automatically pruned
- Consider exporting to persistent storage for long-term retention

---

## Key Management

fiber-pay uses the `KeyManager` class to securely generate and store private keys.

### Features

- **AES-256-GCM encryption** with PBKDF2 key derivation
- **Encrypted storage** of private keys on disk
- **Password protection** (interactive or via environment variable)
- **Key rotation** support
- **Never logged** or exposed in audit trails

### Key Storage Location

Keys are stored in:
```
~/.fiber-pay/keys/
```

Or custom location via `FIBER_DATA_DIR` environment variable.

### Key Generation

**First-time setup**:
```bash
# Interactive password prompt
fiber-pay start

# Or via environment variable
export FIBER_KEY_PASSWORD="secure-password"
fiber-pay start
```

**Programmatic**:
```typescript
import { KeyManager } from '@fiber-pay/sdk';

const keyManager = new KeyManager({
  dataDir: '~/.fiber-pay',
  password: 'secure-password',
});

const privateKey = await keyManager.getOrCreateKey('main');
```

### Key Security Best Practices

1. **Use strong passwords**: At least 16 characters, mixed case, symbols
2. **Environment variables**: Set `FIBER_KEY_PASSWORD` for automation
3. **File permissions**: Ensure key directory is `0700` (owner-only)
4. **Backup keys**: Export and store securely offline
5. **Rotate regularly**: Generate new keys periodically
6. **Never log**: Keys never appear in logs or audit trails

### Key Export (Backup)

```typescript
const keyManager = new KeyManager({ dataDir: '~/.fiber-pay' });
const privateKey = await keyManager.getOrCreateKey('main');

// Export to secure backup location
// (Implementation depends on your backup strategy)
```

---

## Configuration Examples

### Example 1: Conservative Production Policy

Strict limits for production agent:

```typescript
const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'mainnet',
  policy: {
    enabled: true,
    
    spending: {
      maxPerTransaction: '0x2386f26fc10000',    // 10 CKB
      maxPerWindow: '0x152d02c7e14af6800000',   // 10,000 CKB
      windowSeconds: 86400,                      // 24 hours
    },
    
    rateLimit: {
      maxTransactions: 10,
      windowSeconds: 3600,      // 1 hour
      cooldownSeconds: 60,      // 1 minute between
    },
    
    channels: {
      allowOpen: false,         // Don't allow new channels
      allowClose: false,        // Don't allow closing
      allowForceClose: false,
    },
    
    recipients: {
      allowlist: [
        'QmKnownPartner1...',
        'QmKnownPartner2...',
      ],
      allowUnknown: false,      // Only allowlisted recipients
    },
    
    auditLogging: true,
  },
});
```

### Example 2: Moderate Development Policy

Balanced limits for development/testing:

```typescript
const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
  policy: {
    enabled: true,
    
    spending: {
      maxPerTransaction: '0x174876e800',        // 100 CKB
      maxPerWindow: '0xe8d4a51000',             // 1,000 CKB
      windowSeconds: 3600,                      // 1 hour
    },
    
    rateLimit: {
      maxTransactions: 20,
      windowSeconds: 60,
      cooldownSeconds: 1,
    },
    
    channels: {
      allowOpen: true,
      allowClose: true,
      allowForceClose: false,
      maxChannels: 5,
      minFundingAmount: '0x2386f26fc10000',     // 10 CKB
      maxFundingAmount: '0x6124fee993bc0000',   // 1,000 CKB
    },
    
    recipients: {
      blocklist: ['QmKnownScammer...'],
      allowUnknown: true,
    },
    
    auditLogging: true,
  },
});
```

### Example 3: Permissive Testing Policy

Minimal restrictions for local testing:

```typescript
const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
  policy: {
    enabled: true,
    
    spending: {
      maxPerTransaction: '0x152d02c7e14af6800000',  // 100,000 CKB
      maxPerWindow: '0x152d02c7e14af6800000',       // 100,000 CKB
      windowSeconds: 86400,
    },
    
    rateLimit: {
      maxTransactions: 1000,
      windowSeconds: 60,
      cooldownSeconds: 0,
    },
    
    channels: {
      allowOpen: true,
      allowClose: true,
      allowForceClose: true,
    },
    
    recipients: {
      allowUnknown: true,
    },
    
    auditLogging: true,
  },
});
```

### Example 4: Disabled Policy (Not Recommended)

No security restrictions:

```typescript
const fiber = await createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
  policy: {
    enabled: false,  // ⚠️ WARNING: No security checks
  },
});
```

**⚠️ WARNING**: Only disable policies for local development. Never in production.

---

## Best Practices

### 1. Start Conservative

Begin with strict policies and relax as needed:

```typescript
// Start with low limits
spending: {
  maxPerTransaction: '0x2386f26fc10000',  // 10 CKB
  maxPerWindow: '0x174876e800',           // 100 CKB
}

// Increase after observing behavior
spending: {
  maxPerTransaction: '0x174876e800',      // 100 CKB
  maxPerWindow: '0xe8d4a51000',           // 1,000 CKB
}
```

### 2. Monitor Audit Logs

Regularly review logs for unusual patterns:

```typescript
const logs = policyEngine.getAuditLog({ limit: 100 });

// Check for failed payments
const failures = logs.filter(log => !log.success);
console.log(`${failures.length} failed operations`);

// Check for policy violations
const violations = logs.filter(log => log.policyViolations?.length > 0);
```

### 3. Use Testnet First

Always test on testnet before mainnet:

1. Deploy with testnet configuration
2. Run through all workflows
3. Verify audit logs
4. Only then deploy to mainnet

### 4. Separate Policies by Environment

```typescript
const policy = process.env.NODE_ENV === 'production'
  ? PRODUCTION_POLICY
  : DEVELOPMENT_POLICY;

const fiber = await createFiberPay({ policy });
```

### 5. Implement Emergency Stops

Monitor for anomalies and stop agent if detected:

```typescript
const balance = await fiber.getBalance();
if (balance.data.totalCkb < MINIMUM_THRESHOLD) {
  // Stop agent, alert operators
  await fiber.stop();
  throw new Error('Balance below minimum threshold');
}
```

### 6. Regular Security Audits

- Review audit logs weekly
- Check remaining allowances
- Verify no policy bypasses
- Update blocklists as needed

### 7. Key Rotation

Rotate keys periodically:

1. Generate new key
2. Transfer funds to new address
3. Archive old key securely
4. Update agent configuration

### 8. Backup Everything

- Export private keys (encrypted)
- Save audit logs to persistent storage
- Keep policy configurations in version control
- Document all security incidents

---

## Related Documentation

- [API.md](API.md) - Complete API reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Error handling and debugging
- [SKILL.md](../SKILL.md) - Agent skills integration guide

For more information on Fiber Network security, see:
- [Fiber Network Documentation](https://github.com/nervosnetwork/fiber)
- [CKB Security Best Practices](https://docs.nervos.org/docs/basics/guides/crypto%20wallets/overview)
