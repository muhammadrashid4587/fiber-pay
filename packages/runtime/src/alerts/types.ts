import type { Channel, ChannelId, PaymentHash, PeerInfo } from '@fiber-pay/sdk';

export type AlertPriority = 'critical' | 'high' | 'medium' | 'low';

export type AlertType =
  | 'new_inbound_channel_request'
  | 'channel_became_ready'
  | 'channel_closing'
  | 'incoming_payment_received'
  | 'outgoing_payment_completed'
  | 'outgoing_payment_failed'
  | 'channel_balance_changed'
  | 'new_pending_tlc'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'node_offline'
  | 'node_online';

export const alertTypeValues: AlertType[] = [
  'new_inbound_channel_request',
  'channel_became_ready',
  'channel_closing',
  'incoming_payment_received',
  'outgoing_payment_completed',
  'outgoing_payment_failed',
  'channel_balance_changed',
  'new_pending_tlc',
  'peer_connected',
  'peer_disconnected',
  'node_offline',
  'node_online',
];

export const alertPriorityOrder: Record<AlertPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface AlertFilter {
  limit?: number;
  minPriority?: AlertPriority;
  type?: AlertType;
  source?: string;
}

export function isAlertPriority(value: string): value is AlertPriority {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low';
}

export function isAlertType(value: string): value is AlertType {
  return alertTypeValues.includes(value as AlertType);
}

export interface Alert<T = unknown> {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  timestamp: string;
  source: string;
  data: T;
}

export interface AlertInput<T = unknown> {
  type: AlertType;
  priority: AlertPriority;
  source: string;
  data: T;
}

export interface TrackedInvoiceState {
  paymentHash: PaymentHash;
  status: string;
  trackedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TrackedPaymentState {
  paymentHash: PaymentHash;
  status: string;
  trackedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ChannelBalanceChangedData {
  channelId: ChannelId;
  localBalanceBefore: string;
  localBalanceAfter: string;
  remoteBalanceBefore: string;
  remoteBalanceAfter: string;
  channel: Channel;
}

export interface PendingTlcChangedData {
  channelId: ChannelId;
  newPendingTlcCount: number;
  previousPendingTlcCount: number;
  channel: Channel;
}

export interface ChannelStateChangedData {
  channelId: ChannelId;
  previousState: string;
  currentState: string;
  channel: Channel;
}

export interface PeerEventData {
  peer: PeerInfo;
}

export interface RpcHealthData {
  message: string;
}

export interface AlertBackend {
  start?(): Promise<void>;
  send(alert: Alert): Promise<void>;
  stop?(): Promise<void>;
}
