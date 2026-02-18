import type { ClassifiedError, RetryPolicy } from './types.js';

export const defaultPaymentRetryPolicy: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

/**
 * Decide whether a job should be retried given its error and current retry count.
 */
export function shouldRetry(
  error: ClassifiedError,
  retryCount: number,
  policy: RetryPolicy,
): boolean {
  if (!error.retryable) return false;
  if (retryCount >= policy.maxRetries) return false;
  return true;
}

/**
 * Compute the next retry delay using exponential backoff with random jitter.
 * retryCount is the number of retries already attempted (0-based before this retry).
 */
export function computeRetryDelay(retryCount: number, policy: RetryPolicy): number {
  const base = policy.baseDelayMs * policy.backoffMultiplier ** retryCount;
  const capped = Math.min(base, policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * policy.jitterMs);
  return capped + jitter;
}
