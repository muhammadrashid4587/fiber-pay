import { describe, expect, it } from 'vitest';
import { runInvoiceJob } from '../src/jobs/executors/invoice-executor.js';
import { defaultPaymentRetryPolicy } from '../src/jobs/retry-policy.js';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import type { InvoiceJob } from '../src/jobs/types.js';

function baseJob(overrides: Partial<InvoiceJob> = {}): InvoiceJob {
  return {
    id: 'inv-job-1',
    type: 'invoice',
    state: 'queued',
    params: {
      action: 'create',
      newInvoiceParams: { amount: '0x64', currency: 'fibt' },
      waitForTerminal: false,
    },
    retryCount: 0,
    maxRetries: 0,
    idempotencyKey: 'inv-key-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('runInvoiceJob', () => {
  it('creates invoice and succeeds when not waiting terminal', async () => {
    const rpc = {
      newInvoice: async () => ({
        invoice_address: 'ckt1',
        invoice: {
          currency: 'fibt',
          amount: '0x64',
          signature: '0x0',
          data: {
            timestamp: '0x1',
            payment_hash: '0xinv123',
            expiry_time: '0x3c',
            final_htlc_timeout: '0x9',
          },
          hrp: 'fibt',
          hash_algorithm: 'sha256',
          attrs: [],
          is_expired: false,
          payee_pub_key: null,
          description: null,
          fallback_address: null,
          expiry: null,
        },
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runInvoiceJob(baseJob(), rpc, defaultPaymentRetryPolicy, new AbortController().signal)) {
      states.push(updated.state);
    }

    expect(states).toContain('invoice_created');
    expect(states[states.length - 1]).toBe('succeeded');
  });
});
