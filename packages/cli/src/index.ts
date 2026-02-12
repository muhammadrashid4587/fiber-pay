import { Command } from 'commander';
import { createBalanceCommand } from './commands/balance.js';
import { createBinaryCommand } from './commands/binary.js';
import { createChannelCommand } from './commands/channel.js';
import { createInvoiceCommand } from './commands/invoice.js';
import { createNodeCommand } from './commands/node.js';
import { createPaymentCommand } from './commands/payment.js';
import { createPeerCommand } from './commands/peer.js';
import { getConfig } from './lib/config.js';

function shouldOutputJson(): boolean {
  return process.argv.includes('--json');
}

function printFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const commanderCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;

  if (shouldOutputJson()) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code: commanderCode ?? 'CLI_FATAL',
            message,
          },
        },
        null,
        2,
      ),
    );
  } else {
    if (commanderCode?.startsWith('commander.')) {
      return;
    }
    console.error('Fatal error:', message);
  }
}

async function main(): Promise<void> {
  const config = getConfig();

  const program = new Command();
  program
    .name('fiber-pay')
    .description('AI Agent Payment SDK for CKB Lightning Network')
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
  program.addCommand(createBalanceCommand(config));

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  printFatal(error);
  process.exit(1);
});
