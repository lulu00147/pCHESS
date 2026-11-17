import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';
import type { Move as ChessJsMove } from 'chess.js';
import { err, ok } from '../../core/result';
import type { Result } from '../../core/result';
import type { FenIssue, Move, PositionState, Promotion, RuleError, Side } from '../types';

export const CHESS_INITIAL_FEN = DEFAULT_POSITION;

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = new Set(['q', 'r', 'b', 'n']);

interface ParsedUci {
  readonly from: string;
  readonly to: string;
  readonly promotion?: Promotion;
}

function parseUci(uci: string): ParsedUci | null {
  const match = UCI_MOVE.exec(uci.trim().toLowerCase());
  if (!match) return null;

  const [, from, to, promotion] = match;
  if (!from || !to) return null;
  if (promotion && !PROMOTIONS.has(promotion)) return null;

  return promotion ? { from, to, promotion: promotion as Promotion } : { from, to };
}

function expandBoard(fen: string): string[][] | null {
  const board = fen.split(/\s+/)[0];
  if (!board) return null;

  const rows = board.split('/');
  if (rows.length !== 8) return null;

  const expanded: string[][] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const char of row) {
      if (/^[1-8]$/.test(char)) {
        cells.push(...Array<string>(Number(char)).fill('.'));
      } else if (/^[prnbqkPRNBQK]$/.test(char)) {
        cells.push(char);
      } else {
        return null;
      }
    }
    if (cells.length !== 8) return null;
    expanded.push(cells);
  }
  return expanded;
}

function at(board: string[][], square: string): string | undefined {
  if (!SQUARE.test(square)) return undefined;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return board[8 - rank]?.[file];
}

function find(board: string[][], piece: string): string[] {
  const squares: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      if (board[row]?.[file] === piece) {
        squares.push(`${String.fromCharCode(97 + file)}${8 - row}`);
      }
    }
  }
  return squares;
}

function issue(code: string, message: string): FenIssue {
  return { code, message };
}

export function validateChessFen(fen: string): FenIssue[] {
  const trimmed = fen.trim();
  const structural = validateFen(trimmed);
  if (!structural.ok) {
    return [issue('fen.structure', structural.error ?? 'invalid FEN')];
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 6) {
    return [issue('fen.fields', 'FEN must have exactly 6 fields')];
  }

  const board = expandBoard(trimmed);
  if (!board) return [issue('fen.board', 'FEN board is not 8x8')];

  const issues: FenIssue[] = [];
  const whiteKings = find(board, 'K');
  const blackKings = find(board, 'k');
  if (whiteKings.length !== 1) {
    issues.push(issue('fen.kings', 'white must have exactly one king'));
  }
  if (blackKings.length !== 1) {
    issues.push(issue('fen.kings', 'black must have exactly one king'));
  }

  if (whiteKings[0] && blackKings[0]) {
    const white = whiteKings[0];
    const black = blackKings[0];
    const fileGap = Math.abs(white.charCodeAt(0) - black.charCodeAt(0));
    const rankGap = Math.abs(Number(white[1]) - Number(black[1]));
    if (fileGap <= 1 && rankGap <= 1) {
      issues.push(issue('fen.kings-adjacent', 'kings may not be adjacent'));
    }
  }

  for (let rank = 1; rank <= 8; rank += 1) {
    if (rank !== 1 && rank !== 8) continue;
    for (let file = 0; file < 8; file += 1) {
      const piece = board[8 - rank]?.[file];
      if (piece === 'P' || piece === 'p') {
        issues.push(issue('fen.pawn-rank', 'pawns may not be on rank 1 or 8'));
      }
    }
  }

  const counts = { w: 0, b: 0 };
  const pawns = { w: 0, b: 0 };
  for (const row of board) {
    for (const piece of row) {
      if (piece === '.') continue;
      const side: Side = piece === piece.toUpperCase() ? 'w' : 'b';
      counts[side] += 1;
      if (piece.toLowerCase() === 'p') pawns[side] += 1;
    }
  }
  if (counts.w > 16 || counts.b > 16) {
    issues.push(issue('fen.piece-count', 'each side may have at most 16 pieces'));
  }
  if (pawns.w > 8 || pawns.b > 8) {
    issues.push(issue('fen.pawn-count', 'each side may have at most 8 pawns'));
  }

  const castling = fields[2] ?? '-';
  if (castling !== '-') {
    const rights = new Set(castling);
    if ([...rights].some((right) => !'KQkq'.includes(right))) {
      issues.push(issue('fen.castling', 'castling field contains invalid rights'));
    }
    if (rights.has('K') && (at(board, 'e1') !== 'K' || at(board, 'h1') !== 'R')) {
      issues.push(issue('fen.castling', 'K right requires king e1 and rook h1'));
    }
    if (rights.has('Q') && (at(board, 'e1') !== 'K' || at(board, 'a1') !== 'R')) {
      issues.push(issue('fen.castling', 'Q right requires king e1 and rook a1'));
    }
    if (rights.has('k') && (at(board, 'e8') !== 'k' || at(board, 'h8') !== 'r')) {
      issues.push(issue('fen.castling', 'k right requires king e8 and rook h8'));
    }
    if (rights.has('q') && (at(board, 'e8') !== 'k' || at(board, 'a8') !== 'r')) {
      issues.push(issue('fen.castling', 'q right requires king e8 and rook a8'));
    }
  }

  const ep = fields[3] ?? '-';
  const turn = fields[1] as Side;
  if (ep !== '-') {
    if (!SQUARE.test(ep)) {
      issues.push(issue('fen.en-passant', 'invalid en passant square'));
    } else {
      const expectedRank = turn === 'w' ? '6' : '3';
      if (ep[1] !== expectedRank) {
        issues.push(issue('fen.en-passant', 'en passant square rank does not match side'));
      }
      if (at(board, ep) !== '.') {
        issues.push(issue('fen.en-passant', 'en passant target must be empty'));
      }
      const pawnSquare = `${ep[0]}${turn === 'w' ? '5' : '4'}`;
      const pawn = turn === 'w' ? 'p' : 'P';
      if (at(board, pawnSquare) !== pawn) {
        issues.push(issue('fen.en-passant', 'en passant target has no pawn behind it'));
      }
    }
  }

  const flipped = [...fields];
  flipped[1] = turn === 'w' ? 'b' : 'w';
  flipped[3] = '-';
  try {
    const probe = new Chess(flipped.join(' '));
    if (probe.isCheck()) {
      issues.push(issue('fen.opponent-in-check', 'side not to move may not be in check'));
    }
  } catch {
    issues.push(issue('fen.structure', 'FEN is not loadable by chess.js'));
  }

  return issues;
}

