import { existsSync, readFileSync } from 'fs';
import type { FiberRpcClient } from '@fiber-pay/sdk';

export function extractBootnodeAddrs(configFilePath: string): string[] {
  if (!existsSync(configFilePath)) return [];

  try {
    const content = readFileSync(configFilePath, 'utf-8');
    const addrs: string[] = [];
    const regex = /^\s*-\s*["']?(\/ip4\/[^"'\s]+)["']?\s*$/gm;
    const sectionMatch = content.match(/bootnode_addrs:\s*\n((?:\s*-\s*.+\n?)+)/);

    if (sectionMatch) {
      const section = sectionMatch[1];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(section)) !== null) {
        addrs.push(match[1]);
      }
    }

    return addrs;
  } catch {
    return [];
  }
}

export async function autoConnectBootnodes(rpc: FiberRpcClient, bootnodes: string[]): Promise<void> {
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
