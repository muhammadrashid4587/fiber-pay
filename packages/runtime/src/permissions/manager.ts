import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PrivateKey, PublicKey } from '@biscuit-auth/biscuit-wasm';
import {
  Biscuit,
  PrivateKey as BiscuitPrivateKey,
  PublicKey as BiscuitPublicKey,
  KeyPair,
  SignatureAlgorithm,
} from '@biscuit-auth/biscuit-wasm';
import { PermissionMigrator } from './migrator.js';
import { PermissionStorage } from './storage.js';
import type {
  ChannelPermission,
  GrantStatus,
  PaymentPermission,
  Permission,
  PermissionGrant,
  PermissionRequest,
  PermissionResource,
} from './types.js';

export interface ValidationResult {
  valid: boolean;
  grantId?: string;
  permissions?: Permission[];
  limits?: GrantLimits;
  error?: string;
}

export interface GrantLimits {
  dailyLimit?: bigint;
  perPaymentLimit?: bigint;
  dailyCountLimit?: number;
  hourlyCountLimit?: number;
  minIntervalSeconds?: number;
  channelOpeningAllowed?: boolean;
  channelFundingLimit?: bigint;
  canCloseChannels?: boolean;
  canForceClose?: boolean;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  timeWindowDays?: string[];
}

export class LimitTracker {
  private storage: PermissionStorage;

  constructor(storage: PermissionStorage) {
    this.storage = storage;
  }

  checkDailyLimit(grant: PermissionGrant, amount: bigint): { allowed: boolean; remaining: bigint } {
    if (!grant.daily_payment_limit) {
      return { allowed: true, remaining: 0n };
    }

    const today = new Date();
    const dateStr = this.formatDate(today);
    const usage = this.storage.getDailyUsage(grant.id, dateStr);

    const remaining = grant.daily_payment_limit - usage.amount_paid;
    const allowed = remaining >= amount;

    return { allowed, remaining };
  }

  checkDailyCount(grant: PermissionGrant): { allowed: boolean; count: number } {
    if (!grant.daily_count_limit) {
      return { allowed: true, count: 0 };
    }

    const today = new Date();
    const dateStr = this.formatDate(today);
    const usage = this.storage.getDailyUsage(grant.id, dateStr);

    const allowed = usage.payments_count < grant.daily_count_limit;

    return { allowed, count: usage.payments_count };
  }

  checkHourlyCount(grant: PermissionGrant): { allowed: boolean; count: number } {
    if (!grant.hourly_count_limit) {
      return { allowed: true, count: 0 };
    }

    const now = new Date();
    const hourStr = this.formatHour(now);
    const usage = this.storage.getHourlyUsage(grant.id, hourStr);

    const allowed = usage.payments_count < grant.hourly_count_limit;

    return { allowed, count: usage.payments_count };
  }

  checkMinInterval(grant: PermissionGrant): { allowed: boolean; secondsSinceLast: number } {
    if (!grant.min_interval_seconds || !grant.last_used_at) {
      return { allowed: true, secondsSinceLast: Infinity };
    }

    const now = Date.now();
    const lastUsed = grant.last_used_at.getTime();
    const secondsSinceLast = Math.floor((now - lastUsed) / 1000);

    return {
      allowed: secondsSinceLast >= grant.min_interval_seconds,
      secondsSinceLast,
    };
  }

  recordPayment(grantId: string, amount: bigint): void {
    this.storage.recordPaymentUsage(grantId, amount);
  }

  validatePayment(
    grant: PermissionGrant,
    amount: bigint,
  ): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (grant.per_payment_limit && amount > grant.per_payment_limit) {
      errors.push(`Amount exceeds per-payment limit of ${grant.per_payment_limit}`);
    }

    const dailyCheck = this.checkDailyLimit(grant, amount);
    if (!dailyCheck.allowed) {
      errors.push(`Daily limit exceeded. Remaining: ${dailyCheck.remaining}`);
    }

    const dailyCountCheck = this.checkDailyCount(grant);
    if (!dailyCountCheck.allowed) {
      errors.push(`Daily count limit of ${grant.daily_count_limit} exceeded`);
    }

    const hourlyCountCheck = this.checkHourlyCount(grant);
    if (!hourlyCountCheck.allowed) {
      errors.push(`Hourly count limit of ${grant.hourly_count_limit} exceeded`);
    }

    const intervalCheck = this.checkMinInterval(grant);
    if (!intervalCheck.allowed) {
      errors.push(`Minimum interval of ${grant.min_interval_seconds}s not met`);
    }

    return { valid: errors.length === 0, errors };
  }

  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatHour(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }
}

