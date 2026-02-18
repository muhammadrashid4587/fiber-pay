import type { FiberRpcClient } from '@fiber-pay/sdk';
import { classifyPaymentError } from '../error-classifier.js';
import { computeRetryDelay, shouldRetry } from '../retry-policy.js';
import { paymentStateMachine } from '../state-machine.js';
import type { PaymentJob, RetryPolicy } from '../types.js';

// ─── PaymentExecutor ──────────────────────────────────────────────────────────

/**
 * Drives a single PaymentJob through its full lifecycle.
 *
 * Yields the updated job object on every state transition so the caller
 * (JobManager) can persist + emit events after each change with no extra lookups.
 *
 * The generator terminates when the job reaches a terminal state
 * (succeeded | failed | cancelled).
 */
export async function* runPaymentJob(
  job: PaymentJob,
  rpc: FiberRpcClient,
  policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<PaymentJob> {
  let current = { ...job };

  while (!paymentStateMachine.isTerminal(current.state)) {
    if (signal.aborted) {
      current = transition(current, 'cancelled', undefined, new Date().getTime());
      yield current;
      return;
    }

    if (current.state === 'queued') {
      current = { ...current, state: 'executing', updatedAt: Date.now() };
      yield current;
      continue;
    }

    if (current.state === 'waiting_retry') {
      const delay = current.nextRetryAt
        ? Math.max(0, current.nextRetryAt - Date.now())
        : 0;
      if (delay > 0) {
        await sleep(delay, signal);
        if (signal.aborted) {
          current = transition(current, 'cancelled', undefined, Date.now());
          yield current;
          return;
        }
      }
      current = { ...current, state: 'executing', nextRetryAt: undefined, updatedAt: Date.now() };
      yield current;
      continue;
    }

    if (current.state === 'executing') {
      // ── Issue the RPC call ──────────────────────────────────────────────────
      let paymentHash: string | undefined;

      try {
        const sendResult = await rpc.sendPayment(current.params.sendPaymentParams);
        paymentHash = sendResult.payment_hash;

        if (sendResult.status === 'Success') {
          current = {
            ...current,
            state: 'succeeded',
            result: {
              paymentHash: sendResult.payment_hash,
              status: sendResult.status,
              fee: sendResult.fee,
              failedError: sendResult.failed_error,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          return;
        }

        if (sendResult.status === 'Failed') {
          const classified = classifyPaymentError(
            new Error(sendResult.failed_error ?? 'Payment failed'),
            sendResult.failed_error,
          );
          if (shouldRetry(classified, current.retryCount, policy)) {
            const delay = computeRetryDelay(current.retryCount, policy);
            current = {
              ...current,
              state: 'waiting_retry',
              error: classified,
              retryCount: current.retryCount + 1,
              nextRetryAt: Date.now() + delay,
              updatedAt: Date.now(),
            };
            yield current;
          } else {
            current = {
              ...current,
              state: 'failed',
              error: classified,
              result: {
                paymentHash: sendResult.payment_hash,
                status: sendResult.status,
                fee: sendResult.fee,
                failedError: sendResult.failed_error,
              },
              completedAt: Date.now(),
              updatedAt: Date.now(),
            };
            yield current;
          }
          continue;
        }

        // Status is 'Created' or 'Inflight' — move to polling state
        current = { ...current, state: 'inflight', updatedAt: Date.now() };
        if (paymentHash) {
          current = { ...current, params: { ...current.params, sendPaymentParams: { ...current.params.sendPaymentParams, payment_hash: paymentHash as `0x${string}` } } };
        }
        yield current;
        continue;
      } catch (err) {
        // RPC call itself threw — classify and decide
        const classified = classifyPaymentError(err);
        if (shouldRetry(classified, current.retryCount, policy)) {
          const delay = computeRetryDelay(current.retryCount, policy);
          current = {
            ...current,
            state: 'waiting_retry',
            error: classified,
            retryCount: current.retryCount + 1,
            nextRetryAt: Date.now() + delay,
            updatedAt: Date.now(),
          };
          yield current;
        } else {
          current = {
            ...current,
            state: 'failed',
            error: classified,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
        }
        continue;
      }
    }

    if (current.state === 'inflight') {
      // ── Poll get_payment until terminal ────────────────────────────────────
      const hash =
        current.params.sendPaymentParams.payment_hash as string | undefined;

      if (!hash) {
        // Shouldn't happen, but fail-safe
        current = {
          ...current,
          state: 'failed',
          error: { category: 'unknown', retryable: false, message: 'No payment_hash in inflight job' },
          completedAt: Date.now(),
          updatedAt: Date.now(),
        };
        yield current;
        continue;
      }

      try {
        const pollResult = await rpc.getPayment({ payment_hash: hash as `0x${string}` });

        if (pollResult.status === 'Success') {
          current = {
            ...current,
            state: 'succeeded',
            result: {
              paymentHash: pollResult.payment_hash,
              status: pollResult.status,
              fee: pollResult.fee,
              failedError: pollResult.failed_error,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          return;
        }

        if (pollResult.status === 'Failed') {
          const classified = classifyPaymentError(
            new Error(pollResult.failed_error ?? 'Payment failed'),
            pollResult.failed_error,
          );
          if (shouldRetry(classified, current.retryCount, policy)) {
            const delay = computeRetryDelay(current.retryCount, policy);
            current = {
              ...current,
              state: 'waiting_retry',
              error: classified,
              retryCount: current.retryCount + 1,
              nextRetryAt: Date.now() + delay,
              updatedAt: Date.now(),
            };
            yield current;
          } else {
            current = {
              ...current,
              state: 'failed',
              error: classified,
              result: {
                paymentHash: pollResult.payment_hash,
                status: pollResult.status,
                fee: pollResult.fee,
                failedError: pollResult.failed_error,
              },
              completedAt: Date.now(),
              updatedAt: Date.now(),
            };
            yield current;
          }
          continue;
        }

        // Still in-flight — wait and poll again
        await sleep(POLL_INTERVAL_MS, signal);
        if (signal.aborted) {
          current = transition(current, 'cancelled', undefined, Date.now());
          yield current;
          return;
        }
        // Stay in 'inflight', loop continues
        current = { ...current, updatedAt: Date.now() };
        continue;
      } catch (err) {
        // Transient RPC error while polling — back off briefly and retry
        const classified = classifyPaymentError(err);
        if (shouldRetry(classified, current.retryCount, policy)) {
          const delay = computeRetryDelay(current.retryCount, policy);
          current = {
            ...current,
            state: 'waiting_retry',
            error: classified,
            retryCount: current.retryCount + 1,
            nextRetryAt: Date.now() + delay,
            updatedAt: Date.now(),
          };
          yield current;
        } else {
          current = {
            ...current,
            state: 'failed',
            error: classified,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
        }
        continue;
      }
    }

    // Unknown state — should not happen if state machine is correct
    break;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_500;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function transition(
  job: PaymentJob,
  state: PaymentJob['state'],
  result?: PaymentJob['result'],
  now = Date.now(),
): PaymentJob {
  return {
    ...job,
    state,
    result: result ?? job.result,
    updatedAt: now,
    completedAt: paymentStateMachine.isTerminal(state) ? now : job.completedAt,
  };
}
