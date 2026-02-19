import type { NodeInfo } from '@fiber-pay/sdk';
import { useCallback } from 'react';
import type { RuntimeHttpClient } from '../client/http-client.js';
import { usePolling } from './use-polling.js';

interface NodePollingData {
  node: NodeInfo | undefined;
  online: boolean;
}

export interface UseNodeInfoResult {
  node: NodeInfo | undefined;
  online: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useNodeInfo(client: RuntimeHttpClient, intervalMs: number): UseNodeInfoResult {
  const poll = useCallback(async (): Promise<NodePollingData> => {
    const status = await client.getStatus().catch(() => undefined);
    if (!status?.running) {
      return {
        node: undefined,
        online: false,
      };
    }

    const node = await client.getNodeInfo().catch(() => undefined);
    if (!node) {
      return {
        node: undefined,
        online: false,
      };
    }

    return {
      node,
      online: true,
    };
  }, [client]);

  const result = usePolling(poll, intervalMs);

  return {
    node: result.data?.node,
    online: result.data?.online ?? false,
    loading: result.loading,
    refresh: result.refresh,
  };
}
