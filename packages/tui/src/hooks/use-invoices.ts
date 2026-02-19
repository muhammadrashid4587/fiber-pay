import type { TrackedInvoiceState } from '@fiber-pay/runtime';
import { useCallback } from 'react';
import type { RuntimeHttpClient } from '../client/http-client.js';
import { usePolling } from './use-polling.js';

export function useInvoices(client: RuntimeHttpClient, intervalMs: number): {
  invoices: TrackedInvoiceState[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const poll = useCallback(async () => client.listTrackedInvoices(), [client]);
  const result = usePolling(poll, intervalMs);

  return {
    invoices: result.data ?? [],
    loading: result.loading,
    refresh: result.refresh,
  };
}