export interface PermissionManagerOptions {
  dbPath: string;
  nodeId: string;
  keyPair: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  };
}

export class PermissionManager extends EventEmitter {
  private storage: PermissionStorage;
  private migrator: PermissionMigrator;
  private limitTracker: LimitTracker;
  private nodeId: string;
  private keyPair: KeyPair;
  private publicKey: PublicKey;
  private privateKey: PrivateKey;

  constructor(options: PermissionManagerOptions) {
    super();

    this.nodeId = options.nodeId;
    this.storage = new PermissionStorage(options.dbPath);
    this.migrator = new PermissionMigrator(options.dbPath);
    this.limitTracker = new LimitTracker(this.storage);

    this.privateKey = BiscuitPrivateKey.fromBytes(
      options.keyPair.privateKey,
      SignatureAlgorithm.Ed25519,
    );
    this.publicKey = BiscuitPublicKey.fromBytes(
      options.keyPair.publicKey,
      SignatureAlgorithm.Ed25519,
    );
    this.keyPair = KeyPair.fromPrivateKey(this.privateKey);

    this.migrator.migrate().catch((error) => {
      this.emit('error', error);
    });
  }

  async createFromRequest(request: PermissionRequest): Promise<PermissionGrant> {
    if (!request.app?.id) {
      throw new Error('Permission request must include app.id');
    }
    if (!request.permissions?.length) {
      throw new Error('Permission request must include at least one permission');
    }

    const expiresAt = this.parseExpiration(request.expires_in);

    const paymentPerms = request.permissions.filter(
      (p): p is PaymentPermission => p.resource === 'payments' && p.action === 'write',
    );
    const channelPerms = request.permissions.filter(
      (p): p is ChannelPermission => p.resource === 'channels' && p.action === 'write',
    );

    let dailyPaymentLimit: bigint | undefined;
    let perPaymentLimit: bigint | undefined;
    let dailyCountLimit: number | undefined;
    let hourlyCountLimit: number | undefined;
    let minIntervalSeconds: number | undefined;
    let channelOpeningAllowed = false;
    let channelFundingLimit: bigint | undefined;
    let canCloseChannels = false;
    let canForceClose = false;

    for (const perm of paymentPerms) {
      if (perm.daily_limit !== undefined) {
        dailyPaymentLimit = perm.daily_limit;
      }
      if (perm.max_amount !== undefined) {
        perPaymentLimit = perm.max_amount;
      }
      if (perm.daily_count_limit !== undefined) {
        dailyCountLimit = perm.daily_count_limit;
      }
      if (perm.hourly_count_limit !== undefined) {
        hourlyCountLimit = perm.hourly_count_limit;
      }
      if (perm.min_interval_seconds !== undefined) {
        minIntervalSeconds = perm.min_interval_seconds;
      }
    }

    for (const perm of channelPerms) {
      if (perm.can_create_new) {
        channelOpeningAllowed = true;
      }
      if (perm.max_funding !== undefined) {
        channelFundingLimit = perm.max_funding;
      }
      if (perm.can_close) {
        canCloseChannels = true;
      }
      if (perm.can_force_close) {
        canForceClose = true;
      }
    }

    const grantData: Omit<PermissionGrant, 'id' | 'created_at'> = {
      app_id: request.app.id,
      app_name: request.app.name,
      node_id: this.nodeId,
      token_ciphertext: new Uint8Array(),
      scopes: request.permissions,
      status: 'pending',
      expires_at: expiresAt,
      daily_payment_limit: dailyPaymentLimit,
      per_payment_limit: perPaymentLimit,
      daily_count_limit: dailyCountLimit,
      hourly_count_limit: hourlyCountLimit,
      min_interval_seconds: minIntervalSeconds,
      channel_opening_allowed: channelOpeningAllowed,
      channel_funding_limit: channelFundingLimit,
      can_close_channels: canCloseChannels,
      can_force_close: canForceClose,
      total_payments_made: 0,
      total_amount_paid: 0n,
    };

    const grant = this.storage.createGrant(grantData);

    for (const perm of paymentPerms) {
      if (perm.allowed_recipients?.length) {
        this.storage.addRecipientWhitelist(grant.id, perm.allowed_recipients);
      }
    }

    for (const perm of channelPerms) {
      if (perm.allowed_channels?.length) {
        this.storage.addAllowedChannels(grant.id, perm.allowed_channels);
      }
    }

    this.emit('grant:created', grant);

    return grant;
  }

