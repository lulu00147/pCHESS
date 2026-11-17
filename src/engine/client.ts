import type {
  BuildId,
  EngineErrorCode,
  EngineInit,
  MainToWorker,
  WorkerToMain,
  Variant,
} from './protocol';

export type EngineState =
  'idle' | 'initializing' | 'ready' | 'searching' | 'stopping' | 'error' | 'disposed';

export class EngineProtocolError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineProtocolError';
    this.code = code;
  }
}

export interface EngineTransport {
  send(message: MainToWorker): void;
  close(): void;
}

export interface EngineConfig {
  readonly engine: Variant;
  readonly build: BuildId;
  readonly glueUrl: string;
  readonly wasmUrl: string;
  readonly artifactBase: string;
  readonly networks: EngineInit['networks'];
  readonly options: EngineInit['options'];
}

export interface AnalyzeConfig {
  readonly rootFen: string;
  readonly moves: readonly string[];
  readonly fen: string;
  readonly depth: number | null;
  readonly multiPv: number;
  readonly chunkMs?: number;
}

export interface ReadyInfo {
  readonly engine: Variant;
  readonly build: BuildId;
  readonly idName: string;
  readonly options: readonly string[];
}

type Listener = (message: WorkerToMain) => void;

export class EngineClient {
  readonly transport: EngineTransport;
  private state: EngineState = 'idle';
  private searchId = 0;
  private nextSearchId = 0;
  private nextPingId = 0;
  private listeners = new Set<Listener>();
  private initResolve: ((info: ReadyInfo) => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;
  private pings = new Map<number, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  private activeConfig: AnalyzeConfig | null = null;
  private lastChunk: { move: string | null; ponder?: string } | null = null;
  private lastInfoDepth = 0;
  private chunkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(transport: EngineTransport) {
    this.transport = transport;
  }

  get currentState(): EngineState {
    return this.state;
  }

  get currentSearchId(): number {
    return this.searchId;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  init(config: EngineConfig): Promise<ReadyInfo> {
    if (this.state !== 'idle') {
      return Promise.reject(
        new EngineProtocolError('E_ENGINE_INIT', 'engine is already initialized'),
      );
    }
    this.state = 'initializing';
    return new Promise<ReadyInfo>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.transport.send({ type: 'init', searchId: 0, ...config });
    });
  }

  analyze(config: AnalyzeConfig): number {
    if (this.state !== 'ready') {
      throw new EngineProtocolError('E_ENGINE_INIT', `engine is ${this.state}`);
    }
    if (config.depth !== null && (config.depth < 1 || config.depth > 99)) {
      throw new EngineProtocolError('E_ENGINE_INIT', 'depth must be 1..99 or null');
    }
    if (config.multiPv < 1 || config.multiPv > 5) {
      throw new EngineProtocolError('E_ENGINE_INIT', 'multiPv must be 1..5');
    }

    const searchId = ++this.nextSearchId;
    this.searchId = searchId;
    this.state = 'searching';
    this.activeConfig = config;
    this.lastChunk = null;
    this.lastInfoDepth = 0;
    this.sendAnalyze(searchId, config);
    return searchId;
  }

  stop(): boolean {
    if (this.state !== 'searching') return false;
    this.state = 'stopping';
    this.clearChunkTimer();
    this.transport.send({ type: 'stop', searchId: this.searchId });
    return true;
  }

  setoption(name: string, value: string | number | boolean): void {
    if (this.state !== 'ready') {
      throw new EngineProtocolError('E_ENGINE_INIT', `engine is ${this.state}`);
    }
    this.transport.send({ type: 'setoption', name, value });
  }

