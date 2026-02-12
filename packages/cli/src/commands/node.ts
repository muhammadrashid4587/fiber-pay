import { join } from 'node:path';
import {
  ensureFiberBinary,
  type FiberNodeConfig,
  getDefaultBinaryPath,
  ProcessManager,
} from '@fiber-pay/node';
import { CorsProxy, scriptToAddress } from '@fiber-pay/sdk';
import { Command } from 'commander';
import { autoConnectBootnodes, extractBootnodeAddrs } from '../lib/bootnode.js';
import { type CliConfig, ensureNodeConfigFile } from '../lib/config.js';
import { printJson, printNodeInfoHuman } from '../lib/format.js';
import { isProcessRunning, readPidFile, removePidFile, writePidFile } from '../lib/pid.js';
import { createReadyRpcClient, createRpcClient } from '../lib/rpc.js';

export function createNodeCommand(config: CliConfig): Command {
  const node = new Command('node').description('Node management');

  node
    .command('start')
    .option('--cors-proxy [port]')
    .action(async (options) => {
      const existingPid = readPidFile(config.dataDir);
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(`❌ Node is already running (PID: ${existingPid})`);
        process.exit(1);
      }

      const corsProxyPort =
        options.corsProxy === true
          ? 28227
          : options.corsProxy
            ? parseInt(String(options.corsProxy), 10)
            : undefined;

      const binaryPath = config.binaryPath || getDefaultBinaryPath();
      await ensureFiberBinary();
      const configFilePath = ensureNodeConfigFile(config.dataDir, config.network);

      const nodeConfig: FiberNodeConfig = {
        binaryPath,
        dataDir: config.dataDir,
        configFilePath,
        chain: config.network,
      };

      const processManager = new ProcessManager(nodeConfig);
      await processManager.start();
      const processManagerState = processManager as unknown as {
        process?: { pid?: number };
      };
      const processId = processManagerState.process?.pid;
      if (processId !== undefined) {
        writePidFile(config.dataDir, processId);
      }

      let corsProxy: CorsProxy | undefined;
      if (corsProxyPort) {
        corsProxy = new CorsProxy({
          port: corsProxyPort,
          targetUrl: config.rpcUrl,
        });

        try {
          await corsProxy.start();
          console.log(`🌐 CORS proxy started on http://127.0.0.1:${corsProxyPort}`);
        } catch (error) {
          console.error(
            `⚠️  Failed to start CORS proxy: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const rpc = createRpcClient(config);
      try {
        await rpc.waitForReady({ timeout: 30000, interval: 500 });
      } catch {
        console.error('⚠️  RPC did not become ready within 30s. Node may still be starting.');
      }

      const bootnodes = nodeConfig.configFilePath
        ? extractBootnodeAddrs(nodeConfig.configFilePath)
        : extractBootnodeAddrs(join(config.dataDir, 'config.yml'));
      if (bootnodes.length > 0) {
        await autoConnectBootnodes(rpc, bootnodes);
      }

      console.log('✅ Fiber node started successfully!');
      console.log(`   RPC endpoint: ${config.rpcUrl}`);
      if (corsProxy) {
        console.log(`   CORS proxy:   http://127.0.0.1:${corsProxyPort} (browser-safe endpoint)`);
      }
      console.log('   Press Ctrl+C to stop.');

      const shutdown = async () => {
        console.log('\n🛑 Shutting down...');
        if (corsProxy) {
          await corsProxy.stop();
        }
        removePidFile(config.dataDir);
        await processManager.stop();
        console.log('✅ Node stopped.');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      await new Promise(() => {});
    });

  node.command('stop').action(async () => {
    const pid = readPidFile(config.dataDir);
    if (!pid) {
      console.log('❌ No PID file found. Node may not be running.');
      process.exit(1);
    }

    if (!isProcessRunning(pid)) {
      console.log(`❌ Process ${pid} is not running. Cleaning up PID file.`);
      removePidFile(config.dataDir);
      process.exit(1);
    }

    console.log(`🛑 Stopping node (PID: ${pid})...`);
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
    console.log('✅ Node stopped.');
  });

  node.command('status').action(async () => {
    const pid = readPidFile(config.dataDir);
    if (pid && isProcessRunning(pid)) {
      console.log(`✅ Node is running (PID: ${pid})`);
      try {
        const rpc = await createReadyRpcClient(config);
        const nodeInfo = await rpc.nodeInfo();
        console.log(`   Node ID: ${nodeInfo.node_id}`);
        console.log(`   RPC: ${config.rpcUrl}`);
      } catch {
        console.log('   ⚠️  RPC not responding');
      }
    } else {
      if (pid) {
        console.log(`❌ Node is not running (stale PID file: ${pid})`);
        removePidFile(config.dataDir);
      } else {
        console.log('❌ Node is not running');
      }
    }
  });

  node
    .command('info')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const nodeInfo = await rpc.nodeInfo();
      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      const output = {
        nodeId: nodeInfo.node_id,
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
        printJson({ success: true, data: output });
      } else {
        printNodeInfoHuman(output);
      }
    });

  return node;
}
