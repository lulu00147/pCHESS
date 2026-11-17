import { CHESS_PIECES, XIANGQI_PIECES, createPieceSymbol } from './pieces';
import type { ChessPieceSetId, XiangqiPieceSetId } from './types';

const SVG = 'http://www.w3.org/2000/svg';
export const CHESS_SETS: readonly ChessPieceSetId[] = ['staunton', 'duotone', 'flat', 'bold'];
export const XIANGQI_SETS: readonly XiangqiPieceSetId[] = ['disc', 'flat', 'stamp', 'bold'];

let installed = false;

export function installPieceSprites(): void {
  if (installed) return;
  installed = true;

  const host = document.createElementNS(SVG, 'svg');
  host.setAttribute('class', 'piece-sprites');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('focusable', 'false');

  for (const set of CHESS_SETS) {
    for (const code of CHESS_PIECES) {
      host.append(createPieceSymbol('chess', set, code));
    }
  }
  for (const set of XIANGQI_SETS) {
    for (const code of XIANGQI_PIECES) {
      host.append(createPieceSymbol('xiangqi', set, code));
    }
  }

  document.body.append(host);
}
