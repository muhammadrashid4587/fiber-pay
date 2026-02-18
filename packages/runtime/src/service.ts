import { EventEmitter } from 'node:events';
import { FiberRpcClient } from '@fiber-pay/sdk';
import { AlertManager } from './alerts/alert-manager.js';
import { StdoutAlertBackend } from './alerts/backends/stdout.js';
import { WebhookAlertBackend } from './alerts/backends/webhook.js';
import { WebsocketAlertBackend } from './alerts/backends/websocket.js';
import type { Alert, AlertBackend, AlertFilter } from './alerts/types.js';
import { createRuntimeConfig, type RuntimeConfig, type RuntimeConfigInput } from './config.js';
import { ChannelMonitor } from './monitors/channel-monitor.js';
import { HealthMonitor } from './monitors/health-monitor.js';
import { InvoiceTracker } from './monitors/invoice-tracker.js';
import { BaseMonitor } from './monitors/base-monitor.js';
import { PaymentTracker } from './monitors/payment-tracker.js';
import { PeerMonitor } from './monitors/peer-monitor.js';
import { RpcMonitorProxy } from './proxy/rpc-proxy.js';
import { MemoryStore } from './storage/memory-store.js';

export class FiberMonitorService extends EventEmitter {
  private readonly config: RuntimeConfig;
  private readonly startedAt: string;
  private readonly client: FiberRpcClient;
  private readonly store: MemoryStore;
  private readonly alerts: AlertManager;
  private readonly monitors: BaseMonitor[];
  private readonly proxy: RpcMonitorProxy;
  private running = false;
  private offline = false;

  constructor(configInput: RuntimeConfigInput = {}) {
    super();
    this.config = createRuntimeConfig(configInput);
    this.startedAt = new Date().toISOString();

    this.client = new FiberRpcClient({
      url: this.config.fiberRpcUrl,
      timeout: this.config.requestTimeoutMs,
    });

    this.store = new MemoryStore({
      stateFilePath: this.config.storage.stateFilePath,
      flushIntervalMs: this.config.storage.flushIntervalMs,
      maxAlertHistory: this.config.storage.maxAlertHistory,
    });

    this.alerts = new AlertManager({
      backends: this.createAlertBackends(this.config),
      store: this.store,
    });

    const hooks = {
      onCycleError: async (error: unknown, monitorName: string) => {
        await this.handleRpcFailure(error, monitorName);
      },
      onCycleSuccess: async () => {
        if (this.offline) {
          this.offline = false;
          const alert = await this.alerts.emit({
            type: 'node_online',
            priority: 'low',
            source: 'service',
            data: { message: 'RPC calls recovered after previous failure' },
          });
          this.emit('alert', alert);
        }
      },
    };

    this.monitors = [
      new ChannelMonitor({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.channelPollIntervalMs,
          includeClosedChannels: this.config.includeClosedChannels,
        },
        hooks,
      }),
      new InvoiceTracker({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.invoicePollIntervalMs,
          completedItemTtlSeconds: this.config.completedItemTtlSeconds,
        },
        hooks,
      }),
      new PaymentTracker({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.paymentPollIntervalMs,
          completedItemTtlSeconds: this.config.completedItemTtlSeconds,
        },
        hooks,
      }),
      new PeerMonitor({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: { intervalMs: this.config.peerPollIntervalMs },
        hooks,
      }),
      new HealthMonitor({
        client: this.client,
        alerts: this.alerts,
        config: { intervalMs: this.config.healthPollIntervalMs },
      }),
    ];

    const originalEmit = this.alerts.emit.bind(this.alerts);
    this.alerts.emit = async (input) => {
      const alert = await originalEmit(input);
      this.emit('alert', alert);
      return alert;
    };

    this.proxy = new RpcMonitorProxy(
      {
        listen: this.config.proxy.listen,
        targetUrl: this.config.fiberRpcUrl,
      },
      {
        onInvoiceTracked: (paymentHash) => {
          this.store.addTrackedInvoice(paymentHash as `0x${string}`);
        },
        onPaymentTracked: (paymentHash) => {
          this.store.addTrackedPayment(paymentHash as `0x${string}`);
        },
        listTrackedInvoices: () => this.store.listTrackedInvoices(),
        listTrackedPayments: () => this.store.listTrackedPayments(),
        listAlerts: (filters) => this.store.listAlerts(filters),
        getStatus: () => this.getStatus(),
      },
    );
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.store.load();
    this.store.startAutoFlush();
    await this.alerts.start();

    for (const monitor of this.monitors) {
      monitor.start();
    }

    if (this.config.proxy.enabled) {
      await this.proxy.start();
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    for (const monitor of this.monitors) {
      monitor.stop();
    }

    if (this.config.proxy.enabled) {
      await this.proxy.stop();
    }

    this.store.stopAutoFlush();
    await this.store.flush();
    await this.alerts.stop();
    this.running = false;
  }

  getStatus(): {
    startedAt: string;
    proxyListen: string;
    targetUrl: string;
    running: boolean;
  } {
    return {
      startedAt: this.startedAt,
      proxyListen: this.config.proxy.listen,
      targetUrl: this.config.fiberRpcUrl,
      running: this.running,
    };
  }

  listAlerts(filters?: AlertFilter): Alert[] {
    return this.store.listAlerts(filters);
  }

  listTrackedInvoices() {
    return this.store.listTrackedInvoices();
  }

  listTrackedPayments() {
    return this.store.listTrackedPayments();
  }

  trackInvoice(paymentHash: `0x${string}`): void {
    this.store.addTrackedInvoice(paymentHash);
  }

  trackPayment(paymentHash: `0x${string}`): void {
    this.store.addTrackedPayment(paymentHash);
  }

  private createAlertBackends(config: RuntimeConfig): AlertBackend[] {
    return config.alerts.map((alertConfig) => {
      if (alertConfig.type === 'stdout') {
        return new StdoutAlertBackend();
      }
      if (alertConfig.type === 'webhook') {
        return new WebhookAlertBackend({
          url: alertConfig.url,
          timeoutMs: alertConfig.timeoutMs,
          headers: alertConfig.headers,
        });
      }
      const [host, portText] = alertConfig.listen.split(':');
      return new WebsocketAlertBackend({
        host,
        port: Number(portText),
      });
    });
  }

  private async handleRpcFailure(error: unknown, monitorName: string): Promise<void> {
    if (this.offline) {
      return;
    }

    this.offline = true;
    const alert = await this.alerts.emit({
      type: 'node_offline',
      priority: 'critical',
      source: monitorName,
      data: { message: String(error) },
    });
    this.emit('alert', alert);
  }
}