  ping(timeoutMs = 3000): Promise<void> {
    if (this.state === 'disposed') {
      return Promise.reject(new EngineProtocolError('E_ENGINE_INIT', 'engine is disposed'));
    }
    const id = ++this.nextPingId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pings.delete(id);
        reject(new EngineProtocolError('E_UCI_TIMEOUT', 'ping timeout'));
      }, timeoutMs);
      this.pings.set(id, { resolve, timer });
      this.transport.send({ type: 'ping', id });
    });
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.clearChunkTimer();
    this.activeConfig = null;
    this.lastChunk = null;
    this.transport.send({ type: 'dispose' });
    this.transport.close();
    for (const ping of this.pings.values()) {
      clearTimeout(ping.timer);
      ping.resolve();
    }
    this.pings.clear();
    this.initReject?.(new EngineProtocolError('E_ENGINE_CRASH', 'engine disposed during init'));
    this.initReject = null;
    this.initResolve = null;
  }

  fail(reason: string): void {
    if (this.state === 'disposed' || this.state === 'error') return;
    this.state = 'error';
    this.initReject?.(new EngineProtocolError('E_ENGINE_CRASH', reason));
    this.initReject = null;
    this.initResolve = null;
    for (const ping of this.pings.values()) {
      clearTimeout(ping.timer);
      ping.resolve();
    }
    this.pings.clear();
    this.emit({
      type: 'error',
      searchId: this.searchId,
      code: 'E_ENGINE_CRASH',
      message: reason,
      retryable: true,
    });
  }

  receive(message: WorkerToMain): void {
    if (this.state === 'disposed') return;

    switch (message.type) {
      case 'phase':
      case 'download':
        this.emit(message);
        return;
      case 'ready': {
        this.emit(message);
        if (this.state !== 'initializing') return;
        this.state = 'ready';
        this.initResolve?.({
          engine: message.engine,
          build: message.build,
          idName: message.idName,
          options: message.options,
        });
        this.initResolve = null;
        this.initReject = null;
        return;
      }
      case 'info': {
        if (
          message.searchId !== this.searchId ||
          (this.state !== 'searching' && this.state !== 'stopping')
        ) {
          return;
        }
        if (typeof message.line.depth === 'number') {
          this.lastInfoDepth = Math.max(this.lastInfoDepth, message.line.depth);
        }
        this.emit(message);
        return;
      }
      case 'bestmove': {
        if (message.searchId !== this.searchId) return;
        if (this.state === 'searching' || this.state === 'stopping') {
          this.state = 'ready';
          this.clearChunkTimer();
          this.activeConfig = null;
          this.lastChunk = null;
          this.emit(message);
        }
        return;
      }
      case 'chunk': {
        if (message.searchId !== this.searchId) return;
        this.lastChunk = {
          move: message.move,
          ...(message.ponder === undefined ? {} : { ponder: message.ponder }),
        };
        if (this.state === 'stopping') {
          this.state = 'ready';
          this.activeConfig = null;
          this.clearChunkTimer();
          const best = this.lastChunk;
          this.lastChunk = null;
          this.emit({ type: 'bestmove', searchId: this.searchId, ...best });
          return;
        }
        if (this.state !== 'searching' || !this.activeConfig) return;
        const targetDepth = this.activeConfig.depth;
        if (targetDepth !== null && this.lastInfoDepth >= targetDepth) {
          this.state = 'ready';
          this.activeConfig = null;
          this.clearChunkTimer();
          const best = this.lastChunk;
          this.lastChunk = null;
          this.emit({ type: 'bestmove', searchId: this.searchId, ...best });
          return;
        }
        this.clearChunkTimer();
        this.chunkTimer = setTimeout(() => {
          this.chunkTimer = undefined;
          if (this.state === 'searching' && this.activeConfig) {
            this.sendAnalyze(this.searchId, this.activeConfig);
          }
        }, 100);
        return;
      }
      case 'error': {
        if (message.searchId !== null && message.searchId !== this.searchId) return;
        this.state = 'error';
        this.emit(message);
        this.initReject?.(new EngineProtocolError(message.code, message.message));
        this.initReject = null;
        this.initResolve = null;
        return;
      }
      case 'pong': {
        const ping = this.pings.get(message.id);
        this.emit(message);
        if (!ping) return;
        clearTimeout(ping.timer);
        this.pings.delete(message.id);
        ping.resolve();
      }
    }
  }

  private sendAnalyze(searchId: number, config: AnalyzeConfig): void {
    this.transport.send({
      type: 'analyze',
      searchId,
      rootFen: config.rootFen,
      moves: [...config.moves],
      fen: config.fen,
      depth: config.depth,
      multiPv: config.multiPv,
      ...(config.chunkMs === undefined ? {} : { chunkMs: config.chunkMs }),
    });
  }

  private clearChunkTimer(): void {
    if (this.chunkTimer !== undefined) clearTimeout(this.chunkTimer);
    this.chunkTimer = undefined;
  }

  private emit(message: WorkerToMain): void {
    for (const listener of this.listeners) listener(message);
  }
}
