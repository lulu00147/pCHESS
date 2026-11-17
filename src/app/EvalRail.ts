import type { BoardVariant } from '../board/geometry';

export interface EvalRailOptions {
  readonly host: HTMLElement;
  readonly variant: BoardVariant;
  readonly ratio: number;
  readonly score: string;
  readonly label: string;
  readonly flipped?: boolean;
  readonly pending?: boolean;
}

export function renderEvalRail(options: EvalRailOptions): void {
  const ratio = Math.max(0, Math.min(1, options.ratio));
  const bottomRatio = options.flipped ? 1 - ratio : ratio;
  options.host.replaceChildren();
  const rail = document.createElement('div');
  rail.className = `eval-bar eval-rail eval-rail--${options.variant}${
    options.flipped ? ' eval-rail--flipped' : ''
  }${options.pending ? ' eval-rail--pending' : ''}`;
  rail.setAttribute('role', 'img');
  rail.setAttribute('aria-label', options.label);

  const top = document.createElement('div');
  top.className = 'eval-rail__top';
  const bottom = document.createElement('div');
  bottom.className = 'eval-rail__bottom';
  const topPercent = Math.round((1 - bottomRatio) * 100);
  const bottomPercent = 100 - topPercent;
  top.style.height = `${topPercent}%`;
  bottom.style.height = `${bottomPercent}%`;

  const topLabel = document.createElement('span');
  topLabel.className = 'eval-rail__top-label';
  topLabel.textContent = `${topPercent}%`;
  const bottomLabel = document.createElement('span');
  bottomLabel.className = 'eval-rail__bottom-label';
  bottomLabel.textContent = `${bottomPercent}%`;
  const score = document.createElement('span');
  score.className = 'eval-rail__score';
  score.textContent = options.score;

  rail.append(top, bottom);
  if (!options.pending) rail.append(topLabel, bottomLabel);
  rail.append(score);
  options.host.append(rail);
}
