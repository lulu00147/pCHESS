import {
  CHESS_GEOMETRY,
  XIANGQI_GEOMETRY,
  fileLabel,
  geometryFor,
  rankLabel,
  type BoardGeometry,
  type BoardVariant,
  type Cell,
} from './geometry';
import { createPieceUse, type PiecePlacement } from './appearance/pieces';
import { installPieceSprites } from './appearance/sprites';
import type { BoardThemeId, ChessPieceSetId, XiangqiPieceSetId } from './appearance/types';

const SVG = 'http://www.w3.org/2000/svg';

export interface BoardSurfaceOptions {
  readonly variant: BoardVariant;
  readonly theme?: BoardThemeId;
  readonly flipped?: boolean;
  readonly pieces?: readonly PiecePlacement[];
  readonly chessPieceSet?: ChessPieceSetId;
  readonly xiangqiPieceSet?: XiangqiPieceSetId;
  readonly selected?: Cell | null;
  readonly targets?: readonly Cell[];
  readonly lastMove?: { readonly from: Cell; readonly to: Cell } | null;
  readonly arrow?: { readonly from: Cell; readonly to: Cell } | null;
  readonly ariaLabel?: string;
  readonly onCell?: (cell: Cell) => void;
  readonly onDrop?: (from: Cell, to: Cell) => void;
}

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

function addLabel(
  parent: SVGGElement,
  x: number,
  y: number,
  text: string,
  anchor: 'start' | 'middle' | 'end' = 'middle',
): void {
  const label = element('text', {
    x,
    y,
    class: 'board-coord',
    'text-anchor': anchor,
    'dominant-baseline': 'middle',
  });
  label.textContent = text;
  parent.append(label);
}

function chessBoard(geometry: BoardGeometry, flipped: boolean): SVGGElement {
  const group = element('g', { 'data-layer': 'board' });
  group.append(
    element('rect', {
      x: 0,
      y: 0,
      width: geometry.width,
      height: geometry.height,
      class: 'board-frame',
    }),
  );

  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const cell = geometry.point({ file, row }, flipped);
      group.append(
        element('rect', {
          x: cell.x - geometry.cell / 2,
          y: cell.y - geometry.cell / 2,
          width: geometry.cell,
          height: geometry.cell,
          class: `board-square ${(file + row) % 2 === 0 ? 'board-square--light' : 'board-square--dark'}`,
          'data-file': file,
          'data-row': row,
        }),
      );
    }
  }

  for (let file = 0; file < 8; file += 1) {
    const point = geometry.point({ file, row: 7 }, flipped);
    addLabel(group, point.x, geometry.height - 10, fileLabel(geometry, file, flipped));
  }
  for (let row = 0; row < 8; row += 1) {
    const point = geometry.point({ file: 0, row }, flipped);
    addLabel(group, 8, point.y, rankLabel(geometry, row, flipped));
  }

  group.append(
    element('rect', {
      x: 0.5,
      y: 0.5,
      width: geometry.width - 1,
      height: geometry.height - 1,
      class: 'board-border',
    }),
  );
  return group;
}

