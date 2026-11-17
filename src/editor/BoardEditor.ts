import { createBoardSurface } from '../board/BoardSurface';
import { CHESS_PIECES, XIANGQI_PIECES } from '../board/appearance/pieces';
import { installPieceSprites } from '../board/appearance/sprites';
import type { ChessPieceSetId, XiangqiPieceSetId } from '../board/appearance/types';
import type { BoardVariant } from '../board/geometry';
import { translate, type Language } from '../i18n';
import {
  clearEditorBoard,
  editorFen,
  editorFromFen,
  editorIssues,
  editorPieces,
  setEditorSquare,
  type BoardEditorState,
} from './state';

const SVG = 'http://www.w3.org/2000/svg';

export interface BoardEditorOptions {
  readonly host: HTMLElement;
  readonly variant: BoardVariant;
  readonly fen: string;
  readonly chessPieceSet: ChessPieceSetId;
  readonly xiangqiPieceSet: XiangqiPieceSetId;
  readonly hasMoves: boolean;
  readonly language: Language;
  readonly onApply: (fen: string) => void;
  readonly onClose: () => void;
}

export function openBoardEditor(options: BoardEditorOptions): void {
  installPieceSprites();
  let state: BoardEditorState = editorFromFen(options.variant, options.fen);
  let selected: string | 'erase' = 'wP';
  const t = (key: Parameters<typeof translate>[1]): string => translate(options.language, key);
  const codes = options.variant === 'chess' ? CHESS_PIECES : XIANGQI_PIECES;

  const overlay = document.createElement('div');
  overlay.className = 'modal editor';
  const dialog = document.createElement('div');
  dialog.className = 'modal__dialog editor__dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute(
    'aria-label',
    options.variant === 'chess' ? t('editChess') : t('editXiangqi'),
  );

  const title = document.createElement('p');
  title.textContent = options.variant === 'chess' ? t('editChess') : t('editXiangqi');
  const error = document.createElement('p');
  error.className = 'modal__error';

  const body = document.createElement('div');
  body.className = 'editor__body';
  const boardHost = document.createElement('div');
  boardHost.className = 'editor__board';
  const sidePanel = document.createElement('div');
  sidePanel.className = 'editor__side';

  const palette = document.createElement('div');
  palette.className = 'editor__palette';
  for (const code of codes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor__palette-button';
    button.dataset.piece = code;
    button.setAttribute('aria-label', code);
    button.append(
      paletteSvg(
        code,
        options.variant,
        options.variant === 'chess' ? options.chessPieceSet : options.xiangqiPieceSet,
      ),
    );
    button.addEventListener('click', () => {
      selected = code;
      render();
    });
    palette.append(button);
  }

  const eraser = document.createElement('button');
  eraser.type = 'button';
  eraser.textContent = t('eraser');
  eraser.addEventListener('click', () => {
    selected = 'erase';
    render();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t('clearBoard');
  clear.addEventListener('click', () => {
    state = clearEditorBoard(state);
    render();
  });
  const paletteActions = document.createElement('div');
  paletteActions.className = 'editor__actions';
  paletteActions.append(eraser, clear);

  const sideLabel = document.createElement('label');
  sideLabel.textContent = t('sideToMove');
  const side = document.createElement('select');
  for (const value of ['w', 'b'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'w' ? t('redSide') : t('blackSide');
    side.append(option);
  }
  side.addEventListener('change', () => {
    state = { ...state, side: side.value === 'b' ? 'b' : 'w' };
    render();
  });
  sideLabel.append(side);

  const castling = document.createElement('fieldset');
  castling.className = 'editor__fieldset';
  const castlingLegend = document.createElement('legend');
  castlingLegend.textContent = t('castling');
  castling.append(castlingLegend);
  const castlingFlags = ['K', 'Q', 'k', 'q'] as const;
  const castlingBoxes = castlingFlags.map((flag) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = flag;
    input.addEventListener('change', () => {
      const next = castlingFlags.filter((item) => {
        const box = castling.querySelector<HTMLInputElement>(`input[value="${item}"]`);
        return box?.checked;
      });
      state = { ...state, castling: next.join('') || '-' };
      render();
    });
    label.append(input, flag);
    castling.append(label);
    return input;
  });

  const epLabel = document.createElement('label');
  epLabel.textContent = t('enPassant');
  const ep = document.createElement('input');
  ep.type = 'text';
  ep.maxLength = 2;
  ep.addEventListener('input', () => {
    state = { ...state, enPassant: ep.value || '-' };
    render();
  });
  epLabel.append(ep);

  const halfmoveLabel = document.createElement('label');
  halfmoveLabel.textContent = t('halfmove');
  const halfmove = document.createElement('input');
  halfmove.type = 'number';
  halfmove.min = '0';
  halfmove.addEventListener('input', () => {
    state = { ...state, halfmove: Math.max(0, Number(halfmove.value) || 0) };
    render();
  });
  halfmoveLabel.append(halfmove);

  const fullmoveLabel = document.createElement('label');
  fullmoveLabel.textContent = t('fullmove');
  const fullmove = document.createElement('input');
  fullmove.type = 'number';
  fullmove.min = '1';
  fullmove.addEventListener('input', () => {
    state = { ...state, fullmove: Math.max(1, Number(fullmove.value) || 1) };
    render();
  });
  fullmoveLabel.append(fullmove);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = t('apply');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('cancel');
  apply.addEventListener('click', () => {
    if (editorIssues(state).length > 0) return;
    if (options.hasMoves && !window.confirm(t('confirmClearMoves'))) return;
    options.onApply(editorFen(state));
  });
  cancel.addEventListener('click', () => options.onClose());

  const render = (): void => {
    boardHost.replaceChildren(
      createBoardSurface({
        variant: options.variant,
        pieces: editorPieces(state),
        chessPieceSet: options.chessPieceSet,
        xiangqiPieceSet: options.xiangqiPieceSet,
        onCell: (cell) => {
          if (selected === 'erase') {
            state = setEditorSquare(state, cell, null);
          } else {
            const code =
              selected[0] === 'w' ? selected[1]!.toUpperCase() : selected[1]!.toLowerCase();
            state = setEditorSquare(state, cell, code);
          }
          render();
        },
      }),
    );

    for (const button of palette.querySelectorAll<HTMLButtonElement>('.editor__palette-button')) {
      button.setAttribute('aria-pressed', String(button.dataset.piece === selected));
    }
    eraser.setAttribute('aria-pressed', String(selected === 'erase'));
    side.value = state.side;
    for (const box of castlingBoxes) box.checked = state.castling.includes(box.value);
    ep.value = state.enPassant;
    halfmove.value = String(state.halfmove);
    fullmove.value = String(state.fullmove);
    const issues = editorIssues(state);
    error.textContent = issues.length === 0 ? '' : issues.map((issue) => issue.message).join('；');
    apply.disabled = issues.length > 0;
  };

  const sideControls = document.createElement('div');
  sideControls.className = 'editor__controls';
  sideControls.append(sideLabel);
  if (options.variant === 'chess') {
    sideControls.append(castling, epLabel);
  }
  sideControls.append(halfmoveLabel, fullmoveLabel);
  sidePanel.append(palette, paletteActions, sideControls);
  body.append(boardHost, sidePanel);
  dialog.append(title, error, body, actions);
  actions.append(apply, cancel);
  overlay.append(dialog);
  options.host.append(overlay);

  apply.disabled = true;
  render();
}

function paletteSvg(
  code: string,
  variant: BoardVariant,
  set: ChessPieceSetId | XiangqiPieceSetId,
): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'editor__palette-piece');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#pc-${variant}-${set}-${code}`);
  use.setAttribute('width', '100');
  use.setAttribute('height', '100');
  svg.append(use);
  return svg;
}
