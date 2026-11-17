import { parseUciLine } from './uci';
import type { EngineErrorCode, EngineInit, MainToWorker, WorkerToMain } from './protocol';

export interface EngineHandle {
  command(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  terminate(): void;
  abort?: () => void;
}

export interface EngineInitResult {
  readonly idName: string;
  readonly options: readonly string[];
}

export type EngineFactory = (
  init: EngineInit,
) => Promise<{ handle: EngineHandle; meta: EngineInitResult }>;

type State = 'idle' | 'initializing' | 'ready' | 'searching' | 'stopping' | 'disposed';

export class WorkerCore {
  private readonly send: (message: WorkerToMain) => void;
  private readonly factory: EngineFactory;
  private state: State = 'idle';
  private handle: EngineHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private searchId = 0;
  private chunkMs: number | null = null;
  private lastBest: { move: string | null; ponder?: string } | null = null;

  constructor(send: (message: WorkerToMain) => void, factory: EngineFactory) {
    this.send = send;
    this.factory = factory;
  }

  get currentState(): State {
    return this.state;
  }

  async receive(message: MainToWorker): Promise<void> {
    switch (message.type) {
      case 'init':
        await this.initialize(message);
        return;
      case 'analyze':
        this.analyze(message);
        return;
      case 'stop':
        if (message.searchId !== this.searchId) return;
        if (this.state === 'ready' && this.chunkMs !== null && this.lastBest) {
          this.finishBest(this.lastBest);
          return;
        }
        if (this.state === 'searching') {
          this.state = 'stopping';
          try {
            this.handle?.command('stop');
          } catch (error) {
            this.crash(error);
            return;
          }
        }
        return;
      case 'setoption':
        if (this.state !== 'ready') {
          this.error('E_ENGINE_INIT', `engine is ${this.state}`, null);
          return;
        }
        try {
          this.handle?.command(`setoption name ${message.name} value ${String(message.value)}`);
        } catch (error) {
          this.crash(error);
        }
        return;
      case 'ping':
        this.send({ type: 'pong', id: message.id });
        return;
      case 'fault':
        if (message.mode === 'wasm-abort') {
          try {
            this.handle?.abort?.();
            this.crash(new Error('wasm abort: abort handler unavailable'));
          } catch (error) {
            this.crash(error);
          }
        } else {
          this.crash(new Error('injected crash'));
        }
        return;
      case 'dispose':
        this.dispose();
    }
  }

  private async initialize(init: EngineInit): Promise<void> {
    if (this.state !== 'idle') {
      this.error('E_ENGINE_INIT', 'engine is already initialized', 0);
      return;
    }
    this.state = 'initializing';
    this.send({ type: 'phase', phase: 'loading-glue' });

    try {
      const created = await this.factory(init);
      this.handle = created.handle;
      this.unsubscribe = created.handle.onLine((line) => this.onLine(line));
      this.send({ type: 'phase', phase: 'uci' });
      this.state = 'ready';
      this.send({
        type: 'ready',
        engine: init.engine,
        build: init.build,
        idName: created.meta.idName,
        options: [...created.meta.options],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = 'idle';
      this.error('E_ENGINE_INIT', message, 0);
    }
  }

  private analyze(message: Extract<MainToWorker, { type: 'analyze' }>): void {
    if (this.state !== 'ready') {
      this.error('E_ENGINE_INIT', `engine is ${this.state}`, message.searchId);
      return;
    }
    if (message.depth !== null && (message.depth < 1 || message.depth > 99)) {
      this.error('E_ENGINE_INIT', 'depth must be 1..99 or null', message.searchId);
      return;
    }
    if (message.multiPv < 1 || message.multiPv > 5) {
      this.error('E_ENGINE_INIT', 'multiPv must be 1..5', message.searchId);
      return;
    }

    this.searchId = message.searchId;
    this.state = 'searching';
    this.clearChunk();
    this.chunkMs = message.chunkMs ?? null;
    this.lastBest = null;
    try {
      this.handle?.command(`setoption name MultiPV value ${message.multiPv}`);
      const moves = message.moves.length > 0 ? ` moves ${message.moves.join(' ')}` : '';
      this.handle?.command(`position fen ${message.rootFen}${moves}`);
      this.handle?.command(
        message.chunkMs !== undefined
          ? `go movetime ${message.chunkMs}`
          : message.depth === null
            ? 'go infinite'
            : `go depth ${message.depth}`,
      );
    } catch (error) {
      this.crash(error);
    }
  }

  private onLine(line: string): void {
    const event = parseUciLine(line);
    if (!event) return;

    if (event.kind === 'string') {
      this.send({ type: 'phase', phase: 'uci', detail: event.value });
      return;
    }
    if (event.kind === 'info') {
      if (this.state === 'searching' || this.state === 'stopping') {
        this.send({ type: 'info', searchId: this.searchId, line: event.info });
      }
      return;
    }
    if (event.kind === 'bestmove') {
      if (this.state !== 'searching' && this.state !== 'stopping') return;
      const best = {
        move: event.bestMove,
        ...(event.ponder === undefined ? {} : { ponder: event.ponder }),
      };
      if (this.chunkMs !== null && this.state === 'searching') {
        this.lastBest = best;
        this.state = 'ready';
        this.send({
          type: 'chunk',
          searchId: this.searchId,
          move: best.move,
          ...(best.ponder === undefined ? {} : { ponder: best.ponder }),
        });
        return;
      }
      this.finishBest(best);
    }
  }

  private finishBest(best: { move: string | null; ponder?: string }): void {
    this.clearChunk();
    this.state = 'ready';
    this.send({
      type: 'bestmove',
      searchId: this.searchId,
      move: best.move,
      ...(best.ponder === undefined ? {} : { ponder: best.ponder }),
    });
  }

  private clearChunk(): void {
    this.chunkMs = null;
    this.lastBest = null;
  }

  private crash(error: unknown): void {
    if (this.state === 'disposed') return;
    const message = error instanceof Error ? error.message : String(error);
    this.clearChunk();
    this.state = 'disposed';
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.handle?.terminate();
    this.handle = null;
    this.send({
      type: 'error',
      searchId: this.searchId,
      code: 'E_ENGINE_CRASH',
      message,
      retryable: false,
    });
  }

  private error(code: EngineErrorCode, message: string, searchId: number | null): void {
    this.send({
      type: 'error',
      searchId,
      code,
      message,
      retryable: code === 'E_ENGINE_INIT',
    });
  }

  private dispose(): void {
    if (this.state === 'disposed') return;
    this.clearChunk();
    this.state = 'disposed';
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.handle?.terminate();
    this.handle = null;
  }
}
