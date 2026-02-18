import { nodeIdToPeerId, scriptToAddress } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess, printNodeInfoHuman } from '../lib/format.js';
import { stopRuntimeDaemonFromNode } from '../lib/node-runtime-daemon.js';
import { runNodeStartCommand } from '../lib/node-start.js';
import { runNodeReadyCommand, runNodeStatusCommand } from '../lib/node-status.js';
import { isProcessRunning, readPidFile, removePidFile } from '../lib/pid.js';
import { createReadyRpcClient } from '../lib/rpc.js';
import { readRuntimeMeta, readRuntimePid, removeRuntimeFiles } from '../lib/runtime-meta.js';

export function createNodeCommand(config: CliConfig): Command {
  const node = new Command('node').description('Node management');

  node
    .command('start')
    .option('--runtime-daemon', 'Start runtime watcher as a detached daemon process')
    .option(
      '--runtime-proxy-listen <host:port>',
      'Runtime monitor proxy listen address',
      '127.0.0.1:8229',
    )
    .option('--event-stream <format>', 'Event stream format for --json mode (jsonl)', 'jsonl')
    .option('--json')
    .action(async (options) => {
      await runNodeStartCommand(config, options);
    });

  node
    .command('stop')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const runtimeMeta = readRuntimeMeta(config.dataDir);
      const runtimePid = readRuntimePid(config.dataDir);
      if (runtimeMeta?.daemon && runtimePid && isProcessRunning(runtimePid)) {
        stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
      }
      removeRuntimeFiles(config.dataDir);

      const pid = readPidFile(config.dataDir);
      if (!pid) {
        if (json) {
          printJsonError({
            code: 'NODE_NOT_RUNNING',
            message: 'No PID file found. Node may not be running.',
            recoverable: true,
            suggestion: 'Run `fiber-pay node start` first if you intend to stop a node.',
          });
        } else {
          console.log('❌ No PID file found. Node may not be running.');
        }
        process.exit(1);
      }

      if (!isProcessRunning(pid)) {
        if (json) {
          printJsonError({
            code: 'NODE_NOT_RUNNING',
            message: `Process ${pid} is not running. Cleaning up PID file.`,
            recoverable: true,
            suggestion: 'Start the node again if needed; stale PID has been cleaned.',
            details: { pid, stalePidFileCleaned: true },
          });
        } else {
          console.log(`❌ Process ${pid} is not running. Cleaning up PID file.`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (!json) {
        console.log(`🛑 Stopping node (PID: ${pid})...`);
      }
      process.kill(pid, 'SIGTERM');

      let attempts = 0;
      while (isProcessRunning(pid) && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      if (isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }

      removePidFile(config.dataDir);
      if (json) {
        printJsonSuccess({ pid, stopped: true });
      } else {
        console.log('✅ Node stopped.');
      }
    });

  node
    .command('status')
    .option('--json')
    .action(async (options) => {
      await runNodeStatusCommand(config, options);
    });

  node
    .command('ready')
    .description('Agent-oriented readiness summary for automation')
    .option('--json')
    .action(async (options) => {
      await runNodeReadyCommand(config, options);
    });

  node
    .command('info')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const nodeInfo = await rpc.nodeInfo();
      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      const peerId = await nodeIdToPeerId(nodeInfo.node_id);
      const output = {
        nodeId: nodeInfo.node_id,
        peerId,
        addresses: nodeInfo.addresses,
        chainHash: nodeInfo.chain_hash,
        fundingAddress,
        fundingLockScript: nodeInfo.default_funding_lock_script,
        version: nodeInfo.version,
        channelCount: parseInt(nodeInfo.channel_count, 16),
        pendingChannelCount: parseInt(nodeInfo.pending_channel_count, 16),
        peersCount: parseInt(nodeInfo.peers_count, 16),
      };

      if (options.json) {
        printJsonSuccess(output);
      } else {
        printNodeInfoHuman(output);
      }
    });

  return node;
}