function xiangqiBoard(geometry: BoardGeometry, flipped: boolean): SVGGElement {
  const group = element('g', { 'data-layer': 'board' });
  const { margin, cell, files, rows } = geometry;
  const left = margin;
  const right = margin + (files - 1) * cell;
  const top = margin;
  const bottom = margin + (rows - 1) * cell;
  const riverTop = margin + 4 * cell;
  const riverBottom = margin + 5 * cell;

  group.append(
    element('rect', {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      class: 'board-field',
    }),
    element('rect', {
      x: left + 0.5,
      y: top + 0.5,
      width: right - left - 1,
      height: bottom - top - 1,
      class: 'board-border',
    }),
  );

  for (let row = 0; row < rows; row += 1) {
    const y = top + row * cell;
    group.append(
      element('line', {
        x1: left,
        y1: y,
        x2: right,
        y2: y,
        class: 'board-line',
      }),
    );
  }

  for (let file = 0; file < files; file += 1) {
    const x = left + file * cell;
    if (file === 0 || file === files - 1) {
      group.append(element('line', { x1: x, y1: top, x2: x, y2: bottom, class: 'board-line' }));
    } else {
      group.append(
        element('line', { x1: x, y1: top, x2: x, y2: riverTop, class: 'board-line' }),
        element('line', { x1: x, y1: riverBottom, x2: x, y2: bottom, class: 'board-line' }),
      );
    }
  }

  for (const palaceTop of [top, margin + 7 * cell]) {
    group.append(
      element('line', {
        x1: left + 3 * cell,
        y1: palaceTop,
        x2: left + 5 * cell,
        y2: palaceTop + 2 * cell,
        class: 'board-line',
      }),
      element('line', {
        x1: left + 5 * cell,
        y1: palaceTop,
        x2: left + 3 * cell,
        y2: palaceTop + 2 * cell,
        class: 'board-line',
      }),
    );
  }

  for (let file = 0; file < files; file += 1) {
    const x = left + file * cell;
    addLabel(group, x, bottom + 58, fileLabel(geometry, file, flipped));
  }
  for (let row = 0; row < rows; row += 1) {
    const y = top + row * cell;
    addLabel(group, 16, y, rankLabel(geometry, row, flipped));
  }

  return group;
}

function highlightLayer(
  geometry: BoardGeometry,
  flipped: boolean,
  selected: Cell | null | undefined,
  targets: readonly Cell[] | undefined,
  lastMove: { readonly from: Cell; readonly to: Cell } | null | undefined,
): SVGGElement {
  const group = element('g', { 'data-layer': 'highlights' });

  const mark = (cell: Cell, className: string, radius: number): void => {
    const point = geometry.point(cell, flipped);
    if (geometry.kind === 'square') {
      group.append(
        element('rect', {
          x: point.x - geometry.cell / 2 + 4,
          y: point.y - geometry.cell / 2 + 4,
          width: geometry.cell - 8,
          height: geometry.cell - 8,
          class: className,
        }),
      );
    } else {
      group.append(element('circle', { cx: point.x, cy: point.y, r: radius, class: className }));
    }
  };

  if (lastMove) {
    mark(lastMove.from, 'board-last', 46);
    mark(lastMove.to, 'board-last', 46);
  }
  for (const target of targets ?? []) {
    mark(target, 'board-target', geometry.kind === 'square' ? 14 : 38);
  }
  if (selected) mark(selected, 'board-selected', 46);
  return group;
}

function hitLayer(
  geometry: BoardGeometry,
  flipped: boolean,
  onCell: ((cell: Cell) => void) | undefined,
  onDrop: ((from: Cell, to: Cell) => void) | undefined,
): SVGGElement {
  const group = element('g', { 'data-layer': 'hit' });
  let dragStart: Cell | null = null;

  for (let row = 0; row < geometry.rows; row += 1) {
    for (let file = 0; file < geometry.files; file += 1) {
      const point = geometry.point({ file, row }, flipped);
      const node = element(
        geometry.kind === 'square' ? 'rect' : 'circle',
        geometry.kind === 'square'
          ? {
              x: point.x - geometry.cell / 2,
              y: point.y - geometry.cell / 2,
              width: geometry.cell,
              height: geometry.cell,
              class: 'board-hit',
              'data-cell': `${file},${row}`,
              tabindex: onCell ? 0 : -1,
              role: 'button',
            }
          : {
              cx: point.x,
              cy: point.y,
              r: geometry.cell / 2,
              class: 'board-hit',
              'data-cell': `${file},${row}`,
              tabindex: onCell ? 0 : -1,
              role: 'button',
            },
      );
      const cell = { file, row };
      if (onCell) {
        node.addEventListener('keydown', (event) => {
          const key = (event as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            onCell(cell);
          }
        });
        node.addEventListener('pointerdown', (event) => {
          const pointer = event as PointerEvent;
          event.preventDefault();
          dragStart = cell;
          if (typeof node.setPointerCapture === 'function') {
            node.setPointerCapture(pointer.pointerId);
          }
        });
        node.addEventListener('pointerup', (event) => {
          if (!dragStart) return;
          const pointer = event as PointerEvent;
          const from = dragStart;
          dragStart = null;
          const hit =
            typeof document.elementFromPoint === 'function'
              ? document.elementFromPoint(pointer.clientX, pointer.clientY)
              : null;
          const target = hit?.closest<SVGElement>('[data-cell]');
          const raw = target?.getAttribute('data-cell');
          if (!raw) {
            onCell(from);
            return;
          }
          const [targetFile, targetRow] = raw.split(',').map(Number);
          if (targetFile === undefined || targetRow === undefined) {
            onCell(from);
            return;
          }
          const to = { file: targetFile, row: targetRow };
          if (to.file === from.file && to.row === from.row) onCell(from);
          else onDrop?.(from, to);
        });
        node.addEventListener('pointercancel', () => {
          dragStart = null;
        });
      }
      group.append(node);
    }
  }
  return group;
}

