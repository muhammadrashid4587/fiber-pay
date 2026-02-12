import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  type CliConfig,
  getEffectiveConfig,
  parseNetworkFromConfig,
  writeNetworkConfigFile,
} from '../lib/config.js';
import type { FiberNetwork } from '../lib/config-templates.js';
import { printJson } from '../lib/format.js';

function parseNetworkInput(input: string | undefined): FiberNetwork {
  if (!input) return 'testnet';
  if (input === 'testnet' || input === 'mainnet') return input;
  throw new Error(`Invalid network: ${input}. Expected one of: testnet, mainnet`);
}

export function createConfigCommand(_config: CliConfig): Command {
  const config = new Command('config').description('Single source configuration management');

  config
    .command('init')
    .option('--network <network>', 'testnet | mainnet')
    .option('--force', 'Overwrite existing config file')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const selectedNetwork = options.network
        ? parseNetworkInput(options.network)
        : effective.config.network;
      const result = writeNetworkConfigFile(effective.config.dataDir, selectedNetwork, {
        force: Boolean(options.force),
      });

      const payload = {
        success: true,
        data: {
          configPath: result.path,
          network: selectedNetwork,
          created: result.created,
          overwritten: result.overwritten,
          skipped: !result.created && !result.overwritten,
        },
      };

      if (options.json) {
        printJson(payload);
      } else {
        if (result.created) {
          console.log(`✅ Config initialized: ${result.path}`);
        } else if (result.overwritten) {
          console.log(`✅ Config overwritten: ${result.path}`);
        } else {
          console.log(`ℹ️  Config already exists: ${result.path}`);
          console.log('   Use --force to overwrite.');
        }
        console.log(`   Network: ${selectedNetwork}`);
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
          success: true,
          data: {
            config: effective.config,
            sources: effective.sources,
            configExists: effective.configExists,
          },
        };

        if (options.json) {
          printJson(payload);
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
        const payload = {
          success: false,
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: `Config file not found: ${effective.config.configPath}`,
          },
        };

        if (options.json) {
          printJson(payload);
        } else {
          console.error(`Error: Config file not found: ${effective.config.configPath}`);
          console.error('Run: fiber-pay config init --network testnet');
        }
        process.exit(1);
      }

      const content = readFileSync(effective.config.configPath, 'utf-8');
      const fileNetwork = parseNetworkFromConfig(content) || 'unknown';

      if (options.json) {
        printJson({
          success: true,
          data: {
            path: effective.config.configPath,
            network: fileNetwork,
            content,
          },
        });
      } else {
        console.log(`# ${effective.config.configPath} (${fileNetwork})`);
        console.log(content);
      }
    });

  return config;
}
