export interface TuiConfig {
  proxyUrl: string;
  wsUrl?: string;
  alertsEnabled: boolean;
  pollInterval: number;
  alertBufferSize: number;
}

export interface CliConfigLike {
  runtimeProxyListen?: string;
}

export interface TuiConfigOverrides {
  proxyUrl?: string;
  wsUrl?: string;
  alertsEnabled?: boolean;
  pollInterval?: number;
  alertBufferSize?: number;
}

const DEFAULT_PROXY_URL = 'http://127.0.0.1:8229';

function toHttpUrl(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `http://${value}`;
}

export function resolveTuiConfig(
  cliConfig: CliConfigLike,
  overrides: TuiConfigOverrides = {},
): TuiConfig {
  const proxyUrl = overrides.proxyUrl ?? toHttpUrl(cliConfig.runtimeProxyListen ?? DEFAULT_PROXY_URL);

  return {
    proxyUrl,
    wsUrl: overrides.wsUrl,
    alertsEnabled: overrides.alertsEnabled ?? true,
    pollInterval: overrides.pollInterval ?? 3000,
    alertBufferSize: overrides.alertBufferSize ?? 200,
  };
}
