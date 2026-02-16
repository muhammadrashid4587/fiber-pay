import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  ensureFiberBinary,
  type FiberNodeConfig,
  getDefaultBinaryPath,
  ProcessManager,
} from '@fiber-pay/node';
import {
  buildMultiaddrFromNodeId,
  buildMultiaddrFromRpcUrl,
  CorsProxy,
  createKeyManager,
  nodeIdToPeerId,
  scriptToAddress,
} from '@fiber-pay/sdk';
import { Command } from 'commander';
import { autoConnectBootnodes, extractBootnodeAddrs } from '../lib/bootnode.js';
import { type CliConfig, ensureNodeConfigFile } from '../lib/config.js';
import {
  printJsonError,
  printJsonEvent,
  printJsonSuccess,
  printNodeInfoHuman,
} from '../lib/format.js';
import { isProcessRunning, readPidFile, removePidFile, writePidFile } from '../lib/pid.js';
import { createReadyRpcClient, createRpcClient } from '../lib/rpc.js';

function getBinaryVersion(binaryPath: string): string {
  try {
    const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return 'unknown';
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (!output) {
      return 'unknown';
    }
    const firstLine = output.split('\n').find((line) => line.trim().length > 0);
    return firstLine?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createNodeCommand(config: CliConfig): Command {
  const node = new Command('node').description('Node management');

  node
    .command('start')
    .option('--cors-proxy [port]')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const existingPid = readPidFile(config.dataDir);
      if (existingPid && isProcessRunning(existingPid)) {
        if (json) {
          printJsonError({
            code: 'NODE_ALREADY_RUNNING',
            message: `Node is already running (PID: ${existingPid})`,
          });
        } else {
          console.log(`❌ Node is already running (PID: ${existingPid})`);
        }
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
      const binaryVersion = getBinaryVersion(binaryPath);
      const configFilePath = ensureNodeConfigFile(config.dataDir, config.network);

      if (!json) {
        console.log(`🧩 Binary: ${binaryPath}`);
        console.log(`🧩 Version: ${binaryVersion}`);
      }

      const nodeConfig: FiberNodeConfig = {
        binaryPath,
        dataDir: config.dataDir,
        configFilePath,
        chain: config.network,
        keyPassword: config.keyPassword,
      };

      try {
        const keyManager = createKeyManager(config.dataDir, {
          encryptionPassword: config.keyPassword,
          autoGenerate: true,
        });
        await keyManager.initialize();
      } catch (error) {
        const message = `Failed to initialize node keys: ${error instanceof Error ? error.message : String(error)}`;
        if (json) {
          printJsonError({ code: 'NODE_KEY_INIT_FAILED', message });
        } else {
          console.error(`❌ ${message}`);
        }
        process.exit(1);
      }

      const processManager = new ProcessManager(nodeConfig);
      let earlyStop: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      const formatStopDetails = (
        stop: { code: number | null; signal: NodeJS.Signals | null } | null,
      ): string => {
        if (!stop) return '';
        return ` (code: ${stop.code ?? 'null'}, signal: ${stop.signal ?? 'null'})`;
      };
      processManager.on('stopped', (code, signal) => {
        earlyStop = { code, signal };
        removePidFile(config.dataDir);
      });
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
          if (!json) {
            console.log(`🌐 CORS proxy started on http://127.0.0.1:${corsProxyPort}`);
          }
        } catch (error) {
          const message = `Failed to start CORS proxy: ${error instanceof Error ? error.message : String(error)}`;
          if (!json) {
            console.error(`⚠️  ${message}`);
          }
        }
      }

      const rpc = createRpcClient(config);
      let rpcReady = true;
      try {
        await rpc.waitForReady({ timeout: 30000, interval: 500 });
      } catch {
        rpcReady = false;
      }

      if (earlyStop || processManager.getState() === 'stopped') {
        const details = formatStopDetails(earlyStop);
        if (json) {
          printJsonError({
            code: 'NODE_STARTUP_EXITED',
            message: `Fiber node exited during startup${details}`,
          });
        } else {
          console.error(`❌ Fiber node exited during startup${details}`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (!rpcReady) {
        if (json) {
          printJsonError({
            code: 'NODE_RPC_NOT_READY',
            message: 'RPC did not become ready within 30s. Node startup failed.',
          });
        } else {
          console.error('❌ RPC did not become ready within 30s. Node startup failed.');
        }
        const stderrTail = processManager.getStderr(12).join('').trim();
        const stdoutTail = processManager.getStdout(12).join('').trim();
        if (!json && stderrTail.length > 0) {
          console.error('--- fnn stderr (tail) ---');
          console.error(stderrTail);
        }
        if (!json && stdoutTail.length > 0) {
          console.error('--- fnn stdout (tail) ---');
          console.error(stdoutTail);
        }

        removePidFile(config.dataDir);
        await processManager.stop().catch(() => undefined);
        process.exit(1);
      }

      const bootnodes = nodeConfig.configFilePath
        ? extractBootnodeAddrs(nodeConfig.configFilePath)
        : extractBootnodeAddrs(join(config.dataDir, 'config.yml'));
      if (bootnodes.length > 0) {
        await autoConnectBootnodes(rpc, bootnodes);
      }

      if (earlyStop || processManager.getState() === 'stopped') {
        const details = formatStopDetails(earlyStop);
        if (json) {
          printJsonError({
            code: 'NODE_STARTUP_EXITED',
            message: `Fiber node exited during startup${details}`,
          });
        } else {
          console.error(`❌ Fiber node exited during startup${details}`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (json) {
        printJsonEvent('node_started', {
          rpcUrl: config.rpcUrl,
          binaryPath,
          binaryVersion,
          pid: processId ?? null,
          corsProxyUrl: corsProxy ? `http://127.0.0.1:${corsProxyPort}` : null,
        });
      } else {
        console.log('✅ Fiber node started successfully!');
        console.log(`   RPC endpoint: ${config.rpcUrl}`);
        if (corsProxy) {
          console.log(`   CORS proxy:   http://127.0.0.1:${corsProxyPort} (browser-safe endpoint)`);
        }
        console.log('   Press Ctrl+C to stop.');
      }

      let shutdownRequested = false;
      const shutdown = async () => {
        if (shutdownRequested) return;
        shutdownRequested = true;
        if (!json) {
          console.log('\n🛑 Shutting down...');
        }
        if (corsProxy) {
          await corsProxy.stop();
        }
        removePidFile(config.dataDir);
        await processManager.stop();
        if (json) {
          printJsonEvent('node_stopped', { reason: 'signal' });
        } else {
          console.log('✅ Node stopped.');
        }
      };

      await new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => undefined, 60_000);

        const cleanup = () => {
          clearInterval(keepAlive);
          process.off('SIGINT', onSigInt);
          process.off('SIGTERM', onSigTerm);
          processManager.off('stopped', onStopped);
          resolve();
        };

        const onStopped = () => {
          cleanup();
        };

        const onSigInt = () => {
          shutdown().finally(cleanup);
        };

        const onSigTerm = () => {
          shutdown().finally(cleanup);
        };

        process.on('SIGINT', onSigInt);
        process.on('SIGTERM', onSigTerm);
        processManager.on('stopped', onStopped);
      });

      if (!shutdownRequested) {
        if (json) {
          printJsonError({
            code: 'NODE_STOPPED_UNEXPECTEDLY',
            message: 'Fiber node stopped unexpectedly.',
          });
        } else {
          console.error('❌ Fiber node stopped unexpectedly.');
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }
    });

  node
    .command('stop')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const pid = readPidFile(config.dataDir);
      if (!pid) {
        if (json) {
          printJsonError({
            code: 'NODE_NOT_RUNNING',
            message: 'No PID file found. Node may not be running.',
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
      const json = Boolean(options.json);
      const pid = readPidFile(config.dataDir);
      const output: Record<string, unknown> = {
        running: false,
        pid: pid ?? null,
        rpcResponsive: false,
      };

      if (pid && isProcessRunning(pid)) {
        output.running = true;
        try {
          const rpc = await createReadyRpcClient(config);
          const nodeInfo = await rpc.nodeInfo();
          output.rpcResponsive = true;
          output.nodeId = nodeInfo.node_id;
          output.rpcUrl = config.rpcUrl;
          let peerId: string | undefined;
          try {
            peerId = await nodeIdToPeerId(nodeInfo.node_id);
            output.peerId = peerId;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            output.peerId = null;
            output.peerIdError = reason;
          }

          const baseAddress = nodeInfo.addresses[0];
          if (baseAddress) {
            try {
              const multiaddr = await buildMultiaddrFromNodeId(baseAddress, nodeInfo.node_id);
              output.multiaddr = multiaddr;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              output.multiaddr = null;
              output.multiaddrError = reason;
            }
          } else if (peerId) {
            try {
              const inferredMultiaddr = buildMultiaddrFromRpcUrl(config.rpcUrl, peerId);
              output.multiaddr = inferredMultiaddr;
              output.multiaddrInferred = true;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              output.multiaddr = null;
              output.multiaddrError = `no advertised addresses; infer failed: ${reason}`;
            }
          } else {
            output.multiaddr = null;
          }
        } catch {
          output.rpcResponsive = false;
        }
      } else {
        if (pid) {
          output.stalePidFile = true;
          removePidFile(config.dataDir);
        }
      }

      if (json) {
        printJsonSuccess(output);
        return;
      }

      if (output.running) {
        console.log(`✅ Node is running (PID: ${output.pid})`);
        if (output.rpcResponsive) {
          console.log(`   Node ID: ${String(output.nodeId)}`);
          if (output.peerId) {
            console.log(`   Peer ID: ${String(output.peerId)}`);
          } else if (output.peerIdError) {
            console.log(`   Peer ID: unavailable (${String(output.peerIdError)})`);
          }
          console.log(`   RPC: ${String(output.rpcUrl)}`);
          if (output.multiaddr) {
            const inferredSuffix = output.multiaddrInferred
              ? ' (inferred from RPC + peerId; no advertised addresses)'
              : '';
            console.log(`   Multiaddr: ${String(output.multiaddr)}${inferredSuffix}`);
          } else if (output.multiaddrError) {
            console.log(`   Multiaddr: unavailable (${String(output.multiaddrError)})`);
          } else {
            console.log('   Multiaddr: unavailable');
          }
        } else {
          console.log('   ⚠️  RPC not responding');
        }
      } else if (output.pid) {
        console.log(`❌ Node is not running (stale PID file: ${output.pid})`);
      } else {
        console.log('❌ Node is not running');
      }
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
