/**
 * fiber-pay CLI
 * Command-line interface for AI agents to manage CKB Lightning payments
 */

import { parseArgs } from 'util';
import { FiberPay, createFiberPay, MCP_TOOLS, downloadFiberBinary, getFiberBinaryInfo } from './index.js';
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
}

function getConfig(): CliConfig {
  return {
    binaryPath: process.env.FIBER_BINARY_PATH,
    dataDir: process.env.FIBER_DATA_DIR || `${process.env.HOME}/.fiber-pay`,
    network: (process.env.FIBER_NETWORK as 'testnet' | 'mainnet') || 'testnet',
    rpcUrl: process.env.FIBER_RPC_URL,
  };
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

COMMANDS:
  download                Download the Fiber binary for your platform
  binary-info             Check if binary is installed
  init                    Initialize the node and connect (auto-downloads binary)
  balance                 Get current balance information
  pay                     Pay an invoice or send directly
  invoice                 Create an invoice to receive payment
  channels                List all payment channels
  open-channel            Open a new channel
  close-channel           Close a channel
  info                    Get node information
  allowance               Get remaining spending allowance
  audit                   View audit log
  tools                   Output MCP tool definitions
  help                    Show this help

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
  FIBER_KEY_PASSWORD      Password for key encryption

EXAMPLES:
  # Download the Fiber binary
  fiber-pay download

  # Initialize and start node (auto-downloads binary if needed)
  fiber-pay init


  # Check balance
  fiber-pay balance

  # Pay an invoice
  fiber-pay pay fibt1qp...

  # Create invoice for 10 CKB
  fiber-pay invoice 10

  # Open channel with 100 CKB
  fiber-pay open-channel --peer /ip4/x.x.x.x/tcp/8228/p2p/QmXXX --funding 100
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

  const fiber = createFiberPay({
    binaryPath: config.binaryPath,
    dataDir: config.dataDir,
    network: config.network,
  });

  // Commands that need initialization
  const needsInit = ['balance', 'pay', 'invoice', 'create-invoice', 'channels', 'list-channels',
    'open-channel', 'close-channel', 'info', 'node-info', 'allowance', 'spending-allowance', 'audit', 'audit-log'];

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

