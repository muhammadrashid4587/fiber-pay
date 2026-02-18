import { randomUUID } from 'node:crypto';
import type { Store } from '../storage/types.js';
import type { Alert, AlertBackend, AlertInput } from './types.js';

export type AlertEmitListener = (alert: Alert) => void;

export class AlertManager {
  private readonly backends: AlertBackend[];
  private readonly store: Store;
  private readonly listeners: AlertEmitListener[] = [];

  constructor(options: { backends: AlertBackend[]; store: Store }) {
    this.backends = options.backends;
    this.store = options.store;
  }

  /** Register a listener that is called after every emitted alert. */
  onEmit(listener: AlertEmitListener): void {
    this.listeners.push(listener);
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

    for (const listener of this.listeners) {
      listener(alert);
    }

    return alert;
  }
}
