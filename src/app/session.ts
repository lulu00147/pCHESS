import type { Chess, Square } from 'chess.js';
import type { PiecePlacement } from '../board/appearance/pieces';
import type { PositionState } from '../board/types';
import {
  createChessState,
  initialChessState,
  replayChess,
  validateChessFen,
} from '../board/chess/rules';
import {
  currentXiangqiFen,
  applyXiangqiMove,
  createXiangqiState,
  legalMovesForState,
  replayXiangqi,
  xiangqiStatus,
  XIANGQI_INITIAL_FEN,
} from '../board/xiangqi/rules';
import { validateXiangqiFen } from '../board/xiangqi/fen';
import type { FenIssue } from '../board/types';
import { piecesFromChess, piecesFromXiangqi } from '../board/pieces';
import { ok, type Result } from '../core/result';
import { exportPgn, parsePgn, type PgnError } from '../game/pgn';
import { exportXiangqiPgn, parseXiangqiPgn, type XiangqiPgnError } from '../game/xiangqiPgn';
import type { Cell, BoardVariant } from '../board/geometry';
import {
  addMove,
  createGameTree,
  deleteSubtree,
  firstNode,
  lastNode,
  mainline,
  moveCursor,
  pathToNode,
  predecessor,
  type GameTree,
  type MoveNode,
} from '../game/tree';

export interface SessionView {
  readonly pieces: PiecePlacement[];
  readonly selected: Cell | null;
  readonly targets: readonly Cell[];
  readonly lastMove: { readonly from: Cell; readonly to: Cell } | null;
  readonly pendingPromotion: PendingPromotion | null;
}

export type GameOutcome = 'checkmate' | 'stalemate' | 'draw' | null;

export interface GameState {
  readonly status: string;
  readonly outcome: GameOutcome;
}

export interface TreeView {
  readonly mainline: readonly MoveNode[];
  readonly cursorId: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface PendingPromotion {
  readonly from: Cell;
  readonly to: Cell;
}

export interface SessionOptions {
  readonly chessFen?: string;
  readonly xiangqiFen?: string;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.file === b.file && a.row === b.row;
}

function chessCell(cell: Cell): Square {
  return `${String.fromCharCode(97 + cell.file)}${8 - cell.row}` as Square;
}

function chessCellOf(square: string): Cell {
  return { file: square.charCodeAt(0) - 97, row: 8 - Number(square[1]) };
}

function chessMove(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci.length > 4 ? { promotion: uci[4] } : {}),
  };
}

function tryChessMove(chess: Chess, uci: string): ReturnType<Chess['move']> | null {
  try {
    return chess.move(chessMove(uci));
  } catch {
    return null;
  }
}

function xiangqiCell(cell: Cell): string {
  return `${String.fromCharCode(97 + cell.file)}${9 - cell.row}`;
}

function xiangqiCellOf(square: string): Cell {
  return { file: square.charCodeAt(0) - 97, row: 9 - Number(square[1]) };
}

function uciCell(square: string, variant: BoardVariant): Cell {
  return variant === 'chess' ? chessCellOf(square) : xiangqiCellOf(square);
}

export class BoardSession {
  private chess: Chess;
  private xiangqi: PositionState;
  private chessTree: GameTree;
  private xiangqiTree: GameTree;
  private chessRedo: string[] = [];
  private xiangqiRedo: string[] = [];
  private chessVersion = 0;
  private xiangqiVersion = 0;
  private selected: Cell | null = null;
  private targets: Cell[] = [];
  private pending: PendingPromotion | null = null;

  constructor(options: SessionOptions = {}) {
    const chessState: PositionState = options.chessFen
      ? { fen: options.chessFen, history: [] }
      : initialChessState();
    const replayed = replayChess(chessState);
    if (!replayed.ok) throw new Error(replayed.error.message);
    this.chess = replayed.value;
    this.chessTree = createGameTree(chessState.fen);

    const created = options.xiangqiFen
      ? { ok: true as const, value: { fen: options.xiangqiFen, history: [] } }
      : createXiangqiState();
    if (!created.ok) throw new Error(created.error.message);
    this.xiangqi = created.value;
    this.xiangqiTree = createGameTree(created.value.fen);
  }

