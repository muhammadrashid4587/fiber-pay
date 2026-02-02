/**
 * fiber-pay CLI
 * Command-line interface for AI agents to manage CKB Lightning payments
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { FiberPay, createFiberPay, MCP_TOOLS, downloadFiberBinary, getFiberBinaryInfo, FiberRpcClient } from './index.js';
import type { McpToolName } from './agent/mcp-tools.js';
import type { DownloadProgress } from './binary/index.js';

// =============================================================================
// CLI Configuration
// =============================================================================

interface CliConfig {
  binaryPath?: string;
  dataDir: string;
  network: 'testnet' | 'mainnet';
  rpcUrl?: string;
  keyPassword?: string;
}

function getConfig(): CliConfig {
  return {
    binaryPath: process.env.FIBER_BINARY_PATH,
    dataDir: process.env.FIBER_DATA_DIR || `${process.env.HOME}/.fiber-pay`,
    network: (process.env.FIBER_NETWORK as 'testnet' | 'mainnet') || 'testnet',
    rpcUrl: process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227',
    keyPassword: process.env.FIBER_KEY_PASSWORD,
  };
}

// =============================================================================
// PID File Management
// =============================================================================

function getPidFilePath(dataDir: string): string {
  return join(dataDir, 'fiber.pid');
}

function writePidFile(dataDir: string, pid: number): void {
  writeFileSync(getPidFilePath(dataDir), String(pid));
}

function readPidFile(dataDir: string): number | null {
  const pidPath = getPidFilePath(dataDir);
  if (!existsSync(pidPath)) {
    return null;
  }
  try {
    return parseInt(readFileSync(pidPath, 'utf-8').trim());
  } catch {
    return null;
  }
}

function removePidFile(dataDir: string): void {
  const pidPath = getPidFilePath(dataDir);
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Download Progress Display
// =============================================================================

function showProgress(progress: DownloadProgress): void {
  const percent = progress.percent !== undefined ? ` (${progress.percent}%)` : '';
  process.stdout.write(`\r[${progress.phase}]${percent} ${progress.message}`.padEnd(80));
  if (progress.phase === 'installing') {
    console.log(); // New line after install
  }
}

// =============================================================================
// Command Handlers
// =============================================================================

async function handleCommand(fiber: FiberPay, command: string, args: string[]): Promise<void> {
  switch (command) {
    case 'init':
    case 'initialize': {
      const result = await fiber.initialize({
        onDownloadProgress: showProgress,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'balance':
    case 'get-balance': {
      const result = await fiber.getBalance();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'pay': {
      const params: { invoice?: string; recipientNodeId?: string; amountCkb?: number } = {};
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--invoice' && args[i + 1]) {
          params.invoice = args[++i];
        } else if (args[i] === '--to' && args[i + 1]) {
          params.recipientNodeId = args[++i];
        } else if (args[i] === '--amount' && args[i + 1]) {
          params.amountCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          // Positional argument is assumed to be invoice
          params.invoice = args[i];
        }
      }

      const result = await fiber.pay(params);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'invoice':
    case 'create-invoice': {
      let amountCkb = 0;
      let description: string | undefined;
      let expiryMinutes: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (args[i] === '--description' && args[i + 1]) {
          description = args[++i];
        } else if (args[i] === '--expiry' && args[i + 1]) {
          expiryMinutes = parseInt(args[++i]);
        } else if (!args[i].startsWith('--') && !amountCkb) {
          amountCkb = parseFloat(args[i]);
        }
      }

      if (!amountCkb) {
        console.error('Error: Amount required. Usage: invoice --amount <CKB>');
        process.exit(1);
      }

      const result = await fiber.createInvoice({ amountCkb, description, expiryMinutes });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'channels':
    case 'list-channels': {
      const result = await fiber.listChannels();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'open-channel': {
      let peer = '';
      let fundingCkb = 0;
      let isPublic = true;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--peer' && args[i + 1]) {
          peer = args[++i];
        } else if (args[i] === '--funding' && args[i + 1]) {
          fundingCkb = parseFloat(args[++i]);
        } else if (args[i] === '--private') {
          isPublic = false;
        }
      }

      if (!peer || !fundingCkb) {
        console.error('Error: Usage: open-channel --peer <addr> --funding <CKB>');
        process.exit(1);
      }

      const result = await fiber.openChannel({ peer, fundingCkb, isPublic });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'close-channel': {
      let channelId = '';
      let force = false;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
          channelId = args[++i];
        } else if (args[i] === '--force') {
          force = true;
        } else if (!args[i].startsWith('--')) {
          channelId = args[i];
        }
      }

      if (!channelId) {
        console.error('Error: Channel ID required');
        process.exit(1);
      }

      const result = await fiber.closeChannel({ channelId, force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'info':
    case 'node-info': {
      const result = await fiber.getNodeInfo();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'allowance':
    case 'spending-allowance': {
      const allowance = fiber.getSpendingAllowance();
      console.log(JSON.stringify(allowance, null, 2));
      break;
    }

    case 'audit':
    case 'audit-log': {
      let limit = 20;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
          limit = parseInt(args[++i]);
        }
      }
      const log = fiber.getAuditLog({ limit });
      console.log(JSON.stringify(log, null, 2));
      break;
    }

    case 'tools':
    case 'mcp-tools': {
      // Output MCP tool definitions for agent integration
      console.log(JSON.stringify(Object.values(MCP_TOOLS), null, 2));
      break;
    }

    case 'help':
    default:
      printHelp();
      break;
  }
}

// =============================================================================
// Help
// =============================================================================

function printHelp(): void {
  console.log(`
fiber-pay - AI Agent Payment SDK for CKB Lightning Network

USAGE:
  fiber-pay <command> [options]

NODE MANAGEMENT:
  start                   Start the Fiber node (runs in foreground)
  stop                    Stop the running Fiber node
  status                  Check if node is running

COMMANDS (require running node):
  info                    Get node information
  balance                 Get current balance information
  channels                List all payment channels
  peers                   List connected peers

COMMANDS (auto-start node, then stop):
  init                    Initialize the node and connect (auto-downloads binary)
  pay                     Pay an invoice or send directly
  invoice                 Create an invoice to receive payment
  open-channel            Open a new channel
  close-channel           Close a channel
  allowance               Get remaining spending allowance
  audit                   View audit log

BINARY MANAGEMENT:
  download                Download the Fiber binary for your platform
  binary-info             Check if binary is installed

OTHER:
  tools                   Output MCP tool definitions
  help                    Show this help

NODE LIFECYCLE:
  # Start node in foreground (recommended)
  fiber-pay start

  # In another terminal, run commands:
  fiber-pay status
  fiber-pay info
  fiber-pay balance
  fiber-pay channels

  # Stop the node
  fiber-pay stop

BINARY MANAGEMENT:
  fiber-pay download                    Download latest binary
  fiber-pay download --version v0.2.0   Download specific version
  fiber-pay download --force            Re-download even if exists
  fiber-pay binary-info                 Check binary installation status

PAYMENT:
  fiber-pay pay <invoice>
  fiber-pay pay --invoice <invoice>
  fiber-pay pay --to <nodeId> --amount <CKB>

INVOICE:
  fiber-pay invoice <amount>
  fiber-pay invoice --amount <CKB> --description "For coffee"

CHANNELS:
  fiber-pay open-channel --peer <multiaddr> --funding <CKB>
  fiber-pay close-channel <channelId>
  fiber-pay close-channel <channelId> --force

ENVIRONMENT:
  FIBER_BINARY_PATH       Path to fnn binary (optional - auto-downloads if not set)
  FIBER_DATA_DIR          Data directory (default: ~/.fiber-pay)
  FIBER_NETWORK           Network: testnet or mainnet (default: testnet)
  FIBER_RPC_URL           RPC URL (default: http://127.0.0.1:8227)
  FIBER_KEY_PASSWORD      Password for key encryption

EXAMPLES:
  # Download the Fiber binary
  fiber-pay download

  # Start node and keep it running
  fiber-pay start

  # (In another terminal) Check balance
  fiber-pay balance

  # Stop the node
  fiber-pay stop
`);
}

// =============================================================================
// Standalone Commands (don't need FiberPay instance)
// =============================================================================

async function handleStandaloneCommand(command: string, args: string[], config: CliConfig): Promise<boolean> {
  switch (command) {
    case 'download':
    case 'download-binary': {
      let version: string | undefined;
      let force = false;
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--version' && args[i + 1]) {
          version = args[++i];
        } else if (args[i] === '--force' || args[i] === '-f') {
          force = true;
        }
      }

      console.log('Downloading Fiber Network Node binary...');
      
      const info = await downloadFiberBinary({
        installDir: `${config.dataDir}/bin`,
        version,
        force,
        onProgress: showProgress,
      });

      console.log('\n✅ Binary installed successfully!');
      console.log(JSON.stringify(info, null, 2));
      return true;
    }

    case 'binary-info':
    case 'check-binary': {
      const info = await getFiberBinaryInfo(`${config.dataDir}/bin`);
      
      if (info.ready) {
        console.log('✅ Binary is ready');
      } else {
        console.log('❌ Binary not found or not executable');
      }
      console.log(JSON.stringify(info, null, 2));
      return true;
    }

    default:
      return false;
  }
}

// =============================================================================
// RPC-only Commands (connect to running node)
// =============================================================================

async function handleRpcCommand(command: string, args: string[], config: CliConfig): Promise<boolean> {
  const rpc = new FiberRpcClient({ url: config.rpcUrl! });
  
  // Check if node is running
  try {
    await rpc.waitForReady({ timeout: 3000 });
  } catch {
    console.error('❌ Node is not running. Start it first with: fiber-pay start');
    process.exit(1);
  }

  switch (command) {
    case 'info':
    case 'node-info': {
      const nodeInfo = await rpc.nodeInfo();
      console.log(JSON.stringify({
        success: true,
        data: {
          nodeId: nodeInfo.peer_id,
          publicKey: nodeInfo.public_key,
          addresses: nodeInfo.addresses,
          chainHash: nodeInfo.chain_hash,
        }
      }, null, 2));
      return true;
    }

    case 'channels':
    case 'list-channels': {
      const channels = await rpc.listChannels({});
      console.log(JSON.stringify({
        success: true,
        data: {
          channels: channels.channels,
          count: channels.channels.length,
        }
      }, null, 2));
      return true;
    }

    case 'balance':
    case 'get-balance': {
      const channels = await rpc.listChannels({});
      let totalLocal = BigInt(0);
      let totalRemote = BigInt(0);
      
      for (const ch of channels.channels) {
        if (ch.state?.state_name === 'ChannelReady') {
          totalLocal += BigInt(ch.local_balance);
          totalRemote += BigInt(ch.remote_balance);
        }
      }
      
      const localCkb = Number(totalLocal) / 1e8;
      const remoteCkb = Number(totalRemote) / 1e8;
      
      console.log(JSON.stringify({
        success: true,
        data: {
          totalCkb: localCkb,
          availableToSend: localCkb,
          availableToReceive: remoteCkb,
          channelCount: channels.channels.length,
        }
      }, null, 2));
      return true;
    }

    case 'peers':
    case 'list-peers': {
      const peers = await rpc.listPeers();
      console.log(JSON.stringify({
        success: true,
        data: peers
      }, null, 2));
      return true;
    }

    default:
      return false;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const commandArgs = args.slice(1);

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'tools' || command === 'mcp-tools') {
    console.log(JSON.stringify(Object.values(MCP_TOOLS), null, 2));
    return;
  }

  const config = getConfig();

  // Handle standalone commands that don't need FiberPay instance
  const standaloneCommands = ['download', 'download-binary', 'binary-info', 'check-binary'];
  if (standaloneCommands.includes(command)) {
    try {
      await handleStandaloneCommand(command, commandArgs, config);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Handle start command - run node in foreground
  if (command === 'start') {
    const fiber = createFiberPay({
      binaryPath: config.binaryPath,
      dataDir: config.dataDir,
      network: config.network,
      keyPassword: config.keyPassword,
    });

    // Check if already running
    const existingPid = readPidFile(config.dataDir);
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`❌ Node is already running (PID: ${existingPid})`);
      console.log('   Use "fiber-pay stop" to stop it first.');
      process.exit(1);
    }

    console.log('🚀 Starting Fiber node...');
    
    const initResult = await fiber.initialize({
      onDownloadProgress: showProgress,
    });
    
    if (!initResult.success) {
      console.error('Failed to initialize:', initResult.error?.message);
      process.exit(1);
    }

    // Write PID file
    writePidFile(config.dataDir, process.pid);

    console.log('✅ Fiber node started successfully!');
    console.log(JSON.stringify(initResult, null, 2));
    console.log('\n📡 Node is running. Press Ctrl+C to stop.');
    console.log(`   RPC endpoint: ${config.rpcUrl}`);
    console.log(`   Data dir: ${config.dataDir}`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      removePidFile(config.dataDir);
      await fiber.shutdown();
      console.log('✅ Node stopped.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    await new Promise(() => {});
    return;
  }

  // Handle stop command
  if (command === 'stop') {
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
    
    // Wait for process to stop
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      console.log('⚠️  Process did not stop gracefully, force killing...');
      process.kill(pid, 'SIGKILL');
    }

    removePidFile(config.dataDir);
    console.log('✅ Node stopped.');
    return;
  }

  // Handle status command
  if (command === 'status') {
    const pid = readPidFile(config.dataDir);
    
    if (pid && isProcessRunning(pid)) {
      console.log(`✅ Node is running (PID: ${pid})`);
      
      // Try to get node info
      try {
        const rpc = new FiberRpcClient({ url: config.rpcUrl! });
        await rpc.waitForReady({ timeout: 3000 });
        const nodeInfo = await rpc.nodeInfo();
        console.log(`   Node ID: ${nodeInfo.peer_id}`);
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
      console.log('   Start with: fiber-pay start');
    }
    return;
  }

  // RPC-only commands (connect to running node)
  const rpcOnlyCommands = ['info', 'node-info', 'channels', 'list-channels', 'balance', 'get-balance', 'peers', 'list-peers'];
  if (rpcOnlyCommands.includes(command)) {
    try {
      const handled = await handleRpcCommand(command, commandArgs, config);
      if (!handled) {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Commands that need full FiberPay initialization (for operations that modify state)
  const fiber = createFiberPay({
    binaryPath: config.binaryPath,
    dataDir: config.dataDir,
    network: config.network,
    keyPassword: config.keyPassword,
  });

  // These commands need initialization (for backwards compatibility with init command)
  const needsInit = ['init', 'initialize', 'pay', 'invoice', 'create-invoice',
    'open-channel', 'close-channel', 'allowance', 'spending-allowance', 'audit', 'audit-log'];

  if (needsInit.includes(command)) {
    const initResult = await fiber.initialize({
      onDownloadProgress: showProgress,
    });
    if (!initResult.success) {
      console.error('Failed to initialize:', initResult.error?.message);
      process.exit(1);
    }
  }

  try {
    await handleCommand(fiber, command, commandArgs);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    if (needsInit.includes(command)) {
      await fiber.shutdown();
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

