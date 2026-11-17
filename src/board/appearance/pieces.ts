import { CHESS_GLYPHS, XIANGQI_GLYPHS } from './glyphs';
import type { ChessPieceSetId, PieceSetId, XiangqiPieceSetId } from './types';
import type { BoardGeometry, BoardVariant, Cell, Point } from '../geometry';

const SVG = 'http://www.w3.org/2000/svg';

export const CHESS_PIECES = [
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
] as const;
export const XIANGQI_PIECES = [
  'wK',
  'wA',
  'wB',
  'wN',
  'wR',
  'wC',
  'wP',
  'bK',
  'bA',
  'bB',
  'bN',
  'bR',
  'bC',
  'bP',
] as const;

export type ChessPieceCode = (typeof CHESS_PIECES)[number];
export type XiangqiPieceCode = (typeof XIANGQI_PIECES)[number];

function element<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function addPath(
  parent: SVGElement,
  d: string,
  attributes: Record<string, string | number> = {},
): void {
  parent.append(element('path', { d, ...attributes }));
}

function pieceId(variant: BoardVariant, set: PieceSetId, code: string): string {
  return `pc-${variant}-${set}-${code}`;
}

function chessSymbol(code: ChessPieceCode, set: ChessPieceSetId): SVGSymbolElement {
  const symbol = element('symbol', { id: pieceId('chess', set, code), viewBox: '0 0 100 100' });
  const glyph = CHESS_GLYPHS[code.slice(1) as keyof typeof CHESS_GLYPHS];
  if (!glyph) throw new Error(`missing chess glyph: ${code}`);

  let style: Record<string, string | number>;
  if (set === 'flat') {
    style = { fill: 'currentColor', stroke: 'none' };
  } else if (set === 'bold') {
    style = {
      fill: 'currentColor',
      stroke: 'var(--piece-stroke)',
      'stroke-width': 4,
      'stroke-linejoin': 'round',
    };
  } else if (set === 'duotone') {
    style = {
      fill: 'currentColor',
      stroke: 'var(--piece-stroke)',
      'stroke-width': 3,
      'fill-opacity': 0.86,
    };
  } else {
    style = { fill: 'currentColor', stroke: 'var(--piece-stroke)', 'stroke-width': 1.5 };
  }

  addPath(symbol, glyph, { ...style, 'stroke-linejoin': 'round' });
  return symbol;
}

function xiangqiSymbol(code: XiangqiPieceCode, set: XiangqiPieceSetId): SVGSymbolElement {
  const symbol = element('symbol', { id: pieceId('xiangqi', set, code), viewBox: '0 0 100 100' });
  const glyph = XIANGQI_GLYPHS[code as keyof typeof XIANGQI_GLYPHS];
  if (!glyph) throw new Error(`missing xiangqi glyph: ${code}`);

  if (set === 'stamp') {
    symbol.append(
      element('rect', {
        x: 8,
        y: 8,
        width: 84,
        height: 84,
        rx: 10,
        fill: 'var(--piece-glyph)',
        stroke: 'currentColor',
        'stroke-width': 3,
      }),
      element('path', {
        d: glyph,
        fill: 'currentColor',
        stroke: 'none',
        transform: 'translate(50 50) scale(0.62) translate(-50 -50)',
      }),
    );
    return symbol;
  }

  symbol.append(
    element('circle', {
      cx: 50,
      cy: 50,
      r: 45,
      fill: 'currentColor',
      stroke: 'var(--piece-stroke)',
      'stroke-width': 2,
    }),
  );

  if (set === 'flat') {
    symbol.append(element('path', { d: glyph, fill: 'var(--piece-glyph)', stroke: 'none' }));
    return symbol;
  }

  const faceRadius = set === 'bold' ? 30 : 35;
  symbol.append(
    element('circle', {
      cx: 50,
      cy: 50,
      r: faceRadius,
      fill: 'var(--piece-glyph)',
      stroke: 'currentColor',
      'stroke-width': set === 'bold' ? 3 : 1.5,
    }),
    element('path', {
      d: glyph,
      fill: 'currentColor',
      stroke: 'none',
      transform: `translate(50 50) scale(${set === 'bold' ? 0.62 : 0.72}) translate(-50 -50)`,
    }),
  );
  return symbol;
}

export function createPieceSymbol(
  variant: BoardVariant,
  set: PieceSetId,
  code: string,
): SVGSymbolElement {
  if (variant === 'chess') {
    return chessSymbol(code as ChessPieceCode, set as ChessPieceSetId);
  }
  return xiangqiSymbol(code as XiangqiPieceCode, set as XiangqiPieceSetId);
}

export interface PiecePlacement {
  readonly cell: Cell;
  readonly code: string;
  readonly side: 'w' | 'b';
}

export function createPieceUse(
  geometry: BoardGeometry,
  placement: PiecePlacement,
  set: PieceSetId,
  flipped = false,
): SVGUseElement {
  const point: Point = geometry.point(placement.cell, flipped);
  const use = element('use', {
    href: `#${pieceId(geometry.variant, set, placement.code)}`,
    x: point.x - 45,
    y: point.y - 45,
    width: 90,
    height: 90,
    class: `piece piece--${placement.side === 'w' ? (geometry.variant === 'chess' ? 'white' : 'red') : 'black'}`,
    'aria-hidden': 'true',
    'data-piece': placement.code,
  });
  return use;
}
