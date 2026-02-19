import { existsSync } from 'node:fs';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';
import {
  type PersistedLogSourceOption,
  readLastLines,
  resolvePersistedLogPaths,
  resolvePersistedLogTargets,
} from '../lib/log-files.js';
import { readRuntimeMeta } from '../lib/runtime-meta.js';

const ALLOWED_SOURCES = new Set<PersistedLogSourceOption>([
  'all',
  'runtime',
  'fnn-stdout',
  'fnn-stderr',
]);

export function createLogsCommand(config: CliConfig): Command {
  return new Command('logs')
    .alias('log')
    .description('View persisted runtime/fnn logs')
    .option('--source <source>', 'Log source: all|runtime|fnn-stdout|fnn-stderr', 'all')
    .option('--tail <n>', 'Number of recent lines per source', '80')
    .option('--follow', 'Keep streaming appended log lines (human output mode only)')
    .option('--interval-ms <ms>', 'Polling interval for --follow mode', '1000')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const follow = Boolean(options.follow);
      const sourceInput = String(options.source ?? 'all')
        .trim()
        .toLowerCase();

      if (json && follow) {
        const message = '--follow is not supported with --json. Use human mode for streaming logs.';
        printJsonError({
          code: 'LOG_FOLLOW_JSON_UNSUPPORTED',
          message,
          recoverable: true,
          suggestion: 'Remove --json or remove --follow and retry.',
        });
        process.exit(1);
      }

      if (!ALLOWED_SOURCES.has(sourceInput as PersistedLogSourceOption)) {
        const message =
          'Invalid --source value. Expected one of: all, runtime, fnn-stdout, fnn-stderr.';
        if (json) {
          printJsonError({
            code: 'LOG_SOURCE_INVALID',
            message,
            recoverable: true,
            suggestion: 'Retry with --source all|runtime|fnn-stdout|fnn-stderr.',
            details: { source: sourceInput },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      const source = sourceInput as PersistedLogSourceOption;
      const tailInput = Number.parseInt(String(options.tail ?? '80'), 10);
      const tail = Number.isFinite(tailInput) && tailInput > 0 ? tailInput : 80;
      const intervalInput = Number.parseInt(String(options.intervalMs ?? '1000'), 10);
      const intervalMs = Number.isFinite(intervalInput) && intervalInput > 0 ? intervalInput : 1000;

      const meta = readRuntimeMeta(config.dataDir);
      const paths = resolvePersistedLogPaths(config.dataDir, meta);
      const targets = resolvePersistedLogTargets(paths, source);

      if (source !== 'all' && targets.length === 1 && !existsSync(targets[0].path)) {
        const message = `Log file not found for source ${source}: ${targets[0].path}`;
        if (json) {
          printJsonError({
            code: 'LOG_FILE_NOT_FOUND',
            message,
            recoverable: true,
            suggestion: 'Start node/runtime or generate activity, then retry logs command.',
            details: { source, path: targets[0].path },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      const entries = [] as Array<{
        source: (typeof targets)[number]['source'];
        title: (typeof targets)[number]['title'];
        path: string;
        exists: boolean;
        lineCount: number;
        lines: string[];
      }>;

      for (const target of targets) {
        const exists = existsSync(target.path);
        let lines: string[] = [];
        if (exists) {
          try {
            lines = readLastLines(target.path, tail);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : `Failed to read log file: ${target.path}`;
            if (json) {
              printJsonError({
                code: 'LOG_READ_FAILED',
                message,
                recoverable: true,
                suggestion: 'Check log file permissions and retry.',
                details: { source: target.source, path: target.path },
              });
            } else {
              console.error(`Error: ${message}`);
            }
            process.exit(1);
          }
        }

        entries.push({
          source: target.source,
          title: target.title,
          path: target.path,
          exists,
          lineCount: lines.length,
          lines,
        });
      }

      if (json) {
        printJsonSuccess({
          source,
          tail,
          entries,
        });
        return;
      }

      console.log(`Logs (source: ${source}, tail: ${tail})`);
      for (const entry of entries) {
        console.log(`\n${entry.title}: ${entry.path}`);
        if (!entry.exists) {
          console.log('  (file not found)');
          continue;
        }
        if (entry.lines.length === 0) {
          console.log('  (no lines)');
          continue;
        }
        for (const line of entry.lines) {
          console.log(`  ${line}`);
        }
      }

      if (!follow) {
        return;
      }

      console.log(`\nFollowing logs (interval: ${intervalMs}ms). Press Ctrl+C to stop.`);

      const states = new Map(
        entries.map((entry) => [
          entry.source,
          {
            title: entry.title,
            path: entry.path,
            seenLines: entry.exists ? entry.lines.length : 0,
          },
        ]),
      );

      // Keep process alive for follow mode.
      await new Promise<void>((resolve) => {
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          clearInterval(timer);
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          console.log('\nStopped following logs.');
          resolve();
        };

        const timer = setInterval(() => {
          for (const target of targets) {
            const state = states.get(target.source);
            if (!state) continue;

            if (!existsSync(state.path)) {
              continue;
            }

            const allLines = readLastLines(state.path, Number.MAX_SAFE_INTEGER);
            const total = allLines.length;
            const fromIndex = total < state.seenLines ? 0 : state.seenLines;
            const newLines = allLines.slice(fromIndex);
            if (newLines.length === 0) {
              continue;
            }

            for (const line of newLines) {
              console.log(`[${state.title}] ${line}`);
            }
            state.seenLines = total;
          }
        }, intervalMs);

        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
      });
    });
}
