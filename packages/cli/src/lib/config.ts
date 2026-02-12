import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FiberNetwork, getConfigTemplate } from './config-templates.js';

export interface CliConfig {
  binaryPath?: string;
  dataDir: string;
  configPath: string;
  network: FiberNetwork;
  rpcUrl: string;
  keyPassword?: string;
}

export interface EffectiveConfigSources {
  dataDir: 'env' | 'default';
  configPath: 'derived';
  network: 'env' | 'config' | 'default';
  rpcUrl: 'env' | 'config' | 'default';
}

export interface EffectiveConfig {
  config: CliConfig;
  sources: EffectiveConfigSources;
  configExists: boolean;
}

const DEFAULT_DATA_DIR = `${process.env.HOME}/.fiber-pay`;
const DEFAULT_RPC_URL = 'http://127.0.0.1:8227';
const DEFAULT_NETWORK: FiberNetwork = 'testnet';

export function getConfigPath(dataDir: string): string {
  return join(dataDir, 'config.yml');
}

export function parseNetworkFromConfig(configContent: string): FiberNetwork | undefined {
  const match = configContent.match(/^\s*chain:\s*(testnet|mainnet)\s*$/m);
  if (!match) return undefined;
  return match[1] as FiberNetwork;
}

export function parseRpcUrlFromConfig(configContent: string): string | undefined {
  const rpcSectionMatch = configContent.match(
    /(^|\n)rpc:\n([\s\S]*?)(\n[a-zA-Z_]+:|\nservices:|$)/,
  );
  const rpcSection = rpcSectionMatch?.[2];
  if (!rpcSection) return undefined;

  const match = rpcSection.match(/^\s*listening_addr:\s*"?([^"\n]+)"?\s*$/m);
  if (!match) return undefined;
  const listeningAddr = match[1].trim();
  if (!listeningAddr) return undefined;
  if (listeningAddr.startsWith('http://') || listeningAddr.startsWith('https://')) {
    return listeningAddr;
  }
  return `http://${listeningAddr}`;
}

export function writeNetworkConfigFile(
  dataDir: string,
  network: FiberNetwork,
  options: { force?: boolean } = {},
): { path: string; created: boolean; overwritten: boolean } {
  const configPath = getConfigPath(dataDir);
  const alreadyExists = existsSync(configPath);

  if (alreadyExists && !options.force) {
    return { path: configPath, created: false, overwritten: false };
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(configPath, getConfigTemplate(network), 'utf-8');
  return { path: configPath, created: !alreadyExists, overwritten: alreadyExists };
}

export function ensureNodeConfigFile(dataDir: string, network: FiberNetwork): string {
  const configPath = getConfigPath(dataDir);
  if (!existsSync(configPath)) {
    writeNetworkConfigFile(dataDir, network);
  }
  return configPath;
}

export function getEffectiveConfig(): EffectiveConfig {
  const dataDir = process.env.FIBER_DATA_DIR || DEFAULT_DATA_DIR;
  const dataDirSource: EffectiveConfigSources['dataDir'] = process.env.FIBER_DATA_DIR
    ? 'env'
    : 'default';

  const configPath = getConfigPath(dataDir);
  const configExists = existsSync(configPath);
  const configContent = configExists ? readFileSync(configPath, 'utf-8') : undefined;

  const envNetwork = process.env.FIBER_NETWORK as FiberNetwork | undefined;
  const fileNetwork = configContent ? parseNetworkFromConfig(configContent) : undefined;
  const network = envNetwork || fileNetwork || DEFAULT_NETWORK;
  const networkSource: EffectiveConfigSources['network'] = envNetwork
    ? 'env'
    : fileNetwork
      ? 'config'
      : 'default';

  const envRpcUrl = process.env.FIBER_RPC_URL;
  const fileRpcUrl = configContent ? parseRpcUrlFromConfig(configContent) : undefined;
  const rpcUrl = envRpcUrl || fileRpcUrl || DEFAULT_RPC_URL;
  const rpcUrlSource: EffectiveConfigSources['rpcUrl'] = envRpcUrl
    ? 'env'
    : fileRpcUrl
      ? 'config'
      : 'default';

  return {
    configExists,
    config: {
      binaryPath: process.env.FIBER_BINARY_PATH,
      dataDir,
      configPath,
      network,
      rpcUrl,
      keyPassword: process.env.FIBER_KEY_PASSWORD,
    },
    sources: {
      dataDir: dataDirSource,
      configPath: 'derived',
      network: networkSource,
      rpcUrl: rpcUrlSource,
    },
  };
}

export function getConfig(): CliConfig {
  return getEffectiveConfig().config;
}
