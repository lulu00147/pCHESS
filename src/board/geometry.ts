export type BoardVariant = 'chess' | 'xiangqi';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly file: number;
  readonly row: number;
}

export interface BoardGeometry {
  readonly variant: BoardVariant;
  readonly width: number;
  readonly height: number;
  readonly files: number;
  readonly rows: number;
  readonly cell: number;
  readonly margin: number;
  readonly viewBox: string;
  readonly kind: 'square' | 'intersection';
  point(cell: Cell, flipped?: boolean): Point;
  cellAt(point: Point, flipped?: boolean): Cell | null;
}

function mapCell(cell: Cell, files: number, rows: number, flipped: boolean | undefined): Cell {
  if (!flipped) return cell;
  return { file: files - 1 - cell.file, row: rows - 1 - cell.row };
}

function makeGeometry(
  variant: BoardVariant,
  files: number,
  rows: number,
  cell: number,
  margin: number,
  kind: 'square' | 'intersection',
): BoardGeometry {
  const width = margin * 2 + cell * (kind === 'square' ? files : files - 1);
  const height = margin * 2 + cell * (kind === 'square' ? rows : rows - 1);

  return {
    variant,
    width,
    height,
    files,
    rows,
    cell,
    margin,
    viewBox: `0 0 ${width} ${height}`,
    kind,
    point(cellPosition, flipped = false) {
      const mapped = mapCell(cellPosition, files, rows, flipped);
      const x = margin + mapped.file * cell + (kind === 'square' ? cell / 2 : 0);
      const y = margin + mapped.row * cell + (kind === 'square' ? cell / 2 : 0);
      return { x, y };
    },
    cellAt(point, flipped = false) {
      const file =
        kind === 'square'
          ? Math.floor((point.x - margin) / cell)
          : Math.round((point.x - margin) / cell);
      const row =
        kind === 'square'
          ? Math.floor((point.y - margin) / cell)
          : Math.round((point.y - margin) / cell);

      if (file < 0 || file >= files || row < 0 || row >= rows) return null;
      if (kind === 'intersection') {
        const x = margin + file * cell;
        const y = margin + row * cell;
        if (Math.abs(point.x - x) > cell / 2 || Math.abs(point.y - y) > cell / 2) {
          return null;
        }
      }
      return mapCell({ file, row }, files, rows, flipped);
    },
  };
}

export const CHESS_GEOMETRY = makeGeometry('chess', 8, 8, 100, 0, 'square');
export const XIANGQI_GEOMETRY = makeGeometry('xiangqi', 9, 10, 100, 70, 'intersection');

export function geometryFor(variant: BoardVariant): BoardGeometry {
  return variant === 'chess' ? CHESS_GEOMETRY : XIANGQI_GEOMETRY;
}

export function fileLabel(geometry: BoardGeometry, file: number, flipped = false): string {
  const mapped = flipped ? geometry.files - 1 - file : file;
  return String.fromCharCode(97 + mapped);
}

export function rankLabel(geometry: BoardGeometry, row: number, flipped = false): string {
  const mapped = flipped ? geometry.rows - 1 - row : row;
  return geometry.variant === 'chess' ? String(8 - mapped) : String(9 - mapped);
}