  view(variant: BoardVariant): SessionView {
    return {
      pieces: variant === 'chess' ? piecesFromChess(this.chess) : this.piecesForXiangqi(),
      selected: this.selected,
      targets: this.targets,
      lastMove: this.lastMoveFor(variant),
      pendingPromotion: this.pending,
    };
  }

  treeView(variant: BoardVariant): TreeView {
    const tree = this.treeFor(variant);
    const redo = variant === 'chess' ? this.chessRedo : this.xiangqiRedo;
    return {
      mainline: mainline(tree),
      cursorId: tree.cursorId,
      canUndo: tree.cursorId !== 'root',
      canRedo: redo.length > 0,
    };
  }

  status(variant: BoardVariant): string {
    return this.describe(variant).status;
  }

  outcome(variant: BoardVariant): GameOutcome {
    return this.describe(variant).outcome;
  }

  describe(variant: BoardVariant): GameState {
    if (variant === 'chess') {
      if (this.chess.isCheckmate()) return { status: '将死', outcome: 'checkmate' };
      if (this.chess.isDraw()) return { status: '和棋', outcome: 'draw' };
      if (this.chess.isCheck()) {
        return {
          status: this.chess.turn() === 'w' ? '白方被将军' : '黑方被将军',
          outcome: null,
        };
      }
      return {
        status: this.chess.turn() === 'w' ? '白方走子' : '黑方走子',
        outcome: null,
      };
    }

    const status = xiangqiStatus(this.xiangqi);
    if (status.checkmate) return { status: '将死', outcome: 'checkmate' };
    if (status.stalemate) return { status: '困毙', outcome: 'stalemate' };
    let label: string;
    if (status.check) label = status.turn === 'w' ? '红方被将军' : '黑方被将军';
    else label = status.turn === 'w' ? '红方走子' : '黑方走子';
    return { status: label, outcome: null };
  }

  clearSelection(): void {
    this.selected = null;
    this.targets = [];
  }

  snapshot(variant: BoardVariant): GameTree {
    return this.treeFor(variant);
  }

  currentFen(variant: BoardVariant): string {
    return variant === 'chess' ? this.chess.fen() : currentXiangqiFen(this.xiangqi);
  }

  previewLine(
    variant: BoardVariant,
    moves: readonly string[],
    count: number,
  ): { pieces: PiecePlacement[]; lastMove: { from: Cell; to: Cell } | null } | null {
    const line = moves.slice(0, Math.max(0, count));
    let lastMove: { from: Cell; to: Cell } | null = null;
    if (variant === 'chess') {
      const created = createChessState(this.currentFen('chess'));
      if (!created.ok) return null;
      const replayed = replayChess(created.value);
      if (!replayed.ok) return null;
      const chess = replayed.value;
      for (const uci of line) {
        const moved = tryChessMove(chess, uci);
        if (!moved) return null;
        lastMove = { from: chessCellOf(moved.from), to: chessCellOf(moved.to) };
      }
      return { pieces: piecesFromChess(chess), lastMove };
    }
    const created = createXiangqiState(this.currentFen('xiangqi'));
    if (!created.ok) return null;
    let state = created.value;
    for (const uci of line) {
      const applied = applyXiangqiMove(state, uci);
      if (!applied.ok) return null;
      state = applied.value;
      lastMove = {
        from: uciCell(uci.slice(0, 2), 'xiangqi'),
        to: uciCell(uci.slice(2, 4), 'xiangqi'),
      };
    }
    const replayed = replayXiangqi(state);
    if (!replayed.ok) return null;
    return { pieces: piecesFromXiangqi(replayed.value), lastMove };
  }

