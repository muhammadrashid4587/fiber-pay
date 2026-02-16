import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  type CliConfig,
  getEffectiveConfig,
  parseNetworkFromConfig,
  writeNetworkConfigFile,
} from '../lib/config.js';
import type { FiberNetwork } from '../lib/config-templates.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';

function parseNetworkInput(input: string | undefined): FiberNetwork {
  if (!input) return 'testnet';
  if (input === 'testnet' || input === 'mainnet') return input;
  throw new Error(`Invalid network: ${input}. Expected one of: testnet, mainnet`);
}

function parsePortInput(
  input: string | undefined,
  label: 'rpc-port' | 'p2p-port',
): number | undefined {
  if (input === undefined) return undefined;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${label}: ${input}. Expected integer in range 1-65535.`);
  }
  return parsed;
}

function resolvePort(
  optionValue: string | undefined,
  envValue: string | undefined,
  label: 'rpc-port' | 'p2p-port',
): { value: number | undefined; source: 'option' | 'env' | 'unset' } {
  if (optionValue !== undefined) {
    return { value: parsePortInput(optionValue, label), source: 'option' };
  }
  if (envValue !== undefined) {
    return { value: parsePortInput(envValue, label), source: 'env' };
  }
  return { value: undefined, source: 'unset' };
}

export function createConfigCommand(_config: CliConfig): Command {
  const config = new Command('config').description('Single source configuration management');

  config
    .command('init')
    .option(
      '--data-dir <path>',
      'Target data directory (overrides FIBER_DATA_DIR for this command)',
    )
    .option('--network <network>', 'testnet | mainnet')
    .option('--rpc-port <port>', 'Override rpc.listening_addr port in generated config')
    .option('--p2p-port <port>', 'Override fiber.listening_addr port in generated config')
    .option('--force', 'Overwrite existing config file')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const dataDir = options.dataDir ?? effective.config.dataDir;
      const selectedNetwork = options.network
        ? parseNetworkInput(options.network)
        : effective.config.network;
      const rpcPort = resolvePort(options.rpcPort, process.env.FIBER_RPC_PORT, 'rpc-port');
      const p2pPort = resolvePort(options.p2pPort, process.env.FIBER_P2P_PORT, 'p2p-port');
      const result = writeNetworkConfigFile(dataDir, selectedNetwork, {
        force: Boolean(options.force),
        rpcPort: rpcPort.value,
        p2pPort: p2pPort.value,
      });

      const payload = {
        configPath: result.path,
        dataDir,
        network: selectedNetwork,
        rpcPort: rpcPort.value,
        rpcPortSource: rpcPort.source,
        p2pPort: p2pPort.value,
        p2pPortSource: p2pPort.source,
        created: result.created,
        overwritten: result.overwritten,
        skipped: !result.created && !result.overwritten,
      };

      if (options.json) {
        printJsonSuccess(payload);
      } else {
        if (result.created) {
          console.log(`✅ Config initialized: ${result.path}`);
        } else if (result.overwritten) {
          console.log(`✅ Config overwritten: ${result.path}`);
        } else {
          console.log(`ℹ️  Config already exists: ${result.path}`);
          console.log('   Use --force to overwrite.');
        }
        if (options.dataDir !== undefined) {
          console.log(`   Data Dir: ${dataDir} (option)`);
        } else {
          console.log(`   Data Dir: ${dataDir} (${effective.sources.dataDir})`);
        }
        console.log(`   Network: ${selectedNetwork}`);
        if (rpcPort.value !== undefined)
          console.log(`   RPC Port: ${rpcPort.value} (${rpcPort.source})`);
        if (p2pPort.value !== undefined)
          console.log(`   P2P Port: ${p2pPort.value} (${p2pPort.source})`);
      }
    });

  config
    .command('show')
    .option('--effective', 'Show effective values and their source')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();

      if (options.effective) {
        const payload = {
          config: effective.config,
          sources: effective.sources,
          configExists: effective.configExists,
        };

        if (options.json) {
          printJsonSuccess(payload);
        } else {
          console.log('Effective Config');
          console.log(`  Data Dir:    ${effective.config.dataDir} (${effective.sources.dataDir})`);
          console.log(`  Config Path: ${effective.config.configPath}`);
          console.log(`  Network:     ${effective.config.network} (${effective.sources.network})`);
          console.log(`  RPC URL:     ${effective.config.rpcUrl} (${effective.sources.rpcUrl})`);
          console.log(`  Exists:      ${effective.configExists ? 'yes' : 'no'}`);
        }
        return;
      }

      if (!effective.configExists) {
        if (options.json) {
          printJsonError({
            code: 'CONFIG_NOT_FOUND',
            message: `Config file not found: ${effective.config.configPath}`,
            recoverable: true,
            suggestion: 'Run `fiber-pay config init --network testnet` and retry.',
            details: { configPath: effective.config.configPath },
          });
        } else {
          console.error(`Error: Config file not found: ${effective.config.configPath}`);
          console.error('Run: fiber-pay config init --network testnet');
        }
        process.exit(1);
      }

      const content = readFileSync(effective.config.configPath, 'utf-8');
      const fileNetwork = parseNetworkFromConfig(content) || 'unknown';

      if (options.json) {
        printJsonSuccess({
          path: effective.config.configPath,
          network: fileNetwork,
          content,
        });
      } else {
        console.log(`# ${effective.config.configPath} (${fileNetwork})`);
        console.log(content);
      }
    });

  return config;
}
