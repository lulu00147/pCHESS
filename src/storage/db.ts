import type { BoardVariant } from '../board/geometry';
import { ROOT_ID, type GameTree } from '../game/tree';

export const DB_NAME = 'pchess';
export const DB_VERSION = 1;
export const GAME_SCHEMA_VERSION = 1;

export interface GameRecord {
  readonly id: string;
  readonly schemaVersion: number;
  readonly variant: BoardVariant;
  readonly title: string;
  readonly rootFen: string;
  readonly tree: GameTree;
  readonly treeVersion: number;
  readonly cursorId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class StorageError extends Error {
  readonly code: 'invalid-record' | 'database';

  constructor(code: StorageError['code'], message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new StorageError('database', request.error?.message ?? 'IndexedDB request failed'));
  });
}

export function openDatabase(
  factory: IDBFactory = indexedDB,
  name = DB_NAME,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new StorageError('database', request.error?.message ?? 'IndexedDB open failed'));
    request.onblocked = () => reject(new StorageError('database', 'IndexedDB open blocked'));
  });
}

function assertGame(record: GameRecord): void {
  if (!record.id || !record.title || !record.rootFen) {
    throw new StorageError('invalid-record', 'game id, title and rootFen are required');
  }
  if (record.variant !== 'chess' && record.variant !== 'xiangqi') {
    throw new StorageError('invalid-record', `invalid variant: ${String(record.variant)}`);
  }
  if (!Number.isInteger(record.treeVersion) || record.treeVersion < 0) {
    throw new StorageError('invalid-record', 'treeVersion must be a non-negative integer');
  }
  if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
    throw new StorageError('invalid-record', 'timestamps must be finite');
  }
  if (!record.tree || typeof record.tree !== 'object' || !record.tree.nodes) {
    throw new StorageError('invalid-record', 'game tree is missing');
  }
  if (!record.tree.nodes[ROOT_ID] || !record.tree.nodes[record.cursorId]) {
    throw new StorageError('invalid-record', 'tree root or cursor is missing');
  }
  if (record.tree.rootFen !== record.rootFen) {
    throw new StorageError('invalid-record', 'tree rootFen does not match record rootFen');
  }
}

export async function putGame(db: IDBDatabase, record: GameRecord): Promise<void> {
  assertGame(record);
  const transaction = db.transaction('games', 'readwrite');
  transaction.objectStore('games').put(record);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new StorageError('database', transaction.error?.message ?? 'write failed'));
    transaction.onabort = () => reject(new StorageError('database', 'write aborted'));
  });
}

export async function getGame(db: IDBDatabase, id: string): Promise<GameRecord | undefined> {
  const transaction = db.transaction('games', 'readonly');
  const record = await requestResult(transaction.objectStore('games').get(id));
  if (record) assertGame(record);
  return record;
}
