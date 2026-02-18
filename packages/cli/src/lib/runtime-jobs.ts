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