  commitLine(variant: BoardVariant, moves: readonly string[]): Result<number, string> {
    if (moves.length === 0) return ok(0);
    if (variant === 'chess') {
      const created = createChessState(this.currentFen('chess'));
      if (!created.ok) return { ok: false, error: created.error.message };
      const validated = replayChess(created.value);
      if (!validated.ok) return { ok: false, error: validated.error.message };
      for (const uci of moves) {
        if (!tryChessMove(validated.value, uci))
          return { ok: false, error: `非法 PV 着法：${uci}` };
      }
      const replayed = replayChess(created.value);
      if (!replayed.ok) return { ok: false, error: replayed.error.message };
      const chess = replayed.value;
      for (const uci of moves) {
        const moved = tryChessMove(chess, uci);
        if (!moved) return { ok: false, error: `非法 PV 着法：${uci}` };
        this.recordChess(moved, chess.fen());
      }
      this.chess = chess;
      this.clearSelection();
      return ok(moves.length);
    }
    const created = createXiangqiState(this.currentFen('xiangqi'));
    if (!created.ok) return { ok: false, error: created.error.message };
    let validated = created.value;
    for (const uci of moves) {
      const applied = applyXiangqiMove(validated, uci);
      if (!applied.ok) return { ok: false, error: applied.error.message };
      validated = applied.value;
    }
    let state = created.value;
    for (const uci of moves) {
      const applied = applyXiangqiMove(state, uci);
      if (!applied.ok) return { ok: false, error: applied.error.message };
      state = applied.value;
      this.recordXiangqi(uci, currentXiangqiFen(state));
    }
    this.xiangqi = state;
    this.clearSelection();
    return ok(moves.length);
  }

  setFen(variant: BoardVariant, fen: string): Result<string, readonly FenIssue[]> {
    const issues = variant === 'chess' ? validateChessFen(fen) : validateXiangqiFen(fen);
    if (issues.length > 0) return { ok: false, error: issues };

    const state: PositionState = { fen, history: [] };
    const replayed = variant === 'chess' ? replayChess(state) : replayXiangqi(state);
    if (!replayed.ok) {
      return {
        ok: false,
        error: [{ code: replayed.error.code, message: replayed.error.message }],
      };
    }

    if (variant === 'chess') {
      this.chessTree = createGameTree(fen);
      this.chessVersion += 1;
      this.chessRedo.length = 0;
      this.rebuildChess();
    } else {
      this.xiangqiTree = createGameTree(fen);
      this.xiangqiVersion += 1;
      this.xiangqiRedo.length = 0;
      this.xiangqi = state;
    }
    this.clearSelection();
    this.pending = null;
    return ok(fen);
  }

  reset(variant: BoardVariant): void {
    const fen = variant === 'chess' ? initialChessState().fen : XIANGQI_INITIAL_FEN;
    const result = this.setFen(variant, fen);
    if (!result.ok) throw new Error(result.error.map((issue) => issue.message).join('; '));
  }

  deleteNode(variant: BoardVariant, nodeId: string): boolean {
    const tree = this.treeFor(variant);
    if (nodeId === 'root' || !tree.nodes[nodeId]) return false;
    this.setTree(variant, deleteSubtree(tree, nodeId));
    if (variant === 'chess') this.chessVersion += 1;
    else this.xiangqiVersion += 1;
    this.redoFor(variant).length = 0;
    this.clearSelection();
    this.pending = null;
    return true;
  }

  analysisPosition(variant: BoardVariant): { rootFen: string; moves: string[] } {
    const tree = this.treeFor(variant);
    return {
      rootFen: tree.rootFen,
      moves: pathToNode(tree, tree.cursorId)
        .slice(1)
        .map((node) => node.uci),
    };
  }

  treeVersion(variant: BoardVariant): number {
    return variant === 'chess' ? this.chessVersion : this.xiangqiVersion;
  }

