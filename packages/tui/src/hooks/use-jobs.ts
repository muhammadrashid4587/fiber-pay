import type { RuntimeJob } from '@fiber-pay/runtime';
import { useCallback } from 'react';
import type { RuntimeHttpClient } from '../client/http-client.js';
import { usePolling } from './use-polling.js';

export function useJobs(client: RuntimeHttpClient, intervalMs: number): {
  jobs: RuntimeJob[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const poll = useCallback(async () => client.listJobs({ limit: 100 }), [client]);
  const result = usePolling(poll, intervalMs);

  return {
    jobs: result.data ?? [],
    loading: result.loading,
    refresh: result.refresh,
  };
}
