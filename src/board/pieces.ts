import type { Chess } from 'chess.js';
import type { PiecePlacement } from './appearance/pieces';
import { initialChessState, replayChess } from './chess/rules';
import { createXiangqiState, replayXiangqi } from './xiangqi/rules';
import type { XiangqiPosition } from './xiangqi/fen';
import type { BoardVariant } from './geometry';

export function piecesFromChess(chess: Chess): PiecePlacement[] {
  const pieces: PiecePlacement[] = [];
  chess.board().forEach((row, rowIndex) => {
    row.forEach((piece, file) => {
      if (!piece) return;
      pieces.push({
        cell: { file, row: rowIndex },
        code: `${piece.color}${piece.type.toUpperCase()}`,
        side: piece.color,
      });
    });
  });
  return pieces;
}

export function piecesFromXiangqi(position: XiangqiPosition): PiecePlacement[] {
  const pieces: PiecePlacement[] = [];
  for (let rank = 0; rank < 10; rank += 1) {
    for (let file = 0; file < 9; file += 1) {
      const char = position.board[rank]?.[file];
      if (!char) continue;
      const side = char === char.toUpperCase() ? 'w' : 'b';
      pieces.push({
        cell: { file, row: 9 - rank },
        code: `${side}${char.toUpperCase()}`,
        side,
      });
    }
  }
  return pieces;
}

export function initialPieces(variant: BoardVariant): PiecePlacement[] {
  if (variant === 'chess') {
    const replayed = replayChess(initialChessState());
    return replayed.ok ? piecesFromChess(replayed.value) : [];
  }
  const created = createXiangqiState();
  if (!created.ok) return [];
  const replayed = replayXiangqi(created.value);
  return replayed.ok ? piecesFromXiangqi(replayed.value) : [];
}
