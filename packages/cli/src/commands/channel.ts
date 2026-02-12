import { Command } from 'commander';
import {
  ckbToShannons,
  ChannelState,
  type HexString,
} from '@fiber-pay/sdk';
import type { CliConfig } from '../lib/config.js';
import { createReadyRpcClient } from '../lib/rpc.js';
import {
  formatChannel,
  getChannelSummary,
  hasJsonFlag,
  parseChannelState,
  printChannelDetailHuman,
  printChannelListHuman,
  printJson,
  sleep,
  truncateMiddle,
} from '../lib/format.js';

export function createChannelCommand(config: CliConfig): Command {
  const channel = new Command('channel').description('Channel lifecycle and status commands');

  channel
    .command('list')
    .option('--state <state>')
    .option('--peer <peerId>')
    .option('--include-closed')
    .option('--raw')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const stateFilter = parseChannelState(options.state);
      const response = await rpc.listChannels(options.peer ? { peer_id: options.peer, include_closed: Boolean(options.includeClosed) } : { include_closed: Boolean(options.includeClosed) });
      const channels = stateFilter
        ? response.channels.filter((item) => item.state.state_name === stateFilter)
        : response.channels;

      if (options.raw || options.json) {
        printJson({ success: true, data: { channels, count: channels.length } });
      } else {
        printChannelListHuman(channels);
      }
    });

  channel
    .command('get')
    .argument('<channelId>')
    .option('--raw')
    .option('--json')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const response = await rpc.listChannels({ include_closed: true });
      const found = response.channels.find((item) => item.channel_id === channelId);
      if (!found) {
        console.error(`Error: Channel not found: ${channelId}`);
        process.exit(1);
      }

      if (options.raw || options.json) {
        printJson({ success: true, data: found });
      } else {
        printChannelDetailHuman(found);
      }
    });

  channel
    .command('watch')
    .option('--interval <seconds>', 'Refresh interval', '5')
    .option('--timeout <seconds>')
    .option('--channel <channelId>')
    .option('--peer <peerId>')
    .option('--state <state>')
    .option('--until <state>')
    .option('--include-closed')
    .option('--no-clear')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const intervalSeconds = parseInt(options.interval, 10);
      const timeoutSeconds = options.timeout ? parseInt(options.timeout, 10) : undefined;
      const stateFilter = parseChannelState(options.state);
      const untilState = parseChannelState(options.until);
      const noClear = Boolean(options.noClear);
      const json = hasJsonFlag(options.json ? ['--json'] : []);
      const startedAt = Date.now();
      const previousStates = new Map<string, ChannelState>();

      while (true) {
        const response = await rpc.listChannels(options.peer ? { peer_id: options.peer, include_closed: Boolean(options.includeClosed) } : { include_closed: Boolean(options.includeClosed) });
        let channels = response.channels;

        if (options.channel) {
          channels = channels.filter((item) => item.channel_id === options.channel);
        }
        if (stateFilter) {
          channels = channels.filter((item) => item.state.state_name === stateFilter);
        }

        const stateChanges: Array<{ channelId: string; from: ChannelState; to: ChannelState }> = [];
        for (const ch of channels) {
          const prev = previousStates.get(ch.channel_id);
          if (prev && prev !== ch.state.state_name) {
            stateChanges.push({ channelId: ch.channel_id, from: prev, to: ch.state.state_name });
          }
          previousStates.set(ch.channel_id, ch.state.state_name);
        }

        if (!noClear) {
          console.clear();
        }

        console.log(`⏱️  Channel monitor - ${new Date().toISOString()}`);
        console.log(`   Refresh: ${intervalSeconds}s${timeoutSeconds ? ` | Timeout: ${timeoutSeconds}s` : ''}${untilState ? ` | Until: ${untilState}` : ''}`);

        if (stateChanges.length > 0) {
          console.log('\n🔔 State changes:');
          for (const change of stateChanges) {
            console.log(`   ${truncateMiddle(change.channelId)}: ${change.from} -> ${change.to}`);
          }
        }

        if (json) {
          printJson({
            success: true,
            data: {
              channels: channels.map(formatChannel),
              summary: getChannelSummary(channels),
            },
          });
        } else {
          printChannelListHuman(channels);
        }

        if (untilState && channels.some((item) => item.state.state_name === untilState)) {
          console.log(`\n✅ Target state reached: ${untilState}`);
          return;
        }

        if (timeoutSeconds !== undefined && Date.now() - startedAt >= timeoutSeconds * 1000) {
          console.log('\n⏰ Monitor timeout reached.');
          return;
        }

        await sleep(intervalSeconds * 1000);
      }
    });

  channel
    .command('open')
    .requiredOption('--peer <peerIdOrMultiaddr>')
    .requiredOption('--funding <ckb>')
    .option('--private')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const peerInput = options.peer as string;
      const fundingCkb = parseFloat(options.funding);

      let peerId = peerInput;
      if (peerInput.includes('/')) {
        await rpc.connectPeer({ address: peerInput });
        const peerIdMatch = peerInput.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) peerId = peerIdMatch[1];
      }

      const result = await rpc.openChannel({
        peer_id: peerId,
        funding_amount: ckbToShannons(fundingCkb),
        public: !options.private,
      });

      printJson({ success: true, data: { temporaryChannelId: result.temporary_channel_id, peer: peerId, fundingCkb } });
    });

  channel
    .command('close')
    .argument('<channelId>')
    .option('--force')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.shutdownChannel({ channel_id: channelId as HexString, force: Boolean(options.force) });
      printJson({
        success: true,
        data: {
          channelId,
          force: Boolean(options.force),
          message: options.force ? 'Channel force close initiated' : 'Channel close initiated',
        },
      });
    });

  channel
    .command('abandon')
    .argument('<channelId>')
    .action(async (channelId) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.abandonChannel({ channel_id: channelId as HexString });
      printJson({ success: true, data: { channelId, message: 'Channel abandoned.' } });
    });

  channel
    .command('update')
    .argument('<channelId>')
    .option('--enabled <enabled>')
    .option('--tlc-expiry-delta <ms>')
    .option('--tlc-minimum-value <shannonsHex>')
    .option('--tlc-fee-proportional-millionths <value>')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.updateChannel({
        channel_id: channelId as HexString,
        enabled: options.enabled !== undefined ? options.enabled === 'true' : undefined,
        tlc_expiry_delta: options.tlcExpiryDelta,
        tlc_minimum_value: options.tlcMinimumValue,
        tlc_fee_proportional_millionths: options.tlcFeeProportionalMillionths,
      });
      printJson({ success: true, data: { channelId, message: 'Channel updated.' } });
    });

  return channel;
}
