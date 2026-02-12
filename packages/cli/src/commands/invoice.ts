import { ckbToShannons, type HexString, randomBytes32, shannonsToCkb, toHex } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import {
  extractInvoiceMetadata,
  hasJsonFlag,
  parseHexTimestampMs,
  printInvoiceDetailHuman,
  printJson,
} from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

export function createInvoiceCommand(config: CliConfig): Command {
  const invoice = new Command('invoice').description('Invoice lifecycle and status commands');

  invoice
    .command('create')
    .argument('[amount]')
    .option('--amount <ckb>')
    .option('--description <text>')
    .option('--expiry <minutes>')
    .action(async (amountArg, options) => {
      const rpc = await createReadyRpcClient(config);

      const amountCkb = options.amount
        ? parseFloat(options.amount)
        : amountArg
          ? parseFloat(amountArg)
          : 0;
      if (!amountCkb) {
        console.error('Error: Amount required. Usage: invoice create --amount <CKB>');
        process.exit(1);
      }

      const expirySeconds = (options.expiry ? parseInt(options.expiry, 10) : 60) * 60;
      const currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

      const result = await rpc.newInvoice({
        amount: ckbToShannons(amountCkb),
        currency,
        description: options.description,
        expiry: toHex(expirySeconds),
        payment_preimage: randomBytes32(),
      });

      printJson({
        success: true,
        data: {
          invoice: result.invoice_address,
          paymentHash: result.invoice.data.payment_hash,
          amountCkb,
          expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
          status: 'open',
        },
      });
    });

  invoice
    .command('get')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.getInvoice({ payment_hash: paymentHash as HexString });
      const metadata = extractInvoiceMetadata(result.invoice);
      const createdAtMs = parseHexTimestampMs(result.invoice.data.timestamp);
      const output = {
        paymentHash,
        status: result.status,
        invoice: result.invoice_address,
        amountCkb: result.invoice.amount ? shannonsToCkb(result.invoice.amount) : undefined,
        currency: result.invoice.currency,
        description: metadata.description,
        createdAt: createdAtMs
          ? new Date(createdAtMs).toISOString()
          : result.invoice.data.timestamp,
        expiresAt: metadata.expiresAt,
        age: metadata.age,
      };

      if (hasJsonFlag(options.json ? ['--json'] : [])) {
        printJson({ success: true, data: output });
      } else {
        printInvoiceDetailHuman(output);
      }
    });

  invoice
    .command('parse')
    .argument('<invoiceString>')
    .action(async (invoiceString) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.parseInvoice({ invoice: invoiceString });
      printJson({ success: true, data: result });
    });

  invoice
    .command('cancel')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.cancelInvoice({ payment_hash: paymentHash as HexString });
      const output = { paymentHash, status: result.status, invoice: result.invoice_address };
      if (options.json) {
        printJson({ success: true, data: output });
      } else {
        console.log('Invoice cancelled');
        console.log(`  Payment Hash:  ${output.paymentHash}`);
        console.log(`  Status:        ${output.status}`);
        console.log(`  Invoice:       ${output.invoice}`);
      }
    });

  invoice
    .command('settle')
    .argument('<paymentHash>')
    .requiredOption('--preimage <preimage>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.settleInvoice({
        payment_hash: paymentHash as HexString,
        payment_preimage: options.preimage as HexString,
      });

      if (options.json) {
        printJson({ success: true, data: { paymentHash, message: 'Invoice settled.' } });
      } else {
        console.log('Invoice settled');
        console.log(`  Payment Hash:  ${paymentHash}`);
      }
    });

  return invoice;
}
