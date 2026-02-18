import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FiberRpcClient } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';
import { isProcessRunning } from './pid.js';

interface RuntimeMeta {
  pid: number;
  startedAt: string;
  fiberRpcUrl: string;
  proxyListen: string;
  stateFilePath?: string;
  daemon: boolean;
}

export type ResolvedRpcTarget = 'node-rpc' | 'runtime-proxy';

export interface ResolvedRpcEndpoint {
  url: string;
  target: ResolvedRpcTarget;
}

function normalizeUrl(url: string): string {
  try {
    const normalized = new URL(url).toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

function readRuntimeMeta(dataDir: string): RuntimeMeta | null {
  const metaPath = join(dataDir, 'runtime.meta.json');
  if (!existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as RuntimeMeta;
  } catch {
    return null;
  }
}

function readRuntimePid(dataDir: string): number | null {
  const pidPath = join(dataDir, 'runtime.pid');
  if (!existsSync(pidPath)) {
    return null;
  }
  try {
    return Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function resolveRuntimeProxyUrl(config: CliConfig): string | undefined {
  const runtimeMeta = readRuntimeMeta(config.dataDir);
  const runtimePid = readRuntimePid(config.dataDir);

  if (!runtimeMeta || !runtimePid || !isProcessRunning(runtimePid)) {
    return undefined;
  }

  if (!runtimeMeta.proxyListen || !runtimeMeta.fiberRpcUrl) {
    return undefined;
  }

  if (normalizeUrl(runtimeMeta.fiberRpcUrl) !== normalizeUrl(config.rpcUrl)) {
    return undefined;
  }

  if (
    runtimeMeta.proxyListen.startsWith('http://') ||
    runtimeMeta.proxyListen.startsWith('https://')
  ) {
    return runtimeMeta.proxyListen;
  }

  return `http://${runtimeMeta.proxyListen}`;
}

export function createRpcClient(config: CliConfig): FiberRpcClient {
  const resolved = resolveRpcEndpoint(config);
  return new FiberRpcClient({ url: resolved.url });
}

export function resolveRpcEndpoint(config: CliConfig): ResolvedRpcEndpoint {
  const runtimeProxyUrl = resolveRuntimeProxyUrl(config);
  if (runtimeProxyUrl) {
    return {
      url: runtimeProxyUrl,
      target: 'runtime-proxy',
    };
  }

  return {
    url: config.rpcUrl,
    target: 'node-rpc',
  };
}

export async function createReadyRpcClient(
  config: CliConfig,
  options: { timeout?: number; interval?: number } = {},
): Promise<FiberRpcClient> {
  const rpc = createRpcClient(config);
  await rpc.waitForReady({ timeout: options.timeout ?? 3000, interval: options.interval ?? 500 });
  return rpc;
}
