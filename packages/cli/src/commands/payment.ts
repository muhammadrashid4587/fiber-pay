import { ckbToShannons, type HexString, shannonsToCkb } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import {
  formatPaymentResult,
  printJsonError,
  printJsonEvent,
  printJsonSuccess,
  printPaymentDetailHuman,
  sleep,
} from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

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
      const json = Boolean(options.json);
      const invoice = options.invoice || invoiceArg;
      const recipientNodeId = options.to;
      const amountCkb = options.amount ? parseFloat(options.amount) : undefined;
      const maxFeeCkb = options.maxFee ? parseFloat(options.maxFee) : undefined;

      if (!invoice && !recipientNodeId) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_INPUT_INVALID',
            message: 'Either invoice or --to <nodeId> required',
          });
        } else {
          console.error('Error: Either invoice or --to <nodeId> required');
        }
        process.exit(1);
      }
      if (recipientNodeId && !amountCkb) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_INPUT_INVALID',
            message: '--amount required when using --to',
          });
        } else {
          console.error('Error: --amount required when using --to');
        }
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
        status:
          result.status === 'Success'
            ? 'success'
            : result.status === 'Failed'
              ? 'failed'
              : 'pending',
        feeCkb: shannonsToCkb(result.fee),
        failureReason: result.failed_error,
      };

      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log('Payment sent');
        console.log(`  Hash:   ${payload.paymentHash}`);
        console.log(`  Status: ${payload.status}`);
        console.log(`  Fee:    ${payload.feeCkb} CKB`);
        if (payload.failureReason) {
          console.log(`  Error:  ${payload.failureReason}`);
        }
      }
    });

  payment
    .command('get')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.getPayment({ payment_hash: paymentHash as HexString });
      if (options.json) {
        printJsonSuccess(formatPaymentResult(result));
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
      const json = Boolean(options.json);
      const intervalSeconds = parseInt(options.interval, 10);
      const timeoutSeconds = parseInt(options.timeout, 10);
      const startedAt = Date.now();
      let lastStatus: string | undefined;

      while (Date.now() - startedAt < timeoutSeconds * 1000) {
        const paymentResult = await rpc.getPayment({ payment_hash: paymentHash as HexString });

        if (paymentResult.status !== lastStatus) {
          if (json) {
            printJsonEvent('status_transition', {
              statusTransition: {
                from: lastStatus ?? null,
                to: paymentResult.status,
              },
              payment: formatPaymentResult(paymentResult),
            });
          } else {
            console.log(`Status: ${lastStatus ?? '(initial)'} -> ${paymentResult.status}`);
            printPaymentDetailHuman(paymentResult);
            console.log('');
          }
          lastStatus = paymentResult.status;
        }

        if (paymentResult.status === 'Success' || paymentResult.status === 'Failed') {
          if (json) {
            printJsonEvent('terminal', {
              paymentHash,
              terminalStatus: paymentResult.status,
            });
          }
          return;
        }

        await sleep(intervalSeconds * 1000);
      }

      if (json) {
        printJsonError({
          code: 'PAYMENT_WATCH_TIMEOUT',
          message: `Payment ${paymentHash} did not reach terminal state within ${timeoutSeconds}s`,
        });
      } else {
        console.error(
          `Error: Payment ${paymentHash} did not reach terminal state within ${timeoutSeconds}s`,
        );
      }
      process.exit(1);
    });

  return payment;
}
