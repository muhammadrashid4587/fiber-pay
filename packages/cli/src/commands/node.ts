import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureFiberBinary,
  type FiberNodeConfig,
  getDefaultBinaryPath,
  getFiberBinaryInfo,
  ProcessManager,
} from '@fiber-pay/node';
import { startRuntimeService } from '@fiber-pay/runtime';
import {
  buildMultiaddrFromNodeId,
  buildMultiaddrFromRpcUrl,
  ChannelState,
  createKeyManager,
  nodeIdToPeerId,
  type Script,
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
import { createReadyRpcClient, createRpcClient, resolveRpcEndpoint } from '../lib/rpc.js';

const CELLS_PAGE_SIZE = 100;

interface IndexerCellsResponse {
  objects: Array<{ output?: { capacity?: string } }>;
  last_cursor?: string;
}

interface RuntimeMeta {
  pid: number;
  startedAt: string;
  fiberRpcUrl: string;
  proxyListen: string;
  stateFilePath?: string;
  daemon: boolean;
}

async function callJsonRpc<TResult>(
  url: string,
  method: string,
  params: unknown[],
): Promise<TResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    result?: TResult;
    error?: { message?: string; code?: number };
  };

  if (payload.error) {
    const code = payload.error.code ?? 'unknown';
    const message = payload.error.message ?? 'JSON-RPC error';
    throw new Error(`${message} (code: ${code})`);
  }

  if (payload.result === undefined) {
    throw new Error('Missing JSON-RPC result');
  }

  return payload.result;
}

async function getLockBalanceShannons(ckbRpcUrl: string, lockScript: Script): Promise<bigint> {
  let cursor: string | undefined;
  let total = 0n;
  const limitHex = `0x${CELLS_PAGE_SIZE.toString(16)}`;

  for (let i = 0; i < 2000; i++) {
    const params: unknown[] = [{ script: lockScript, script_type: 'lock' }, 'asc', limitHex];
    if (cursor) {
      params.push(cursor);
    }

    const page = await callJsonRpc<IndexerCellsResponse>(ckbRpcUrl, 'get_cells', params);
    const cells = page.objects ?? [];

    for (const cell of cells) {
      if (cell.output?.capacity) {
        total += BigInt(cell.output.capacity);
      }
    }

    const nextCursor = page.last_cursor;
    if (!nextCursor || nextCursor === cursor || cells.length < CELLS_PAGE_SIZE) {
      break;
    }
    cursor = nextCursor;
  }

  return total;
}

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

function getCliEntrypoint(): string {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Unable to resolve CLI entrypoint path');
  }
  return entrypoint;
}

function getRuntimePidFilePath(dataDir: string): string {
  return join(dataDir, 'runtime.pid');
}

function getRuntimeMetaFilePath(dataDir: string): string {
  return join(dataDir, 'runtime.meta.json');
}

function writeRuntimePid(dataDir: string, pid: number): void {
  writeFileSync(getRuntimePidFilePath(dataDir), String(pid));
}

function writeRuntimeMeta(dataDir: string, meta: RuntimeMeta): void {
  writeFileSync(getRuntimeMetaFilePath(dataDir), JSON.stringify(meta, null, 2));
}

function removeRuntimeFiles(dataDir: string): void {
  const runtimePidPath = getRuntimePidFilePath(dataDir);
  const runtimeMetaPath = getRuntimeMetaFilePath(dataDir);
  if (existsSync(runtimePidPath)) {
    unlinkSync(runtimePidPath);
  }
  if (existsSync(runtimeMetaPath)) {
    unlinkSync(runtimeMetaPath);
  }
}

