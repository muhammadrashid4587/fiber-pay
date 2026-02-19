import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { parseIntegerOption } from '../lib/parse-options.js';

export function createTuiCommand(config: CliConfig): Command {
  return new Command('tui')
    .description('Open real-time terminal dashboard for runtime monitor and alerts')
    .option('--poll-interval <seconds>', 'Polling interval for HTTP data (default: 3)')
    .option('--ws-url <url>', 'WebSocket alert endpoint URL (optional)')
    .option('--no-alerts', 'Disable WebSocket alert feed (poll-only mode)')
    .action(async (options: { pollInterval?: string; wsUrl?: string; alerts?: boolean }) => {
      const { renderDashboard, resolveTuiConfig } = await import('@fiber-pay/tui');
      const pollSeconds = parseIntegerOption(options.pollInterval, 'poll-interval') ?? 3;
      const alertsEnabled = options.alerts !== false;

      const tuiConfig = resolveTuiConfig(config, {
        alertsEnabled,
        pollInterval: pollSeconds * 1000,
        wsUrl: alertsEnabled ? options.wsUrl : undefined,
      });

      renderDashboard(tuiConfig);
    });
}
