import type { FiberRpcClient } from '@fiber-pay/sdk';
import { classifyPaymentError } from '../error-classifier.js';
import type { InvoiceJob, RetryPolicy } from '../types.js';

const DEFAULT_POLL_INTERVAL = 1_500;

export async function* runInvoiceJob(
  job: InvoiceJob,
  rpc: FiberRpcClient,
  _policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<InvoiceJob> {
  let current = { ...job };

  if (current.state === 'queued') {
    current = { ...current, state: 'executing', updatedAt: Date.now() };
    yield current;
  }

  try {
    const pollIntervalMs = current.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

    if (current.params.action === 'create') {
      if (!current.params.newInvoiceParams) {
        throw new Error('Invoice create job requires newInvoiceParams');
      }
      const created = await rpc.newInvoice(current.params.newInvoiceParams);
      const paymentHash = created.invoice.data.payment_hash;
      const createdStatus = created.invoice.is_expired ? 'Expired' : 'Open';

      current = {
        ...current,
        state: 'invoice_created',
        result: {
          paymentHash,
          invoiceAddress: created.invoice_address,
          status: createdStatus,
          invoice: created.invoice,
        },
        updatedAt: Date.now(),
      };
      yield current;

      if (!current.params.waitForTerminal) {
        current = {
          ...current,
          state: 'succeeded',
          completedAt: Date.now(),
          updatedAt: Date.now(),
        };
        yield current;
        return;
      }

      // Watch invoice until terminal
      while (true) {
        if (signal.aborted) {
          current = { ...current, state: 'cancelled', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        const invoice = await rpc.getInvoice({ payment_hash: paymentHash });
        if (invoice.status === 'Paid') {
          current = {
            ...current,
            state: 'invoice_settled',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            updatedAt: Date.now(),
          };
          yield current;

          current = {
            ...current,
            state: 'succeeded',
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          return;
        }

        if (invoice.status === 'Received') {
          current = {
            ...current,
            state: 'invoice_received',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            updatedAt: Date.now(),
          };
          yield current;
        } else if (invoice.status === 'Cancelled') {
          current = {
            ...current,
            state: 'invoice_cancelled',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          current = { ...current, state: 'failed', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        } else if (invoice.status === 'Expired') {
          current = {
            ...current,
            state: 'invoice_expired',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          current = { ...current, state: 'failed', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'watch') {
      if (!current.params.getInvoicePaymentHash) {
        throw new Error('Invoice watch job requires getInvoicePaymentHash');
      }
      while (true) {
        const invoice = await rpc.getInvoice({ payment_hash: current.params.getInvoicePaymentHash });
        current = {
          ...current,
          state:
            invoice.status === 'Paid'
              ? 'invoice_settled'
              : invoice.status === 'Received'
                ? 'invoice_received'
                : invoice.status === 'Cancelled'
                  ? 'invoice_cancelled'
                  : invoice.status === 'Expired'
                    ? 'invoice_expired'
                    : 'invoice_active',
          result: {
            paymentHash: current.params.getInvoicePaymentHash,
            invoiceAddress: invoice.invoice_address,
            status: invoice.status,
            invoice: invoice.invoice,
          },
          updatedAt: Date.now(),
        };
        yield current;

        if (invoice.status === 'Paid') {
          current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }
        if (invoice.status === 'Cancelled' || invoice.status === 'Expired') {
          current = { ...current, state: 'failed', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'cancel') {
      if (!current.params.cancelInvoiceParams) {
        throw new Error('Invoice cancel job requires cancelInvoiceParams');
      }
      const cancelled = await rpc.cancelInvoice(current.params.cancelInvoiceParams);
      current = {
        ...current,
        state: 'invoice_cancelled',
        result: {
          paymentHash: current.params.cancelInvoiceParams.payment_hash,
          invoiceAddress: cancelled.invoice_address,
          status: cancelled.status,
          invoice: cancelled.invoice,
        },
        updatedAt: Date.now(),
      };
      yield current;
      current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
      yield current;
      return;
    }

    if (current.params.action === 'settle') {
      if (!current.params.settleInvoiceParams) {
        throw new Error('Invoice settle job requires settleInvoiceParams');
      }
      await rpc.settleInvoice(current.params.settleInvoiceParams);
      current = {
        ...current,
        state: 'invoice_settled',
        result: {
          paymentHash: current.params.settleInvoiceParams.payment_hash,
          status: 'Paid',
        },
        updatedAt: Date.now(),
      };
      yield current;
      current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
      yield current;
      return;
    }

    throw new Error(`Unsupported invoice action: ${(current.params as { action?: string }).action}`);
  } catch (error) {
    const classified = classifyPaymentError(error);
    current = {
      ...current,
      state: 'failed',
      error: classified,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };
    yield current;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
