import { existsSync, readFileSync } from 'node:fs';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import { parse as parseYaml } from 'yaml';

export function extractBootnodeAddrs(configFilePath: string): string[] {
  if (!existsSync(configFilePath)) return [];

  try {
    const content = readFileSync(configFilePath, 'utf-8');
    const doc = parseYaml(content);
    const addrs = doc?.fiber?.bootnode_addrs;
    if (!Array.isArray(addrs)) return [];
    return addrs.filter((a): a is string => typeof a === 'string' && a.startsWith('/ip'));
  } catch {
    return [];
  }
}

export async function autoConnectBootnodes(
  rpc: FiberRpcClient,
  bootnodes: string[],
): Promise<void> {
  if (bootnodes.length === 0) return;

  console.log(`🔗 Connecting to ${bootnodes.length} bootnode(s)...`);
  for (const addr of bootnodes) {
    const shortId = addr.match(/\/p2p\/(.+)$/)?.[1]?.slice(0, 12) || addr.slice(-12);
    try {
      await rpc.connectPeer({ address: addr });
      console.log(`   ✅ Connected to ${shortId}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('already')) {
        console.log(`   ✅ Already connected to ${shortId}...`);
      } else {
        console.error(`   ⚠️  Failed to connect to ${shortId}...: ${msg}`);
      }
    }
  }
}