function readRuntimePid(dataDir: string): number | null {
  const runtimePidPath = getRuntimePidFilePath(dataDir);
  if (!existsSync(runtimePidPath)) {
    return null;
  }
  try {
    return Number.parseInt(readFileSync(runtimePidPath, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function readRuntimeMeta(dataDir: string): RuntimeMeta | null {
  const runtimeMetaPath = getRuntimeMetaFilePath(dataDir);
  if (!existsSync(runtimeMetaPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(runtimeMetaPath, 'utf-8')) as RuntimeMeta;
  } catch {
    return null;
  }
}

function startRuntimeDaemonFromNode(params: {
  dataDir: string;
  rpcUrl: string;
  proxyListen: string;
  stateFilePath: string;
}): { ok: true } | { ok: false; message: string } {
  const cliEntrypoint = getCliEntrypoint();
  const result = spawnSync(
    process.execPath,
    [
      cliEntrypoint,
      '--data-dir',
      params.dataDir,
      '--rpc-url',
      params.rpcUrl,
      'runtime',
      'start',
      '--daemon',
      '--fiber-rpc-url',
      params.rpcUrl,
      '--proxy-listen',
      params.proxyListen,
      '--state-file',
      params.stateFilePath,
      '--json',
    ],
    { encoding: 'utf-8' },
  );

  if (result.status === 0) {
    return { ok: true };
  }

  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '').trim();
  const details = stderr || stdout || `exit code ${result.status ?? 'unknown'}`;
  return { ok: false, message: details };
}

function stopRuntimeDaemonFromNode(params: { dataDir: string; rpcUrl: string }): void {
  const cliEntrypoint = getCliEntrypoint();
  spawnSync(
    process.execPath,
    [
      cliEntrypoint,
      '--data-dir',
      params.dataDir,
      '--rpc-url',
      params.rpcUrl,
      'runtime',
      'stop',
      '--json',
    ],
    { encoding: 'utf-8' },
  );
}

export function createNodeCommand(config: CliConfig): Command {
  const node = new Command('node').description('Node management');

  node
    .command('start')
    .option('--runtime-daemon', 'Start runtime watcher as a detached daemon process')
    .option(
      '--runtime-proxy-listen <host:port>',
      'Runtime monitor proxy listen address',
      '127.0.0.1:8228',
    )
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

      const runtimeDaemon = Boolean(options.runtimeDaemon);
      const runtimeProxyListen = String(options.runtimeProxyListen ?? '127.0.0.1:8228');
      const runtimeStateFilePath = join(config.dataDir, 'runtime-state.json');

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

      let runtime: Awaited<ReturnType<typeof startRuntimeService>> | undefined;

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
        if (runtimeDaemon) {
          stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
        } else if (runtime) {
          await runtime.stop().catch(() => undefined);
        }
        removeRuntimeFiles(config.dataDir);
        process.exit(1);
      }

      try {
        if (runtimeDaemon) {
          const daemonStart = startRuntimeDaemonFromNode({
            dataDir: config.dataDir,
            rpcUrl: config.rpcUrl,
            proxyListen: runtimeProxyListen,
            stateFilePath: runtimeStateFilePath,
          });
          if (!daemonStart.ok) {
            throw new Error(daemonStart.message);
          }
        } else {
          runtime = await startRuntimeService({
            fiberRpcUrl: config.rpcUrl,
            proxy: {
              enabled: true,
              listen: runtimeProxyListen,
            },
            storage: {
              stateFilePath: runtimeStateFilePath,
            },
          });

          const runtimeStatus = runtime.service.getStatus();
          writeRuntimePid(config.dataDir, process.pid);
          writeRuntimeMeta(config.dataDir, {
            pid: process.pid,
            startedAt: runtimeStatus.startedAt,
            fiberRpcUrl: runtimeStatus.targetUrl,
            proxyListen: runtimeStatus.proxyListen,
            stateFilePath: runtimeStateFilePath,
            daemon: false,
          });
        }

        emitStage('runtime_started', 'ok', {
          proxyListen: runtimeProxyListen,
          daemon: runtimeDaemon,
        });
      } catch (error) {
        const message = `Runtime failed to start: ${error instanceof Error ? error.message : String(error)}`;
        emitStage('runtime_started', 'error', {
          code: 'NODE_RUNTIME_START_FAILED',
          message,
          proxyListen: runtimeProxyListen,
        });
        if (json) {
          printJsonError({
            code: 'NODE_RUNTIME_START_FAILED',
            message,
            recoverable: true,
            suggestion: 'Retry with a free --runtime-proxy-listen port.',
            details: {
              runtimeProxyListen,
            },
          });
        } else {
          console.error(`❌ ${message}`);
        }

        removeRuntimeFiles(config.dataDir);
        removePidFile(config.dataDir);
        await processManager.stop().catch(() => undefined);
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
        if (runtimeDaemon) {
          stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
        } else if (runtime) {
          await runtime.stop().catch(() => undefined);
          removeRuntimeFiles(config.dataDir);
        }
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
          runtimeEnabled: true,
          runtimeDaemon,
          proxyUrl: `http://${runtimeProxyListen}`,
        });
      } else {
        console.log('✅ Fiber node started successfully!');
        console.log(`   RPC endpoint: ${config.rpcUrl}`);
        console.log(
          `   Runtime proxy: http://${runtimeProxyListen} (browser-safe endpoint + monitoring)`,
        );
        console.log(`   Runtime mode:  ${runtimeDaemon ? 'daemon' : 'embedded'}`);
        console.log('   Press Ctrl+C to stop.');
      }

      let shutdownRequested = false;
      const shutdown = async () => {
        if (shutdownRequested) return;
        shutdownRequested = true;
        if (!json) {
          console.log('\n🛑 Shutting down...');
        }
        if (runtimeDaemon) {
          stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
        } else if (runtime) {
          await runtime.stop();
        }
        removeRuntimeFiles(config.dataDir);
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
        if (runtimeDaemon) {
          stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
        }
        removeRuntimeFiles(config.dataDir);
        process.exit(1);
      }
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
      const json = Boolean(options.json);
      const pid = readPidFile(config.dataDir);
      const resolvedRpc = resolveRpcEndpoint(config);
      const managedBinaryPath = join(config.dataDir, 'bin', 'fnn');
      const binaryInfo = config.binaryPath
        ? getCustomBinaryState(config.binaryPath)
        : await getFiberBinaryInfo(join(config.dataDir, 'bin'));
      const configExists = existsSync(config.configPath);
      const nodeRunning = Boolean(pid && isProcessRunning(pid));

      let rpcResponsive = false;
      let nodeId: string | null = null;
      let peerId: string | null = null;
      let peerIdError: string | null = null;
      let multiaddr: string | null = null;
      let multiaddrError: string | null = null;
      let multiaddrInferred = false;
      let channelsTotal = 0;
      let channelsReady = 0;
      let canSend = false;
      let canReceive = false;
      let localCkb = 0;
      let remoteCkb = 0;
      let fundingAddress: string | null = null;
      let fundingCkb = 0;
      let fundingBalanceError: string | null = null;

      if (nodeRunning) {
        try {
          const rpc = await createReadyRpcClient(config);
          const nodeInfo = await rpc.nodeInfo();
          const channels = await rpc.listChannels({ include_closed: false });
          rpcResponsive = true;

          nodeId = nodeInfo.node_id;
          try {
            peerId = await nodeIdToPeerId(nodeInfo.node_id);
          } catch (error) {
            peerIdError = error instanceof Error ? error.message : String(error);
          }

          const baseAddress = nodeInfo.addresses[0];
          if (baseAddress) {
            try {
              multiaddr = await buildMultiaddrFromNodeId(baseAddress, nodeInfo.node_id);
            } catch (error) {
              multiaddrError = error instanceof Error ? error.message : String(error);
            }
          } else if (peerId) {
            try {
              multiaddr = buildMultiaddrFromRpcUrl(config.rpcUrl, peerId);
              multiaddrInferred = true;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              multiaddrError = `no advertised addresses; infer failed: ${reason}`;
            }
          }

          channelsTotal = channels.channels.length;
          const readyChannels = channels.channels.filter(
            (channel) => channel.state?.state_name === ChannelState.ChannelReady,
          );
          channelsReady = readyChannels.length;
          canSend = readyChannels.some((channel) => BigInt(channel.local_balance) > 0n);
          canReceive = readyChannels.some((channel) => BigInt(channel.remote_balance) > 0n);

          let totalLocal = 0n;
          let totalRemote = 0n;
          for (const channel of readyChannels) {
            totalLocal += BigInt(channel.local_balance);
            totalRemote += BigInt(channel.remote_balance);
          }
          localCkb = Number(totalLocal) / 1e8;
          remoteCkb = Number(totalRemote) / 1e8;

          fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
          if (config.ckbRpcUrl) {
            try {
              const fundingBalance = await getLockBalanceShannons(
                config.ckbRpcUrl,
                nodeInfo.default_funding_lock_script as Script,
              );
              fundingCkb = Number(fundingBalance) / 1e8;
            } catch (error) {
              fundingBalanceError =
                error instanceof Error
                  ? error.message
                  : 'Failed to query CKB balance for funding address';
            }
          } else {
            fundingBalanceError =
              'CKB RPC URL not configured (set ckb.rpc_url in config.yml or FIBER_CKB_RPC_URL)';
          }
        } catch {
          rpcResponsive = false;
        }
      } else if (pid) {
        removePidFile(config.dataDir);
      }

      let recommendation = 'READY';
      const reasons: string[] = [];

      if (!binaryInfo.ready) reasons.push('Fiber binary is missing or not executable.');
      if (!configExists) reasons.push('Config file is missing.');
      if (!nodeRunning) reasons.push('Node process is not running.');
      if (nodeRunning && !rpcResponsive)
        reasons.push('Node process is running but RPC is not reachable.');
      if (rpcResponsive && channelsReady === 0) reasons.push('No ChannelReady channel found.');
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
      } else if (!rpcResponsive) {
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
        running: nodeRunning,
        pid: pid ?? null,
        rpcResponsive,
        rpcUrl: config.rpcUrl,
        rpcTarget: resolvedRpc.target,
        resolvedRpcUrl: resolvedRpc.url,
        nodeId,
        peerId,
        peerIdError,
        multiaddr,
        multiaddrError,
        multiaddrInferred,
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
            rpcReachable: rpcResponsive,
            rpcTarget: resolvedRpc.target,
            rpcClientUrl: resolvedRpc.url,
          },
          channels: {
            total: channelsTotal,
            ready: channelsReady,
            canSend,
            canReceive,
          },
        },
        balance: {
          totalCkb: localCkb + fundingCkb,
          channelLocalCkb: localCkb,
          availableToSend: localCkb,
          availableToReceive: remoteCkb,
          channelCount: channelsTotal,
          activeChannelCount: channelsReady,
          fundingAddress,
          fundingAddressTotalCkb: fundingCkb,
          fundingBalanceError,
        },
        recommendation,
        reasons,
      };

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
          console.log(
            `   RPC Client: ${String(output.rpcTarget)} (${String(output.resolvedRpcUrl)})`,
          );
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

      console.log('');
      console.log('Diagnostics');
      console.log(`  Binary:        ${output.checks.binary.ready ? 'ready' : 'missing'}`);
      console.log(`  Config:        ${output.checks.config.exists ? 'present' : 'missing'}`);
      console.log(
        `  RPC:           ${output.checks.node.rpcReachable ? 'reachable' : 'unreachable'}`,
      );
      console.log(
        `  Channels:      ${output.checks.channels.ready}/${output.checks.channels.total} ready/total`,
      );
      console.log(`  Can Send:      ${output.checks.channels.canSend ? 'yes' : 'no'}`);
      console.log(`  Can Receive:   ${output.checks.channels.canReceive ? 'yes' : 'no'}`);
      console.log(`  Recommendation:${output.recommendation}`);
      if (output.reasons.length > 0) {
        console.log('  Reasons:');
        for (const reason of output.reasons) {
          console.log(`    - ${reason}`);
        }
      }

      console.log('');
      console.log('Balance');
      console.log(`  Total CKB:     ${output.balance.totalCkb.toFixed(8)}`);
      console.log(`  Channel Local: ${output.balance.channelLocalCkb.toFixed(8)}`);
      console.log(`  To Send:       ${output.balance.availableToSend.toFixed(8)}`);
      console.log(`  To Receive:    ${output.balance.availableToReceive.toFixed(8)}`);
      console.log(
        `  Channels:      ${output.balance.activeChannelCount}/${output.balance.channelCount} active/total`,
      );
      if (output.balance.fundingAddress) {
        console.log(`  Funding Addr:  ${output.balance.fundingAddress}`);
      }
      console.log(`  Funding CKB:   ${output.balance.fundingAddressTotalCkb.toFixed(8)}`);
      if (output.balance.fundingBalanceError) {
        console.log(`  Funding Err:   ${output.balance.fundingBalanceError}`);
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
