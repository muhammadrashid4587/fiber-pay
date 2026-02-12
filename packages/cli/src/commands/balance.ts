import { ChannelState } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printBalanceHuman, printJson } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

export function createBalanceCommand(config: CliConfig): Command {
  return new Command('balance')
    .description('Get current balance information')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const channels = await rpc.listChannels({});
      let totalLocal = 0n;
      let totalRemote = 0n;
      let activeChannelCount = 0;

      for (const ch of channels.channels) {
        if (ch.state?.state_name === ChannelState.ChannelReady) {
          totalLocal += BigInt(ch.local_balance);
          totalRemote += BigInt(ch.remote_balance);
          activeChannelCount++;
        }
      }

      const localCkb = Number(totalLocal) / 1e8;
      const remoteCkb = Number(totalRemote) / 1e8;

      const output = {
        totalCkb: localCkb,
        availableToSend: localCkb,
        availableToReceive: remoteCkb,
        channelCount: channels.channels.length,
        activeChannelCount,
      };

      if (options.json) {
        printJson({ success: true, data: output });
      } else {
        printBalanceHuman(output);
      }
    });
}
