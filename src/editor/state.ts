import type { BoardVariant, Cell } from '../board/geometry';
import type { FenIssue } from '../board/types';
import { validateChessFen } from '../board/chess/rules';
import { validateXiangqiFen } from '../board/xiangqi/fen';
import type { PiecePlacement } from '../board/appearance/pieces';

export interface BoardEditorState {
  readonly variant: BoardVariant;
  readonly squares: ReadonlyArray<ReadonlyArray<string | null>>;
  readonly side: 'w' | 'b';
  readonly castling: string;
  readonly enPassant: string;
  readonly halfmove: number;
  readonly fullmove: number;
}

const CHESS_ROWS = 8;
const CHESS_FILES = 8;
const XIANGQI_ROWS = 10;
const XIANGQI_FILES = 9;

function editorDimensions(variant: BoardVariant): { rows: number; files: number } {
  return variant === 'chess'
    ? { rows: CHESS_ROWS, files: CHESS_FILES }
    : { rows: XIANGQI_ROWS, files: XIANGQI_FILES };
}

function emptyBoard(variant: BoardVariant): (string | null)[][] {
  const { rows, files } = editorDimensions(variant);
  return Array.from({ length: rows }, () => Array.from({ length: files }, () => null));
}

export function editorFromFen(variant: BoardVariant, fen: string): BoardEditorState {
  const { rows, files } = editorDimensions(variant);
  const parts = fen.trim().split(/\s+/);
  const squares = emptyBoard(variant);
  const ranks = (parts[0] ?? '').split('/');

  if (ranks.length === rows) {
    ranks.forEach((rank, row) => {
      let file = 0;
      for (const char of rank) {
        if (char >= '1' && char <= '9') {
          file += Number(char);
        } else if (char === '.' || /^[KQRBNPkqrbnpACac]$/.test(char)) {
          if (file < files) squares[row]![file] = char === '.' ? null : char;
          file += 1;
        }
      }
    });
  }

  return {
    variant,
    squares,
    side: parts[1] === 'b' ? 'b' : 'w',
    castling: variant === 'chess' ? (parts[2] ?? '-') : '-',
    enPassant: variant === 'chess' ? (parts[3] ?? '-') : '-',
    halfmove: Math.max(0, Number(parts[4] ?? 0) || 0),
    fullmove: Math.max(1, Number(parts[5] ?? 1) || 1),
  };
}

export function editorFen(state: BoardEditorState): string {
  const ranks = state.squares.map((row) => {
    let text = '';
    let empty = 0;
    for (const square of row) {
      if (square === null) {
        empty += 1;
      } else {
        if (empty > 0) {
          text += String(empty);
          empty = 0;
        }
        text += square;
      }
    }
    if (empty > 0) text += String(empty);
    return text;
  });
  const castling = state.variant === 'chess' ? state.castling || '-' : '-';
  const ep = state.variant === 'chess' ? state.enPassant || '-' : '-';
  return `${ranks.join('/')} ${state.side} ${castling} ${ep} ${state.halfmove} ${state.fullmove}`;
}

export function editorIssues(state: BoardEditorState): readonly FenIssue[] {
  const fen = editorFen(state);
  return state.variant === 'chess' ? validateChessFen(fen) : validateXiangqiFen(fen);
}

export function setEditorSquare(
  state: BoardEditorState,
  cell: Cell,
  piece: string | null,
): BoardEditorState {
  const squares = state.squares.map((row) => [...row]);
  if (squares[cell.row] && cell.file >= 0 && cell.file < squares[cell.row]!.length) {
    squares[cell.row]![cell.file] = piece;
  }
  return { ...state, squares };
}

export function clearEditorBoard(state: BoardEditorState): BoardEditorState {
  return { ...state, squares: emptyBoard(state.variant) };
}

export function editorPieces(state: BoardEditorState): PiecePlacement[] {
  const pieces: PiecePlacement[] = [];
  state.squares.forEach((row, rowIndex) => {
    row.forEach((code, file) => {
      if (!code) return;
      pieces.push({
        cell: { file, row: rowIndex },
        code: `${code === code.toUpperCase() ? 'w' : 'b'}${code.toUpperCase()}`,
        side: code === code.toUpperCase() ? 'w' : 'b',
      });
    });
  });
  return pieces;
}
