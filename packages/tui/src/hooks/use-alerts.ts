import type { Alert } from '@fiber-pay/runtime';
import { useEffect, useState } from 'react';
import type { WsAlertClient, WsConnectionState } from '../client/ws-client.js';

export interface UseAlertsResult {
  alerts: Alert[];
  connected: boolean;
  connectionState: WsConnectionState;
  latestAlert: Alert | undefined;
}

export function useAlerts(
  wsClient: WsAlertClient | undefined,
  options: { bufferSize?: number } = {},
): UseAlertsResult {
  const bufferSize = options.bufferSize ?? 200;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connectionState, setConnectionState] = useState<WsConnectionState>('disconnected');

  useEffect(() => {
    if (!wsClient) {
      setConnectionState('disconnected');
      return;
    }

    const unsubscribeAlert = wsClient.onAlert((alert) => {
      setAlerts((prev) => {
        const next = [...prev, alert];
        if (next.length <= bufferSize) {
          return next;
        }
        return next.slice(next.length - bufferSize);
      });
    });

    const unsubscribeState = wsClient.onState((state) => {
      setConnectionState(state);
    });

    wsClient.start();

    return () => {
      unsubscribeAlert();
      unsubscribeState();
      wsClient.stop();
    };
  }, [bufferSize, wsClient]);

  return {
    alerts,
    connected: connectionState === 'connected',
    connectionState,
    latestAlert: alerts.length > 0 ? alerts[alerts.length - 1] : undefined,
  };
}
