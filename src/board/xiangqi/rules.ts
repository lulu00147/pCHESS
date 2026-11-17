import { err, ok } from '../../core/result';
import type { Result } from '../../core/result';
import type { Move, PositionState, RuleError, Side } from '../types';
import {
  XIANGQI_FILES,
  XIANGQI_INITIAL_FEN,
  XIANGQI_RANKS,
  inBoard,
  isOwnHalf,
  isPalace,
  opposite,
  parseSquare,
  pieceAt,
  pieceSide,
  pieceType,
  squareName,
  cloneBoard,
  type XiangqiBoard,
} from './board';
import { isKingInCheck } from './attacks';
import {
  parseXiangqiFen,
  serializeXiangqiFen,
  validateXiangqiFen,
  type XiangqiPosition,
} from './fen';

export { XIANGQI_INITIAL_FEN } from './board';

const ORTHOGONAL = [
  { file: 0, rank: 1 },
  { file: 0, rank: -1 },
  { file: 1, rank: 0 },
  { file: -1, rank: 0 },
] as const;

const DIAGONAL = [
  { file: 1, rank: 1 },
  { file: 1, rank: -1 },
  { file: -1, rank: 1 },
  { file: -1, rank: -1 },
] as const;

const HORSE = [
  { file: 1, rank: 2 },
  { file: 2, rank: 1 },
  { file: 2, rank: -1 },
  { file: 1, rank: -2 },
  { file: -1, rank: -2 },
  { file: -2, rank: -1 },
  { file: -2, rank: 1 },
  { file: -1, rank: 2 },
] as const;

function move(fromFile: number, fromRank: number, toFile: number, toRank: number): Move {
  return {
    from: squareName(fromFile, fromRank),
    to: squareName(toFile, toRank),
    uci: `${squareName(fromFile, fromRank)}${squareName(toFile, toRank)}`,
  };
}

function canLand(board: XiangqiBoard, side: Side, file: number, rank: number): boolean {
  if (!inBoard(file, rank)) return false;
  const target = pieceAt(board, file, rank);
  return target === null || pieceSide(target) !== side;
}

function addIfLegal(
  board: XiangqiBoard,
  side: Side,
  moves: Move[],
  fromFile: number,
  fromRank: number,
  toFile: number,
  toRank: number,
): boolean {
  if (!canLand(board, side, toFile, toRank)) return false;
  moves.push(move(fromFile, fromRank, toFile, toRank));
  return true;
}

function generatePseudoMoves(board: XiangqiBoard, side: Side): Move[] {
  const moves: Move[] = [];
  const forward = side === 'w' ? 1 : -1;

  for (let rank = 0; rank < XIANGQI_RANKS; rank += 1) {
    for (let file = 0; file < XIANGQI_FILES; file += 1) {
      const piece = pieceAt(board, file, rank);
      if (!piece || pieceSide(piece) !== side) continue;

      switch (pieceType(piece)) {
        case 'K':
          for (const direction of ORTHOGONAL) {
            const toFile = file + direction.file;
            const toRank = rank + direction.rank;
            if (!isPalace(side, toFile, toRank)) continue;
            addIfLegal(board, side, moves, file, rank, toFile, toRank);
          }
          break;

        case 'A':
          for (const direction of DIAGONAL) {
            const toFile = file + direction.file;
            const toRank = rank + direction.rank;
            if (!isPalace(side, toFile, toRank)) continue;
            addIfLegal(board, side, moves, file, rank, toFile, toRank);
          }
          break;

        case 'B':
          for (const direction of DIAGONAL) {
            const toFile = file + direction.file * 2;
            const toRank = rank + direction.rank * 2;
            if (!isOwnHalf(side, toRank)) continue;
            if (pieceAt(board, file + direction.file, rank + direction.rank) !== null) continue;
            addIfLegal(board, side, moves, file, rank, toFile, toRank);
          }
          break;

        case 'N':
          for (const offset of HORSE) {
            const toFile = file + offset.file;
            const toRank = rank + offset.rank;
            const legFile = Math.abs(offset.rank) === 2 ? file : file + offset.file / 2;
            const legRank = Math.abs(offset.rank) === 2 ? rank + offset.rank / 2 : rank;
            if (!inBoard(toFile, toRank) || pieceAt(board, legFile, legRank) !== null) continue;
            addIfLegal(board, side, moves, file, rank, toFile, toRank);
          }
          break;

        case 'R':
          for (const direction of ORTHOGONAL) {
            let toFile = file + direction.file;
            let toRank = rank + direction.rank;
            while (inBoard(toFile, toRank)) {
              const target = pieceAt(board, toFile, toRank);
              if (target === null) {
                moves.push(move(file, rank, toFile, toRank));
              } else {
                if (pieceSide(target) !== side) {
                  moves.push(move(file, rank, toFile, toRank));
                }
                break;
              }
              toFile += direction.file;
              toRank += direction.rank;
            }
          }
          break;

        case 'C':
          for (const direction of ORTHOGONAL) {
            let toFile = file + direction.file;
            let toRank = rank + direction.rank;
            let screens = 0;
            while (inBoard(toFile, toRank)) {
              const target = pieceAt(board, toFile, toRank);
              if (screens === 0) {
                if (target === null) {
                  moves.push(move(file, rank, toFile, toRank));
                } else {
                  screens = 1;
                }
              } else if (target !== null) {
                if (pieceSide(target) !== side) {
                  moves.push(move(file, rank, toFile, toRank));
                }
                break;
              }
              toFile += direction.file;
              toRank += direction.rank;
            }
          }
          break;

        case 'P': {
          addIfLegal(board, side, moves, file, rank, file, rank + forward);
          const crossed = side === 'w' ? rank >= 5 : rank <= 4;
          if (crossed) {
            addIfLegal(board, side, moves, file, rank, file - 1, rank);
            addIfLegal(board, side, moves, file, rank, file + 1, rank);
          }
          break;
        }

        default:
          break;
      }
    }
  }

  return moves;
}

