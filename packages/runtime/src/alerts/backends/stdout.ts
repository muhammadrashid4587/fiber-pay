import type { Alert, AlertBackend } from '../types.js';

export class StdoutAlertBackend implements AlertBackend {
  async send(alert: Alert): Promise<void> {
    const line = `[fiber-runtime] ${alert.timestamp} ${alert.priority.toUpperCase()} ${alert.type} ${JSON.stringify(alert.data)}`;
    console.log(line);
  }
}
