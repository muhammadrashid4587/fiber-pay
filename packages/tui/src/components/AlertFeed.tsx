import type { Alert } from '@fiber-pay/runtime';
import { Box, Text } from 'ink';
import { formatTime, priorityColor } from './utils.js';

interface AlertFeedProps {
  alerts: Alert[];
  connected: boolean;
  connectionState: string;
  mode: 'websocket' | 'polling' | 'disabled';
  scrollOffset: number;
  maxRows: number;
}

function summarizeAlert(alert: Alert): string {
  if (!alert.data || typeof alert.data !== 'object') {
    return '-';
  }

  const data = alert.data as Record<string, unknown>;
  const summary =
    (typeof data.message === 'string' && data.message) ||
    (typeof data.status === 'string' && data.status) ||
    (typeof data.channelId === 'string' && data.channelId) ||
    (typeof data.paymentHash === 'string' && data.paymentHash) ||
    (typeof data.jobId === 'string' && data.jobId) ||
    '';

  return summary ? summary.slice(0, 64) : '-';
}

export function AlertFeed({
  alerts,
  connected,
  connectionState,
  mode,
  scrollOffset,
  maxRows,
}: AlertFeedProps): JSX.Element {
  if (mode === 'disabled') {
    return <Text color="gray">Alerts disabled (`--no-alerts`)</Text>;
  }

  const headerLabel =
    mode === 'websocket' ? `WS: ${connectionState}` : 'HTTP alerts: polling /monitor/list_alerts';
  const headerColor = mode === 'websocket' ? (connected ? 'green' : 'yellow') : 'cyan';

  if (alerts.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={headerColor}>{headerLabel}</Text>
        <Text color="gray">Waiting for alerts...</Text>
      </Box>
    );
  }

  const start = Math.max(0, alerts.length - maxRows - scrollOffset);
  const end = alerts.length - scrollOffset;
  const visible = alerts.slice(start, end);

  return (
    <Box flexDirection="column">
      <Text color={headerColor}>{headerLabel}</Text>
      {visible.map((alert) => (
        <Text key={alert.id} color={priorityColor(alert.priority)} bold={alert.priority === 'critical'}>
          [{formatTime(alert.timestamp)}] [{alert.priority.toUpperCase()}] {alert.type}: {summarizeAlert(alert)}
        </Text>
      ))}
    </Box>
  );
}
