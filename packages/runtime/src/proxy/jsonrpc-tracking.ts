import { isObject } from './json.js';

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: unknown;
}

export function collectJsonRpcMethods(requestBody: unknown): Map<string | number, string> {
  const methods = new Map<string | number, string>();
  for (const item of normalizeJsonRpcRequest(requestBody)) {
    if (item.id !== undefined && typeof item.method === 'string') {
      methods.set(item.id, item.method);
    }
  }
  return methods;
}

export function captureTrackedHashes(
  methodById: Map<string | number, string>,
  responseBody: unknown,
  handlers: {
    onInvoiceTracked: (paymentHash: string) => void;
    onPaymentTracked: (paymentHash: string) => void;
  },
): void {
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
        handlers.onInvoiceTracked(paymentHash);
      }
    }

    if (method === 'send_payment') {
      const paymentHash = extractPaymentHash(message.result);
      if (paymentHash) {
        handlers.onPaymentTracked(paymentHash);
      }
    }
  }
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