  async approve(requestId: string, approvedLimits?: GrantLimits): Promise<PermissionGrant> {
    const grant = this.storage.getGrantById(requestId);
    if (!grant) {
      throw new Error(`Grant not found: ${requestId}`);
    }

    if (grant.status !== 'pending') {
      throw new Error(`Cannot approve grant with status: ${grant.status}`);
    }

    const updates: Partial<PermissionGrant> = {
      status: 'active',
    };

    if (approvedLimits) {
      if (approvedLimits.dailyLimit !== undefined) {
        updates.daily_payment_limit = approvedLimits.dailyLimit;
      }
      if (approvedLimits.perPaymentLimit !== undefined) {
        updates.per_payment_limit = approvedLimits.perPaymentLimit;
      }
      if (approvedLimits.dailyCountLimit !== undefined) {
        updates.daily_count_limit = approvedLimits.dailyCountLimit;
      }
      if (approvedLimits.hourlyCountLimit !== undefined) {
        updates.hourly_count_limit = approvedLimits.hourlyCountLimit;
      }
      if (approvedLimits.minIntervalSeconds !== undefined) {
        updates.min_interval_seconds = approvedLimits.minIntervalSeconds;
      }
      if (approvedLimits.channelOpeningAllowed !== undefined) {
        updates.channel_opening_allowed = approvedLimits.channelOpeningAllowed;
      }
      if (approvedLimits.channelFundingLimit !== undefined) {
        updates.channel_funding_limit = approvedLimits.channelFundingLimit;
      }
      if (approvedLimits.canCloseChannels !== undefined) {
        updates.can_close_channels = approvedLimits.canCloseChannels;
      }
      if (approvedLimits.canForceClose !== undefined) {
        updates.can_force_close = approvedLimits.canForceClose;
      }
      if (approvedLimits.timeWindowStart !== undefined) {
        updates.time_window_start = approvedLimits.timeWindowStart;
      }
      if (approvedLimits.timeWindowEnd !== undefined) {
        updates.time_window_end = approvedLimits.timeWindowEnd;
      }
      if (approvedLimits.timeWindowDays !== undefined) {
        updates.time_window_days = approvedLimits.timeWindowDays;
      }
    }

    const token = await this.generateBiscuitToken(grant, updates.scopes || grant.scopes);
    updates.token_ciphertext = new TextEncoder().encode(token);

    const approvedGrant = this.storage.updateGrant(requestId, updates);

    this.emit('grant:approved', approvedGrant);

    return approvedGrant;
  }

  async reject(requestId: string, reason?: string): Promise<void> {
    const grant = this.storage.getGrantById(requestId);
    if (!grant) {
      throw new Error(`Grant not found: ${requestId}`);
    }

    if (grant.status !== 'pending') {
      throw new Error(`Cannot reject grant with status: ${grant.status}`);
    }

    const revocationId = `rejected-${randomUUID()}`;
    this.storage.revokeGrant(requestId, revocationId);

    const rejectedGrant = this.storage.updateGrant(requestId, {
      status: 'revoked',
      revocation_id: revocationId,
    });

    this.emit('grant:rejected', { grant: rejectedGrant, reason });
  }

