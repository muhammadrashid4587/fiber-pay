import type { Alert, AlertBackend } from '../types.js';

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_CYAN = '\x1b[36m';

function shouldUseColor(): boolean {
  return process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;
}

function colorize(text: string, color: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }
  return `${color}${text}${ANSI_RESET}`;
}

function renderAlertLine(alert: Alert): string {
  const withColor = shouldUseColor();
  const priorityLabel = alert.priority.toUpperCase().padEnd(8, ' ');

  const priorityColor =
    alert.priority === 'critical'
      ? ANSI_RED
      : alert.priority === 'high'
        ? ANSI_YELLOW
        : alert.priority === 'medium'
          ? ANSI_CYAN
          : ANSI_GREEN;

  const typeColor = alert.type.startsWith('channel_')
    ? ANSI_BLUE
    : alert.type.startsWith('payment_') || alert.type.startsWith('incoming_') || alert.type.startsWith('outgoing_')
      ? ANSI_MAGENTA
      : ANSI_CYAN;

  const prefix = colorize('[fiber-runtime]', `${ANSI_BOLD}${ANSI_CYAN}`, withColor);
  const ts = colorize(alert.timestamp, ANSI_DIM, withColor);
  const priority = colorize(priorityLabel, `${ANSI_BOLD}${priorityColor}`, withColor);
  const type = colorize(alert.type, `${ANSI_BOLD}${typeColor}`, withColor);
  const data = colorize(JSON.stringify(alert.data), ANSI_DIM, withColor);

  return `${prefix} ${ts} ${priority} ${type} ${data}`;
}

export class StdoutAlertBackend implements AlertBackend {
  async send(alert: Alert): Promise<void> {
    console.log(renderAlertLine(alert));
  }
}
