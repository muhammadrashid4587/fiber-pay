import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type Alert,
  type AlertFilter,
  type TrackedInvoiceState,
  type TrackedPaymentState,
  isAlertPriority,
  isAlertType,
} from '../alerts/types.js';
import { parseListenAddress } from '../config.js';

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: unknown;
}

export interface RpcMonitorProxyConfig {
  listen: string;
  targetUrl: string;
}

export interface RpcMonitorProxyStatus {
  startedAt: string;
  proxyListen: string;
  targetUrl: string;
  running: boolean;
}

export interface RpcMonitorProxyDeps {
  onInvoiceTracked: (paymentHash: string) => void;
  onPaymentTracked: (paymentHash: string) => void;
  listTrackedInvoices: () => TrackedInvoiceState[];
  listTrackedPayments: () => TrackedPaymentState[];
  listAlerts: (filters?: AlertFilter) => Alert[];
  getStatus: () => RpcMonitorProxyStatus;
}

export class RpcMonitorProxy {
  private readonly config: RpcMonitorProxyConfig;
  private readonly deps: RpcMonitorProxyDeps;
  private server: http.Server | undefined;

  constructor(config: RpcMonitorProxyConfig, deps: RpcMonitorProxyDeps) {
    this.config = config;
    this.deps = deps;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    const { host, port } = parseListenAddress(this.config.listen);

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      this.handleMonitorEndpoint(req, res);
      return;
    }

    if (req.method !== 'POST') {
      this.writeJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const requestBody = await readRawBody(req);

    const requestJson = tryParseJson(requestBody.toString('utf-8'));
    const methodById = collectJsonRpcMethods(requestJson);

    let responseText = '';
    let responseStatus = 500;
    let responseHeaders = new Headers();

    try {
      const response = await fetch(this.config.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': req.headers['content-type'] ?? 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        body: requestBody,
      });

      responseStatus = response.status;
      responseHeaders = response.headers;
      responseText = await response.text();

      const responseJson = tryParseJson(responseText);
      this.captureHashes(methodById, responseJson);
    } catch (error) {
      this.writeJson(res, 502, { error: `Proxy request failed: ${String(error)}` });
      return;
    }

    const contentType = responseHeaders.get('content-type') ?? 'application/json';
    res.writeHead(responseStatus, {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
    });
    res.end(responseText);
  }

  private handleMonitorEndpoint(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/monitor/list_tracked_invoices') {
      this.writeJson(res, 200, { invoices: this.deps.listTrackedInvoices() });
      return;
    }

    if (url.pathname === '/monitor/list_tracked_payments') {
      this.writeJson(res, 200, { payments: this.deps.listTrackedPayments() });
      return;
    }

    if (url.pathname === '/monitor/list_alerts') {
      const limitRaw = url.searchParams.get('limit');
      const minPriorityRaw = url.searchParams.get('min_priority');
      const typeRaw = url.searchParams.get('type');
      const sourceRaw = url.searchParams.get('source');

      const limit = parseOptionalPositiveInteger(limitRaw);
      if (limitRaw !== null && limit === undefined) {
        this.writeJson(res, 400, {
          error: 'Invalid query parameter: limit must be a positive integer',
        });
        return;
      }

      if (minPriorityRaw && !isAlertPriority(minPriorityRaw)) {
        this.writeJson(res, 400, {
          error: 'Invalid query parameter: min_priority must be one of critical|high|medium|low',
        });
        return;
      }

      if (typeRaw && !isAlertType(typeRaw)) {
        this.writeJson(res, 400, {
          error: 'Invalid query parameter: type is not a known alert type',
        });
        return;
      }

      const minPriority = minPriorityRaw && isAlertPriority(minPriorityRaw) ? minPriorityRaw : undefined;
      const type = typeRaw && isAlertType(typeRaw) ? typeRaw : undefined;

      this.writeJson(res, 200, {
        alerts: this.deps.listAlerts({
          limit,
          minPriority,
          type,
          source: sourceRaw ?? undefined,
        }),
      });
      return;
    }

    if (url.pathname === '/monitor/status') {
      this.writeJson(res, 200, this.deps.getStatus());
      return;
    }

    this.writeJson(res, 404, { error: 'Not found' });
  }

  private captureHashes(methodById: Map<string | number, string>, responseBody: unknown): void {
    const responses = normalizeJsonRpcResponse(responseBody);

    for (const message of responses) {
      if (message.error || message.id === undefined) {
        continue;
      }
      const method = methodById.get(message.id);
      if (!method) {
        continue;
      }

      if (method === 'new_invoice') {
        const paymentHash = extractInvoicePaymentHash(message.result);
        if (paymentHash) {
          this.deps.onInvoiceTracked(paymentHash);
        }
      }

      if (method === 'send_payment') {
        const paymentHash = extractPaymentHash(message.result);
        if (paymentHash) {
          this.deps.onPaymentTracked(paymentHash);
        }
      }
    }
  }

  private writeJson(res: ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
    });
    res.end(JSON.stringify(value));
  }
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function collectJsonRpcMethods(requestBody: unknown): Map<string | number, string> {
  const methods = new Map<string | number, string>();
  for (const item of normalizeJsonRpcRequest(requestBody)) {
    if (item.id !== undefined && typeof item.method === 'string') {
      methods.set(item.id, item.method);
    }
  }
  return methods;
}

function normalizeJsonRpcRequest(body: unknown): JsonRpcMessage[] {
  if (!body) {
    return [];
  }
  if (Array.isArray(body)) {
    return body.filter(isObject) as JsonRpcMessage[];
  }
  if (isObject(body)) {
    return [body as JsonRpcMessage];
  }
  return [];
}

function normalizeJsonRpcResponse(body: unknown): JsonRpcMessage[] {
  if (!body) {
    return [];
  }
  if (Array.isArray(body)) {
    return body.filter(isObject) as JsonRpcMessage[];
  }
  if (isObject(body)) {
    return [body as JsonRpcMessage];
  }
  return [];
}

function extractInvoicePaymentHash(result: unknown): string | undefined {
  if (!isObject(result)) {
    return undefined;
  }

  const invoice = result.invoice;
  if (!isObject(invoice)) {
    return undefined;
  }

  const data = invoice.data;
  if (!isObject(data)) {
    return undefined;
  }

  return typeof data.payment_hash === 'string' ? data.payment_hash : undefined;
}

function extractPaymentHash(result: unknown): string | undefined {
  if (!isObject(result)) {
    return undefined;
  }
  return typeof result.payment_hash === 'string' ? result.payment_hash : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOptionalPositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
