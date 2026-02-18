import type {
  AbandonChannelParams,
  AcceptChannelParams,
  AcceptChannelResult,
  CancelInvoiceParams,
  GetInvoiceResult,
  NewInvoiceParams,
  OpenChannelParams,
  OpenChannelResult,
  SendPaymentParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  UpdateChannelParams,
} from '@fiber-pay/sdk';

// ─── Shared Job ──────────────────────────────────────────────────────────────

export type JobType = 'payment' | 'invoice' | 'channel';

export type JobState =
  // Shared lifecycle
  | 'queued'
  | 'executing'
  | 'inflight' // payment only
  | 'waiting_retry'
  // Invoice-specific lifecycle
  | 'invoice_created'
  | 'invoice_active'
  | 'invoice_received'
  | 'invoice_settled'
  | 'invoice_expired'
  | 'invoice_cancelled'
  // Channel-specific lifecycle
  | 'channel_opening'
  | 'channel_accepting'
  | 'channel_abandoning'
  | 'channel_updating'
  | 'channel_awaiting_ready'
  | 'channel_ready'
  | 'channel_closing'
  | 'channel_closed'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export const TERMINAL_JOB_STATES = new Set<JobState>(['succeeded', 'failed', 'cancelled']);

export interface Job<TParams = unknown, TResult = unknown, TType extends JobType = JobType> {
  id: string;
  type: TType;
  state: JobState;
  params: TParams;
  result?: TResult;
  error?: ClassifiedError;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: number;
  /** For deduplication — derived from invoice payment_hash or caller-supplied */
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ─── Job Events ───────────────────────────────────────────────────────────────

export type JobEventType =
  | 'created'
  | 'executing'
  | 'inflight'
  | 'invoice_created'
  | 'invoice_received'
  | 'invoice_settled'
  | 'invoice_expired'
  | 'invoice_cancelled'
  | 'channel_opening'
  | 'channel_accepting'
  | 'channel_abandoning'
  | 'channel_updating'
  | 'channel_ready'
  | 'channel_closed'
  | 'retry_scheduled'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
  id: string;
  jobId: string;
  eventType: JobEventType;
  fromState?: JobState;
  toState?: JobState;
  data?: Record<string, unknown>;
  createdAt: number;
}

// ─── Payment Job ─────────────────────────────────────────────────────────────

export interface PaymentJobParams {
  /** Raw invoice string (if paying by invoice) */
  invoice?: string;
  /** SDK send_payment params — merged from invoice or supplied directly */
  sendPaymentParams: SendPaymentParams;
}

export interface PaymentJobResult {
  paymentHash: string;
  /** Final Fiber payment status: Success | Failed */
  status: string;
  /** Fee in shannon (hex string from Fiber) */
  fee: string;
  failedError?: string;
}

export type PaymentJob = Job<PaymentJobParams, PaymentJobResult, 'payment'>;

// ─── Invoice Job ─────────────────────────────────────────────────────────────

export type InvoiceJobAction = 'create' | 'watch' | 'cancel' | 'settle';

export interface InvoiceJobParams {
  action: InvoiceJobAction;
  newInvoiceParams?: NewInvoiceParams;
  getInvoicePaymentHash?: `0x${string}`;
  cancelInvoiceParams?: CancelInvoiceParams;
  settleInvoiceParams?: SettleInvoiceParams;
  /** Wait for lifecycle transitions to complete before succeeding */
  waitForTerminal?: boolean;
  /** Poll interval while waiting for invoice state changes */
  pollIntervalMs?: number;
}

export interface InvoiceJobResult {
  paymentHash?: `0x${string}`;
  invoiceAddress?: string;
  status?: GetInvoiceResult['status'];
  invoice?: GetInvoiceResult['invoice'];
}

export type InvoiceJob = Job<InvoiceJobParams, InvoiceJobResult, 'invoice'>;

// ─── Channel Job ─────────────────────────────────────────────────────────────

export type ChannelJobAction = 'open' | 'shutdown' | 'accept' | 'abandon' | 'update';

export interface ChannelJobParams {
  action: ChannelJobAction;
  openChannelParams?: OpenChannelParams;
  shutdownChannelParams?: ShutdownChannelParams;
  acceptChannelParams?: AcceptChannelParams;
  abandonChannelParams?: AbandonChannelParams;
  updateChannelParams?: UpdateChannelParams;
  /** Optional peer filter for locating channel after open */
  peerId?: string;
  /** Optional channel id to wait for */
  channelId?: `0x${string}`;
  waitForReady?: boolean;
  waitForClosed?: boolean;
  pollIntervalMs?: number;
}

export interface ChannelJobResult {
  temporaryChannelId?: OpenChannelResult['temporary_channel_id'];
  acceptedChannelId?: AcceptChannelResult['channel_id'];
  channelId?: `0x${string}`;
  state?: string;
}

export type ChannelJob = Job<ChannelJobParams, ChannelJobResult, 'channel'>;

export type RuntimeJob = PaymentJob | InvoiceJob | ChannelJob;

// ─── Error Classification ─────────────────────────────────────────────────────

export type ErrorCategory =
  | 'no_route'
  | 'insufficient_balance'
  | 'invoice_expired'
  | 'invoice_cancelled'
  | 'peer_offline'
  | 'timeout'
  | 'temporary_failure'
  | 'amount_too_large'
  | 'invalid_payment'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
  rawError?: string;
}

// ─── Retry Policy ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
}

// ─── Job Filters ──────────────────────────────────────────────────────────────

export interface JobFilter {
  type?: JobType;
  state?: JobState | JobState[];
  limit?: number;
  offset?: number;
}
