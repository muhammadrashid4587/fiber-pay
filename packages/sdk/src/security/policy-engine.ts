/**
 * Policy Engine
 * Enforces spending limits, rate limits, and other security policies
 * This operates at the SDK level and cannot be bypassed via prompts
 */

import type {
  SecurityPolicy,
  PolicyViolation,
  PolicyCheckResult,
  SpendingLimit,
  RateLimit,
  AuditLogEntry,
  AuditAction,
} from '../types/index.js';
import { fromHex, toHex } from '../utils.js';

// =============================================================================
// Policy Engine
// =============================================================================

export class PolicyEngine {
  private policy: SecurityPolicy;
  private auditLog: AuditLogEntry[] = [];
  private spendingState: SpendingLimit;
  private rateLimitState: RateLimit;

  constructor(policy: SecurityPolicy) {
    this.policy = policy;
    
    // Initialize spending state
    this.spendingState = {
      ...policy.spending!,
      currentSpent: '0x0',
      windowStart: Date.now(),
    };
    
    // Initialize rate limit state
    this.rateLimitState = {
      ...policy.rateLimit!,
      currentCount: 0,
      windowStart: Date.now(),
      lastTransaction: 0,
    };
  }

  /**
   * Check if a payment is allowed by the policy
   */
  checkPayment(params: {
    amount: string; // hex
    recipient?: string;
  }): PolicyCheckResult {
    const violations: PolicyViolation[] = [];
    let requiresConfirmation = false;

    if (!this.policy.enabled) {
      return { allowed: true, violations: [], requiresConfirmation: false };
    }

    const amount = fromHex(params.amount as `0x${string}`);

    // Check spending limit per transaction
    if (this.policy.spending) {
      const maxPerTx = fromHex(this.policy.spending.maxPerTransaction as `0x${string}`);
      if (amount > maxPerTx) {
        violations.push({
          type: 'SPENDING_LIMIT_PER_TX',
          message: `Amount ${amount} exceeds per-transaction limit of ${maxPerTx}`,
          details: {
            requested: params.amount,
            limit: this.policy.spending.maxPerTransaction,
          },
        });
      }

      // Check spending limit per window
      this.refreshSpendingWindow();
      const currentSpent = fromHex(this.spendingState.currentSpent as `0x${string}`);
      const maxPerWindow = fromHex(this.policy.spending.maxPerWindow as `0x${string}`);
      
      if (currentSpent + amount > maxPerWindow) {
        const remaining = maxPerWindow - currentSpent;
        violations.push({
          type: 'SPENDING_LIMIT_PER_WINDOW',
          message: `Amount ${amount} would exceed window limit. Remaining: ${remaining}`,
          details: {
            requested: params.amount,
            limit: this.policy.spending.maxPerWindow,
            remaining: toHex(remaining > 0n ? remaining : 0n),
          },
        });
      }
    }

    // Check rate limit
    if (this.policy.rateLimit) {
      this.refreshRateLimitWindow();
      
      if (this.rateLimitState.currentCount! >= this.policy.rateLimit.maxTransactions) {
        violations.push({
          type: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit of ${this.policy.rateLimit.maxTransactions} transactions per ${this.policy.rateLimit.windowSeconds}s exceeded`,
          details: {},
        });
      }

      // Check cooldown
      const now = Date.now();
      const cooldownMs = this.policy.rateLimit.cooldownSeconds * 1000;
      const timeSinceLast = now - (this.rateLimitState.lastTransaction || 0);
      
      if (timeSinceLast < cooldownMs) {
        violations.push({
          type: 'RATE_LIMIT_COOLDOWN',
          message: `Cooldown period not elapsed. Wait ${Math.ceil((cooldownMs - timeSinceLast) / 1000)}s`,
          details: {
            cooldownRemaining: Math.ceil((cooldownMs - timeSinceLast) / 1000),
          },
        });
      }
    }

    // Check recipient policy
    if (this.policy.recipients && params.recipient) {
      if (this.policy.recipients.blocklist?.includes(params.recipient)) {
        violations.push({
          type: 'RECIPIENT_BLOCKED',
          message: `Recipient ${params.recipient} is blocklisted`,
          details: { recipient: params.recipient },
        });
      }

      if (
        this.policy.recipients.allowlist &&
        this.policy.recipients.allowlist.length > 0 &&
        !this.policy.recipients.allowlist.includes(params.recipient) &&
        !this.policy.recipients.allowUnknown
      ) {
        violations.push({
          type: 'RECIPIENT_NOT_ALLOWED',
          message: `Recipient ${params.recipient} is not in allowlist`,
          details: { recipient: params.recipient },
        });
      }
    }

    // Check confirmation threshold
    if (this.policy.confirmationThreshold) {
      const threshold = fromHex(this.policy.confirmationThreshold as `0x${string}`);
      if (amount > threshold) {
        requiresConfirmation = true;
        violations.push({
          type: 'REQUIRES_CONFIRMATION',
          message: `Amount ${amount} exceeds confirmation threshold of ${threshold}`,
          details: {
            requested: params.amount,
            limit: this.policy.confirmationThreshold,
          },
        });
      }
    }

    return {
      allowed: violations.filter(v => v.type !== 'REQUIRES_CONFIRMATION').length === 0,
      violations,
      requiresConfirmation,
    };
  }

  /**
   * Check if a channel operation is allowed
   */
  checkChannelOperation(params: {
    operation: 'open' | 'close' | 'force_close';
    fundingAmount?: string; // hex
    currentChannelCount?: number;
  }): PolicyCheckResult {
    const violations: PolicyViolation[] = [];

    if (!this.policy.enabled || !this.policy.channels) {
      return { allowed: true, violations: [], requiresConfirmation: false };
    }

    const { channels } = this.policy;

    if (params.operation === 'open') {
      if (!channels.allowOpen) {
        violations.push({
          type: 'CHANNEL_OPEN_NOT_ALLOWED',
          message: 'Channel opening is not allowed by policy',
          details: {},
        });
      }

      if (params.fundingAmount && channels.maxFundingAmount) {
        const funding = fromHex(params.fundingAmount as `0x${string}`);
        const max = fromHex(channels.maxFundingAmount as `0x${string}`);
        if (funding > max) {
          violations.push({
            type: 'CHANNEL_FUNDING_EXCEEDS_MAX',
            message: `Funding amount ${funding} exceeds maximum ${max}`,
            details: {
              requested: params.fundingAmount,
              limit: channels.maxFundingAmount,
            },
          });
        }
      }

      if (params.fundingAmount && channels.minFundingAmount) {
        const funding = fromHex(params.fundingAmount as `0x${string}`);
        const min = fromHex(channels.minFundingAmount as `0x${string}`);
        if (funding < min) {
          violations.push({
            type: 'CHANNEL_FUNDING_BELOW_MIN',
            message: `Funding amount ${funding} below minimum ${min}`,
            details: {
              requested: params.fundingAmount,
              limit: channels.minFundingAmount,
            },
          });
        }
      }

      if (
        channels.maxChannels &&
        params.currentChannelCount !== undefined &&
        params.currentChannelCount >= channels.maxChannels
      ) {
        violations.push({
          type: 'MAX_CHANNELS_REACHED',
          message: `Maximum channel count of ${channels.maxChannels} reached`,
          details: {},
        });
      }
    }

    if (params.operation === 'close' && !channels.allowClose) {
      violations.push({
        type: 'CHANNEL_CLOSE_NOT_ALLOWED',
        message: 'Channel closing is not allowed by policy',
        details: {},
      });
    }

    if (params.operation === 'force_close' && !channels.allowForceClose) {
      violations.push({
        type: 'CHANNEL_FORCE_CLOSE_NOT_ALLOWED',
        message: 'Force channel closing is not allowed by policy',
        details: {},
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      requiresConfirmation: false,
    };
  }

  /**
   * Record a successful payment (updates spending and rate limit state)
   */
  recordPayment(amount: string): void {
    this.refreshSpendingWindow();
    this.refreshRateLimitWindow();

    // Update spending
    const currentSpent = fromHex(this.spendingState.currentSpent as `0x${string}`);
    const paymentAmount = fromHex(amount as `0x${string}`);
    this.spendingState.currentSpent = toHex(currentSpent + paymentAmount);

    // Update rate limit
    this.rateLimitState.currentCount! += 1;
    this.rateLimitState.lastTransaction = Date.now();
  }

  /**
   * Add an entry to the audit log
   */
  addAuditEntry(
    action: AuditAction,
    success: boolean,
    details: Record<string, unknown>,
    violations?: PolicyViolation[]
  ): void {
    if (!this.policy.auditLogging) return;

    this.auditLog.push({
      timestamp: Date.now(),
      action,
      success,
      details,
      policyViolations: violations,
    });

    // Keep audit log bounded (last 1000 entries)
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
  }

  /**
   * Get the audit log
   */
  getAuditLog(options?: { limit?: number; since?: number }): AuditLogEntry[] {
    let log = this.auditLog;

    if (options?.since) {
      log = log.filter((entry) => entry.timestamp >= options.since!);
    }

    if (options?.limit) {
      log = log.slice(-options.limit);
    }

    return log;
  }

  /**
   * Get remaining spending allowance
   */
  getRemainingAllowance(): { perTransaction: bigint; perWindow: bigint } {
    this.refreshSpendingWindow();

    const maxPerTx = this.policy.spending
      ? fromHex(this.policy.spending.maxPerTransaction as `0x${string}`)
      : BigInt(Number.MAX_SAFE_INTEGER);

    const maxPerWindow = this.policy.spending
      ? fromHex(this.policy.spending.maxPerWindow as `0x${string}`)
      : BigInt(Number.MAX_SAFE_INTEGER);

    const currentSpent = fromHex(this.spendingState.currentSpent as `0x${string}`);
    const remainingWindow = maxPerWindow - currentSpent;

    return {
      perTransaction: maxPerTx,
      perWindow: remainingWindow > 0n ? remainingWindow : 0n,
    };
  }

  /**
   * Update the policy
   */
  updatePolicy(newPolicy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...newPolicy };
    this.addAuditEntry('POLICY_UPDATED', true, { newPolicy });
  }

  /**
   * Get the current policy
   */
  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private refreshSpendingWindow(): void {
    if (!this.policy.spending) return;

    const now = Date.now();
    const windowMs = this.policy.spending.windowSeconds * 1000;
    const windowStart = this.spendingState.windowStart || now;

    if (now - windowStart >= windowMs) {
      // Reset window
      this.spendingState.currentSpent = '0x0';
      this.spendingState.windowStart = now;
    }
  }

  private refreshRateLimitWindow(): void {
    if (!this.policy.rateLimit) return;

    const now = Date.now();
    const windowMs = this.policy.rateLimit.windowSeconds * 1000;
    const windowStart = this.rateLimitState.windowStart || now;

    if (now - windowStart >= windowMs) {
      // Reset window
      this.rateLimitState.currentCount = 0;
      this.rateLimitState.windowStart = now;
    }
  }
}
