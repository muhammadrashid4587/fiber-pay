import { FiberRpcClient } from '@fiber-pay/sdk';
import type { AlertManager } from '../alerts/alert-manager.js';
import { BaseMonitor, type BaseMonitorHooks } from './base-monitor.js';

export interface HealthMonitorConfig {
  intervalMs: number;
}

export class HealthMonitor extends BaseMonitor {
  protected get name(): string {
    return 'health-monitor';
  }

  private readonly client: FiberRpcClient;
  private readonly alerts: AlertManager;
  private isOffline = false;

  constructor(options: {
    client: FiberRpcClient;
    alerts: AlertManager;
    config: HealthMonitorConfig;
    hooks?: BaseMonitorHooks;
  }) {
    super(options.config.intervalMs, options.hooks);
    this.client = options.client;
    this.alerts = options.alerts;
  }

  protected async poll(): Promise<void> {
    const isHealthy = await this.client.ping();

    if (isHealthy && this.isOffline) {
      this.isOffline = false;
      await this.alerts.emit({
        type: 'node_online',
        priority: 'low',
        source: this.name,
        data: { message: 'Fiber node RPC recovered' },
      });
      return;
    }

    if (!isHealthy && !this.isOffline) {
      this.isOffline = true;
      await this.alerts.emit({
        type: 'node_offline',
        priority: 'critical',
        source: this.name,
        data: { message: 'Fiber node ping returned false' },
      });
    }
  }
}
