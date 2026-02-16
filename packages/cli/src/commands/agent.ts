import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getFiberBinaryInfo } from '@fiber-pay/node';
import { ChannelState } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess } from '../lib/format.js';
import { isProcessRunning, readPidFile } from '../lib/pid.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function getCustomBinaryState(binaryPath: string): {
  path: string;
  ready: boolean;
  version: string;
} {
  const exists = existsSync(binaryPath);
  if (!exists) {
    return { path: binaryPath, ready: false, version: 'unknown' };
  }

  try {
    const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return { path: binaryPath, ready: false, version: 'unknown' };
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const firstLine = output.split('\n').find((line) => line.trim().length > 0) ?? 'unknown';
    return { path: binaryPath, ready: true, version: firstLine.trim() };
  } catch {
    return { path: binaryPath, ready: false, version: 'unknown' };
  }
}

export function createAgentCommand(config: CliConfig): Command {
  const agent = new Command('agent').description('Agent-oriented diagnostics and checks');

  agent
    .command('check')
    .description('Run automation readiness checks for binary/config/node/rpc/channel')
    .option('--json')
    .action(async (options) => {
      const managedBinaryPath = join(config.dataDir, 'bin', 'fnn');
      const binaryInfo = config.binaryPath
        ? getCustomBinaryState(config.binaryPath)
        : await getFiberBinaryInfo(join(config.dataDir, 'bin'));

      const configExists = existsSync(config.configPath);
      const pid = readPidFile(config.dataDir);
      const nodeRunning = Boolean(pid && isProcessRunning(pid));

      let rpcReachable = false;
      let channelsTotal = 0;
      let channelsReady = 0;
      let canSend = false;
      let canReceive = false;

      if (nodeRunning) {
        try {
          const rpc = await createReadyRpcClient(config);
          rpcReachable = true;
          const channels = await rpc.listChannels({ include_closed: false });
          channelsTotal = channels.channels.length;
          const readyChannels = channels.channels.filter(
            (channel) => channel.state?.state_name === ChannelState.ChannelReady,
          );
          channelsReady = readyChannels.length;
          canSend = readyChannels.some((channel) => BigInt(channel.local_balance) > 0n);
          canReceive = readyChannels.some((channel) => BigInt(channel.remote_balance) > 0n);
        } catch {
          rpcReachable = false;
        }
      }

      let recommendation = 'READY';
      const reasons: string[] = [];

      if (!binaryInfo.ready) {
        reasons.push('Fiber binary is missing or not executable.');
      }
      if (!configExists) {
        reasons.push('Config file is missing.');
      }
      if (!nodeRunning) {
        reasons.push('Node process is not running.');
      }
      if (nodeRunning && !rpcReachable) {
        reasons.push('Node process is running but RPC is not reachable.');
      }
      if (rpcReachable && channelsReady === 0) {
        reasons.push('No ChannelReady channel found.');
      }
      if (channelsReady > 0 && !canSend && canReceive) {
        reasons.push('Send liquidity is low on ChannelReady channels.');
      }
      if (channelsReady > 0 && canSend && !canReceive) {
        reasons.push('Receive liquidity is low on ChannelReady channels.');
      }
      if (channelsReady > 0 && !canSend && !canReceive) {
        reasons.push('ChannelReady channels exist but liquidity is zero.');
      }

      if (!binaryInfo.ready) {
        recommendation = 'INSTALL_BINARY';
      } else if (!configExists) {
        recommendation = 'INIT_CONFIG';
      } else if (!nodeRunning) {
        recommendation = 'START_NODE';
      } else if (!rpcReachable) {
        recommendation = 'WAIT_RPC';
      } else if (channelsReady === 0) {
        recommendation = 'OPEN_CHANNEL';
      } else if (!canSend && !canReceive) {
        recommendation = 'NO_LIQUIDITY';
      } else if (!canSend && canReceive) {
        recommendation = 'SEND_CAPACITY_LOW';
      } else if (canSend && !canReceive) {
        recommendation = 'RECEIVE_CAPACITY_LOW';
      }

      const output = {
        checks: {
          binary: {
            path: binaryInfo.path,
            ready: binaryInfo.ready,
            version: binaryInfo.version,
            source: config.binaryPath ? 'env-binary-path' : 'managed-binary-dir',
            managedPath: managedBinaryPath,
          },
          config: {
            path: config.configPath,
            exists: configExists,
            network: config.network,
            rpcUrl: config.rpcUrl,
          },
          node: {
            running: nodeRunning,
            pid: pid ?? null,
            rpcReachable,
          },
          channels: {
            total: channelsTotal,
            ready: channelsReady,
            canSend,
            canReceive,
          },
        },
        recommendation,
        reasons,
      };

      if (options.json) {
        printJsonSuccess(output);
      } else {
        console.log('Agent Check');
        console.log(`  Binary:        ${output.checks.binary.ready ? 'ready' : 'missing'}`);
        console.log(`  Config:        ${output.checks.config.exists ? 'present' : 'missing'}`);
        console.log(`  Node:          ${output.checks.node.running ? 'running' : 'stopped'}`);
        console.log(
          `  RPC:           ${output.checks.node.rpcReachable ? 'reachable' : 'unreachable'}`,
        );
        console.log(`  Channels:      ${channelsReady}/${channelsTotal} ready/total`);
        console.log(`  Can Send:      ${canSend ? 'yes' : 'no'}`);
        console.log(`  Can Receive:   ${canReceive ? 'yes' : 'no'}`);
        console.log(`  Recommendation:${recommendation}`);
        if (reasons.length > 0) {
          console.log('  Reasons:');
          for (const reason of reasons) {
            console.log(`    - ${reason}`);
          }
        }
      }
    });

  return agent;
}
