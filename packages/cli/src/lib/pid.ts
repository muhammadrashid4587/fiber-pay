import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function getPidFilePath(dataDir: string): string {
  return join(dataDir, 'fiber.pid');
}

export function writePidFile(dataDir: string, pid: number): void {
  writeFileSync(getPidFilePath(dataDir), String(pid));
}

export function readPidFile(dataDir: string): number | null {
  const pidPath = getPidFilePath(dataDir);
  if (!existsSync(pidPath)) return null;

  try {
    return parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

export function removePidFile(dataDir: string): void {
  const pidPath = getPidFilePath(dataDir);
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
