import type { BoardVariant } from '../board/geometry';
import type { BoardSession } from './session';
import {
  getGame,
  openDatabase,
  putGame,
  GAME_SCHEMA_VERSION,
  type GameRecord,
} from '../storage/db';

export interface GameMeta {
  readonly chess: { readonly id: string; readonly createdAt: number };
  readonly xiangqi: { readonly id: string; readonly createdAt: number };
}

interface RestoreResult {
  readonly restored: boolean;
  readonly failed: boolean;
}

const VARIANTS = ['chess', 'xiangqi'] as const;

export class GamePersistence {
  private database: Promise<IDBDatabase | null> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private blocked = false;
  private savedVersions: Record<BoardVariant, number> = {
    chess: -1,
    xiangqi: -1,
  };
  private savedCursors: Record<BoardVariant, string | null> = {
    chess: null,
    xiangqi: null,
  };

  constructor(
    private readonly session: BoardSession,
    private readonly meta: GameMeta,
    private readonly onNotice: (message: string) => void,
  ) {}

  schedule(): void {
    if (this.blocked) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.persist();
    }, 200);
  }

  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    void this.persist();
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset(): void {
    this.blocked = false;
  }

  disable(): void {
    this.block();
  }

  async restore(): Promise<RestoreResult> {
    const database = await this.open();
    if (!database) return { restored: false, failed: true };

    const [chess, xiangqi] = await Promise.all([
      getGame(database, this.meta.chess.id).catch(() => {
        this.block();
        return undefined;
      }),
      getGame(database, this.meta.xiangqi.id).catch(() => {
        this.block();
        return undefined;
      }),
    ]);

    let restored = false;
    for (const variant of VARIANTS) {
      const record = variant === 'chess' ? chess : xiangqi;
      if (!record) continue;
      if (record.schemaVersion !== GAME_SCHEMA_VERSION) {
        this.block();
        continue;
      }
      if (this.session.treeVersion(variant) !== 0) {
        this.block();
        continue;
      }
      if (!this.session.restoreTree(variant, record.tree, record.treeVersion)) {
        this.block();
        continue;
      }
      this.savedVersions[variant] = this.session.treeVersion(variant);
      this.savedCursors[variant] = this.session.treeView(variant).cursorId;
      restored = true;
    }
    return { restored, failed: this.blocked };
  }

  private block(): void {
    if (this.blocked) return;
    this.blocked = true;
    this.onNotice('存档不可用，已停止自动保存');
  }

  private record(variant: BoardVariant, treeVersion: number): GameRecord {
    const tree = this.session.snapshot(variant);
    const meta = this.meta[variant];
    return {
      schemaVersion: GAME_SCHEMA_VERSION,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
      id: meta.id,
      variant,
      title: variant === 'chess' ? '国际象棋' : '中国象棋',
      rootFen: tree.rootFen,
      tree,
      treeVersion,
      cursorId: tree.cursorId,
    };
  }

  async persist(): Promise<void> {
    if (this.blocked) return;
    const dirty = VARIANTS.filter(
      (variant) =>
        this.session.treeVersion(variant) !== this.savedVersions[variant] ||
        this.session.treeView(variant).cursorId !== this.savedCursors[variant],
    );
    if (dirty.length === 0) return;
    const database = await this.open();
    if (!database) return;
    try {
      for (const variant of dirty) {
        const version = this.session.treeVersion(variant);
        const cursor = this.session.treeView(variant).cursorId;
        await putGame(database, this.record(variant, version));
        if (
          this.session.treeVersion(variant) === version &&
          this.session.treeView(variant).cursorId === cursor
        ) {
          this.savedVersions[variant] = version;
          this.savedCursors[variant] = cursor;
        }
      }
    } catch {
      this.onNotice('本地存储写入失败');
    }
  }

  private open(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (!this.database) {
      this.database = openDatabase().catch(() => {
        this.database = null;
        this.onNotice('本地存储不可用');
        return null;
      });
    }
    return this.database;
  }
}
