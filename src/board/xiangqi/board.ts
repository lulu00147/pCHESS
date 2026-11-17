import type { Side } from '../types';

export const XIANGQI_FILES = 9;
export const XIANGQI_RANKS = 10;
export const XIANGQI_INITIAL_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export type XiangqiBoard = ReadonlyArray<ReadonlyArray<string | null>>;

export interface XiangqiSquare {
  readonly file: number;
  readonly rank: number;
}

export function opposite(side: Side): Side {
  return side === 'w' ? 'b' : 'w';
}

export function pieceSide(piece: string): Side {
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

export function pieceType(piece: string): string {
  return piece.toUpperCase();
}

export function inBoard(file: number, rank: number): boolean {
  return file >= 0 && file < XIANGQI_FILES && rank >= 0 && rank < XIANGQI_RANKS;
}

export function squareName(file: number, rank: number): string {
  return `${String.fromCharCode(97 + file)}${rank}`;
}

export function parseSquare(square: string): XiangqiSquare | null {
  const match = /^([a-i])([0-9])$/.exec(square);
  if (!match) return null;
  return { file: match[1]!.charCodeAt(0) - 97, rank: Number(match[2]) };
}

export function pieceAt(board: XiangqiBoard, file: number, rank: number): string | null {
  return board[rank]?.[file] ?? null;
}

export function findKing(board: XiangqiBoard, side: Side): XiangqiSquare | null {
  const target = side === 'w' ? 'K' : 'k';
  for (let rank = 0; rank < XIANGQI_RANKS; rank += 1) {
    for (let file = 0; file < XIANGQI_FILES; file += 1) {
      if (board[rank]?.[file] === target) return { file, rank };
    }
  }
  return null;
}

export function isPalace(side: Side, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false;
  return side === 'w' ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9;
}

export function isOwnHalf(side: Side, rank: number): boolean {
  return side === 'w' ? rank <= 4 : rank >= 5;
}

export function cloneBoard(board: XiangqiBoard): (string | null)[][] {
  return board.map((row) => [...row]);
}
