import type { BoardVariant } from '../board/geometry';
import type { EngineClient } from './client';
import type { BuildId, WorkerToMain } from './protocol';
import { autoConfig, lowerHashMb } from './config';
import { engineConfigFromManifest, loadEngineManifest } from './manifest';
import { resolveEngineOptions, type EnginePreferences } from './preferences';
import { selectBuild } from './buildSelection';
import { connectEngineWorker } from './workerTransport';

export interface EngineSession {
  readonly client: EngineClient;
  readonly build: BuildId;
  readonly hashMb: number;
}

export interface EngineSessionOptions {
  readonly variant: BoardVariant;
  readonly preferences: EnginePreferences;
  readonly preferredHash: number | null;
  readonly onClient: (client: EngineClient) => void;
  readonly onMessage: (client: EngineClient, message: WorkerToMain) => void;
  readonly onStatus: (status: 'hash-retry') => void;
}

export async function createEngineSession(options: EngineSessionOptions): Promise<EngineSession> {
  const manifest = await loadEngineManifest();
  const build = selectBuild(
    globalThis.crossOriginIsolated,
    typeof SharedArrayBuffer !== 'undefined',
  );
  const auto = autoConfig({
    isolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    mobile:
      typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches &&
      window.innerWidth < 1024,
  });
  const config = engineConfigFromManifest(
    manifest,
    options.variant,
    build,
    resolveEngineOptions(options.preferences, auto),
  );
  const { default: workerUrl } = await import('./emscriptenWorker?worker&url');

  const initialize = async (hashMb: number, attempt: number): Promise<EngineSession> => {
    const worker = new Worker(`${workerUrl}?glue=${encodeURIComponent(config.glueUrl)}`);
    const client = connectEngineWorker(worker);
    options.onClient(client);
    client.onMessage((message) => options.onMessage(client, message));
    try {
      await client.init({ ...config, options: { ...config.options, hashMb } });
      return { client, build, hashMb };
    } catch (error) {
      client.dispose();
      if (attempt === 0 && hashMb > 16 && isWasmAbort(error)) {
        options.onStatus('hash-retry');
        return initialize(lowerHashMb(hashMb), 1);
      }
      throw error;
    }
  };

  return initialize(options.preferredHash ?? config.options.hashMb, 0);
}

function isWasmAbort(error: unknown): boolean {
  return error instanceof Error && /wasm abort/i.test(error.message);
}
