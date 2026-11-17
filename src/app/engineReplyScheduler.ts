export interface EngineReplySchedulerOptions {
  readonly isRunning: () => boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly delayMs?: number;
}

export class EngineReplyScheduler {
  private enabled = true;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: EngineReplySchedulerOptions) {}

  get isPending(): boolean {
    return this.pending;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pending = false;
      this.clearTimer();
    }
  }

  afterMove(): void {
    this.clearTimer();
    if (!this.enabled) return;
    this.pending = true;
    this.schedule();
  }

  cancel(): void {
    const wasPending = this.pending;
    this.pending = false;
    this.clearTimer();
    if (wasPending && this.options.isRunning()) this.options.stop();
  }

  clearPending(): void {
    this.pending = false;
    this.clearTimer();
  }

  reset(): void {
    this.pending = false;
    this.clearTimer();
  }

  private schedule(): void {
    if (!this.enabled || !this.pending) return;
    if (this.options.isRunning()) {
      this.options.stop();
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.enabled || !this.pending || this.options.isRunning()) return;
      this.options.start();
    }, this.options.delayMs ?? 120);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
