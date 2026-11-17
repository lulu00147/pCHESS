import type { ParsedInfo } from './uci';

export type Variant = 'chess' | 'xiangqi';
export type BuildId = 'threads-simd' | 'single-simd';

export type Phase = 'loading-glue' | 'compiling-wasm' | 'installing-net' | 'uci' | 'ready';

export type EngineErrorCode =
  | 'E_CAPABILITY'
  | 'E_WASM_COMPILE'
  | 'E_WORKER'
  | 'E_DOWNLOAD'
  | 'E_HASH'
  | 'E_QUOTA'
  | 'E_ENGINE_INIT'
  | 'E_UCI_TIMEOUT'
  | 'E_ENGINE_CRASH'
  | 'E_INVALID_FEN';

export interface NetworkSpec {
  readonly option: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface EngineInit {
  readonly type: 'init';
  readonly searchId: 0;
  readonly engine: Variant;
  readonly build: BuildId;
  readonly glueUrl: string;
  readonly wasmUrl: string;
  readonly artifactBase: string;
  readonly networks: readonly NetworkSpec[];
  readonly options: {
    readonly threads: number;
    readonly hashMb: number;
    readonly multiPv: number;
  };
}

export type MainToWorker =
  | EngineInit
  | {
      readonly type: 'analyze';
      readonly searchId: number;
      readonly rootFen: string;
      readonly moves: readonly string[];
      readonly fen: string;
      readonly depth: number | null;
      readonly multiPv: number;
      readonly chunkMs?: number;
    }
  | { readonly type: 'stop'; readonly searchId: number }
  | {
      readonly type: 'setoption';
      readonly name: string;
      readonly value: string | number | boolean;
    }
  | { readonly type: 'ping'; readonly id: number }
  | { readonly type: 'fault'; readonly mode: 'crash' | 'wasm-abort' }
  | { readonly type: 'dispose' };

export type WorkerToMain =
  | { readonly type: 'phase'; readonly phase: Phase; readonly detail?: string }
  | {
      readonly type: 'download';
      readonly url: string;
      readonly loaded: number;
      readonly total: number | null;
      readonly done: boolean;
    }
  | {
      readonly type: 'ready';
      readonly engine: Variant;
      readonly build: BuildId;
      readonly idName: string;
      readonly options: readonly string[];
    }
  | { readonly type: 'info'; readonly searchId: number; readonly line: ParsedInfo }
  | {
      readonly type: 'chunk';
      readonly searchId: number;
      readonly move: string | null;
      readonly ponder?: string;
    }
  | {
      readonly type: 'bestmove';
      readonly searchId: number;
      readonly move: string | null;
      readonly ponder?: string;
    }
  | {
      readonly type: 'error';
      readonly searchId: number | null;
      readonly code: EngineErrorCode;
      readonly message: string;
      readonly detail?: string;
      readonly retryable: boolean;
    }
  | { readonly type: 'pong'; readonly id: number };
