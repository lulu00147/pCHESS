import type { ParsedInfo } from '../engine/uci';

export class AnalysisState {
  lines = new Map<number, ParsedInfo>();
  best: string | null = null;
  bestFen: string | null = null;
  fen: string | null = null;
  searchId: number | null = null;
  status = '引擎未连接';
  running = false;

  reset(): void {
    this.clearResults();
    this.status = '引擎未连接';
    this.running = false;
  }

  begin(): void {
    this.clearResults();
    this.status = '初始化引擎';
    this.running = true;
  }

  info(line: ParsedInfo, single: boolean): void {
    this.lines.set(line.multipv, line);
    this.status = `深度 ${line.depth ?? '?'}${single ? '（单线程）' : ''}`;
  }

  finish(move: string | null): void {
    this.best = move ?? '(none)';
    this.bestFen = this.fen;
    this.running = false;
    this.status = '完成';
  }

  clearResult(): void {
    this.clearResults();
  }

  fail(message: string): void {
    this.clearResults();
    this.running = false;
    this.status = message;
  }

  private clearResults(): void {
    this.lines.clear();
    this.best = null;
    this.bestFen = null;
    this.fen = null;
    this.searchId = null;
  }
}
