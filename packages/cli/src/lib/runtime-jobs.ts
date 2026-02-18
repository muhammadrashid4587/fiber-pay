import { sleep } from './async.js';

export type RuntimeJobRecord = {
  id: string;
  type?: string;
  state: string;
  idempotencyKey?: string;
  retryCount?: number;
  maxRetries?: number;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  result?:
    | {
        paymentHash?: string;
        fee?: string;
        failedError?: string;
      }
    | Record<string, unknown>;
  error?: { message?: string };
};

export type RuntimeJobEventRecord = {
  id: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  createdAt: number;
  data?: unknown;
};

export type RuntimePaymentJobRequest = {
  params: {
    invoice?: string;
    sendPaymentParams: Record<string, unknown>;
  };
  options?: {
    idempotencyKey?: string;
    maxRetries?: number;
  };
};

export type RuntimeChannelJobRequest = {
  params: {
    action: 'open' | 'shutdown' | 'accept' | 'abandon' | 'update';
    openChannelParams?: Record<string, unknown>;
    shutdownChannelParams?: Record<string, unknown>;
    acceptChannelParams?: Record<string, unknown>;
    abandonChannelParams?: Record<string, unknown>;
    updateChannelParams?: Record<string, unknown>;
    peerId?: string;
    channelId?: string;
    waitForReady?: boolean;
    waitForClosed?: boolean;
    pollIntervalMs?: number;
  };
  options?: {
    idempotencyKey?: string;
    maxRetries?: number;
  };
};

export type RuntimeInvoiceJobRequest = {
  params: {
    action: 'create' | 'watch' | 'cancel' | 'settle';
    newInvoiceParams?: Record<string, unknown>;
    getInvoicePaymentHash?: string;
    cancelInvoiceParams?: Record<string, unknown>;
    settleInvoiceParams?: Record<string, unknown>;
    waitForTerminal?: boolean;
    pollIntervalMs?: number;
  };
  options?: {
    idempotencyKey?: string;
    maxRetries?: number;
  };
};

export async function tryCreateRuntimePaymentJob(
  runtimeUrl: string,
  body: RuntimePaymentJobRequest,
): Promise<RuntimeJobRecord | null> {
  try {
    const response = await fetch(`${runtimeUrl}/jobs/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeJobRecord;
  } catch {
    return null;
  }
}

export async function tryCreateRuntimeChannelJob(
  runtimeUrl: string,
  body: RuntimeChannelJobRequest,
): Promise<RuntimeJobRecord | null> {
  try {
    const response = await fetch(`${runtimeUrl}/jobs/channel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeJobRecord;
  } catch {
    return null;
  }
}

export async function tryCreateRuntimeInvoiceJob(
  runtimeUrl: string,
  body: RuntimeInvoiceJobRequest,
): Promise<RuntimeJobRecord | null> {
  try {
    const response = await fetch(`${runtimeUrl}/jobs/invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeJobRecord;
  } catch {
    return null;
  }
}

export async function waitForRuntimeJobTerminal(
  runtimeUrl: string,
  jobId: string,
  timeoutSeconds: number,
): Promise<RuntimeJobRecord> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutSeconds * 1000) {
    const response = await fetch(`${runtimeUrl}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch runtime job ${jobId}: ${response.status}`);
    }
    const job = (await response.json()) as RuntimeJobRecord;
    if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled') {
      return job;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for runtime job ${jobId}`);
}
