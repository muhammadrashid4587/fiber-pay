import { describe, expect, it } from 'vitest';
import {
  computeRetryDelay,
  defaultPaymentRetryPolicy,
  shouldRetry,
} from '../src/jobs/retry-policy.js';
import type { ClassifiedError } from '../src/jobs/types.js';

const retryable: ClassifiedError = {
  category: 'no_route',
  retryable: true,
  message: 'no route',
};

const permanent: ClassifiedError = {
  category: 'invoice_expired',
  retryable: false,
  message: 'expired',
};

describe('shouldRetry', () => {
  it('returns true for retryable error within retry limit', () => {
    expect(shouldRetry(retryable, 0, defaultPaymentRetryPolicy)).toBe(true);
    expect(shouldRetry(retryable, 2, defaultPaymentRetryPolicy)).toBe(true);
  });

  it('returns false when retry count equals maxRetries', () => {
    expect(shouldRetry(retryable, 3, defaultPaymentRetryPolicy)).toBe(false);
  });

  it('returns false for permanent errors regardless of count', () => {
    expect(shouldRetry(permanent, 0, defaultPaymentRetryPolicy)).toBe(false);
  });
});

describe('computeRetryDelay', () => {
  it('returns delay within expected range for retry 0', () => {
    const { baseDelayMs, jitterMs } = defaultPaymentRetryPolicy;
    const delay = computeRetryDelay(0, defaultPaymentRetryPolicy);
    expect(delay).toBeGreaterThanOrEqual(baseDelayMs);
    expect(delay).toBeLessThanOrEqual(baseDelayMs + jitterMs);
  });

  it('returns delay within expected range for retry 1 (2x base)', () => {
    const { baseDelayMs, backoffMultiplier, jitterMs } = defaultPaymentRetryPolicy;
    const delay = computeRetryDelay(1, defaultPaymentRetryPolicy);
    const expected = baseDelayMs * backoffMultiplier;
    expect(delay).toBeGreaterThanOrEqual(expected);
    expect(delay).toBeLessThanOrEqual(expected + jitterMs);
  });

  it('caps at maxDelayMs', () => {
    const { maxDelayMs, jitterMs } = defaultPaymentRetryPolicy;
    const delay = computeRetryDelay(100, defaultPaymentRetryPolicy);
    expect(delay).toBeLessThanOrEqual(maxDelayMs + jitterMs);
  });
});
