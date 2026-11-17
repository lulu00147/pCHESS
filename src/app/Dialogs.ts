export interface FenDialogOptions {
  readonly host: HTMLElement;
  readonly title: string;
  readonly value: string;
  readonly applyLabel: string;
  readonly copyLabel: string;
  readonly cancelLabel: string;
  readonly onApply: (value: string) => string | null;
}

export function openFenDialog(options: FenDialogOptions): void {
  const { host } = options;
  host.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const dialog = document.createElement('div');
  dialog.className = 'modal__dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'FEN');

  const title = document.createElement('p');
  title.textContent = options.title;
  const field = document.createElement('textarea');
  field.className = 'modal__textarea';
  field.value = options.value;
  field.spellcheck = false;
  const error = document.createElement('p');
  error.className = 'modal__error';

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = options.applyLabel;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = options.copyLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = options.cancelLabel;

  apply.addEventListener('click', () => {
    const failure = options.onApply(field.value.trim());
    if (failure) {
      error.textContent = failure;
      return;
    }
    host.replaceChildren();
  });
  copy.addEventListener('click', () => {
    field.select();
    void navigator.clipboard?.writeText(field.value).catch(() => undefined);
  });
  cancel.addEventListener('click', () => host.replaceChildren());

  actions.append(apply, copy, cancel);
  dialog.append(title, field, error, actions);
  overlay.append(dialog);
  host.append(overlay);
  field.focus();
  field.select();
}

export interface PromotionOptions {
  readonly host: HTMLElement;
  readonly pieceSet: string;
  readonly dialogLabel: string;
  readonly title: string;
  readonly cancelLabel: string;
  readonly pieceLabels: Readonly<Record<'q' | 'r' | 'b' | 'n', string>>;
  readonly onPromote: (piece: 'q' | 'r' | 'b' | 'n') => void;
  readonly onCancel: () => void;
}

export function renderPromotion(options: PromotionOptions): void {
  const { host } = options;
  host.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'promotion';
  const dialog = document.createElement('div');
  dialog.className = 'promotion__dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', options.dialogLabel);

  const title = document.createElement('p');
  title.textContent = options.title;
  const pieces = document.createElement('div');
  pieces.className = 'promotion__options';
  const choices = [
    { piece: 'q', label: options.pieceLabels.q },
    { piece: 'r', label: options.pieceLabels.r },
    { piece: 'b', label: options.pieceLabels.b },
    { piece: 'n', label: options.pieceLabels.n },
  ] as const;

  for (const { piece, label } of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.append(promotionPieceSvg(options.pieceSet, piece));
    button.addEventListener('click', () => options.onPromote(piece));
    pieces.append(button);
  }

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'promotion__cancel';
  cancel.textContent = options.cancelLabel;
  cancel.addEventListener('click', options.onCancel);

  dialog.append(title, pieces, cancel);
  overlay.append(dialog);
  host.append(overlay);
  (pieces.querySelector('button') as HTMLButtonElement | null)?.focus();
}

function promotionPieceSvg(pieceSet: string, piece: 'q' | 'r' | 'b' | 'n'): SVGSVGElement {
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'promotion__piece');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#pc-chess-${pieceSet}-w${piece.toUpperCase()}`);
  use.setAttribute('width', '100');
  use.setAttribute('height', '100');
  svg.append(use);
  return svg;
}
