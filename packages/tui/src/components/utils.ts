import type { AlertPriority } from '@fiber-pay/runtime';
import type { ChannelState } from '@fiber-pay/sdk';
import type { ComponentProps } from 'react';
import type { Text } from 'ink';

type InkColor = ComponentProps<typeof Text>['color'];

export function shortHex(value: string, left = 6, right = 6): string {
  if (value.length <= left + right + 3) {
    return value;
  }
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function formatTimestamp(input: number | string | undefined): string {
  if (input === undefined) {
    return '-';
  }

  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toISOString().slice(11, 19);
}

export function statusColor(status: string): InkColor {
  const normalized = status.toLowerCase();
  if (normalized.includes('success') || normalized.includes('paid') || normalized.includes('ready')) {
    return 'green';
  }
  if (normalized.includes('fail') || normalized.includes('cancel')) {
    return 'red';
  }
  if (normalized.includes('expired') || normalized.includes('shutdown')) {
    return 'yellow';
  }
  if (normalized.includes('inflight') || normalized.includes('received') || normalized.includes('executing')) {
    return 'cyan';
  }
  if (normalized.includes('closed')) {
    return 'gray';
  }
  return 'white';
}

export function channelStateColor(state: ChannelState | string): InkColor {
  switch (state) {
    case 'CHANNEL_READY':
      return 'green';
    case 'SHUTTING_DOWN':
      return 'yellow';
    case 'CLOSED':
      return 'gray';
    case 'NEGOTIATING_FUNDING':
      return 'cyan';
    default:
      return 'white';
  }
}

export function priorityColor(priority: AlertPriority): InkColor {
  switch (priority) {
    case 'critical':
      return 'red';
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'gray';
    default:
      return 'white';
  }
}
