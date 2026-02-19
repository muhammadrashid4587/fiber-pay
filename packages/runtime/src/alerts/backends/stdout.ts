import type { Alert, AlertBackend } from '../types.js';
import { formatRuntimeAlert } from '../format.js';

export class StdoutAlertBackend implements AlertBackend {
  async send(alert: Alert): Promise<void> {
    console.log(formatRuntimeAlert(alert));
  }
}
