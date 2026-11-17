import { EngineClient, type EngineTransport } from './client';
import type { MainToWorker, WorkerToMain } from './protocol';

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerToMain>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerToMain>) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

export function connectEngineWorker(worker: WorkerLike): EngineClient {
  let closed = false;
  const onMessage = (event: MessageEvent<WorkerToMain>): void => {
    client.receive(event.data);
  };
  const onError = (event: Event): void => {
    const reason = 'message' in event && typeof event.message === 'string' ? event.message : '';
    client.fail(reason || 'worker error');
  };

  const transport: EngineTransport = {
    send(message: MainToWorker): void {
      if (closed) throw new Error('worker is closed');
      worker.postMessage(message);
    },
    close(): void {
      if (closed) return;
      closed = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      worker.terminate();
    },
  };

  const client = new EngineClient(transport);
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);
  return client;
}
