import { randomUUID } from 'node:crypto';
import type { Store } from '../storage/types.js';
import type { Alert, AlertBackend, AlertInput } from './types.js';

export class AlertManager {
  private readonly backends: AlertBackend[];
  private readonly store: Store;

  constructor(options: { backends: AlertBackend[]; store: Store }) {
    this.backends = options.backends;
    this.store = options.store;
  }

  async start(): Promise<void> {
    for (const backend of this.backends) {
      if (backend.start) {
        await backend.start();
      }
    }
  }

  async stop(): Promise<void> {
    for (const backend of this.backends) {
      if (backend.stop) {
        await backend.stop();
      }
    }
  }

  async emit(input: AlertInput): Promise<Alert> {
    const alert: Alert = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: input.type,
      priority: input.priority,
      source: input.source,
      data: input.data,
    };

    this.store.addAlert(alert);

    await Promise.allSettled(this.backends.map((backend) => backend.send(alert)));

    return alert;
  }
}
