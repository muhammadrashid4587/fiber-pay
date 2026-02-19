import type { TrackedPaymentState } from '@fiber-pay/runtime';
import { useCallback } from 'react';
import type { RuntimeHttpClient } from '../client/http-client.js';
import { usePolling } from './use-polling.js';

export function usePayments(client: RuntimeHttpClient, intervalMs: number): {
  payments: TrackedPaymentState[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const poll = useCallback(async () => client.listTrackedPayments(), [client]);
  const result = usePolling(poll, intervalMs);

  return {
    payments: result.data ?? [],
    loading: result.loading,
    refresh: result.refresh,
  };
}
