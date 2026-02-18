import { Command } from 'commander';
import { CLI_COMMIT, CLI_VERSION } from '../lib/build-info.js';
import { printJsonSuccess } from '../lib/format.js';

export function createVersionCommand(): Command {
  return new Command('version')
    .description('Show CLI version and commit id')
    .option('--json', 'Output JSON')
    .action((options: { json?: boolean }) => {
      const payload = {
        version: CLI_VERSION,
        commit: CLI_COMMIT,
      };

      if (options.json) {
        printJsonSuccess(payload);
        return;
      }

      console.log(`Version: ${payload.version}`);
      console.log(`Commit:  ${payload.commit}`);
    });
}
