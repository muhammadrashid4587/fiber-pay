import type { CkbInvoiceStatus, FiberRpcClient } from '@fiber-pay/sdk';
import type { AlertManager } from '../alerts/alert-manager.js';
import type { Store } from '../storage/types.js';
import { BaseMonitor, type BaseMonitorHooks } from './base-monitor.js';

export interface InvoiceTrackerConfig {
  intervalMs: number;
  completedItemTtlSeconds: number;
}

export class InvoiceTracker extends BaseMonitor {
  protected get name(): string {
    return 'invoice-tracker';
  }

  private readonly client: FiberRpcClient;
  private readonly store: Store;
  private readonly alerts: AlertManager;
  private readonly config: InvoiceTrackerConfig;

  constructor(options: {
    client: FiberRpcClient;
    store: Store;
    alerts: AlertManager;
    config: InvoiceTrackerConfig;
    hooks?: BaseMonitorHooks;
  }) {
    super(options.config.intervalMs, options.hooks);
    this.client = options.client;
    this.store = options.store;
    this.alerts = options.alerts;
    this.config = options.config;
  }

  protected async poll(): Promise<void> {
    const tracked = this.store.listTrackedInvoices();

    for (const invoice of tracked) {
      try {
        const next = await this.client.getInvoice({ payment_hash: invoice.paymentHash });
        const previousStatus = invoice.status;
        const currentStatus = next.status;

        if (currentStatus !== previousStatus) {
          this.store.updateTrackedInvoice(invoice.paymentHash, currentStatus);

          if (currentStatus === 'Received' || currentStatus === 'Paid') {
            await this.alerts.emit({
              type: 'incoming_payment_received',
              priority: 'high',
              source: this.name,
              data: {
                paymentHash: invoice.paymentHash,
                previousStatus,
                currentStatus,
                invoice: next,
              },
            });
          }
        }
      } catch {
        // invoice may not exist yet or node may be temporarily unavailable
      }
    }

    this.store.pruneCompleted(this.config.completedItemTtlSeconds * 1000);
  }
}

export function isTerminalInvoiceStatus(status: CkbInvoiceStatus): boolean {
  return status === 'Cancelled' || status === 'Expired' || status === 'Paid';
}
