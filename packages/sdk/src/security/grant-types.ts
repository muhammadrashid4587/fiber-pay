import type { BiscuitPermission } from './biscuit-policy.js';

export interface AmountLimits {
  perPayment?: string;
  dailyTotal?: string;
  hourlyTotal?: string;
}

export interface CountLimits {
  daily?: number;
  hourly?: number;
}

export interface TimeWindow {
  start?: string;
  end?: string;
}

export interface ChannelRestrictions {
  allowedChannels?: string[];
  blockedChannels?: string[];
}

export interface RecipientRestrictions {
  allowlist?: string[];
  blocklist?: string[];
}

export interface GrantRestrictions {
  amount?: AmountLimits;
  count?: CountLimits;
  timeWindow?: TimeWindow;
  recipients?: RecipientRestrictions;
  channels?: ChannelRestrictions;
  expiresAt?: string;
}

export interface KeyPair {
  privateKey: string;
  publicKey?: string;
}

export interface PermissionGrant {
  grantId: string;
  nodeId: string;
  appId: string;
  permissions: BiscuitPermission[];
  restrictions?: GrantRestrictions;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenGeneratorOptions {
  rootKeyPair: KeyPair;
  defaultExpirySeconds?: number;
}

export interface DatalogCaveat {
  description: string;
  rule: string;
}

export interface GeneratedToken {
  token: string;
  grantId: string;
  expiresAt?: string;
}
