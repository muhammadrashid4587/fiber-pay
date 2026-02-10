/**
 * Fiber RPC Client
 * Type-safe JSON-RPC client for Fiber Network Node
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  // Peer methods
  ConnectPeerParams,
  ConnectPeerResult,
  DisconnectPeerParams,
  ListPeersResult,
  // Channel methods
  OpenChannelParams,
  OpenChannelResult,
  AcceptChannelParams,
  AcceptChannelResult,
  ListChannelsParams,
  ListChannelsResult,
  ShutdownChannelParams,
  AbandonChannelParams,
  UpdateChannelParams,
  // Payment methods
  SendPaymentParams,
  SendPaymentResult,
  GetPaymentParams,
  GetPaymentResult,
  // Invoice methods
  NewInvoiceParams,
  NewInvoiceResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  GetInvoiceParams,
  GetInvoiceResult,
  CancelInvoiceParams,
  // Graph methods
  GraphNodesParams,
  GraphNodesResult,
  GraphChannelsParams,
  GraphChannelsResult,
  // Info methods
  NodeInfoResult,
  HexString,
} from '../types/index.js';

// =============================================================================
// RPC Client Configuration
// =============================================================================

export interface RpcClientConfig {
  /** RPC endpoint URL */
  url: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Biscuit token for authentication */
  biscuitToken?: string;
}

// =============================================================================
// RPC Error
// =============================================================================

export class FiberRpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'FiberRpcError';
  }

  static fromJsonRpcError(error: JsonRpcError): FiberRpcError {
    return new FiberRpcError(error.code, error.message, error.data);
  }
}

// =============================================================================
// RPC Client
// =============================================================================

export class FiberRpcClient {
  private requestId = 0;
  private config: Required<Pick<RpcClientConfig, 'url' | 'timeout'>> & RpcClientConfig;

  constructor(config: RpcClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Make a raw JSON-RPC call
   */
  async call<TResult>(method: string, params: unknown[] = []): Promise<TResult> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.biscuitToken) {
      headers['Authorization'] = `Bearer ${this.config.biscuitToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new FiberRpcError(
          -32000,
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      const json = (await response.json()) as JsonRpcResponse<TResult>;

      if (json.error) {
        throw FiberRpcError.fromJsonRpcError(json.error);
      }

      return json.result as TResult;
    } catch (error) {
      if (error instanceof FiberRpcError) {
        throw error;
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new FiberRpcError(-32000, 'Request timeout');
        }
        throw new FiberRpcError(-32000, error.message);
      }
      throw new FiberRpcError(-32000, 'Unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // Peer Module
  // ===========================================================================

  /**
   * Connect to a peer
   */
  async connectPeer(params: ConnectPeerParams): Promise<ConnectPeerResult> {
    return this.call<ConnectPeerResult>('connect_peer', [params]);
  }

  /**
   * Disconnect from a peer
   */
  async disconnectPeer(params: DisconnectPeerParams): Promise<null> {
    return this.call<null>('disconnect_peer', [params]);
  }

  /**
   * List all connected peers
   */
  async listPeers(): Promise<ListPeersResult> {
    return this.call<ListPeersResult>('list_peers', []);
  }

  // ===========================================================================
  // Channel Module
  // ===========================================================================

  /**
   * Open a new channel with a peer
   */
  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    return this.call<OpenChannelResult>('open_channel', [params]);
  }

  /**
   * Accept a channel opening request
   */
  async acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult> {
    return this.call<AcceptChannelResult>('accept_channel', [params]);
  }

  /**
   * List all channels
   */
  async listChannels(params?: ListChannelsParams): Promise<ListChannelsResult> {
    return this.call<ListChannelsResult>('list_channels', params ? [params] : [{}]);
  }

  /**
   * Shutdown (close) a channel
   */
  async shutdownChannel(params: ShutdownChannelParams): Promise<null> {
    return this.call<null>('shutdown_channel', [params]);
  }

  /**
   * Abandon a pending channel
   */
  async abandonChannel(params: AbandonChannelParams): Promise<null> {
    return this.call<null>('abandon_channel', [params]);
  }

  /**
   * Update channel parameters
   */
  async updateChannel(params: UpdateChannelParams): Promise<null> {
    return this.call<null>('update_channel', [params]);
  }

  // ===========================================================================
  // Payment Module
  // ===========================================================================

  /**
   * Send a payment
   */
  async sendPayment(params: SendPaymentParams): Promise<SendPaymentResult> {
    return this.call<SendPaymentResult>('send_payment', [params]);
  }

  /**
   * Get payment status
   */
  async getPayment(params: GetPaymentParams): Promise<GetPaymentResult> {
    return this.call<GetPaymentResult>('get_payment', [params]);
  }

  // ===========================================================================
  // Invoice Module
  // ===========================================================================

  /**
   * Create a new invoice
   */
  async newInvoice(params: NewInvoiceParams): Promise<NewInvoiceResult> {
    return this.call<NewInvoiceResult>('new_invoice', [params]);
  }

  /**
   * Parse an invoice string
   */
  async parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult> {
    return this.call<ParseInvoiceResult>('parse_invoice', [params]);
  }

  /**
   * Get invoice by payment hash
   */
  async getInvoice(params: GetInvoiceParams): Promise<GetInvoiceResult> {
    return this.call<GetInvoiceResult>('get_invoice', [params]);
  }

  /**
   * Cancel an open invoice
   */
  async cancelInvoice(params: CancelInvoiceParams): Promise<null> {
    return this.call<null>('cancel_invoice', [params]);
  }

  // ===========================================================================
  // Graph Module
  // ===========================================================================

  /**
   * List nodes in the network graph
   */
  async graphNodes(params?: GraphNodesParams): Promise<GraphNodesResult> {
    return this.call<GraphNodesResult>('graph_nodes', params ? [params] : [{}]);
  }

  /**
   * List channels in the network graph
   */
  async graphChannels(params?: GraphChannelsParams): Promise<GraphChannelsResult> {
    return this.call<GraphChannelsResult>('graph_channels', params ? [params] : [{}]);
  }

  // ===========================================================================
  // Info Module
  // ===========================================================================

  /**
   * Get local node information
   */
  async nodeInfo(): Promise<NodeInfoResult> {
    return this.call<NodeInfoResult>('node_info', []);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if the node is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.nodeInfo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for the node to be ready
   */
  async waitForReady(
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    const { timeout = 60000, interval = 1000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (await this.ping()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(-32000, 'Node not ready within timeout');
  }
}

// =============================================================================
// Re-export utility functions
// =============================================================================

export { toHex, fromHex, ckbToShannons, shannonsToCkb, randomBytes32 } from '../utils.js';