function arrowLayer(
  geometry: BoardGeometry,
  flipped: boolean,
  arrow: { readonly from: Cell; readonly to: Cell } | null | undefined,
): SVGGElement | null {
  if (!arrow) return null;
  const group = element('g', { 'data-layer': 'arrow' });
  const from = geometry.point(arrow.from, flipped);
  const to = geometry.point(arrow.to, flipped);
  group.append(
    element('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      class: 'board-arrow',
      'marker-end': 'url(#pchess-arrowhead)',
    }),
  );
  return group;
}

function piecesLayer(
  geometry: BoardGeometry,
  pieces: readonly PiecePlacement[],
  set: ChessPieceSetId | XiangqiPieceSetId,
  flipped: boolean,
): SVGGElement {
  const group = element('g', { 'data-layer': 'pieces' });
  for (const piece of pieces) {
    group.append(createPieceUse(geometry, piece, set, flipped));
  }
  return group;
}

export function createBoardSurface(options: BoardSurfaceOptions): SVGSVGElement {
  installPieceSprites();
  const geometry = geometryFor(options.variant);
  const flipped = options.flipped ?? false;
  const set =
    options.variant === 'chess'
      ? (options.chessPieceSet ?? 'staunton')
      : (options.xiangqiPieceSet ?? 'disc');
  const svg = element('svg', {
    viewBox: geometry.viewBox,
    class: `board-surface board-surface--${options.variant}`,
    role: 'img',
    'aria-label':
      options.ariaLabel ?? (options.variant === 'chess' ? '国际象棋棋盘' : '中国象棋棋盘'),
    'data-board-theme': options.theme ?? 'wood',
    'data-piece-set': set,
  });

  const board =
    options.variant === 'chess' ? chessBoard(geometry, flipped) : xiangqiBoard(geometry, flipped);
  const defs = element('defs');
  const marker = element('marker', {
    id: 'pchess-arrowhead',
    viewBox: '0 0 4 4',
    refX: 2,
    refY: 2,
    markerWidth: 4,
    markerHeight: 4,
    orient: 'auto',
  });
  marker.append(element('path', { d: 'M0,0 L4,2 L0,4 Z', class: 'board-arrowhead' }));
  defs.append(marker);
  svg.append(defs, board);
  svg.append(
    highlightLayer(geometry, flipped, options.selected, options.targets, options.lastMove),
  );
  svg.append(piecesLayer(geometry, options.pieces ?? [], set, flipped));
  const arrow = arrowLayer(geometry, flipped, options.arrow);
  if (arrow) svg.append(arrow);
  svg.append(hitLayer(geometry, flipped, options.onCell, options.onDrop));
  return svg;
}

export { CHESS_GEOMETRY, XIANGQI_GEOMETRY };