  async revoke(grantId: string): Promise<void> {
    const grant = this.storage.getGrantById(grantId);
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`);
    }

    if (grant.status !== 'active') {
      throw new Error(`Cannot revoke grant with status: ${grant.status}`);
    }

    const revocationId = randomUUID();
    this.storage.revokeGrant(grantId, revocationId);

    const revokedGrant = this.storage.getGrantById(grantId);
    if (revokedGrant) {
      this.emit('grant:revoked', revokedGrant);
    }
  }

  async validateToken(token: string): Promise<ValidationResult> {
    try {
      let biscuit: Biscuit;
      try {
        biscuit = Biscuit.fromBase64(token, this.publicKey);
      } catch {
        return { valid: false, error: 'Invalid token format or signature' };
      }

      const grantId = this.extractGrantId(biscuit);
      if (!grantId) {
        return { valid: false, error: 'Token missing grant identifier' };
      }

      const grant = this.storage.getGrantById(grantId);
      if (!grant) {
        return { valid: false, error: 'Grant not found' };
      }

      if (grant.status !== 'active') {
        return { valid: false, error: `Grant is ${grant.status}` };
      }

      if (grant.expires_at && grant.expires_at < new Date()) {
        return { valid: false, error: 'Grant has expired' };
      }

      if (grant.revoked_at) {
        return { valid: false, error: 'Grant has been revoked' };
      }

      const permissions = this.extractPermissions(biscuit);

      return {
        valid: true,
        grantId,
        permissions,
        limits: {
          dailyLimit: grant.daily_payment_limit,
          perPaymentLimit: grant.per_payment_limit,
          dailyCountLimit: grant.daily_count_limit,
          hourlyCountLimit: grant.hourly_count_limit,
          minIntervalSeconds: grant.min_interval_seconds,
          channelOpeningAllowed: grant.channel_opening_allowed,
          channelFundingLimit: grant.channel_funding_limit,
          canCloseChannels: grant.can_close_channels,
          canForceClose: grant.can_force_close,
          timeWindowStart: grant.time_window_start,
          timeWindowEnd: grant.time_window_end,
          timeWindowDays: grant.time_window_days,
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Token validation failed',
      };
    }
  }

  async getGrant(grantId: string): Promise<PermissionGrant | undefined> {
    return this.storage.getGrantById(grantId);
  }

  async listGrants(filters?: { status?: GrantStatus; appId?: string }): Promise<PermissionGrant[]> {
    return this.storage.listGrants(filters);
  }

  getLimitTracker(): LimitTracker {
    return this.limitTracker;
  }

  close(): void {
    this.storage.close();
    this.migrator.close();
    this.removeAllListeners();
  }

  private async generateBiscuitToken(
    grant: PermissionGrant,
    permissions: Permission[],
  ): Promise<string> {
    const authorityFacts: string[] = [];

    authorityFacts.push(`grant_id("${grant.id}");`);
    authorityFacts.push(`app_id("${grant.app_id}");`);
    authorityFacts.push(`node_id("${grant.node_id}");`);

    for (const perm of permissions) {
      if (perm.action === 'read') {
        authorityFacts.push(`read("${perm.resource}");`);
      } else if (perm.action === 'write') {
        authorityFacts.push(`write("${perm.resource}");`);
      }
    }

    const paymentPerms = permissions.filter(
      (p): p is PaymentPermission => p.resource === 'payments' && p.action === 'write',
    );
    for (const perm of paymentPerms) {
      if (perm.max_amount !== undefined) {
        authorityFacts.push(`max_payment_amount(${perm.max_amount});`);
      }
      if (perm.daily_limit !== undefined) {
        authorityFacts.push(`daily_payment_limit(${perm.daily_limit});`);
      }
    }

    const channelPerms = permissions.filter(
      (p): p is ChannelPermission => p.resource === 'channels' && p.action === 'write',
    );
    for (const perm of channelPerms) {
      if (perm.can_create_new) {
        authorityFacts.push(`can_create_channel(true);`);
      }
      if (perm.max_funding !== undefined) {
        authorityFacts.push(`max_channel_funding(${perm.max_funding});`);
      }
    }

    const builder = Biscuit.builder();

    for (const factStr of authorityFacts) {
      builder.addCode(factStr);
    }

    if (grant.expires_at) {
      const expiresAt = Math.floor(grant.expires_at.getTime() / 1000);
      builder.addCode(`check if time($t), $t < ${expiresAt};`);
    }

    const biscuit = builder.build(this.privateKey);
    return biscuit.toBase64();
  }

  private extractGrantId(biscuit: Biscuit): string | null {
    const code = biscuit.getBlockSource(0);
    const match = code.match(/grant_id\("([^"]+)"\)/);
    if (match) {
      return match[1];
    }
    return null;
  }

  private extractPermissions(biscuit: Biscuit): Permission[] {
    const permissions: Permission[] = [];
    const authorityCode = biscuit.getBlockSource(0);

    // Match read("resource") facts
    const readRegex = /read\("([^"]+)"\)/g;
    let readMatch: RegExpExecArray | null = readRegex.exec(authorityCode);
    while (readMatch !== null) {
      permissions.push({
        resource: readMatch[1] as PermissionResource,
        action: 'read',
      } as Permission);
      readMatch = readRegex.exec(authorityCode);
    }

    // Match write("resource") facts
    const writeRegex = /write\("([^"]+)"\)/g;
    let writeMatch: RegExpExecArray | null = writeRegex.exec(authorityCode);
    while (writeMatch !== null) {
      permissions.push({
        resource: writeMatch[1] as PermissionResource,
        action: 'write',
      } as Permission);
      writeMatch = writeRegex.exec(authorityCode);
    }

    return permissions;
  }

  private parseExpiration(expiresIn: string): Date | undefined {
    const match = expiresIn.match(/^(\d+)([dhms])$/);
    if (!match) {
      return undefined;
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];

    const now = Date.now();
    let millis: number;

    switch (unit) {
      case 'd':
        millis = amount * 24 * 60 * 60 * 1000;
        break;
      case 'h':
        millis = amount * 60 * 60 * 1000;
        break;
      case 'm':
        millis = amount * 60 * 1000;
        break;
      case 's':
        millis = amount * 1000;
        break;
      default:
        return undefined;
    }

    return new Date(now + millis);
  }
}

export default PermissionManager;
