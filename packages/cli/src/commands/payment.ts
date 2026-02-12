import { Command } from 'commander';
import { ckbToShannons, shannonsToCkb, type HexString } from '@fiber-pay/sdk';
import type { CliConfig } from '../lib/config.js';
import { createReadyRpcClient } from '../lib/rpc.js';
import { formatPaymentResult, printJson, printPaymentDetailHuman, sleep } from '../lib/format.js';

export function createPaymentCommand(config: CliConfig): Command {
  const payment = new Command('payment').description('Payment lifecycle and status commands');

  payment
    .command('send')
    .argument('[invoice]')
    .option('--invoice <invoice>')
    .option('--to <nodeId>')
    .option('--amount <ckb>')
    .option('--max-fee <ckb>')
    .option('--json')
    .action(async (invoiceArg, options) => {
      const rpc = await createReadyRpcClient(config);
      const invoice = options.invoice || invoiceArg;
      const recipientNodeId = options.to;
      const amountCkb = options.amount ? parseFloat(options.amount) : undefined;
      const maxFeeCkb = options.maxFee ? parseFloat(options.maxFee) : undefined;

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

      const payload = {
        paymentHash: result.payment_hash,
        status: result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
        feeCkb: shannonsToCkb(result.fee),
        failureReason: result.failed_error,
      };

      printJson({ success: result.status === 'Success', data: payload });
    });

  payment
    .command('get')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.getPayment({ payment_hash: paymentHash as HexString });
      if (options.json) {
        printJson({ success: true, data: formatPaymentResult(result) });
      } else {
        printPaymentDetailHuman(result);
      }
    });

  payment
    .command('watch')
    .argument('<paymentHash>')
    .option('--interval <seconds>', 'Polling interval', '2')
    .option('--timeout <seconds>', 'Timeout', '120')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const intervalSeconds = parseInt(options.interval, 10);
      const timeoutSeconds = parseInt(options.timeout, 10);
      const startedAt = Date.now();
      let lastStatus: string | undefined;

      while (Date.now() - startedAt < timeoutSeconds * 1000) {
        const paymentResult = await rpc.getPayment({ payment_hash: paymentHash as HexString });

        if (paymentResult.status !== lastStatus) {
          if (options.json) {
            printJson({
              success: true,
              data: {
                statusTransition: {
                  from: lastStatus ?? null,
                  to: paymentResult.status,
                  at: new Date().toISOString(),
                },
                payment: formatPaymentResult(paymentResult),
              },
            });
          } else {
            console.log(`Status: ${lastStatus ?? '(initial)'} -> ${paymentResult.status}`);
            printPaymentDetailHuman(paymentResult);
            console.log('');
          }
          lastStatus = paymentResult.status;
        }

        if (paymentResult.status === 'Success' || paymentResult.status === 'Failed') {
          return;
        }

        await sleep(intervalSeconds * 1000);
      }

      printJson({
        success: false,
        error: {
          code: 'PAYMENT_WATCH_TIMEOUT',
          message: `Payment ${paymentHash} did not reach terminal state within ${timeoutSeconds}s`,
        },
      });
      process.exit(1);
    });

  return payment;
}
