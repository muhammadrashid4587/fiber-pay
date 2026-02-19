import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Alert, AlertBackend } from '../types.js';

export class JsonlFileAlertBackend implements AlertBackend {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  async send(alert: Alert): Promise<void> {
    appendFileSync(this.path, `${JSON.stringify(alert)}\n`, 'utf-8');
  }
}