function applyToBoard(board: XiangqiBoard, moveToApply: Move): XiangqiBoard {
  const from = parseSquare(moveToApply.from);
  const to = parseSquare(moveToApply.to);
  if (!from || !to) throw new Error(`invalid move: ${moveToApply.uci}`);
  const next = cloneBoard(board);
  next[to.rank]![to.file] = next[from.rank]?.[from.file] ?? null;
  next[from.rank]![from.file] = null;
  return next;
}

function legalXiangqiMoves(position: XiangqiPosition): Move[] {
  return generatePseudoMoves(position.board, position.turn).filter((candidate) => {
    const next = applyToBoard(position.board, candidate);
    return !isKingInCheck(next, position.turn);
  });
}

function updateCounters(
  position: XiangqiPosition,
  moveToApply: Move,
): Pick<XiangqiPosition, 'halfmove' | 'fullmove' | 'turn'> {
  const from = parseSquare(moveToApply.from);
  const to = parseSquare(moveToApply.to);
  if (!from || !to) throw new Error(`invalid move: ${moveToApply.uci}`);
  const piece = pieceAt(position.board, from.file, from.rank);
  const captured = pieceAt(position.board, to.file, to.rank) !== null;
  const pawn = piece ? pieceType(piece) === 'P' : false;
  return {
    halfmove: captured || pawn ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (position.turn === 'b' ? 1 : 0),
    turn: opposite(position.turn),
  };
}

function applyXiangqiMoveToPosition(position: XiangqiPosition, candidate: Move): XiangqiPosition {
  return {
    board: applyToBoard(position.board, candidate),
    ...updateCounters(position, candidate),
  };
}

export function replayXiangqi(state: PositionState): Result<XiangqiPosition, RuleError> {
  const issues = validateXiangqiFen(state.fen);
  if (issues.length > 0) {
    return err({
      code: 'invalid-fen',
      message: issues.map((entry) => entry.message).join('; '),
    });
  }

  const parsed = parseXiangqiFen(state.fen);
  if (!parsed.ok) {
    return err({
      code: 'invalid-fen',
      message: parsed.error.map((entry) => entry.message).join('; '),
    });
  }

  let position = parsed.value;
  for (const [index, uci] of state.history.entries()) {
    const candidate = legalXiangqiMoves(position).find((entry) => entry.uci === uci);
    if (!candidate) {
      return err({
        code: 'invalid-history',
        message: `history[${index}] is illegal: ${uci}`,
      });
    }
    position = applyXiangqiMoveToPosition(position, candidate);
  }
  return ok(position);
}

export function createXiangqiState(
  fen: string = XIANGQI_INITIAL_FEN,
  history: readonly string[] = [],
): Result<PositionState, RuleError> {
  const state: PositionState = { fen, history: [...history] };
  const replayed = replayXiangqi(state);
  return replayed.ok ? ok(state) : err(replayed.error);
}

export function currentXiangqiFen(state: PositionState): string {
  const replayed = replayXiangqi(state);
  if (!replayed.ok) throw new Error(replayed.error.message);
  return serializeXiangqiFen(replayed.value);
}

export function legalMovesForState(state: PositionState): Move[] {
  const replayed = replayXiangqi(state);
  if (!replayed.ok) throw new Error(replayed.error.message);
  return legalXiangqiMoves(replayed.value);
}

export function applyXiangqiMove(
  state: PositionState,
  uci: string,
): Result<PositionState, RuleError> {
  const replayed = replayXiangqi(state);
  if (!replayed.ok) return err(replayed.error);
  const candidate = legalXiangqiMoves(replayed.value).find((entry) => entry.uci === uci);
  if (!candidate) {
    return err({ code: 'illegal-move', message: `illegal xiangqi move: ${uci}` });
  }
  return ok({ fen: state.fen, history: [...state.history, uci] });
}

export interface XiangqiStatus {
  readonly turn: Side;
  readonly check: boolean;
  readonly checkmate: boolean;
  readonly stalemate: boolean;
  readonly draw: false;
}

export function xiangqiStatus(state: PositionState): XiangqiStatus {
  const replayed = replayXiangqi(state);
  if (!replayed.ok) throw new Error(replayed.error.message);
  const position = replayed.value;
  const check = isKingInCheck(position.board, position.turn);
  const hasMoves = legalXiangqiMoves(position).length > 0;
  return {
    turn: position.turn,
    check,
    checkmate: check && !hasMoves,
    stalemate: !check && !hasMoves,
    draw: false,
  };
}

export function xiangqiPerft(state: PositionState, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('perft depth must be a non-negative integer');
  }
  const replayed = replayXiangqi(state);
  if (!replayed.ok) throw new Error(replayed.error.message);

  const walk = (position: XiangqiPosition, remaining: number): number => {
    if (remaining === 0) return 1;
    let nodes = 0;
    for (const candidate of legalXiangqiMoves(position)) {
      nodes += walk(applyXiangqiMoveToPosition(position, candidate), remaining - 1);
    }
    return nodes;
  };

  return walk(replayed.value, depth);
}
