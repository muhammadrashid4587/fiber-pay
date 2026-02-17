import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  type CliConfig,
  getEffectiveConfig,
  loadProfileConfig,
  type ProfileConfig,
  parseNetworkFromConfig,
  saveProfileConfig,
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
    .option('--effective', 'Debug resolved values and value source')
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

  // ---------------------------------------------------------------------------
  // config set — edit a known key in config.yml via line replacement
  // ---------------------------------------------------------------------------
  const CONFIG_SET_KEYS: Record<string, { section: string; yamlKey: string; quote?: boolean }> = {
    'rpc.listening_addr': { section: 'rpc', yamlKey: 'listening_addr', quote: true },
    'fiber.listening_addr': { section: 'fiber', yamlKey: 'listening_addr', quote: true },
    'ckb.rpc_url': { section: 'ckb', yamlKey: 'rpc_url', quote: true },
    chain: { section: 'fiber', yamlKey: 'chain' },
  };

  config
    .command('set')
    .description(`Set a known key in config.yml. Keys: ${Object.keys(CONFIG_SET_KEYS).join(', ')}`)
    .argument('<key>', 'Config key to set')
    .argument('<value>', 'New value')
    .option('--json')
    .action(async (key, value, options) => {
      const effective = getEffectiveConfig();
      const json = Boolean(options.json);
      const configPath = effective.config.configPath;

      if (!existsSync(configPath)) {
        const msg = `Config file not found: ${configPath}. Run \`fiber-pay config init\` first.`;
        if (json) {
          printJsonError({
            code: 'CONFIG_NOT_FOUND',
            message: msg,
            recoverable: true,
            suggestion: 'Run `fiber-pay config init --network testnet` and retry.',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const spec = CONFIG_SET_KEYS[key];
      if (!spec) {
        const msg = `Unknown config key: ${key}. Valid keys: ${Object.keys(CONFIG_SET_KEYS).join(', ')}`;
        if (json) {
          printJsonError({
            code: 'CONFIG_INVALID_KEY',
            message: msg,
            recoverable: true,
            suggestion: `Use one of: ${Object.keys(CONFIG_SET_KEYS).join(', ')}`,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const content = readFileSync(configPath, 'utf-8');
      const lines = content.split('\n');
      let currentSection: string | null = null;
      let replaced = false;

      for (let i = 0; i < lines.length; i++) {
        const sectionMatch = lines[i].match(/^([a-zA-Z_]+):\s*$/);
        if (sectionMatch) {
          currentSection = sectionMatch[1];
          continue;
        }

        if (currentSection === spec.section) {
          const keyPattern = new RegExp(`^(\\s*)${spec.yamlKey}:\\s*`);
          if (keyPattern.test(lines[i])) {
            const indent = lines[i].match(/^(\s*)/)?.[1] ?? '  ';
            const formatted = spec.quote ? `"${value}"` : value;
            lines[i] = `${indent}${spec.yamlKey}: ${formatted}`;
            replaced = true;
            break;
          }
        }
      }

      if (!replaced) {
        const msg = `Key "${spec.yamlKey}" not found in section "${spec.section}" of ${configPath}`;
        if (json) {
          printJsonError({
            code: 'CONFIG_KEY_NOT_FOUND_IN_FILE',
            message: msg,
            recoverable: true,
            suggestion: 'Ensure config.yml contains the expected section and key.',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      writeFileSync(configPath, lines.join('\n'), 'utf-8');

      if (json) {
        printJsonSuccess({ key, value, configPath });
      } else {
        console.log(`✅ Set ${key} = ${value} in ${configPath}`);
      }
    });

  // ---------------------------------------------------------------------------
  // config profile — manage profile.json key-value settings
  // ---------------------------------------------------------------------------
  const profile = new Command('profile').description(
    'Manage profile.json settings (CLI-only overrides)',
  );

  const PROFILE_KEYS: (keyof ProfileConfig)[] = ['binaryPath', 'keyPassword'];

  profile
    .command('show')
    .description('Show current profile.json values')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const profileData = loadProfileConfig(effective.config.dataDir);

      if (options.json) {
        printJsonSuccess({ dataDir: effective.config.dataDir, profile: profileData ?? {} });
      } else {
        if (!profileData || Object.keys(profileData).length === 0) {
          console.log('No profile settings found.');
          console.log(`  Location: ${effective.config.dataDir}/profile.json`);
          return;
        }
        console.log('Profile Settings');
        console.log(`  Location: ${effective.config.dataDir}/profile.json`);
        for (const key of PROFILE_KEYS) {
          if (profileData[key] !== undefined) {
            console.log(`  ${key}: ${profileData[key]}`);
          }
        }
      }
    });

  profile
    .command('set')
    .description('Set a profile key')
    .argument('<key>', `One of: ${PROFILE_KEYS.join(', ')}`)
    .argument('<value>')
    .option('--json')
    .action(async (key, value, options) => {
      if (!PROFILE_KEYS.includes(key as keyof ProfileConfig)) {
        const msg = `Unknown profile key: ${key}. Valid keys: ${PROFILE_KEYS.join(', ')}`;
        if (options.json) {
          printJsonError({
            code: 'PROFILE_INVALID_KEY',
            message: msg,
            recoverable: true,
            suggestion: `Use one of: ${PROFILE_KEYS.join(', ')}`,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const effective = getEffectiveConfig();
      const existing = loadProfileConfig(effective.config.dataDir) ?? {};

      (existing as Record<string, unknown>)[key] = value;
      saveProfileConfig(effective.config.dataDir, existing);

      if (options.json) {
        printJsonSuccess({ key, value, dataDir: effective.config.dataDir });
      } else {
        console.log(`✅ Profile key "${key}" set to "${value}"`);
      }
    });

  profile
    .command('unset')
    .description('Remove a profile key')
    .argument('<key>', `One of: ${PROFILE_KEYS.join(', ')}`)
    .option('--json')
    .action(async (key, options) => {
      if (!PROFILE_KEYS.includes(key as keyof ProfileConfig)) {
        const msg = `Unknown profile key: ${key}. Valid keys: ${PROFILE_KEYS.join(', ')}`;
        if (options.json) {
          printJsonError({
            code: 'PROFILE_INVALID_KEY',
            message: msg,
            recoverable: true,
            suggestion: `Use one of: ${PROFILE_KEYS.join(', ')}`,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const effective = getEffectiveConfig();
      const existing = loadProfileConfig(effective.config.dataDir) ?? {};
      delete (existing as Record<string, unknown>)[key];
      saveProfileConfig(effective.config.dataDir, existing);

      if (options.json) {
        printJsonSuccess({ key, removed: true, dataDir: effective.config.dataDir });
      } else {
        console.log(`✅ Profile key "${key}" removed`);
      }
    });

  config.addCommand(profile);

  return config;
}
