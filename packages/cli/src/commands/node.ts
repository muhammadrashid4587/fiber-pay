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
  ChannelState,
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
    .option('--event-stream <format>', 'Event stream format for --json mode (jsonl)', 'jsonl')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const eventStream = String(options.eventStream ?? 'jsonl').toLowerCase();
      const emitStage = (stage: string, status: 'ok' | 'error', data: Record<string, unknown>) => {
        if (!json) return;
        printJsonEvent('startup_stage', { stage, status, ...data });
      };
      if (json && eventStream !== 'jsonl') {
        printJsonError({
          code: 'NODE_EVENT_STREAM_INVALID',
          message: `Unsupported --event-stream format: ${options.eventStream}. Expected: jsonl`,
          recoverable: true,
          suggestion: 'Use `--event-stream jsonl` when using --json.',
          details: { provided: options.eventStream, expected: ['jsonl'] },
        });
        process.exit(1);
      }
      emitStage('init', 'ok', { rpcUrl: config.rpcUrl, dataDir: config.dataDir });
      const existingPid = readPidFile(config.dataDir);
      if (existingPid && isProcessRunning(existingPid)) {
        if (json) {
          printJsonError({
            code: 'NODE_ALREADY_RUNNING',
            message: `Node is already running (PID: ${existingPid})`,
            recoverable: true,
            suggestion: 'Skip start or run `fiber-pay node stop` before retrying.',
            details: { pid: existingPid },
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
      emitStage('binary_resolved', 'ok', {
        binaryPath,
        binaryVersion,
        configFilePath,
      });

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
        emitStage('key_initialized', 'ok', {});
      } catch (error) {
        const message = `Failed to initialize node keys: ${error instanceof Error ? error.message : String(error)}`;
        emitStage('key_initialized', 'error', { code: 'NODE_KEY_INIT_FAILED', message });
        if (json) {
          printJsonError({
            code: 'NODE_KEY_INIT_FAILED',
            message,
            recoverable: true,
            suggestion: 'Verify key password and write permission for the data directory.',
            details: { dataDir: config.dataDir },
          });
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
      emitStage('process_started', 'ok', { pid: processId ?? null });

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
        emitStage('process_started', 'error', {
          code: 'NODE_STARTUP_EXITED',
          details,
        });
        if (json) {
          printJsonError({
            code: 'NODE_STARTUP_EXITED',
            message: `Fiber node exited during startup${details}`,
            recoverable: true,
            suggestion: 'Inspect fnn logs and verify config ports are free before retrying.',
            details: earlyStop ?? undefined,
          });
        } else {
          console.error(`❌ Fiber node exited during startup${details}`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (!rpcReady) {
        emitStage('rpc_ready', 'error', {
          code: 'NODE_RPC_NOT_READY',
          timeoutSeconds: 30,
        });
        if (json) {
          printJsonError({
            code: 'NODE_RPC_NOT_READY',
            message: 'RPC did not become ready within 30s. Node startup failed.',
            recoverable: true,
            suggestion: 'Retry after a delay and verify RPC port + config consistency.',
            details: { timeoutSeconds: 30, rpcUrl: config.rpcUrl },
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
      emitStage('rpc_ready', 'ok', { rpcUrl: config.rpcUrl });

      const bootnodes = nodeConfig.configFilePath
        ? extractBootnodeAddrs(nodeConfig.configFilePath)
        : extractBootnodeAddrs(join(config.dataDir, 'config.yml'));
      if (bootnodes.length > 0) {
        await autoConnectBootnodes(rpc, bootnodes);
      }
      emitStage('bootnodes_connected', 'ok', { count: bootnodes.length });

      if (earlyStop || processManager.getState() === 'stopped') {
        const details = formatStopDetails(earlyStop);
        emitStage('bootnodes_connected', 'error', {
          code: 'NODE_STARTUP_EXITED',
          details,
        });
        if (json) {
          printJsonError({
            code: 'NODE_STARTUP_EXITED',
            message: `Fiber node exited during startup${details}`,
            recoverable: true,
            suggestion: 'Inspect fnn logs and verify config ports are free before retrying.',
            details: earlyStop ?? undefined,
          });
        } else {
          console.error(`❌ Fiber node exited during startup${details}`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (json) {
        emitStage('startup_complete', 'ok', {
          pid: processId ?? null,
          rpcUrl: config.rpcUrl,
        });
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
            recoverable: true,
            suggestion: 'Check process logs and restart the node when configuration is healthy.',
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
    .command('ready')
    .description('Agent-oriented readiness summary for automation')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const pid = readPidFile(config.dataDir);
      const output: Record<string, unknown> = {
        nodeRunning: false,
        rpcReachable: false,
        channelsTotal: 0,
        channelsReady: 0,
        canSend: false,
        canReceive: false,
        recommendation: 'NODE_STOPPED',
        reasons: ['Node process is not running.'],
        pid: pid ?? null,
        rpcUrl: config.rpcUrl,
      };

      if (pid && isProcessRunning(pid)) {
        output.nodeRunning = true;
        output.reasons = [];

        try {
          const rpc = await createReadyRpcClient(config);
          output.rpcReachable = true;
          const channels = await rpc.listChannels({ include_closed: false });
          output.channelsTotal = channels.channels.length;

          const readyChannels = channels.channels.filter(
            (channel) => channel.state?.state_name === ChannelState.ChannelReady,
          );
          output.channelsReady = readyChannels.length;

          const canSend = readyChannels.some((channel) => BigInt(channel.local_balance) > 0n);
          const canReceive = readyChannels.some((channel) => BigInt(channel.remote_balance) > 0n);
          output.canSend = canSend;
          output.canReceive = canReceive;

          if (readyChannels.length === 0) {
            output.recommendation = 'NEED_CHANNEL';
            output.reasons = [
              'No ChannelReady channel found. Open and wait for channel readiness.',
            ];
          } else if (canSend && canReceive) {
            output.recommendation = 'READY';
            output.reasons = ['Node is reachable and has send/receive liquidity.'];
          } else if (canSend) {
            output.recommendation = 'RECEIVE_CAPACITY_LOW';
            output.reasons = ['Receive liquidity is low on all ChannelReady channels.'];
          } else if (canReceive) {
            output.recommendation = 'SEND_CAPACITY_LOW';
            output.reasons = ['Send liquidity is low on all ChannelReady channels.'];
          } else {
            output.recommendation = 'NO_LIQUIDITY';
            output.reasons = [
              'ChannelReady channels exist but both local/remote liquidity are zero.',
            ];
          }
        } catch {
          output.rpcReachable = false;
          output.recommendation = 'RPC_UNREACHABLE';
          output.reasons = ['Node process is running but RPC is not reachable.'];
        }
      } else if (pid) {
        output.recommendation = 'NODE_STOPPED';
        output.reasons = ['Stale PID file detected and cleaned.'];
        removePidFile(config.dataDir);
      }

      if (json) {
        printJsonSuccess(output);
      } else {
        console.log('Node Readiness');
        console.log(`  Node Running:   ${output.nodeRunning ? 'yes' : 'no'}`);
        console.log(`  RPC Reachable:  ${output.rpcReachable ? 'yes' : 'no'}`);
        console.log(
          `  Channels:       ${output.channelsReady}/${output.channelsTotal} ready/total`,
        );
        console.log(`  Can Send:       ${output.canSend ? 'yes' : 'no'}`);
        console.log(`  Can Receive:    ${output.canReceive ? 'yes' : 'no'}`);
        console.log(`  Recommendation: ${String(output.recommendation)}`);
        const reasons = Array.isArray(output.reasons) ? output.reasons : [];
        if (reasons.length > 0) {
          console.log('  Reasons:');
          for (const reason of reasons) {
            console.log(`    - ${String(reason)}`);
          }
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
