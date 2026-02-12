import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJson, printPeerListHuman } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

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
    .option('--json')
    .action(async (address, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.connectPeer({ address });

      if (options.json) {
        printJson({ success: true, data: { address, message: 'Connected' } });
      } else {
        console.log('✅ Connected to peer');
        console.log(`  Address: ${address}`);
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
