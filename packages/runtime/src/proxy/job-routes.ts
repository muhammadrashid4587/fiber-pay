import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChannelJobParams, InvoiceJobParams, PaymentJobParams } from '../jobs/types.js';
import type { ValidationResult } from '../permissions/manager.js';
import type { Permission } from '../permissions/types.js';
import { isPayloadTooLargeError, readRawBody } from './body.js';
import { writeJson } from './http-utils.js';
import { isObject, tryParseJson } from './json.js';
import type { RpcMonitorProxyDeps } from './types.js';

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/**
 * Check if grant has write permission for a resource
 */
function hasWritePermission(permissions: Permission[], resource: string): boolean {
  return permissions.some((p) => p.resource === resource && p.action === 'write');
}

/**
 * Validate token and check resource permission
 * Returns ValidationResult if valid, null if no permission manager (permission checks disabled)
 */
async function checkPermission(
  req: IncomingMessage,
  deps: RpcMonitorProxyDeps,
  resource: 'payments' | 'channels',
): Promise<{ valid: true; result: ValidationResult } | { valid: false; error: string } | null> {
  // If no permission manager, permission checks are disabled
  if (!deps.permissionManager) {
    return null;
  }

  const token = extractToken(req);
  if (!token) {
    return { valid: false, error: 'Missing authorization token' };
  }

  const validation = await deps.permissionManager.validateToken(token);
  if (!validation.valid) {
    return { valid: false, error: validation.error ?? 'Invalid token' };
  }

  if (!validation.permissions) {
    return { valid: false, error: 'No permissions found in token' };
  }

  if (!hasWritePermission(validation.permissions, resource)) {
    return { valid: false, error: `Permission denied: write("${resource}") required` };
  }

  return { valid: true, result: validation };
}

export async function handleJobPostEndpoint(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  deps: RpcMonitorProxyDeps,
): Promise<void> {
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (isPayloadTooLargeError(error)) {
      writeJson(res, 413, { error: 'Request body too large' });
      return;
    }
    writeJson(res, 400, { error: 'Failed to read request body' });
    return;
  }

  const body = tryParseJson(rawBody.toString('utf-8'));
  if (!isObject(body)) {
    writeJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (pathname === '/jobs/payment') {
    if (!deps.createPaymentJob) {
      writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
      return;
    }

    // Check write("payments") permission
    const permissionCheck = await checkPermission(req, deps, 'payments');
    if (permissionCheck && !permissionCheck.valid) {
      writeJson(res, 403, { error: permissionCheck.error });
      return;
    }

    const params = body.params as PaymentJobParams | undefined;
    if (!params) {
      writeJson(res, 400, { error: 'Missing params for payment job' });
      return;
    }
    const options = body.options as { idempotencyKey?: string; maxRetries?: number } | undefined;

    const paramsWithGrant: PaymentJobParams = permissionCheck?.valid
      ? { ...params, grantId: permissionCheck.result.grantId }
      : params;

    const job = await deps.createPaymentJob(paramsWithGrant, options);
    writeJson(res, 200, job);
    return;
  }

  if (pathname === '/jobs/invoice') {
    if (!deps.createInvoiceJob) {
      writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
      return;
    }
    const params = body.params as InvoiceJobParams | undefined;
    if (!params) {
      writeJson(res, 400, { error: 'Missing params for invoice job' });
      return;
    }
    const options = body.options as { idempotencyKey?: string; maxRetries?: number } | undefined;
    const job = await deps.createInvoiceJob(params, options);
    writeJson(res, 200, job);
    return;
  }

  if (pathname === '/jobs/channel') {
    if (!deps.createChannelJob) {
      writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
      return;
    }

    // Check write("channels") permission
    const permissionCheck = await checkPermission(req, deps, 'channels');
    if (permissionCheck && !permissionCheck.valid) {
      writeJson(res, 403, { error: permissionCheck.error });
      return;
    }

    const params = body.params as ChannelJobParams | undefined;
    if (!params) {
      writeJson(res, 400, { error: 'Missing params for channel job' });
      return;
    }
    const options = body.options as
      | { idempotencyKey?: string; maxRetries?: number; reuseTerminal?: boolean }
      | undefined;

    const paramsWithGrant: ChannelJobParams = permissionCheck?.valid
      ? { ...params, grantId: permissionCheck.result.grantId }
      : params;

    const job = await deps.createChannelJob(paramsWithGrant, options);
    writeJson(res, 200, job);
    return;
  }

  writeJson(res, 404, { error: 'Unknown jobs endpoint' });
}

export async function handleDeleteEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RpcMonitorProxyDeps,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/jobs/')) {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!deps.cancelJob) {
    writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
    return;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const [, id] = segments;
  if (!id) {
    writeJson(res, 400, { error: 'Missing job id' });
    return;
  }

  try {
    deps.cancelJob(id);
    writeJson(res, 204, {});
  } catch (error) {
    writeJson(res, 404, { error: String(error) });
  }
}
