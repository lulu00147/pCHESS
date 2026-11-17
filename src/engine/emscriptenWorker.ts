import { WorkerCore, type EngineHandle, type EngineInitResult } from './workerCore';
import { installNetworkFile, type EngineFS } from './fsInstall';
import { loadNetwork } from './assets';
import { UciLineBuffer } from './lineBuffer';
import { parseUciLine } from './uci';
import type { EngineInit, MainToWorker } from './protocol';

interface EmscriptenModule {
  readonly FS: EngineFS & { mkdir(path: string): void; chdir(path: string): void };
  ccall(
    name: string,
    returnType: null,
    argTypes: readonly ['string'],
    args: readonly [string],
  ): unknown;
}

type WorkerScope = {
  readonly name: string;
  readonly location: Location;
  postMessage(message: unknown): void;
  importScripts(...urls: string[]): void;
};

const scope = globalThis as unknown as WorkerScope;


async function bootstrapEngine(
  init: EngineInit,
): Promise<{ handle: EngineHandle; meta: EngineInitResult }> {
  let runtimeResolve!: () => void;
  let runtimeReject!: (error: Error) => void;
  const runtime = new Promise<void>((resolve, reject) => {
    runtimeResolve = resolve;
    runtimeReject = reject;
  });

  const lines = new UciLineBuffer();
  const listeners = new Set<(line: string) => void>();
  const emitLines = (text: string): void => {
    for (const line of lines.push(`${text}\n`)) {
      for (const listener of listeners) listener(line);
    }
  };

  const artifactBase = new URL(init.artifactBase, self.location.href);
  const glueUrl = new URL(init.glueUrl, self.location.href).href;
  const wasmUrl = new URL(init.wasmUrl, self.location.href).href;
  (scope as unknown as { Module: unknown }).Module = {
    locateFile: (path: string) =>
      path.endsWith('.wasm') ? wasmUrl : new URL(path, artifactBase).href,
    print: emitLines,
    printErr: emitLines,
    onAbort: (reason: string) => runtimeReject(new Error(`wasm abort: ${reason}`)),
    onRuntimeInitialized: () => runtimeResolve(),
  };

  try {
    scope.importScripts(glueUrl);
  } catch (error) {
    throw new Error(`glue load failed: ${String(error)}`, { cause: error });
  }

  await Promise.race([
    runtime,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('runtime init timeout')), 30000),
    ),
  ]);
  const em = (scope as unknown as { Module?: EmscriptenModule }).Module;
  if (!em) throw new Error('Emscripten module missing');
  const fs = em.FS;

  try {
    fs.mkdir('/engine');
  } catch {
    // Directory may already exist.
  }
  fs.chdir('/engine');

  const networkOptions: Array<{ option: string; value: string }> = [];
  for (const network of init.networks) {
    const response = await loadNetwork(network, {
      onProgress: ({ loaded, total }) =>
        scope.postMessage({ type: 'download', url: network.url, loaded, total, done: false }),
    });
    const filename = new URL(network.url, self.location.href).pathname.split('/').pop();
    if (!filename) throw new Error(`invalid network URL: ${network.url}`);
    const path = `/engine/${filename}`;
    await installNetworkFile(fs, response, path, network.bytes);
    scope.postMessage({
      type: 'download',
      url: network.url,
      loaded: network.bytes,
      total: network.bytes,
      done: true,
    });
    networkOptions.push({ option: network.option, value: path });
  }

  const send = (command: string): void => {
    em.ccall('uci_command', null, ['string'], [command]);
  };

  let idName = 'unknown';
  const optionNames: string[] = [];
  const waiters = new Map<string, () => void>();
  const onLine = (line: string): void => {
    const event = parseUciLine(line);
    if (!event) return;
    if (event.kind === 'id' && event.name) idName = event.name;
    if (event.kind === 'option') optionNames.push(event.option.name);
    waiters.get(line)?.();
    waiters.get(event.kind)?.();
  };
  listeners.add(onLine);

  const waitFor = (token: string, timeoutMs = 15000): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(token);
        reject(new Error(`UCI timeout: ${token}`));
      }, timeoutMs);
      waiters.set(token, () => {
        clearTimeout(timer);
        waiters.delete(token);
        resolve();
      });
    });

  const uciOk = waitFor('uciok');
  send('uci');
  await uciOk;
  send(`setoption name Threads value ${init.options.threads}`);
  send(`setoption name Hash value ${init.options.hashMb}`);
  send(`setoption name MultiPV value ${init.options.multiPv}`);
  for (const option of networkOptions)
    send(`setoption name ${option.option} value ${option.value}`);
  const readyOk = waitFor('readyok');
  send('isready');
  await readyOk;
  listeners.delete(onLine);

  return {
    handle: {
      command: send,
      onLine(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      terminate() {
        listeners.clear();
      },
      abort() {
        const module = (
          globalThis as unknown as {
            Module?: {
              FS?: {
                writeFile: (path: string, data: string) => void;
                open: (path: string, flags: string) => number;
                mmap: (
                  stream: number,
                  length: number,
                  position: number,
                  prot: number,
                  flags: number,
                ) => unknown;
              };
            };
          }
        ).Module;
        if (!module?.FS) throw new Error('wasm abort: FS unavailable');
        module.FS.writeFile('/tmp/pchess-abort', 'x');
        const stream = module.FS.open('/tmp/pchess-abort', 'r');
        module.FS.mmap(stream, 16, 0, 1, 0);
      },
    },
    meta: { idName, options: optionNames },
  };
}

const core = new WorkerCore((message) => scope.postMessage(message), bootstrapEngine);
if (scope.name === 'em-pthread') {
  const glue = new URL(scope.location.href).searchParams.get('glue');
  if (glue) scope.importScripts(glue);
} else {
  (scope as unknown as { onmessage: (event: MessageEvent<MainToWorker>) => void }).onmessage = (
    event,
  ) => {
    void core.receive(event.data);
  };
}
