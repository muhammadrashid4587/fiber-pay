import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeMeta } from './runtime-meta.js';

export interface PersistedLogPaths {
  runtimeAlerts: string;
  fnnStdout: string;
  fnnStderr: string;
}

export type PersistedLogSource = 'runtime' | 'fnn-stdout' | 'fnn-stderr';
export type PersistedLogSourceOption = PersistedLogSource | 'all';

export interface PersistedLogTarget {
  source: PersistedLogSource;
  title: 'runtime.alerts' | 'fnn.stdout' | 'fnn.stderr';
  path: string;
}

export function resolvePersistedLogPaths(
  dataDir: string,
  meta?: RuntimeMeta | null,
): PersistedLogPaths {
  return {
    runtimeAlerts: meta?.alertLogFilePath ?? join(dataDir, 'logs', 'runtime.alerts.jsonl'),
    fnnStdout: meta?.fnnStdoutLogPath ?? join(dataDir, 'logs', 'fnn.stdout.log'),
    fnnStderr: meta?.fnnStderrLogPath ?? join(dataDir, 'logs', 'fnn.stderr.log'),
  };
}

export function resolvePersistedLogTargets(
  paths: PersistedLogPaths,
  source: PersistedLogSourceOption,
): PersistedLogTarget[] {
  const all: PersistedLogTarget[] = [
    {
      source: 'runtime',
      title: 'runtime.alerts',
      path: paths.runtimeAlerts,
    },
    {
      source: 'fnn-stdout',
      title: 'fnn.stdout',
      path: paths.fnnStdout,
    },
    {
      source: 'fnn-stderr',
      title: 'fnn.stderr',
      path: paths.fnnStderr,
    },
  ];

  if (source === 'all') {
    return all;
  }

  return all.filter((target) => target.source === source);
}

export function readLastLines(filePath: string, maxLines: number): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(-maxLines);
}
