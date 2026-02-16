import { join } from 'node:path';
import { Command } from 'commander';
import { createAgentCommand } from './commands/agent.js';
import { createBalanceCommand } from './commands/balance.js';
import { createBinaryCommand } from './commands/binary.js';
import { createChannelCommand } from './commands/channel.js';
import { createConfigCommand } from './commands/config.js';
import { createInvoiceCommand } from './commands/invoice.js';
import { createNodeCommand } from './commands/node.js';
import { createPaymentCommand } from './commands/payment.js';
import { createPeerCommand } from './commands/peer.js';
import { getConfig } from './lib/config.js';
import { printJsonError } from './lib/format.js';

function shouldOutputJson(): boolean {
  return process.argv.includes('--json');
}

function getFlagValue(argv: string[], index: number): string | undefined {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    return undefined;
  }
  return value;
}

function applyGlobalOverrides(argv: string[]): void {
  let explicitDataDir = false;
  let profileName: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--profile': {
        const value = getFlagValue(argv, index);
        if (value) profileName = value;
        break;
      }
      case '--data-dir': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_DATA_DIR = value;
          explicitDataDir = true;
        }
        break;
      }
      case '--rpc-url': {
        const value = getFlagValue(argv, index);
        if (value) process.env.FIBER_RPC_URL = value;
        break;
      }
      case '--network': {
        const value = getFlagValue(argv, index);
        if (value) process.env.FIBER_NETWORK = value;
        break;
      }
      case '--key-password': {
        const value = getFlagValue(argv, index);
        if (value) process.env.FIBER_KEY_PASSWORD = value;
        break;
      }
      case '--binary-path': {
        const value = getFlagValue(argv, index);
        if (value) process.env.FIBER_BINARY_PATH = value;
        break;
      }
      default:
        break;
    }
  }

  if (!explicitDataDir && profileName) {
    const homeDir = process.env.HOME ?? process.cwd();
    process.env.FIBER_DATA_DIR = join(homeDir, '.fiber-pay', 'profiles', profileName);
  }
}

function printFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const commanderCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;

  if (shouldOutputJson()) {
    printJsonError({
      code: commanderCode ?? 'CLI_FATAL',
      message,
      recoverable: !commanderCode || commanderCode.startsWith('commander.'),
      suggestion: commanderCode?.startsWith('commander.')
        ? 'Run the command with --help and fix invalid arguments.'
        : 'Inspect command arguments and environment, then retry.',
    });
  } else {
    if (commanderCode?.startsWith('commander.')) {
      return;
    }
    console.error('Fatal error:', message);
  }
}

async function main(): Promise<void> {
  applyGlobalOverrides(process.argv);
  const config = getConfig();

  const program = new Command();
  program
    .name('fiber-pay')
    .description('AI Agent Payment SDK for CKB Lightning Network')
    .option('--profile <name>', 'Use profile at ~/.fiber-pay/profiles/<name>')
    .option('--data-dir <path>', 'Override data directory for all commands')
    .option('--rpc-url <url>', 'Override RPC URL for all commands')
    .option('--network <network>', 'Override network for all commands (testnet|mainnet)')
    .option('--key-password <password>', 'Override key password for all commands')
    .option('--binary-path <path>', 'Override fiber binary path for all commands')
    .showHelpAfterError()
    .showSuggestionAfterError();

  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => {
      if (!shouldOutputJson()) {
        process.stderr.write(str);
      }
    },
  });

  program.addCommand(createNodeCommand(config));
  program.addCommand(createChannelCommand(config));
  program.addCommand(createInvoiceCommand(config));
  program.addCommand(createPaymentCommand(config));
  program.addCommand(createPeerCommand(config));
  program.addCommand(createBinaryCommand(config));
  program.addCommand(createConfigCommand(config));
  program.addCommand(createBalanceCommand(config));
  program.addCommand(createAgentCommand(config));

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  printFatal(error);
  process.exit(1);
});
