import {
  findKing,
  inBoard,
  isOwnHalf,
  isPalace,
  opposite,
  pieceAt,
  pieceSide,
  pieceType,
  type XiangqiBoard,
} from './board';
import type { Side } from '../types';

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

function isEnemy(piece: string | null, by: Side): boolean {
  return piece !== null && pieceSide(piece) === by;
}

function isAttacked(board: XiangqiBoard, file: number, rank: number, by: Side): boolean {
  const pawn = by === 'w' ? 'P' : 'p';

  if (by === 'w') {
    if (pieceAt(board, file, rank - 1) === pawn) return true;
    if (
      rank >= 5 &&
      (pieceAt(board, file - 1, rank) === pawn || pieceAt(board, file + 1, rank) === pawn)
    ) {
      return true;
    }
  } else {
    if (pieceAt(board, file, rank + 1) === pawn) return true;
    if (
      rank <= 4 &&
      (pieceAt(board, file - 1, rank) === pawn || pieceAt(board, file + 1, rank) === pawn)
    ) {
      return true;
    }
  }

  const advisor = by === 'w' ? 'A' : 'a';
  for (const direction of DIAGONAL) {
    const attackFile = file + direction.file;
    const attackRank = rank + direction.rank;
    if (
      pieceAt(board, attackFile, attackRank) === advisor &&
      isPalace(by, attackFile, attackRank)
    ) {
      return true;
    }
  }

  const elephant = by === 'w' ? 'B' : 'b';
  for (const direction of DIAGONAL) {
    const attackFile = file + direction.file * 2;
    const attackRank = rank + direction.rank * 2;
    if (pieceAt(board, attackFile, attackRank) !== elephant) continue;
    if (!isOwnHalf(by, attackRank) || !isOwnHalf(by, rank)) continue;
    if (pieceAt(board, file + direction.file, rank + direction.rank) === null) {
      return true;
    }
  }

  const horse = by === 'w' ? 'N' : 'n';
  for (const move of HORSE) {
    const horseFile = file + move.file;
    const horseRank = rank + move.rank;
    if (pieceAt(board, horseFile, horseRank) !== horse) continue;
    const legFile = Math.abs(move.rank) === 2 ? horseFile : file + move.file / 2;
    const legRank = Math.abs(move.rank) === 2 ? rank + move.rank / 2 : horseRank;
    if (pieceAt(board, legFile, legRank) === null) return true;
  }

  for (const direction of ORTHOGONAL) {
    let scanFile = file + direction.file;
    let scanRank = rank + direction.rank;
    while (inBoard(scanFile, scanRank)) {
      const piece = pieceAt(board, scanFile, scanRank);
      if (piece !== null) {
        if (isEnemy(piece, by)) {
          const type = pieceType(piece);
          const distance = Math.abs(scanFile - file) + Math.abs(scanRank - rank);
          if (type === 'R') return true;
          if (type === 'K' && (distance === 1 || direction.file === 0)) return true;
        }
        break;
      }
      scanFile += direction.file;
      scanRank += direction.rank;
    }
  }

  const cannon = by === 'w' ? 'C' : 'c';
  for (const direction of ORTHOGONAL) {
    let scanFile = file + direction.file;
    let scanRank = rank + direction.rank;
    let screens = 0;
    while (inBoard(scanFile, scanRank)) {
      const piece = pieceAt(board, scanFile, scanRank);
      if (piece !== null) {
        if (screens === 0) {
          screens = 1;
        } else {
          if (piece === cannon) return true;
          break;
        }
      }
      scanFile += direction.file;
      scanRank += direction.rank;
    }
  }

  return false;
}

export function isKingInCheck(board: XiangqiBoard, side: Side): boolean {
  const king = findKing(board, side);
  if (!king) return false;
  return isAttacked(board, king.file, king.rank, opposite(side));
}

export function kingsFacing(board: XiangqiBoard): boolean {
  const red = findKing(board, 'w');
  const black = findKing(board, 'b');
  if (!red || !black || red.file !== black.file) return false;

  const from = Math.min(red.rank, black.rank) + 1;
  const to = Math.max(red.rank, black.rank);
  for (let rank = from; rank < to; rank += 1) {
    if (pieceAt(board, red.file, rank) !== null) return false;
  }
  return true;
}
