import type { BoardVariant, Cell } from '../board/geometry';

export function uciArrow(
  variant: BoardVariant,
  uci: string | null,
): { from: Cell; to: Cell } | null {
  const pattern = variant === 'chess' ? /^[a-h][1-8][a-h][1-8][qrbn]?$/ : /^[a-i][0-9][a-i][0-9]$/;
  if (!uci || !pattern.test(uci)) return null;
  const cell = (square: string): Cell => ({
    file: square.charCodeAt(0) - 97,
    row: variant === 'chess' ? 8 - Number(square[1]) : 9 - Number(square[1]),
  });
  return { from: cell(uci.slice(0, 2)), to: cell(uci.slice(2, 4)) };
}
