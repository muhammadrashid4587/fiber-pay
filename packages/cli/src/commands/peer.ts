import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJson, printPeerListHuman } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function extractPeerIdFromMultiaddr(address: string): string | undefined {
  const match = address.match(/\/p2p\/([^/]+)$/);
  return match?.[1];
}

async function waitForPeerConnected(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  peerId: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const peers = await rpc.listPeers();
    if (peers.peers.some((peer) => peer.peer_id === peerId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export function createPeerCommand(config: CliConfig): Command {
  const peer = new Command('peer').description('Peer management');

  peer
    .command('list')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const peers = await rpc.listPeers();
      if (options.json) {
        printJson({ success: true, data: peers });
      } else {
        printPeerListHuman(peers.peers);
      }
    });

  peer
    .command('connect')
    .argument('<multiaddr>')
    .option('--timeout <sec>', 'Wait timeout for peer to appear in peer list', '8')
    .option('--json')
    .action(async (address, options) => {
      const rpc = await createReadyRpcClient(config);
      const peerId = extractPeerIdFromMultiaddr(address);
      if (!peerId) {
        throw new Error('Invalid multiaddr: missing /p2p/<peerId> suffix');
      }

      await rpc.connectPeer({ address });
      const timeoutMs = Math.max(1, Number.parseInt(String(options.timeout), 10) || 8) * 1000;
      const connected = await waitForPeerConnected(rpc, peerId, timeoutMs);

      if (!connected) {
        throw new Error(
          `connect_peer accepted but peer not found in list within ${Math.floor(timeoutMs / 1000)}s (${peerId})`,
        );
      }

      if (options.json) {
        printJson({ success: true, data: { address, peerId, message: 'Connected' } });
      } else {
        console.log('✅ Connected to peer');
        console.log(`  Address: ${address}`);
        console.log(`  Peer ID: ${peerId}`);
      }
    });

  peer
    .command('disconnect')
    .argument('<peerId>')
    .option('--json')
    .action(async (peerId, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.disconnectPeer({ peer_id: peerId });

      if (options.json) {
        printJson({ success: true, data: { peerId, message: 'Disconnected' } });
      } else {
        console.log('✅ Disconnected peer');
        console.log(`  Peer ID: ${peerId}`);
      }
    });

  return peer;
}
