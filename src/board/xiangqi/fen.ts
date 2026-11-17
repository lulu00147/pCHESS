import { err, ok } from '../../core/result';
import type { Result } from '../../core/result';
import type { FenIssue, Side } from '../types';
import {
  XIANGQI_FILES,
  XIANGQI_RANKS,
  findKing,
  isOwnHalf,
  isPalace,
  opposite,
  pieceAt,
  pieceSide,
  pieceType,
  type XiangqiBoard,
} from './board';
import { isKingInCheck, kingsFacing } from './attacks';

export { XIANGQI_INITIAL_FEN } from './board';

export interface XiangqiPosition {
  readonly board: XiangqiBoard;
  readonly turn: Side;
  readonly halfmove: number;
  readonly fullmove: number;
}

const PIECES = new Set(['K', 'A', 'B', 'N', 'R', 'C', 'P', 'k', 'a', 'b', 'n', 'r', 'c', 'p']);
const MAX_COUNT: Record<string, number> = {
  K: 1,
  A: 2,
  B: 2,
  N: 2,
  R: 2,
  C: 2,
  P: 5,
};

function issue(code: string, message: string): FenIssue {
  return { code, message };
}

function parseNumber(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export function parseXiangqiFen(fen: string): Result<XiangqiPosition, FenIssue[]> {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) {
    return err([issue('fen.fields', 'Xiangqi FEN must have exactly 6 fields')]);
  }

  const boardField = fields[0];
  const turn = fields[1];
  const halfmove = parseNumber(fields[4]);
  const fullmove = parseNumber(fields[5]);
  if (!boardField) return err([issue('fen.board', 'missing board field')]);
  if (turn !== 'w' && turn !== 'b') {
    return err([issue('fen.turn', 'side to move must be w or b')]);
  }
  if (halfmove === null || fullmove === null) {
    return err([issue('fen.counters', 'move counters must be non-negative integers')]);
  }
  if (fields[2] !== '-' || fields[3] !== '-') {
    return err([issue('fen.state', 'xiangqi FEN requires "- -" state fields')]);
  }

  const rows = boardField.split('/');
  if (rows.length !== XIANGQI_RANKS) {
    return err([issue('fen.ranks', 'Xiangqi board must have exactly 10 ranks')]);
  }

  const board: (string | null)[][] = Array.from({ length: XIANGQI_RANKS }, () =>
    Array<string | null>(XIANGQI_FILES).fill(null),
  );
  const issues: FenIssue[] = [];

  rows.forEach((row, rowIndex) => {
    const rank = XIANGQI_RANKS - 1 - rowIndex;
    let file = 0;
    for (const char of row) {
      if (/^[1-9]$/.test(char)) {
        file += Number(char);
        continue;
      }
      if (!PIECES.has(char)) {
        issues.push(issue('fen.piece', `invalid piece: ${char}`));
        return;
      }
      if (file >= XIANGQI_FILES) {
        issues.push(issue('fen.files', 'rank has more than 9 files'));
        return;
      }
      board[rank]![file] = char;
      file += 1;
    }
    if (file !== XIANGQI_FILES) {
      issues.push(issue('fen.files', `rank ${rank} does not contain 9 files`));
    }
  });

  if (issues.length > 0) return err(issues);

  return ok({
    board: board as XiangqiBoard,
    turn,
    halfmove,
    fullmove,
  });
}

export function validateXiangqiFen(fen: string): FenIssue[] {
  const parsed = parseXiangqiFen(fen);
  if (!parsed.ok) return parsed.error;

  const { board, turn } = parsed.value;
  const issues: FenIssue[] = [];
  const counts = new Map<string, number>();

  for (let rank = 0; rank < XIANGQI_RANKS; rank += 1) {
    for (let file = 0; file < XIANGQI_FILES; file += 1) {
      const piece = pieceAt(board, file, rank);
      if (!piece) continue;

      const side = pieceSide(piece);
      const type = pieceType(piece);
      counts.set(piece, (counts.get(piece) ?? 0) + 1);

      if (type === 'K' && !isPalace(side, file, rank)) {
        issues.push(issue('fen.king-palace', 'king must stay inside its palace'));
      }
      if (type === 'A' && !isPalace(side, file, rank)) {
        issues.push(issue('fen.advisor-palace', 'advisor must stay inside its palace'));
      }
      if (type === 'B' && !isOwnHalf(side, rank)) {
        issues.push(issue('fen.elephant-river', 'elephant may not cross the river'));
      }
      if (type === 'P') {
        if (side === 'w' && rank < 3) {
          issues.push(issue('fen.pawn-rank', 'red pawn may not be behind its start rank'));
        }
        if (side === 'b' && rank > 6) {
          issues.push(issue('fen.pawn-rank', 'black pawn may not be behind its start rank'));
        }
      }
    }
  }

  const redKings = counts.get('K') ?? 0;
  const blackKings = counts.get('k') ?? 0;
  if (redKings !== 1 || blackKings !== 1) {
    issues.push(issue('fen.kings', 'each side must have exactly one king'));
  }

  for (const [piece, count] of counts) {
    const limit = MAX_COUNT[pieceType(piece)];
    if (limit !== undefined && count > limit) {
      issues.push(issue('fen.piece-count', `too many ${piece}`));
    }
  }

  const redTotal = [...counts.entries()]
    .filter(([piece]) => pieceSide(piece) === 'w')
    .reduce((sum, [, count]) => sum + count, 0);
  const blackTotal = [...counts.entries()]
    .filter(([piece]) => pieceSide(piece) === 'b')
    .reduce((sum, [, count]) => sum + count, 0);
  if (redTotal > 16 || blackTotal > 16) {
    issues.push(issue('fen.piece-count', 'each side may have at most 16 pieces'));
  }

  if (findKing(board, 'w') && findKing(board, 'b') && kingsFacing(board)) {
    issues.push(issue('fen.kings-facing', 'kings may not face each other'));
  }

  if (isKingInCheck(board, opposite(turn))) {
    issues.push(issue('fen.opponent-in-check', 'side not to move may not be in check'));
  }

  return issues;
}

export function serializeXiangqiFen(position: XiangqiPosition): string {
  const rows: string[] = [];
  for (let rank = XIANGQI_RANKS - 1; rank >= 0; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < XIANGQI_FILES; file += 1) {
      const piece = pieceAt(position.board, file, rank);
      if (piece === null) {
        empty += 1;
      } else {
        if (empty > 0) row += String(empty);
        empty = 0;
        row += piece;
      }
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return `${rows.join('/')} ${position.turn} - - ${position.halfmove} ${position.fullmove}`;
}
