import { FiberRpcClient } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';

export function createRpcClient(config: CliConfig): FiberRpcClient {
  return new FiberRpcClient({ url: config.rpcUrl });
}

export async function createReadyRpcClient(
  config: CliConfig,
  options: { timeout?: number; interval?: number } = {}
): Promise<FiberRpcClient> {
  const rpc = createRpcClient(config);
  await rpc.waitForReady({ timeout: options.timeout ?? 3000, interval: options.interval ?? 500 });
  return rpc;
}
