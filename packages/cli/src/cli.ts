/**
 * fiber-pay CLI
 * Command-line interface for AI agents to manage CKB Lightning payments
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Project root: cli dist is at packages/cli/dist/cli.js -> 3 levels up
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
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
  CorsProxy,
  ckbToShannons,
  shannonsToCkb,
  randomBytes32,
  toHex,
  scriptToAddress,
  ChannelState,
  type HexString,
  type Script,
  type ChannelInfo,
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
// Bootnode Helpers
// =============================================================================

/**
 * Extract bootnode addresses from a Fiber config YAML file.
 * Uses simple regex since the YAML parser doesn't handle list items.
 */
function extractBootnodeAddrs(configFilePath: string): string[] {
  if (!existsSync(configFilePath)) return [];
  try {
    const content = readFileSync(configFilePath, 'utf-8');
    const addrs: string[] = [];
    // Match lines like:  - "/ip4/.../p2p/Qm..."
    const regex = /^\s*-\s*["']?(\/ip4\/[^"'\s]+)["']?\s*$/gm;
    let match;
    // Only capture addresses in the bootnode_addrs section
    const sectionMatch = content.match(/bootnode_addrs:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (sectionMatch) {
      const section = sectionMatch[1];
      while ((match = regex.exec(section)) !== null) {
        addrs.push(match[1]);
      }
    }
    return addrs;
  } catch {
    return [];
  }
}

/**
 * Auto-connect to bootnode addresses via RPC after node start.
 * Assumes RPC is already ready.
 */
async function autoConnectBootnodes(rpc: FiberRpcClient, bootnodes: string[]): Promise<void> {
  if (bootnodes.length === 0) return;

  console.log(`🔗 Connecting to ${bootnodes.length} bootnode(s)...`);
  for (const addr of bootnodes) {
    const shortId = addr.match(/\/p2p\/(.+)$/)?.[1]?.slice(0, 12) || addr.slice(-12);
    try {
      await rpc.connectPeer({ address: addr });
      console.log(`   ✅ Connected to ${shortId}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "already connected" is fine
      if (msg.toLowerCase().includes('already')) {
        console.log(`   ✅ Already connected to ${shortId}...`);
      } else {
        console.error(`   ⚠️  Failed to connect to ${shortId}...: ${msg}`);
      }
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncateMiddle(value: string, start = 10, end = 8): string {
  if (!value || value.length <= start + end + 3) {
    return value;
  }
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function parseHexTimestampMs(hexTimestamp: string): number | null {
  if (!hexTimestamp) return null;
  try {
    const raw = Number(BigInt(hexTimestamp));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  } catch {
    return null;
  }
}

function formatAge(whenMs: number | null): string {
  if (!whenMs) return 'unknown';
  const diff = Date.now() - whenMs;
  if (diff < 0) return 'just now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function stateLabel(state: ChannelState): string {
  switch (state) {
    case ChannelState.NegotiatingFunding:
      return '🔄 Negotiating Funding';
    case ChannelState.CollaboratingFundingTx:
      return '🧩 Collaborating Funding Tx';
    case ChannelState.SigningCommitment:
      return '✍️ Signing Commitment';
    case ChannelState.AwaitingTxSignatures:
      return '⏳ Awaiting Tx Signatures';
    case ChannelState.AwaitingChannelReady:
      return '⏳ Awaiting Channel Ready';
    case ChannelState.ChannelReady:
      return '✅ Channel Ready';
    case ChannelState.ShuttingDown:
      return '🛑 Shutting Down';
    case ChannelState.Closed:
      return '❌ Closed';
    default:
      return state;
  }
}

function parseChannelState(input: string | undefined): ChannelState | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toUpperCase();
  return (Object.values(ChannelState) as string[]).includes(normalized)
    ? (normalized as ChannelState)
    : undefined;
}

function formatChannel(channel: ChannelInfo): Record<string, unknown> {
  const local = BigInt(channel.local_balance);
  const remote = BigInt(channel.remote_balance || '0x0');
  const capacity = local + remote;
  const localPct = capacity > 0n ? Number((local * 100n) / capacity) : 0;
  const remotePct = capacity > 0n ? 100 - localPct : 0;

  return {
    channelId: channel.channel_id,
    channelIdShort: truncateMiddle(channel.channel_id, 10, 8),
    peerId: channel.peer_id,
    peerIdShort: truncateMiddle(channel.peer_id, 10, 8),
    state: channel.state.state_name,
    stateLabel: stateLabel(channel.state.state_name),
    stateFlags: channel.state.state_flags,
    localBalanceCkb: shannonsToCkb(channel.local_balance),
    remoteBalanceCkb: shannonsToCkb(channel.remote_balance),
    capacityCkb: shannonsToCkb(toHex(capacity)),
    balanceRatio: `${localPct}/${remotePct}`,
    pendingTlcs: channel.pending_tlcs.length,
    enabled: channel.enabled,
    isPublic: channel.is_public,
    age: formatAge(parseHexTimestampMs(channel.created_at)),
  };
}

function getChannelSummary(channels: ChannelInfo[]): Record<string, unknown> {
  let totalLocal = 0n;
  let totalRemote = 0n;
  let active = 0;

  for (const channel of channels) {
    totalLocal += BigInt(channel.local_balance);
    totalRemote += BigInt(channel.remote_balance || '0x0');
    if (channel.state.state_name === ChannelState.ChannelReady) {
      active++;
    }
  }

  return {
    count: channels.length,
    activeCount: active,
    totalLocalCkb: shannonsToCkb(toHex(totalLocal)),
    totalRemoteCkb: shannonsToCkb(toHex(totalRemote)),
    totalCapacityCkb: shannonsToCkb(toHex(totalLocal + totalRemote)),
  };
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
  start [--cors-proxy [port]]  Start the Fiber node (runs in foreground)
                               --cors-proxy: Enable CORS proxy (default port: 28227)
  stop                         Stop the running Fiber node
  status                       Check if node is running

COMMANDS (require running node - connect via RPC):
  info                    Get node information
  balance                 Get current balance information
  channels                List channels with human-readable state/balances
  watch-channels          Monitor channel state changes in real-time
  peers                   List connected peers
  invoice                 Create an invoice to receive payment
  pay                     Pay an invoice or send directly
  open-channel            Open a new channel
  abandon-channel         Abandon a pending/temporary channel
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
  # Or with CORS proxy for browser access:
  fiber-pay start --cors-proxy

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

CORS PROXY:
  # Enable CORS proxy on default port 28227:
  fiber-pay start --cors-proxy

  # Enable CORS proxy on custom port:
  fiber-pay start --cors-proxy 3000

  # Then use http://127.0.0.1:28227 (or custom port) from your browser/frontend

PAYMENT:
  fiber-pay pay <invoice>
  fiber-pay pay --invoice <invoice>
  fiber-pay pay --to <pubkey> --amount <CKB>   # keysend

INVOICE:
  fiber-pay invoice <amount>
  fiber-pay invoice --amount <CKB> --description "For coffee"

CHANNELS:
  fiber-pay channels
  fiber-pay channels --state CHANNEL_READY
  fiber-pay channels --peer <peer_id>
  fiber-pay channels --raw
  fiber-pay watch-channels
  fiber-pay watch-channels --include-closed
  fiber-pay watch-channels --interval 2 --until CHANNEL_READY
  fiber-pay watch-channels --channel <channelId> --timeout 300
  fiber-pay abandon-channel <temporaryChannelId>

  # Existing channel management commands:
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
          nodeId: nodeInfo.node_id,
          addresses: nodeInfo.addresses,
          chainHash: nodeInfo.chain_hash,
          fundingAddress: fundingAddress,
          fundingLockScript: nodeInfo.default_funding_lock_script,
          version: nodeInfo.version,
          channelCount: parseInt(nodeInfo.channel_count, 16),
          pendingChannelCount: parseInt(nodeInfo.pending_channel_count, 16),
          peersCount: parseInt(nodeInfo.peers_count, 16),
        }
      }, null, 2));
      return true;
    }

    case 'channels':
    case 'list-channels': {
      let raw = false;
      let peerId: string | undefined;
      let stateFilter: ChannelState | undefined;
      let includeClosed = false;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--raw') {
          raw = true;
        } else if (args[i] === '--peer' && args[i + 1]) {
          peerId = args[++i];
        } else if (args[i] === '--include-closed') {
          includeClosed = true;
        } else if (args[i] === '--state' && args[i + 1]) {
          const parsed = parseChannelState(args[++i]);
          if (!parsed) {
            console.error(`Error: Invalid --state value. Use one of: ${Object.values(ChannelState).join(', ')}`);
            process.exit(1);
          }
          stateFilter = parsed;
        }
      }

      const channels = await rpc.listChannels(peerId ? { peer_id: peerId, include_closed: includeClosed } : { include_closed: includeClosed });
      const filtered = stateFilter
        ? channels.channels.filter(channel => channel.state.state_name === stateFilter)
        : channels.channels;

      if (raw) {
        console.log(JSON.stringify({
          success: true,
          data: {
            channels: filtered,
            count: filtered.length,
          }
        }, null, 2));
        return true;
      }

      console.log(JSON.stringify({
        success: true,
        data: {
          channels: filtered.map(formatChannel),
          summary: getChannelSummary(filtered),
        }
      }, null, 2));
      return true;
    }

    case 'watch-channels':
    case 'watch':
    case 'monitor-channels':
    case 'channel-status': {
      let intervalSeconds = 5;
      let timeoutSeconds: number | undefined;
      let channelIdFilter: string | undefined;
      let peerId: string | undefined;
      let stateFilter: ChannelState | undefined;
      let untilState: ChannelState | undefined;
      let noClear = false;
      let includeClosed = false;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--interval' && args[i + 1]) {
          intervalSeconds = parseInt(args[++i], 10);
        } else if (args[i] === '--timeout' && args[i + 1]) {
          timeoutSeconds = parseInt(args[++i], 10);
        } else if (args[i] === '--channel' && args[i + 1]) {
          channelIdFilter = args[++i];
        } else if (args[i] === '--peer' && args[i + 1]) {
          peerId = args[++i];
        } else if (args[i] === '--include-closed') {
          includeClosed = true;
        } else if (args[i] === '--state' && args[i + 1]) {
          const parsed = parseChannelState(args[++i]);
          if (!parsed) {
            console.error(`Error: Invalid --state value. Use one of: ${Object.values(ChannelState).join(', ')}`);
            process.exit(1);
          }
          stateFilter = parsed;
        } else if (args[i] === '--until' && args[i + 1]) {
          const parsed = parseChannelState(args[++i]);
          if (!parsed) {
            console.error(`Error: Invalid --until value. Use one of: ${Object.values(ChannelState).join(', ')}`);
            process.exit(1);
          }
          untilState = parsed;
        } else if (args[i] === '--no-clear') {
          noClear = true;
        }
      }

      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
        console.error('Error: --interval must be a positive integer');
        process.exit(1);
      }

      if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
        console.error('Error: --timeout must be a positive integer');
        process.exit(1);
      }

      const startedAt = Date.now();
      const previousStates = new Map<string, ChannelState>();

      while (true) {
        const response = await rpc.listChannels(peerId ? { peer_id: peerId, include_closed: includeClosed } : { include_closed: includeClosed });
        let channels = response.channels;

        if (channelIdFilter) {
          channels = channels.filter(channel => channel.channel_id === channelIdFilter);
        }

        if (stateFilter) {
          channels = channels.filter(channel => channel.state.state_name === stateFilter);
        }

        const stateChanges: Array<{ channelId: string; from: ChannelState; to: ChannelState }> = [];
        for (const channel of channels) {
          const previous = previousStates.get(channel.channel_id);
          const current = channel.state.state_name;
          if (previous && previous !== current) {
            stateChanges.push({ channelId: channel.channel_id, from: previous, to: current });
          }
          previousStates.set(channel.channel_id, current);
        }

        if (!noClear) {
          console.clear();
        }

        console.log(`⏱️  Channel monitor - ${new Date().toISOString()}`);
        console.log(`   Refresh: ${intervalSeconds}s${timeoutSeconds ? ` | Timeout: ${timeoutSeconds}s` : ''}${untilState ? ` | Until: ${untilState}` : ''}`);
        if (channelIdFilter) {
          console.log(`   Filter channel: ${channelIdFilter}`);
        }
        if (peerId) {
          console.log(`   Filter peer: ${peerId}`);
        }
        if (stateFilter) {
          console.log(`   Filter state: ${stateFilter}`);
        }

        if (stateChanges.length > 0) {
          console.log('\n🔔 State changes:');
          for (const change of stateChanges) {
            console.log(`   ${truncateMiddle(change.channelId)}: ${change.from} -> ${change.to}`);
          }
        }

        console.log(JSON.stringify({
          success: true,
          data: {
            channels: channels.map(formatChannel),
            summary: getChannelSummary(channels),
          }
        }, null, 2));

        if (untilState && channels.some(channel => channel.state.state_name === untilState)) {
          console.log(`\n✅ Target state reached: ${untilState}`);
          return true;
        }

        if (timeoutSeconds !== undefined && Date.now() - startedAt >= timeoutSeconds * 1000) {
          console.log('\n⏰ Monitor timeout reached.');
          return true;
        }

        await sleep(intervalSeconds * 1000);
      }
    }

    case 'balance':
    case 'get-balance': {
      const channels = await rpc.listChannels({});
      let totalLocal = BigInt(0);
      let totalRemote = BigInt(0);
      let activeChannelCount = 0;
      
      for (const ch of channels.channels) {
        // Check for ChannelReady state
        if (ch.state?.state_name === ChannelState.ChannelReady) {
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

    case 'abandon-channel':
    case 'abandon': {
      let channelId: string | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
          channelId = args[++i];
        } else if (!args[i].startsWith('--')) {
          channelId = args[i];
        }
      }

      if (!channelId) {
        console.error('Error: Channel ID required. Usage: abandon-channel <channelId>');
        process.exit(1);
      }

      await rpc.abandonChannel({ channel_id: channelId as HexString });

      console.log(JSON.stringify({
        success: true,
        data: {
          channelId,
          message: 'Channel abandoned.',
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
        if (channel.state.state_name === ChannelState.ChannelReady) {
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
        if (channel.state.state_name === ChannelState.ChannelReady && 
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
    
    // Parse --cors-proxy option
    let corsProxyPort: number | undefined;
    for (let i = 0; i < commandArgs.length; i++) {
      if (commandArgs[i] === '--cors-proxy') {
        const nextArg = commandArgs[i + 1];
        if (nextArg && /^\d+$/.test(nextArg)) {
          corsProxyPort = parseInt(nextArg);
          i++;
        } else {
          corsProxyPort = 28227;
        }
      }
    }

    // Ensure binary is downloaded
    const binaryPath = config.binaryPath || getDefaultBinaryPath();
    await ensureFiberBinary();

    // Start the process
    const nodeConfig: FiberNodeConfig = {
      binaryPath,
      dataDir: config.dataDir,
      configFilePath: config.network === 'testnet' ? join(PROJECT_ROOT, 'testnet-config.yml') : undefined,
      chain: config.network,
    };
    const processManager = new ProcessManager(nodeConfig);

    await processManager.start();
    
    // Write PID file
    if (processManager['process']) {
      writePidFile(config.dataDir, processManager['process'].pid!);
    }

    // Start CORS proxy if requested
    let corsProxy: CorsProxy | undefined;
    if (corsProxyPort) {
      corsProxy = new CorsProxy({
        port: corsProxyPort,
        targetUrl: config.rpcUrl!,
      });
      try {
        await corsProxy.start();
        console.log(`🌐 CORS proxy started on http://127.0.0.1:${corsProxyPort}`);
      } catch (err) {
        console.error(`⚠️  Failed to start CORS proxy: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Wait for node RPC to be ready before auto-connecting
    console.log('⏳ Waiting for node RPC to be ready...');
    const rpc = new FiberRpcClient({ url: config.rpcUrl! });
    try {
      await rpc.waitForReady({ timeout: 30000, interval: 500 });
    } catch {
      console.error('⚠️  RPC did not become ready within 30s. Node may still be starting.');
      console.log('   You can manually connect to bootnodes later.');
    }

    console.log('✅ Fiber node started successfully!');
    console.log('\n📡 Node is running. Press Ctrl+C to stop.');
    console.log(`   RPC endpoint: ${config.rpcUrl}`);
    if (corsProxy) {
      console.log(`   CORS proxy:   http://127.0.0.1:${corsProxyPort} (use this from browser)`);
    }
    console.log(`   Data dir: ${config.dataDir}`);

    // Auto-connect to bootnodes from config
    const bootnodes = nodeConfig.configFilePath
      ? extractBootnodeAddrs(nodeConfig.configFilePath)
      : extractBootnodeAddrs(join(config.dataDir, 'config.yml'));
    if (bootnodes.length > 0) {
      await autoConnectBootnodes(rpc, bootnodes);
    }

    // Handle graceful shutdown
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
      console.log('   Start with: fiber-pay start');
    }
    return;
  }

  // RPC-only commands (connect to running node)
  const rpcOnlyCommands = [
    'info', 'node-info', 
    'channels', 'list-channels', 
    'watch-channels', 'watch', 'monitor-channels', 'channel-status',
    'balance', 'get-balance', 
    'peers', 'list-peers',
    'invoice', 'create-invoice',
    'pay',
    'open-channel',
    'abandon-channel', 'abandon',
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

