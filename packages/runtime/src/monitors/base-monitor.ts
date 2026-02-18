export interface BaseMonitorHooks {
  onCycleError?: (error: unknown, monitorName: string) => Promise<void> | void;
  onCycleSuccess?: (monitorName: string) => Promise<void> | void;
}

export abstract class BaseMonitor {
  protected readonly intervalMs: number;
  private readonly hooks: BaseMonitorHooks;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(intervalMs: number, hooks: BaseMonitorHooks = {}) {
    this.intervalMs = intervalMs;
    this.hooks = hooks;
  }

  protected abstract get name(): string;

  protected abstract poll(): Promise<void>;

  start(): void {
    this.stop();
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.poll();
      await this.hooks.onCycleSuccess?.(this.name);
    } catch (error) {
      await this.hooks.onCycleError?.(error, this.name);
    } finally {
      this.running = false;
    }
  }
}