function toMove(move: ChessJsMove): Move {
  return {
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion as Promotion } : {}),
    san: move.san,
  };
}

export function replayChess(state: PositionState): Result<Chess, RuleError> {
  const fenIssues = validateChessFen(state.fen);
  if (fenIssues.length > 0) {
    return err({
      code: 'invalid-fen',
      message: fenIssues.map((entry) => entry.message).join('; '),
    });
  }

  const game = new Chess(state.fen);
  for (const [index, uci] of state.history.entries()) {
    const parsed = parseUci(uci);
    if (!parsed) {
      return err({
        code: 'invalid-history',
        message: `history[${index}] is not a UCI move: ${uci}`,
      });
    }
    try {
      game.move(parsed);
    } catch {
      return err({
        code: 'invalid-history',
        message: `history[${index}] is illegal: ${uci}`,
      });
    }
  }
  return ok(game);
}

function requireReplay(state: PositionState): Chess {
  const replayed = replayChess(state);
  if (!replayed.ok) throw new Error(replayed.error.message);
  return replayed.value;
}

export function createChessState(
  fen: string = CHESS_INITIAL_FEN,
  history: readonly string[] = [],
): Result<PositionState, RuleError> {
  const state: PositionState = { fen, history: [...history] };
  const replayed = replayChess(state);
  return replayed.ok ? ok(state) : err(replayed.error);
}

export function initialChessState(): PositionState {
  return { fen: CHESS_INITIAL_FEN, history: [] };
}

export function currentChessFen(state: PositionState): string {
  return requireReplay(state).fen();
}

export function chessSideToMove(state: PositionState): Side {
  return requireReplay(state).turn();
}

export function legalChessMoves(state: PositionState, from?: string): Move[] {
  const game = requireReplay(state);
  return game
    .moves({ verbose: true })
    .map(toMove)
    .filter((move) => !from || move.from === from);
}

export function applyChessMove(
  state: PositionState,
  uci: string,
): Result<PositionState, RuleError> {
  const parsed = parseUci(uci);
  if (!parsed) {
    return err({ code: 'illegal-move', message: `not a UCI move: ${uci}` });
  }

  const game = requireReplay(state);
  const match = game
    .moves({ verbose: true })
    .find(
      (move) =>
        move.from === parsed.from &&
        move.to === parsed.to &&
        (move.promotion ?? '') === (parsed.promotion ?? ''),
    );

  if (!match) {
    return err({ code: 'illegal-move', message: `illegal move: ${uci}` });
  }

  try {
    game.move(parsed);
  } catch {
    return err({ code: 'illegal-move', message: `illegal move: ${uci}` });
  }

  return ok({ fen: state.fen, history: [...state.history, uci] });
}

export interface ChessStatus {
  readonly turn: Side;
  readonly check: boolean;
  readonly checkmate: boolean;
  readonly stalemate: boolean;
  readonly draw: boolean;
}

export function chessStatus(state: PositionState): ChessStatus {
  const game = requireReplay(state);
  return {
    turn: game.turn(),
    check: game.isCheck(),
    checkmate: game.isCheckmate(),
    stalemate: game.isStalemate(),
    draw: game.isDraw(),
  };
}

export function chessPerft(state: PositionState, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('perft depth must be a non-negative integer');
  }
  return requireReplay(state).perft(depth);
}
