/**
 * fiber-pay CLI
 * Command-line interface for AI agents to manage CKB Lightning payments
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  downloadFiberBinary,
  getFiberBinaryInfo,
  ProcessManager,
  ensureFiberBinary,
  getDefaultBinaryPath,
  type DownloadProgress,
  type FiberNodeConfig,
} from '@fiber-pay/node';
import {
  FiberRpcClient,
  ckbToShannons,
  shannonsToCkb,
  randomBytes32,
  toHex,
  scriptToAddress,
  type HexString,
  type Script,
} from '@fiber-pay/sdk';

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

COMMANDS (require running node - connect via RPC):
  info                    Get node information
  balance                 Get current balance information
  channels                List all payment channels
  peers                   List connected peers
  invoice                 Create an invoice to receive payment
  pay                     Pay an invoice or send directly
  open-channel            Open a new channel
  close-channel           Close a channel

BINARY MANAGEMENT:
  download                Download the Fiber binary for your platform
  binary-info             Check if binary is installed

OTHER:
  init                    One-off init test (starts node, gets info, stops)
  tools                   Output MCP tool definitions
  help                    Show this help

WORKFLOW:
  # 1. Download the Fiber binary (if not already installed)
  fiber-pay download

  # 2. Start the node (runs in foreground, keep this terminal open)
  fiber-pay start

  # 3. In another terminal, run commands:
  fiber-pay status
  fiber-pay info
  fiber-pay balance
  fiber-pay channels
  fiber-pay invoice --amount 10 --description "Test"
  fiber-pay pay <invoice>
  fiber-pay open-channel --peer <multiaddr> --funding <CKB>

  # 4. Stop the node (Ctrl+C in the start terminal, or:)
  fiber-pay stop

PAYMENT:
  fiber-pay pay <invoice>
  fiber-pay pay --invoice <invoice>
  fiber-pay pay --to <pubkey> --amount <CKB>   # keysend

INVOICE:
  fiber-pay invoice <amount>
  fiber-pay invoice --amount <CKB> --description "For coffee"

CHANNELS:
  fiber-pay open-channel --peer <multiaddr> --funding <CKB>
  fiber-pay open-channel --peer <peer_id> --funding <CKB>
  fiber-pay close-channel <channelId>
  fiber-pay close-channel <channelId> --force

ENVIRONMENT:
  FIBER_BINARY_PATH       Path to fnn binary (optional - auto-downloads if not set)
  FIBER_DATA_DIR          Data directory (default: ~/.fiber-pay)
  FIBER_NETWORK           Network: testnet or mainnet (default: testnet)
  FIBER_RPC_URL           RPC URL (default: http://127.0.0.1:8227)
  FIBER_KEY_PASSWORD      Password for key encryption
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
      
      // Convert lock script to CKB address
      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      
      console.log(JSON.stringify({
        success: true,
        data: {
          nodeId: nodeInfo.peer_id,
          publicKey: nodeInfo.public_key,
          addresses: nodeInfo.addresses,
          chainHash: nodeInfo.chain_hash,
          fundingAddress: fundingAddress,
          fundingLockScript: nodeInfo.default_funding_lock_script,
          version: nodeInfo.version,
          channelCount: nodeInfo.channel_count,
          pendingChannelCount: nodeInfo.pending_channel_count,
          peersCount: nodeInfo.peers_count,
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
      let activeChannelCount = 0;
      
      for (const ch of channels.channels) {
        // Check for CHANNEL_READY state (case-insensitive)
        const stateName = ch.state?.state_name?.toUpperCase() || '';
        if (stateName === 'CHANNEL_READY' || stateName === 'CHANNELREADY') {
          totalLocal += BigInt(ch.local_balance);
          totalRemote += BigInt(ch.remote_balance);
          activeChannelCount++;
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
          activeChannelCount,
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

      const amountHex = ckbToShannons(amountCkb);
      const expirySeconds = (expiryMinutes || 60) * 60;
      const preimage = randomBytes32();
      const currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

      const result = await rpc.newInvoice({
        amount: amountHex,
        currency,
        description,
        expiry: toHex(expirySeconds),
        payment_preimage: preimage,
      });

      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

      console.log(JSON.stringify({
        success: true,
        data: {
          invoice: result.invoice_address,
          paymentHash: result.invoice.payment_hash,
          amountCkb,
          expiresAt,
          status: 'open',
        }
      }, null, 2));
      return true;
    }

    case 'pay': {
      let invoice: string | undefined;
      let recipientNodeId: string | undefined;
      let amountCkb: number | undefined;
      let maxFeeCkb: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--invoice' && args[i + 1]) {
          invoice = args[++i];
        } else if (args[i] === '--to' && args[i + 1]) {
          recipientNodeId = args[++i];
        } else if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (args[i] === '--max-fee' && args[i + 1]) {
          maxFeeCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          // Positional argument is assumed to be invoice
          invoice = args[i];
        }
      }

      if (!invoice && !recipientNodeId) {
        console.error('Error: Either invoice or --to <nodeId> required');
        process.exit(1);
      }

      if (recipientNodeId && !amountCkb) {
        console.error('Error: --amount required when using --to');
        process.exit(1);
      }

      const result = await rpc.sendPayment({
        invoice,
        target_pubkey: recipientNodeId as HexString | undefined,
        amount: amountCkb ? ckbToShannons(amountCkb) : undefined,
        keysend: recipientNodeId ? true : undefined,
        max_fee_amount: maxFeeCkb ? ckbToShannons(maxFeeCkb) : undefined,
      });

      console.log(JSON.stringify({
        success: result.status === 'Success',
        data: {
          paymentHash: result.payment_hash,
          status: result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
          feeCkb: shannonsToCkb(result.fee),
          failureReason: result.failed_error,
        }
      }, null, 2));
      return true;
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
        console.error('Error: Usage: open-channel --peer <peer_id_or_multiaddr> --funding <CKB>');
        process.exit(1);
      }

      // If peer contains '/', it's a multiaddr - connect first
      let peerId = peer;
      if (peer.includes('/')) {
        await rpc.connectPeer({ address: peer });
        // Extract peer ID from multiaddr
        const peerIdMatch = peer.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) {
          peerId = peerIdMatch[1];
        }
      }

      const result = await rpc.openChannel({
        peer_id: peerId,
        funding_amount: ckbToShannons(fundingCkb),
        public: isPublic,
      });

      console.log(JSON.stringify({
        success: true,
        data: {
          temporaryChannelId: result.temporary_channel_id,
          peer: peerId,
          fundingCkb,
        }
      }, null, 2));
      return true;
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

      await rpc.shutdownChannel({
        channel_id: channelId as HexString,
        force,
      });

      console.log(JSON.stringify({
        success: true,
        data: {
          channelId,
          force,
          message: force ? 'Channel force close initiated' : 'Channel close initiated',
        }
      }, null, 2));
      return true;
    }

    case 'verify-invoice':
    case 'validate-invoice': {
      const invoice = args.find(arg => !arg.startsWith('--'));
      
      if (!invoice) {
        console.error('Error: Invoice required. Usage: verify-invoice <invoice-string>');
        process.exit(1);
      }

      const result = await rpc.parseInvoice({ invoice });
      console.log(JSON.stringify({
        success: true,
        data: {
          paymentHash: result.invoice.payment_hash,
          amountCkb: result.invoice.amount ? shannonsToCkb(result.invoice.amount) : undefined,
          description: result.invoice.description,
          expirySeconds: result.invoice.expiry,
          invoiceAddress: result.invoice.invoice_address,
        }
      }, null, 2));
      return true;
    }

    case 'liquidity':
    case 'liquidity-report':
    case 'analyze-liquidity': {
      const channels = await rpc.listChannels({});
      
      let totalLocal = 0n;
      let totalRemote = 0n;
      let totalCapacity = 0n;
      let activeChannels = 0;

      for (const channel of channels.channels) {
        if (channel.state.state_name === 'ChannelReady') {
          activeChannels++;
          totalLocal += BigInt(channel.local_balance);
          totalRemote += BigInt(channel.remote_balance || '0x0');
          totalCapacity += BigInt(channel.local_balance) + BigInt(channel.remote_balance || '0x0');
        }
      }

      console.log(JSON.stringify({
        success: true,
        data: {
          activeChannels,
          totalLocalCkb: shannonsToCkb(toHex(totalLocal)),
          totalRemoteCkb: shannonsToCkb(toHex(totalRemote)),
          totalCapacityCkb: shannonsToCkb(toHex(totalCapacity)),
        }
      }, null, 2));
      return true;
    }

    case 'payment-proof':
    case 'get-proof': {
      const paymentHash = args.find(arg => !arg.startsWith('--'));
      
      if (!paymentHash) {
        console.error('Error: Payment hash required. Usage: payment-proof <payment-hash>');
        process.exit(1);
      }

      const payment = await rpc.getPayment({ payment_hash: paymentHash as HexString });
      console.log(JSON.stringify({
        success: true,
        data: payment
      }, null, 2));
      return true;
    }

    case 'can-send': {
      let amountCkb = 0;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          amountCkb = parseFloat(args[i]);
        }
      }

      if (!amountCkb) {
        console.error('Error: Amount required. Usage: can-send <CKB>');
        process.exit(1);
      }

      const amountShannons = BigInt(ckbToShannons(amountCkb));
      const channels = await rpc.listChannels({});
      
      let canSend = false;
      for (const channel of channels.channels) {
        if (channel.state.state_name === 'ChannelReady' && 
            BigInt(channel.local_balance) >= amountShannons) {
          canSend = true;
          break;
        }
      }

      console.log(JSON.stringify({
        success: true,
        data: {
          canSend,
          requestedAmountCkb: amountCkb,
        }
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
    // Check if already running
    const existingPid = readPidFile(config.dataDir);
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`❌ Node is already running (PID: ${existingPid})`);
      console.log('   Use "fiber-pay stop" to stop it first.');
      process.exit(1);
    }

    console.log('🚀 Starting Fiber node...');
    
    // Ensure binary is downloaded
    const binaryPath = config.binaryPath || getDefaultBinaryPath();
    await ensureFiberBinary();

    // Start the process
    const nodeConfig: FiberNodeConfig = {
      binaryPath,
      dataDir: config.dataDir,
      configFilePath: config.network === 'testnet' ? join(process.cwd(), 'testnet-config.yml') : undefined,
      chain: config.network,
    };
    const processManager = new ProcessManager(nodeConfig);

    await processManager.start();
    
    // Write PID file
    if (processManager['process']) {
      writePidFile(config.dataDir, processManager['process'].pid!);
    }

    console.log('✅ Fiber node started successfully!');
    console.log('\n📡 Node is running. Press Ctrl+C to stop.');
    console.log(`   RPC endpoint: ${config.rpcUrl}`);
    console.log(`   Data dir: ${config.dataDir}`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      removePidFile(config.dataDir);
      await processManager.stop();
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
  const rpcOnlyCommands = [
    'info', 'node-info', 
    'channels', 'list-channels', 
    'balance', 'get-balance', 
    'peers', 'list-peers',
    'invoice', 'create-invoice',
    'pay',
    'open-channel',
    'close-channel',
    'verify-invoice', 'validate-invoice',
    'liquidity', 'liquidity-report', 'analyze-liquidity',
    'payment-proof', 'get-proof',
    'can-send',
  ];
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

  // Unknown command
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

