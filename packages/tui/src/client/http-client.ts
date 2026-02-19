import type {
  Alert,
  AlertPriority,
  AlertType,
  RuntimeJob,
  TrackedInvoiceState,
  TrackedPaymentState,
} from '@fiber-pay/runtime';
import type { Channel, NodeInfo, PeerInfo } from '@fiber-pay/sdk';

export interface RpcMonitorProxyStatus {
  startedAt: string;
  proxyListen: string;
  targetUrl: string;
  running: boolean;
}

export interface ListAlertsFilter {
  limit?: number;
  type?: AlertType;
  minPriority?: AlertPriority;
}

export interface ListJobsFilter {
  state?: RuntimeJob['state'];
  type?: RuntimeJob['type'];
  limit?: number;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class RuntimeHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  async getStatus(): Promise<RpcMonitorProxyStatus> {
    return this.request<RpcMonitorProxyStatus>('/monitor/status');
  }

  async getNodeInfo(): Promise<NodeInfo> {
    return this.rpc<NodeInfo>('get_node_info', []);
  }

  async listChannels(): Promise<Channel[]> {
    const result = await this.rpc<{ channels?: Channel[] }>('list_channels', [{}]);
    return result.channels ?? [];
  }

  async listPeers(): Promise<PeerInfo[]> {
    const result = await this.rpc<{ peers?: PeerInfo[] }>('list_peers', []);
    return result.peers ?? [];
  }

  async listTrackedInvoices(): Promise<TrackedInvoiceState[]> {
    const payload = await this.request<{ invoices?: TrackedInvoiceState[] }>(
      '/monitor/list_tracked_invoices',
    );
    return payload.invoices ?? [];
  }

  async listTrackedPayments(): Promise<TrackedPaymentState[]> {
    const payload = await this.request<{ payments?: TrackedPaymentState[] }>(
      '/monitor/list_tracked_payments',
    );
    return payload.payments ?? [];
  }

  async listAlerts(filter: ListAlertsFilter = {}): Promise<Alert[]> {
    const query = new URLSearchParams();
    if (filter.limit) query.set('limit', String(filter.limit));
    if (filter.type) query.set('type', filter.type);
    if (filter.minPriority) query.set('min_priority', filter.minPriority);

    const suffix = query.toString();
    const payload = await this.request<{ alerts?: Alert[] }>(
      suffix ? `/monitor/list_alerts?${suffix}` : '/monitor/list_alerts',
    );
    return payload.alerts ?? [];
  }

  async listJobs(filter: ListJobsFilter = {}): Promise<RuntimeJob[]> {
    const query = new URLSearchParams();
    if (filter.state) query.set('state', filter.state);
    if (filter.type) query.set('type', filter.type);
    if (filter.limit) query.set('limit', String(filter.limit));

    const suffix = query.toString();
    const payload = await this.request<{ jobs?: RuntimeJob[] }>(suffix ? `/jobs?${suffix}` : '/jobs');
    return payload.jobs ?? [];
  }

  async getJob(id: string): Promise<RuntimeJob> {
    return this.request<RuntimeJob>(`/jobs/${id}`);
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: `tui-${Date.now()}`,
        jsonrpc: '2.0',
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(`RPC ${method} failed: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error(`RPC ${method} returned empty result`);
    }

    return payload.result;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Request ${path} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
