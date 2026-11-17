export interface AutoAnalysisSchedulerOptions {
  readonly isRunning: () => boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly delayMs?: number;
}

export class AutoAnalysisScheduler {
  private enabled = false;
  private paused = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: AutoAnalysisSchedulerOptions) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.paused = false;
    if (!enabled) {
      this.pending = false;
      this.cancelTimer();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.pending = false;
      this.cancelTimer();
    }
  }

  afterMove(): void {
    this.cancelTimer();
    if (!this.enabled || this.paused) return;
    if (this.options.isRunning()) {
      this.pending = true;
      this.options.stop();
      return;
    }
    this.schedule();
  }

  afterResult(): void {
    if (!this.pending) return;
    this.pending = false;
    if (!this.enabled || this.paused || this.options.isRunning()) return;
    this.schedule();
  }

  reset(): void {
    this.pending = false;
    this.cancelTimer();
  }

  cancelPending(): void {
    this.pending = false;
    this.cancelTimer();
  }

  private schedule(): void {
    if (!this.enabled || this.paused) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.enabled || this.paused || this.options.isRunning()) return;
      this.options.start();
    }, this.options.delayMs ?? 120);
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
