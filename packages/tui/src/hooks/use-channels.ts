import type { Channel } from '@fiber-pay/sdk';
import { useCallback } from 'react';
import type { RuntimeHttpClient } from '../client/http-client.js';
import { usePolling } from './use-polling.js';

export function useChannels(client: RuntimeHttpClient, intervalMs: number): {
  channels: Channel[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const poll = useCallback(async () => client.listChannels(), [client]);
  const result = usePolling(poll, intervalMs);

  return {
    channels: result.data ?? [],
    loading: result.loading,
    refresh: result.refresh,
  };
}