  restoreTree(variant: BoardVariant, tree: GameTree, version = 0): boolean {
    if (!Number.isInteger(version) || version < 0) return false;
    const previousTree = this.treeFor(variant);
    const previousChess = this.chess;
    const previousXiangqi = this.xiangqi;
    const previousVersion = variant === 'chess' ? this.chessVersion : this.xiangqiVersion;

    if (variant === 'chess') this.chessTree = tree;
    else this.xiangqiTree = tree;

    try {
      if (variant === 'chess') this.rebuildChess();
      else this.rebuildXiangqi();
    } catch {
      if (variant === 'chess') {
        this.chessTree = previousTree;
        this.chess = previousChess;
        this.chessVersion = previousVersion;
      } else {
        this.xiangqiTree = previousTree;
        this.xiangqi = previousXiangqi;
        this.xiangqiVersion = previousVersion;
      }
      return false;
    }

    if (variant === 'chess') this.chessVersion = version;
    else this.xiangqiVersion = version;
    this.redoFor(variant).length = 0;
    this.clearSelection();
    this.pending = null;
    return true;
  }

  loadPgn(text: string): Result<string, PgnError> {
    const parsed = parsePgn(text);
    if (!parsed.ok) return parsed;
    this.chessTree = parsed.value.tree;
    this.chessRedo.length = 0;
    this.chessVersion += 1;
    this.rebuildChess();
    this.clearSelection();
    this.pending = null;
    return ok('PGN 已导入');
  }

  exportPgn(): string {
    return exportPgn({ headers: {}, tree: this.chessTree, result: '*' });
  }

  loadXiangqiPgn(text: string): Result<string, XiangqiPgnError> {
    const parsed = parseXiangqiPgn(text);
    if (!parsed.ok) return parsed;
    this.xiangqiTree = parsed.value.tree;
    this.xiangqiRedo.length = 0;
    this.xiangqiVersion += 1;
    this.rebuildXiangqi();
    this.clearSelection();
    this.pending = null;
    return ok('PGN 已导入');
  }

  exportXiangqiPgn(): string {
    return exportXiangqiPgn({ headers: {}, tree: this.xiangqiTree, result: '*' });
  }

  cancelPromotion(): void {
    this.pending = null;
  }

  promote(piece: PromotionPiece): boolean {
    if (!this.pending) return false;
    const from = chessCell(this.pending.from);
    const to = chessCell(this.pending.to);
    let move: ReturnType<Chess['move']>;
    try {
      move = this.chess.move({ from, to, promotion: piece });
    } catch {
      this.pending = null;
      return false;
    }
    if (!move) {
      this.pending = null;
      return false;
    }
    this.pending = null;
    this.recordChess(move);
    return true;
  }

  click(variant: BoardVariant, cell: Cell): void {
    if (this.pending) return;
    if (variant === 'chess') this.clickChess(cell);
    else this.clickXiangqi(cell);
  }

  goTo(variant: BoardVariant, id: string): void {
    const tree = this.treeFor(variant);
    this.setTree(variant, moveCursor(tree, id));
    this.redoFor(variant).length = 0;
    this.clearSelection();
    this.pending = null;
  }

  first(variant: BoardVariant): void {
    this.setTree(variant, firstNode(this.treeFor(variant)));
    this.redoFor(variant).length = 0;
    this.clearSelection();
    this.pending = null;
  }

  last(variant: BoardVariant): void {
    this.setTree(variant, lastNode(this.treeFor(variant)));
    this.redoFor(variant).length = 0;
    this.clearSelection();
    this.pending = null;
  }

  undo(variant: BoardVariant): void {
    const tree = this.treeFor(variant);
    if (tree.cursorId === 'root') {
      this.pending = null;
      this.clearSelection();
      return;
    }
    this.redoFor(variant).push(tree.cursorId);
    this.setTree(variant, predecessor(tree));
    this.clearSelection();
    this.pending = null;
  }

  redo(variant: BoardVariant): void {
    const redo = this.redoFor(variant);
    const next = redo.pop();
    if (!next) return;
    this.setTree(variant, moveCursor(this.treeFor(variant), next));
    this.clearSelection();
    this.pending = null;
  }

  private treeFor(variant: BoardVariant): GameTree {
    return variant === 'chess' ? this.chessTree : this.xiangqiTree;
  }

  private redoFor(variant: BoardVariant): string[] {
    return variant === 'chess' ? this.chessRedo : this.xiangqiRedo;
  }

  private setTree(variant: BoardVariant, tree: GameTree): void {
    if (variant === 'chess') {
      this.chessTree = tree;
      this.rebuildChess();
    } else {
      this.xiangqiTree = tree;
      this.rebuildXiangqi();
    }
  }

