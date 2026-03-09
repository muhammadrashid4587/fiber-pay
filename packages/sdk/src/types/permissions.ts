/**
 * Permission request types
 * These are copied from @fiber-pay/runtime to avoid circular dependencies
 */

import { z } from 'zod';

export type PermissionAction = 'read' | 'write';

export type PermissionResource = 'payments' | 'channels' | 'peers' | 'invoices' | 'node';

export const PermissionActionSchema = z.enum(['read', 'write']);

export const PermissionResourceSchema = z.enum([
  'payments',
  'channels',
  'peers',
  'invoices',
  'node',
]);

export interface AppInfo {
  /** Unique app identifier (e.g., "com.example.app") */
  id: string;
  /** Human-readable app name */
  name: string;
  /** Optional icon URL */
  icon?: string;
  /** Optional callback URL for notifications */
  callback_url?: string;
}

export const AppInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  callback_url: z.string().optional(),
});

export interface PaymentPermission {
  resource: 'payments';
  action: 'write';
  /** Maximum amount allowed per payment (in shannons) */
  max_amount?: bigint;
  /** Daily cumulative payment limit (in shannons) */
  daily_limit?: bigint;
  /** Maximum number of payments per day */
  daily_count_limit?: number;
  /** Maximum number of payments per hour */
  hourly_count_limit?: number;
  /** Minimum seconds between payments */
  min_interval_seconds?: number;
  /** List of allowed recipient addresses */
  allowed_recipients?: string[];
}

export const PaymentPermissionSchema = z.object({
  resource: z.literal('payments'),
  action: z.literal('write'),
  max_amount: z.bigint().optional(),
  daily_limit: z.bigint().optional(),
  daily_count_limit: z.number().optional(),
  hourly_count_limit: z.number().optional(),
  min_interval_seconds: z.number().optional(),
  allowed_recipients: z.array(z.string()).optional(),
});

export interface ChannelPermission {
  resource: 'channels';
  action: 'write';
  /** Whether the app can create new channels */
  can_create_new?: boolean;
  /** Maximum funding amount for new channels (in shannons) */
  max_funding?: bigint;
  /** List of allowed channel IDs */
  allowed_channels?: string[];
  /** Whether the app can close channels */
  can_close?: boolean;
  /** Whether the app can force-close channels */
  can_force_close?: boolean;
}

export const ChannelPermissionSchema = z.object({
  resource: z.literal('channels'),
  action: z.literal('write'),
  can_create_new: z.boolean().optional(),
  max_funding: z.bigint().optional(),
  allowed_channels: z.array(z.string()).optional(),
  can_close: z.boolean().optional(),
  can_force_close: z.boolean().optional(),
});

export interface ReadOnlyPermission {
  resource: PermissionResource;
  action: 'read';
}

export const ReadOnlyPermissionSchema = z.object({
  resource: PermissionResourceSchema,
  action: z.literal('read'),
});

/** Discriminated union of all permission types */
export type Permission = PaymentPermission | ChannelPermission | ReadOnlyPermission;

export const PermissionSchema = z.union([
  PaymentPermissionSchema,
  ChannelPermissionSchema,
  ReadOnlyPermissionSchema,
]);

export interface PermissionRequest {
  /** Version of the permission request protocol */
  version: string;
  /** App information */
  app: AppInfo;
  /** Requested permissions */
  permissions: Permission[];
  /** Expiration duration in ISO 8601 format (e.g., "7d") */
  expires_in: string;
  /** Unique nonce for replay protection */
  nonce: string;
  /** Optional signature for verification */
  signature?: string;
}

export const PermissionRequestSchema = z.object({
  version: z.string(),
  app: AppInfoSchema,
  permissions: z.array(PermissionSchema),
  expires_in: z.string(),
  nonce: z.string(),
  signature: z.string().optional(),
});
