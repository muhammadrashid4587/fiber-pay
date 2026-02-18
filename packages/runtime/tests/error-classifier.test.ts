import { describe, expect, it } from 'vitest';
import { classifyPaymentError } from '../src/jobs/error-classifier.js';

describe('classifyPaymentError', () => {
  it('classifies no_route errors', () => {
    const r = classifyPaymentError(new Error('no path found'));
    expect(r.category).toBe('no_route');
    expect(r.retryable).toBe(true);
  });

  it('classifies from Fiber failed_error string (no_route)', () => {
    const r = classifyPaymentError(undefined, 'Route not found for payment');
    expect(r.category).toBe('no_route');
    expect(r.retryable).toBe(true);
  });

  it('classifies insufficient_balance', () => {
    const r = classifyPaymentError(new Error('insufficient balance'));
    expect(r.category).toBe('insufficient_balance');
    expect(r.retryable).toBe(false);
  });

  it('classifies invoice_expired', () => {
    const r = classifyPaymentError(undefined, 'Invoice expired');
    expect(r.category).toBe('invoice_expired');
    expect(r.retryable).toBe(false);
  });

  it('classifies peer_offline', () => {
    const r = classifyPaymentError(new Error('peer offline'));
    expect(r.category).toBe('peer_offline');
    expect(r.retryable).toBe(true);
  });

  it('classifies timeout', () => {
    const r = classifyPaymentError(new Error('Request timed out'));
    expect(r.category).toBe('timeout');
    expect(r.retryable).toBe(true);
  });

  it('falls back to unknown for unrecognized errors', () => {
    const r = classifyPaymentError(new Error('something completely unexpected'));
    expect(r.category).toBe('unknown');
    expect(r.retryable).toBe(false);
  });

  it('prefers failed_error string over thrown error message', () => {
    const r = classifyPaymentError(new Error('some rpc error'), 'Invoice expired');
    expect(r.category).toBe('invoice_expired');
  });

  it('handles non-Error thrown values', () => {
    const r = classifyPaymentError('timeout');
    expect(r.category).toBe('timeout');
    expect(r.retryable).toBe(true);
  });
});