  private rebuildChess(): void {
    const tree = this.chessTree;
    const history = pathToNode(tree, tree.cursorId)
      .slice(1)
      .map((node) => node.uci);
    const replayed = replayChess({ fen: tree.rootFen, history });
    if (!replayed.ok) throw new Error(replayed.error.message);
    this.chess = replayed.value;
  }

  private rebuildXiangqi(): void {
    const tree = this.xiangqiTree;
    const history = pathToNode(tree, tree.cursorId)
      .slice(1)
      .map((node) => node.uci);
    const replayed = replayXiangqi({ fen: tree.rootFen, history });
    if (!replayed.ok) throw new Error(replayed.error.message);
    this.xiangqi = { fen: tree.rootFen, history };
  }

  private recordChess(
    move: { from: string; to: string; san: string; promotion?: string },
    fenAfter = this.chess.fen(),
  ): void {
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    this.chessTree = addMove(this.chessTree, this.chessTree.cursorId, {
      uci,
      san: move.san,
      fenAfter,
    }).tree;
    this.chessRedo.length = 0;
    this.chessVersion += 1;
  }

  private recordXiangqi(uci: string, fenAfter: string): void {
    this.xiangqiTree = addMove(this.xiangqiTree, this.xiangqiTree.cursorId, {
      uci,
      fenAfter,
    }).tree;
    this.xiangqiRedo.length = 0;
    this.xiangqiVersion += 1;
  }

  private piecesForXiangqi(): PiecePlacement[] {
    const replayed = replayXiangqi(this.xiangqi);
    return replayed.ok ? piecesFromXiangqi(replayed.value) : [];
  }

  private lastMoveFor(variant: BoardVariant): { from: Cell; to: Cell } | null {
    const tree = this.treeFor(variant);
    const node = tree.nodes[tree.cursorId];
    if (!node || !node.uci) return null;
    return {
      from: uciCell(node.uci.slice(0, 2), variant),
      to: uciCell(node.uci.slice(2, 4), variant),
    };
  }

  private clickChess(cell: Cell): void {
    const square = chessCell(cell);
    const piece = this.chess.get(square);

    if (this.selected && this.targets.some((target) => sameCell(target, cell))) {
      const from = chessCell(this.selected);
      const moving = this.chess.get(from);
      const promoting =
        moving?.type === 'p' && (moving.color === 'w' ? cell.row === 0 : cell.row === 7);
      if (promoting) {
        this.pending = { from: this.selected, to: cell };
        this.clearSelection();
        return;
      }
      const move = this.chess.move({ from, to: square });
      if (move) {
        this.recordChess(move);
        this.clearSelection();
        return;
      }
    }

    if (piece && piece.color === this.chess.turn()) {
      this.selected = cell;
      this.targets = this.chess
        .moves({ square, verbose: true })
        .map((move) => chessCellOf(move.to));
    } else {
      this.clearSelection();
    }
  }

  private clickXiangqi(cell: Cell): void {
    const square = xiangqiCell(cell);
    const replayed = replayXiangqi(this.xiangqi);
    if (!replayed.ok) return;
    const piece = replayed.value.board[9 - cell.row]?.[cell.file] ?? null;
    const own =
      piece !== null && (piece === piece.toUpperCase() ? 'w' : 'b') === replayed.value.turn;

    if (this.selected && this.targets.some((target) => sameCell(target, cell))) {
      const uci = `${xiangqiCell(this.selected)}${square}`;
      const applied = applyXiangqiMove(this.xiangqi, uci);
      if (applied.ok) {
        this.xiangqi = applied.value;
        this.recordXiangqi(uci, currentXiangqiFen(applied.value));
        this.clearSelection();
        return;
      }
    }

    if (own) {
      this.selected = cell;
      this.targets = legalMovesForState(this.xiangqi)
        .filter((move) => move.from === square)
        .map((move) => xiangqiCellOf(move.to));
    } else {
      this.clearSelection();
    }
  }
}
