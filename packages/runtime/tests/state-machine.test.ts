import { describe, expect, it } from 'vitest';
import { JobStateMachine, paymentStateMachine } from '../src/jobs/state-machine.js';
import type { JobState } from '../src/jobs/types.js';

describe('JobStateMachine', () => {
  it('allows valid transitions', () => {
    expect(paymentStateMachine.transition('queued', 'send_issued')).toBe('executing');
    expect(paymentStateMachine.transition('executing', 'payment_inflight')).toBe('inflight');
    expect(paymentStateMachine.transition('executing', 'payment_success')).toBe('succeeded');
    expect(paymentStateMachine.transition('inflight', 'payment_success')).toBe('succeeded');
    expect(paymentStateMachine.transition('executing', 'payment_failed_retryable')).toBe('waiting_retry');
    expect(paymentStateMachine.transition('inflight', 'payment_failed_permanent')).toBe('failed');
    expect(paymentStateMachine.transition('waiting_retry', 'retry_delay_elapsed')).toBe('executing');
  });

  it('returns null for invalid transitions', () => {
    expect(paymentStateMachine.transition('succeeded', 'send_issued')).toBeNull();
    expect(paymentStateMachine.transition('failed', 'retry_delay_elapsed')).toBeNull();
    expect(paymentStateMachine.transition('queued', 'payment_success')).toBeNull();
  });

  it('identifies terminal states correctly', () => {
    const terminal: JobState[] = ['succeeded', 'failed', 'cancelled'];
    for (const s of terminal) {
      expect(paymentStateMachine.isTerminal(s)).toBe(true);
    }
    const nonTerminal: JobState[] = ['queued', 'executing', 'inflight', 'waiting_retry'];
    for (const s of nonTerminal) {
      expect(paymentStateMachine.isTerminal(s)).toBe(false);
    }
  });

  it('allows cancel from any active state', () => {
    const active: JobState[] = ['queued', 'executing', 'inflight', 'waiting_retry'];
    for (const s of active) {
      expect(paymentStateMachine.transition(s, 'cancel')).toBe('cancelled');
    }
  });

  it('does not allow cancel from terminal states', () => {
    const terminal: JobState[] = ['succeeded', 'failed', 'cancelled'];
    for (const s of terminal) {
      expect(paymentStateMachine.transition(s, 'cancel')).toBeNull();
    }
  });
});
