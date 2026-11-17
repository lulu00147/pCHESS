import { formatScore } from '../engine/score';
import type { ParsedInfo } from '../engine/uci';
import type { MessageKey } from '../i18n';

export interface AnalysisPreview {
  readonly moves: readonly string[];
  readonly index: number;
}

export interface AnalysisViewOptions {
  readonly host: HTMLElement;
  readonly t: (key: MessageKey) => string;
  readonly status: string;
  readonly running: boolean;
  readonly single: boolean;
  readonly multiPv: number;
  readonly depth: number | null;
  readonly lines: ReadonlyMap<number, ParsedInfo>;
  readonly best: string | null;
  readonly stale: boolean;
  readonly turn: 'w' | 'b';
  readonly preview: AnalysisPreview | null;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onMultiPv: (value: number) => void;
  readonly onDepth: (value: number | null) => void;
  readonly onPreview: (moves: readonly string[]) => void;
  readonly onPreviewIndex: (index: number) => void;
  readonly onCommit: (moves: readonly string[]) => void;
  readonly onExitPreview: () => void;
}

interface AnalysisViewState {
  readonly panel: HTMLElement;
  readonly start: HTMLButtonElement;
  readonly stop: HTMLButtonElement;
  readonly multiPv: HTMLSelectElement;
  readonly depth: HTMLSelectElement;
  readonly status: HTMLSpanElement;
  readonly lines: HTMLElement;
  options: AnalysisViewOptions;
}

const views = new WeakMap<HTMLElement, AnalysisViewState>();

export function renderAnalysisView(options: AnalysisViewOptions): void {
  let view = views.get(options.host);
  if (!view || !options.host.contains(view.panel)) {
    view = createView(options);
    views.set(options.host, view);
  }
  view.options = options;
  view.panel.classList.toggle(
    'analysis-panel--empty',
    !options.stale && options.lines.size === 0 && !options.preview && !options.best,
  );
  updateToolbar(view, options);
  renderLines(view.lines, options);
}

function createView(options: AnalysisViewOptions): AnalysisViewState {
  const { host, t } = options;
  host.replaceChildren();
  const panel = document.createElement('section');
  panel.className = 'analysis-panel';
  const toolbar = document.createElement('div');
  toolbar.className = 'analysis-toolbar';

  const start = button(t('analyze'), () => views.get(host)?.options.onStart());
  const stop = button(t('stop'), () => views.get(host)?.options.onStop());

  const multiPv = select('MultiPV');
  for (const count of [1, 2, 3, 4, 5]) {
    const option = document.createElement('option');
    option.value = String(count);
    option.textContent = `PV ${count}`;
    multiPv.append(option);
  }
  multiPv.addEventListener('change', () =>
    views.get(host)?.options.onMultiPv(Number(multiPv.value)),
  );

  const depth = select('Depth');
  for (const value of [8, 12, 16, 20, null] as const) {
    const option = document.createElement('option');
    option.value = value === null ? 'infinite' : String(value);
    option.textContent = value === null ? '∞' : `d${value}`;
    depth.append(option);
  }
  depth.addEventListener('change', () => {
    const current = views.get(host);
    if (current) current.options.onDepth(depth.value === 'infinite' ? null : Number(depth.value));
  });

  const status = document.createElement('span');
  toolbar.append(start, stop, multiPv, depth, status);

  const lines = document.createElement('div');
  lines.className = 'analysis-lines';
  panel.append(toolbar, lines);
  host.append(panel);
  return { panel, start, stop, multiPv, depth, status, lines, options };
}

function updateToolbar(view: AnalysisViewState, options: AnalysisViewOptions): void {
  view.start.textContent = options.t('analyze');
  view.start.disabled = options.running;
  view.stop.textContent = options.t('stop');
  view.stop.disabled = !options.running;
  view.multiPv.value = String(options.multiPv);
  view.multiPv.disabled = options.running;
  view.depth.value = options.depth === null ? 'infinite' : String(options.depth);
  view.depth.disabled = options.running || options.single;
  view.status.textContent = options.status;
}

function renderLines(host: HTMLElement, options: AnalysisViewOptions): void {
  host.replaceChildren();
  if (options.stale) {
    const hint = document.createElement('div');
    hint.className = 'analysis-stale';
    hint.textContent = options.t('analysisStale');
    host.append(hint);
  } else {
    const sorted = [...options.lines.values()].sort((a, b) => a.multipv - b.multipv);
    for (const info of sorted) {
      const row = document.createElement('div');
      row.className = 'analysis-line';
      const text = document.createElement('span');
      const speed = info.nps ? ` · ${formatCount(info.nps)}/s` : '';
      const score = info.score ? formatScore(info.score, options.turn, options.turn) : '—';
      text.textContent = `#${info.multipv} d${info.depth ?? '?'} ${score}${speed} ${info.pv.slice(0, 8).join(' ')}`;
      row.append(text);
      if (info.pv.length > 0) {
        row.append(button(options.t('preview'), () => options.onPreview(info.pv)));
      }
      host.append(row);
    }
  }

  if (options.preview) {
    const preview = options.preview;
    const controls = document.createElement('div');
    controls.className = 'analysis-preview';
    const label = document.createElement('span');
    label.textContent = `${options.t('preview')} ${preview.index}/${preview.moves.length}`;
    const previous = button(options.t('previous'), () =>
      options.onPreviewIndex(Math.max(0, preview.index - 1)),
    );
    previous.disabled = preview.index <= 0;
    const next = button(options.t('next'), () =>
      options.onPreviewIndex(Math.min(preview.moves.length, preview.index + 1)),
    );
    next.disabled = preview.index >= preview.moves.length;
    const add = button(options.t('addToTree'), () => options.onCommit(preview.moves));
    const exit = button(options.t('exitPreview'), options.onExitPreview);
    controls.append(label, previous, next, add, exit);
    host.append(controls);
  }

  if (options.best) {
    const best = document.createElement('div');
    best.textContent = `bestmove ${options.best}`;
    host.append(best);
  }
}

function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

function select(label: string): HTMLSelectElement {
  const element = document.createElement('select');
  element.setAttribute('aria-label', label);
  return element;
}

function formatCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}G`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
