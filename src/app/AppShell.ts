import { createBoardSurface } from '../board/BoardSurface';
import { renderMoveTree } from './MoveTreeView';
import { GamePersistence } from './GamePersistence';
import { openSettings as openSettingsView } from './SettingsView';
import { openFenDialog as openFenDialogView, renderPromotion } from './Dialogs';
import { renderAnalysisView } from './AnalysisView';
import { renderEvalRail } from './EvalRail';
import { resolveEvaluation, type EvaluationCache } from './evaluation';
import { AnalysisState } from './analysisState';
import { EngineReplyScheduler } from './engineReplyScheduler';
import { acceptEngineMessage } from './engineMessageGate';
import { uciArrow } from './arrow';
import { AutoAnalysisScheduler } from './autoAnalysisScheduler';
import { BoardSession, type GameOutcome, type SessionView } from './session';
import { CHESS_SETS, XIANGQI_SETS } from '../board/appearance/sprites';
import { openBoardEditor } from '../editor/BoardEditor';
import {
  DEFAULT_APPEARANCE,
  type Appearance,
  type BoardThemeId,
  type ChessPieceSetId,
  type XiangqiPieceSetId,
} from '../board/appearance/types';
import type { BoardVariant } from '../board/geometry';
import type { EngineClient } from '../engine/client';
import type { WorkerToMain } from '../engine/protocol';
import { createEngineSession } from '../engine/engineSession';
import { selectBuild } from '../engine/buildSelection';
import {
  loadEnginePreferences,
  saveEnginePreferences,
  type EnginePreferences,
} from '../engine/preferences';
import {
  LANGUAGE_KEY,
  loadLanguage,
  translate,
  translateEngineStatus,
  translateNotice,
  translateStatus,
  type Language,
  type MessageKey,
} from '../i18n';

const VARIANTS: ReadonlyArray<{ id: BoardVariant; label: string }> = [
  { id: 'chess', label: '国际象棋' },
  { id: 'xiangqi', label: '中国象棋' },
];
const BOARD_THEMES: ReadonlyArray<BoardThemeId> = ['wood', 'green', 'blue', 'contrast'];
const STORAGE_KEY = 'pchess:v1:appearance';
const THEME_KEY = 'pchess:v1:theme';
const AUTO_ANALYZE_KEY = 'pchess:v1:auto-analyze';
const ENGINE_REPLY_KEY = 'pchess:v1:engine-reply';
type UiTheme = 'system' | 'light' | 'dark';

function applyUiTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    
  }
}

function loadUiTheme(): UiTheme {
  const value = readSetting(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function loadEngineReply(): boolean {
  return readSetting(ENGINE_REPLY_KEY) !== '0';
}

function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const data = JSON.parse(raw) as Partial<Appearance>;
    const boardTheme = BOARD_THEMES.includes(data.boardTheme as BoardThemeId)
      ? (data.boardTheme as BoardThemeId)
      : DEFAULT_APPEARANCE.boardTheme;
    const chessPieceSet = CHESS_SETS.includes(data.chessPieceSet as ChessPieceSetId)
      ? (data.chessPieceSet as ChessPieceSetId)
      : DEFAULT_APPEARANCE.chessPieceSet;
    const xiangqiPieceSet = XIANGQI_SETS.includes(data.xiangqiPieceSet as XiangqiPieceSetId)
      ? (data.xiangqiPieceSet as XiangqiPieceSetId)
      : DEFAULT_APPEARANCE.xiangqiPieceSet;
    return { boardTheme, chessPieceSet, xiangqiPieceSet };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    
  }
}

export function mountAppShell(root: HTMLElement, session = new BoardSession()): void {
  let variant: BoardVariant = window.location.hash === '#xiangqi' ? 'xiangqi' : 'chess';
  let flipped = false;
  let appearance = loadAppearance();
  let uiTheme = loadUiTheme();
  applyUiTheme(uiTheme);
  let language: Language = loadLanguage();
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const t = (key: MessageKey): string => translate(language, key);
  let notice = '';
  let stopTimer: number | undefined;
  const gameMeta = {
    chess: { id: 'current-chess', createdAt: Date.now() },
    xiangqi: { id: 'current-xiangqi', createdAt: Date.now() },
  } as const;
  const persistence = new GamePersistence(session, gameMeta, (message) => {
    notice = message;
    render();
  });
  let engineClient: EngineClient | null = null;
  const analysis = new AnalysisState();
  const autoScheduler = new AutoAnalysisScheduler({
    isRunning: () => analysis.running,
    start: () => void analyzeCurrent(),
    stop: () => {
      engineClient?.stop();
    },
  });
  const replyScheduler = new EngineReplyScheduler({
    isRunning: () => analysis.running,
    start: () => void analyzeCurrent(),
    stop: () => {
      engineClient?.stop();
    },
  });
  let evaluationCache: EvaluationCache | null = null;
  let analysisGeneration = 0;
  let analysisSingle =
    selectBuild(globalThis.crossOriginIsolated, typeof SharedArrayBuffer !== 'undefined') ===
    'single-simd';
  let analysisMultiPv = 1;
  let analysisDepth: number | null = 12;
  let preview: { moves: string[]; index: number } | null = null;
  const collapsed = new Set<string>();
  let enginePreferences: EnginePreferences = loadEnginePreferences();
  let effectiveHashMb: number | null = null;
  let autoAnalyze = readSetting(AUTO_ANALYZE_KEY) === '1';
  autoScheduler.setEnabled(autoAnalyze);
  let engineReply = loadEngineReply();
  let analysisFrame: number | undefined;
  let persistenceReady = false;
  let pendingSave = false;

  const shell = document.createElement('main');
  shell.className = 'app-shell';

  const header = document.createElement('header');
  header.className = 'app-header';
  const title = document.createElement('h1');
  title.textContent = 'pCHESS';
  const controls = document.createElement('div');
  controls.className = 'app-controls';
  const generalSettings = document.createElement('div');
  generalSettings.className = 'settings-general';

  const variantButtons = VARIANTS.map(({ id }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = id === 'chess' ? t('chess') : t('xiangqi');
    button.dataset.variant = id;
    button.addEventListener('click', () => {
      variant = id;
      flipped = false;
      collapsed.clear();
      session.clearSelection();
      session.cancelPromotion();
      fenHost.replaceChildren();
      editorHost.replaceChildren();
      syncPieceOptions();
      autoScheduler.setPaused(false);
      resetAnalysis();
    });
    controls.append(button);
    return button;
  });

  const flipButton = document.createElement('button');
  flipButton.type = 'button';
  flipButton.textContent = t('flip');
  flipButton.addEventListener('click', () => {
    flipped = !flipped;
    render();
  });
  controls.append(flipButton);

  const uiThemeButton = document.createElement('button');
  uiThemeButton.type = 'button';
  const themeText = (): string =>
    uiTheme === 'system' ? t('themeSystem') : uiTheme === 'dark' ? t('themeDark') : t('themeLight');
  uiThemeButton.textContent = themeText();
  uiThemeButton.addEventListener('click', () => {
    uiTheme = uiTheme === 'system' ? 'light' : uiTheme === 'light' ? 'dark' : 'system';
    writeSetting(THEME_KEY, uiTheme);
    applyUiTheme(uiTheme);
    uiThemeButton.textContent = themeText();
  });
  generalSettings.append(uiThemeButton);

  const themeLabel = document.createElement('label');
  themeLabel.textContent = t('boardTheme');
  const themeSelect = document.createElement('select');
  for (const theme of BOARD_THEMES) {
    const option = document.createElement('option');
    option.value = theme;
    option.textContent = theme;
    themeSelect.append(option);
  }
  themeSelect.addEventListener('change', () => {
    appearance = { ...appearance, boardTheme: themeSelect.value as BoardThemeId };
    saveAppearance(appearance);
    render();
  });
  themeLabel.append(themeSelect);

  const pieceLabel = document.createElement('label');
  pieceLabel.textContent = t('pieces');
  const pieceSelect = document.createElement('select');
  pieceSelect.addEventListener('change', () => {
    appearance =
      variant === 'chess'
        ? { ...appearance, chessPieceSet: pieceSelect.value as ChessPieceSetId }
        : { ...appearance, xiangqiPieceSet: pieceSelect.value as XiangqiPieceSetId };
    saveAppearance(appearance);
    render();
  });
  pieceLabel.append(pieceSelect);
  generalSettings.append(themeLabel, pieceLabel);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.textContent = t('newGame');
  newButton.addEventListener('click', () => {
    if (session.treeView(variant).mainline.length > 0 && !window.confirm(t('confirmNewGame'))) {
      return;
    }
    session.reset(variant);
    persistence.reset();
    collapsed.clear();
    resetAnalysis();
    scheduleSave();
  });

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = t('importPgn');
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.pgn,application/x-chess-pgn,text/plain';
  importInput.hidden = true;
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        const loaded = variant === 'chess' ? session.loadPgn(text) : session.loadXiangqiPgn(text);
        notice = loaded.ok ? loaded.value : `PGN 导入失败：${loaded.error.message}`;
        importInput.value = '';
        if (loaded.ok) {
          collapsed.clear();
          resetAnalysis();
          scheduleSave();
        } else {
          render();
        }
      })
      .catch(() => {
        importInput.value = '';
        notice = 'PGN 导入失败：读取文件失败';
        render();
      });
  });

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = t('exportPgn');
  exportButton.addEventListener('click', () => {
    const text = variant === 'chess' ? session.exportPgn() : session.exportXiangqiPgn();
    const blob = new Blob([text], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = variant === 'chess' ? 'pchess.pgn' : 'pchess-xiangqi.pgn';
    anchor.click();
    URL.revokeObjectURL(url);
  });
  const fenButton = document.createElement('button');
  fenButton.type = 'button';
  fenButton.textContent = 'FEN';
  fenButton.addEventListener('click', () => {
    editorHost.replaceChildren();
    openFenDialog();
  });
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.textContent = t('edit');
  editButton.addEventListener('click', () => {
    fenHost.replaceChildren();
    editorHost.replaceChildren();
    openBoardEditor({
      host: editorHost,
      variant,
      fen: session.snapshot(variant).rootFen,
      chessPieceSet: appearance.chessPieceSet,
      xiangqiPieceSet: appearance.xiangqiPieceSet,
      hasMoves: session.treeView(variant).mainline.length > 0,
      language,
      onApply: (fen) => {
        const result = session.setFen(variant, fen);
        if (!result.ok) {
          notice = `FEN 应用失败：${result.error.map((issue) => issue.message).join('；')}`;
          render();
          return;
        }
        editorHost.replaceChildren();
        collapsed.clear();
        resetAnalysis();
        scheduleSave();
      },
      onClose: () => editorHost.replaceChildren(),
    });
  });
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = t('settings');
  settingsButton.addEventListener('click', () => void openSettings());
  const languageButton = document.createElement('button');
  languageButton.type = 'button';
  languageButton.textContent = t('language');
  languageButton.addEventListener('click', () => {
    language = language === 'zh' ? 'en' : 'zh';
    writeSetting(LANGUAGE_KEY, language);
    applyLanguage();
    render();
    if (settingsHost.childElementCount > 0) void openSettings();
  });
  controls.append(
    newButton,
    importButton,
    exportButton,
    editButton,
    fenButton,
    settingsButton,
    importInput,
  );
  const legalLink = document.createElement('a');
  legalLink.href = '/legal/';
  legalLink.target = '_blank';
  legalLink.rel = 'noreferrer';
  legalLink.className = 'app-legal';
  legalLink.textContent = t('legal');
  generalSettings.append(languageButton, legalLink);

  const status = document.createElement('p');
  status.className = 'app-status';
  const promotionHost = document.createElement('div');
  const fenHost = document.createElement('div');
  const editorHost = document.createElement('div');
  const settingsHost = document.createElement('div');
  settingsHost.className = 'settings-host';

  header.append(title, controls);
  const boardHost = document.createElement('div');
  boardHost.className = 'board-host';
  const evalHost = document.createElement('div');
  evalHost.className = 'eval-host';
  const boardStage = document.createElement('div');
  boardStage.className = 'board-stage';
  boardStage.append(evalHost, boardHost);
  const movesHost = document.createElement('div');
  movesHost.className = 'moves-host';
  const analysisHost = document.createElement('div');
  analysisHost.className = 'analysis-host';

  const boardColumn = document.createElement('div');
  boardColumn.className = 'board-column';
  boardColumn.append(boardStage, status);
  const sideColumn = document.createElement('aside');
  sideColumn.className = 'side-column';
  sideColumn.append(analysisHost, movesHost);
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  workspace.append(boardColumn, sideColumn);

  shell.append(header, workspace, promotionHost, fenHost, editorHost, settingsHost);
  root.append(shell);

  async function openSettings(): Promise<void> {
    settingsHost.replaceChildren();
    const restartEngine = (): void => resetAnalysis();
    await openSettingsView({
      host: settingsHost,
      t,
      general: generalSettings,
      preferences: enginePreferences,
      autoAnalyze,
      engineReply,
      running: analysis.running,
      onAutoAnalyze: (enabled) => {
        autoAnalyze = enabled;
        autoScheduler.setEnabled(enabled);
        writeSetting(AUTO_ANALYZE_KEY, autoAnalyze ? '1' : '0');
      },
      onEngineReply: (enabled) => {
        engineReply = enabled;
        replyScheduler.setEnabled(enabled);
        writeSetting(ENGINE_REPLY_KEY, engineReply ? '1' : '0');
      },
      onPreferences: (next) => {
        enginePreferences = next;
        saveEnginePreferences(next);
        effectiveHashMb = null;
        restartEngine();
        return true;
      },
      onEngineRestart: restartEngine,
    });
  }

  function openFenDialog(): void {
    openFenDialogView({
      host: fenHost,
      title: `${variant === 'chess' ? t('chess') : t('xiangqi')} FEN`,
      value: session.currentFen(variant),
      applyLabel: t('importFen'),
      copyLabel: t('copyCurrent'),
      cancelLabel: t('cancel'),
      onApply: (value) => {
        if (
          session.treeView(variant).mainline.length > 0 &&
          !window.confirm(t('confirmClearTree'))
        ) {
          return '';
        }
        const result = session.setFen(variant, value);
        if (!result.ok) {
          return result.error.map((issue) => issue.message).join('；');
        }
        collapsed.clear();
        resetAnalysis();
        scheduleSave();
        return null;
      },
    });
  }

  function syncPieceOptions(): void {
    const sets = variant === 'chess' ? CHESS_SETS : XIANGQI_SETS;
    pieceSelect.replaceChildren();
    for (const set of sets) {
      const option = document.createElement('option');
      option.value = set;
      option.textContent = set;
      pieceSelect.append(option);
    }
    pieceSelect.value = variant === 'chess' ? appearance.chessPieceSet : appearance.xiangqiPieceSet;
  }

  function applyLanguage(): void {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    for (const button of variantButtons) {
      button.textContent = button.dataset.variant === 'chess' ? t('chess') : t('xiangqi');
    }
    flipButton.textContent = t('flip');
    newButton.textContent = t('newGame');
    uiThemeButton.textContent = themeText();
    if (themeLabel.firstChild) themeLabel.firstChild.textContent = t('boardTheme');
    if (pieceLabel.firstChild) pieceLabel.firstChild.textContent = t('pieces');
    importButton.textContent = t('importPgn');
    exportButton.textContent = t('exportPgn');
    editButton.textContent = t('edit');
    settingsButton.textContent = t('settings');
    languageButton.textContent = t('language');
    legalLink.textContent = t('legal');
  }

  function disposeEngine(): void {
    analysisGeneration += 1;
    cancelAnalysisFrame();
    autoScheduler.reset();
    replyScheduler.reset();
    if (stopTimer !== undefined) window.clearTimeout(stopTimer);
    stopTimer = undefined;
    evaluationCache = null;
    engineClient?.dispose();
    engineClient = null;
    analysis.running = false;
    analysisSingle =
      selectBuild(globalThis.crossOriginIsolated, typeof SharedArrayBuffer !== 'undefined') ===
      'single-simd';
  }

  function cancelEngineReply(): void {
    replyScheduler.cancel();
  }

  function resetAnalysis(): void {
    disposeEngine();
    analysis.reset();
    preview = null;
    render();
  }

  function stopAnalysis(): void {
    cancelEngineReply();
    if (analysis.running && !engineClient) {
      analysisGeneration += 1;
      autoScheduler.setPaused(true);
      autoScheduler.cancelPending();
      analysis.running = false;
      analysis.status = '已取消初始化';
      renderAnalysis();
      return;
    }
    if (engineClient?.currentState === 'initializing') {
      disposeEngine();
      autoScheduler.setPaused(true);
      analysis.status = '已取消初始化';
      renderAnalysis();
      return;
    }
    autoScheduler.setPaused(true);
    autoScheduler.cancelPending();
    const stopped = engineClient?.stop() ?? false;
    analysis.status = stopped ? '停止请求已发送' : '引擎未在搜索';
    if (stopped) {
      const generation = analysisGeneration;
      stopTimer = window.setTimeout(() => {
        stopTimer = undefined;
        if (generation !== analysisGeneration || !analysis.running) return;
        engineClient?.dispose();
        engineClient = null;
        failCurrentAnalysis('引擎无响应');
        render();
      }, 3000);
    }
    renderAnalysis();
  }

  function renderEval(outcome: GameOutcome): void {
    const currentFen = session.currentFen(variant);
    const turn = currentFen.split(' ')[1] === 'b' ? 'b' : 'w';
    const result = resolveEvaluation({
      cache: evaluationCache,
      variant,
      fen: currentFen,
      turn,
      line: analysis.fen === currentFen ? analysis.lines.get(1) : undefined,
      outcome,
      running: analysis.running,
      replyPending: replyScheduler.isPending,
    });
    evaluationCache = result.cache;
    renderEvalRail({
      host: evalHost,
      variant,
      ratio: result.ratio,
      score: result.score,
      label: result.pending
        ? `${t('winRate')} —`
        : `${t('winRate')} ${Math.round(result.ratio * 100)}%`,
      flipped,
      pending: result.pending,
    });
  }

  function cancelAnalysisFrame(): void {
    if (analysisFrame === undefined) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(analysisFrame);
    } else {
      window.clearTimeout(analysisFrame);
    }
    analysisFrame = undefined;
  }

  function scheduleAnalysisRender(): void {
    if (analysisFrame !== undefined) return;
    const render = (): void => {
      analysisFrame = undefined;
      renderAnalysis();
    };
    analysisFrame =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(render)
        : window.setTimeout(render, 16);
  }

  function renderAnalysis(outcome = session.outcome(variant)): void {
    cancelAnalysisFrame();
    renderEval(outcome);
    const stale = analysis.fen !== null && analysis.fen !== session.currentFen(variant);
    const turn = session.currentFen(variant).split(' ')[1] === 'b' ? 'b' : 'w';
    renderAnalysisView({
      host: analysisHost,
      t,
      status: translateEngineStatus(
        language,
        stale && !analysis.running ? '局面已变化' : analysis.status,
      ),
      running: analysis.running,
      single: analysisSingle,
      multiPv: analysisMultiPv,
      depth: analysisDepth,
      lines: analysis.lines,
      best: analysis.best,
      stale,
      turn,
      preview,
      onStart: () => {
        cancelEngineReply();
        autoScheduler.setPaused(false);
        void analyzeCurrent();
      },
      onStop: stopAnalysis,
      onMultiPv: (value) => {
        analysisMultiPv = value;
      },
      onDepth: (value) => {
        analysisDepth = value;
      },
      onPreview: (moves) => {
        preview = { moves: [...moves], index: 1 };
        render();
      },
      onPreviewIndex: (index) => {
        if (!preview) return;
        preview = { ...preview, index };
        render();
      },
      onCommit: (moves) => {
        const committed = session.commitLine(variant, moves);
        notice = committed.ok ? `加入 ${committed.value} 着` : `加入失败：${committed.error}`;
        preview = null;
        render();
        if (committed.ok) scheduleSave();
      },
      onExitPreview: () => {
        preview = null;
        render();
      },
    });
  }

  function clearStopTimer(): void {
    if (stopTimer !== undefined) window.clearTimeout(stopTimer);
    stopTimer = undefined;
  }

  function failCurrentAnalysis(message: string): void {
    clearStopTimer();
    evaluationCache = null;
    replyScheduler.clearPending();
    autoScheduler.cancelPending();
    analysis.fail(message);
  }

  function handleEngineMessage(client: EngineClient, message: WorkerToMain): void {
    if (
      !acceptEngineMessage({
        client,
        currentClient: engineClient,
        running: analysis.running,
        type: message.type,
        searchId: analysis.searchId,
        messageSearchId: 'searchId' in message ? message.searchId : null,
      })
    ) {
      return;
    }
    if (message.type === 'info') {
      analysis.info(message.line, analysisSingle);
      scheduleAnalysisRender();
      return;
    } else if (message.type === 'bestmove') {
      clearStopTimer();
      const replyFen = analysis.fen;
      const wasReply = replyScheduler.isPending;
      analysis.finish(message.move);
      if (wasReply) {
        autoScheduler.cancelPending();
        if (message.move && replyFen === session.currentFen(variant)) {
          const committed = session.commitLine(variant, [message.move]);
          replyScheduler.clearPending();
          analysis.clearResult();
          preview = null;
          analysis.status = committed.ok ? '电脑已走子' : `电脑应着失败：${committed.error}`;
          if (committed.ok) {
            scheduleSave();
            void analyzeCurrent(true);
          }
        } else if (replyFen !== null && replyFen !== session.currentFen(variant)) {
          analysis.clearResult();
          replyScheduler.afterMove();
        } else {
          replyScheduler.clearPending();
        }
      }
      autoScheduler.afterResult();
    } else if (message.type === 'error') {
      failCurrentAnalysis(`${message.code}: ${message.message}`);
      client.dispose();
      if (engineClient === client) engineClient = null;
    } else if (message.type === 'download') {
      const percent =
        message.total && message.total > 0
          ? Math.min(100, Math.floor((message.loaded / message.total) * 100))
          : null;
      analysis.status = message.done
        ? '网络就绪'
        : `下载网络${percent === null ? '' : ` ${percent}%`}`;
      scheduleAnalysisRender();
      return;
    } else {
      return;
    }
    render();
  }

  async function analyzeCurrent(finiteDepth = false): Promise<void> {
    clearStopTimer();
    const generation = ++analysisGeneration;
    analysis.begin();
    renderAnalysis();

    try {
      if (!engineClient) {
        const session = await createEngineSession({
          variant,
          preferences: enginePreferences,
          preferredHash: effectiveHashMb,
          onClient: (client) => {
            if (generation === analysisGeneration) engineClient = client;
            else client.dispose();
          },
          onMessage: handleEngineMessage,
          onStatus: (status) => {
            if (generation !== analysisGeneration) return;
            analysis.status = status === 'hash-retry' ? 'Hash 降级重试' : analysis.status;
            renderAnalysis();
          },
        });
        if (generation !== analysisGeneration || engineClient !== session.client) {
          session.client.dispose();
          return;
        }
        analysisSingle = session.build === 'single-simd';
        effectiveHashMb = session.hashMb;
      }

      if (generation !== analysisGeneration) return;
      const fen = session.currentFen(variant);
      const position = session.analysisPosition(variant);
      analysis.fen = fen;
      const active = engineClient;
      if (!active) throw new Error('engine unavailable');
      const replyDepth = Math.min(analysisDepth ?? 12, 12);
      const targetDepth = replyScheduler.isPending || finiteDepth ? replyDepth : analysisDepth;
      const searchId = active.analyze({
        rootFen: position.rootFen,
        moves: position.moves,
        fen,
        depth: targetDepth,
        multiPv: analysisMultiPv,
        ...(analysisSingle ? { chunkMs: 300 } : {}),
      });
      analysis.searchId = searchId;
      analysis.status = analysisSingle ? '搜索中（单线程分片）' : '搜索中';
    } catch (error) {
      if (generation !== analysisGeneration) return;
      engineClient?.dispose();
      engineClient = null;
      failCurrentAnalysis(`分析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (generation === analysisGeneration) renderAnalysis();
  }

  function afterUserMove(): void {
    if (!engineReply) {
      autoScheduler.afterMove();
      return;
    }
    replyScheduler.afterMove();
  }

  function scheduleSave(): void {
    if (!persistenceReady) {
      pendingSave = true;
      return;
    }
    persistence.schedule();
  }

  function flushSave(): void {
    if (!root.isConnected || !persistenceReady) return;
    persistence.flush();
  }

  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });

  async function restorePersisted(): Promise<void> {
    try {
      await persistence.restore();
    } catch {
      persistence.disable();
      notice = '存档恢复失败';
    } finally {
      persistenceReady = true;
      render();
      if (pendingSave) {
        pendingSave = false;
        scheduleSave();
      }
    }
  }

  function render(): void {
    boardStage.dataset.variant = variant;
    for (const button of variantButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.variant === variant));
    }
    themeSelect.value = appearance.boardTheme;
    pieceSelect.value = variant === 'chess' ? appearance.chessPieceSet : appearance.xiangqiPieceSet;
    const view = session.view(variant);
    const gameState = session.describe(variant);
    const previewView = preview ? session.previewLine(variant, preview.moves, preview.index) : null;
    const bestArrow =
      !preview && analysis.best && analysis.bestFen === session.currentFen(variant)
        ? uciArrow(variant, analysis.best)
        : null;
    boardHost.replaceChildren(
      createBoardSurface({
        variant,
        ariaLabel: variant === 'chess' ? t('chessBoard') : t('xiangqiBoard'),
        theme: appearance.boardTheme,
        chessPieceSet: appearance.chessPieceSet,
        xiangqiPieceSet: appearance.xiangqiPieceSet,
        pieces: previewView?.pieces ?? view.pieces,
        selected: preview ? null : view.selected,
        targets: preview ? [] : view.targets,
        lastMove: previewView?.lastMove ?? view.lastMove,
        arrow: previewView?.lastMove ?? bestArrow,
        flipped,
        onCell: (cell) => {
          if (preview) {
            preview = null;
            render();
            return;
          }
          if (view.pendingPromotion) return;
          const before = session.treeVersion(variant);
          session.click(variant, cell);
          const moved = session.treeVersion(variant) !== before;
          if (moved) afterUserMove();
          render();
          scheduleSave();
        },
        onDrop: (from, to) => {
          if (preview) {
            preview = null;
            render();
            return;
          }
          if (view.pendingPromotion) return;
          const before = session.treeVersion(variant);
          session.click(variant, from);
          session.click(variant, to);
          const moved = session.treeVersion(variant) !== before;
          if (moved) afterUserMove();
          render();
          scheduleSave();
        },
      }),
    );
    status.textContent = `${variant === 'chess' ? t('chess') : t('xiangqi')} · ${translateStatus(language, gameState.status)}${notice ? ` · ${translateNotice(language, notice)}` : ''}`;
    renderMoves();
    renderAnalysis(gameState.outcome);
    renderPromotionOverlay(view.pendingPromotion);
  }

  function renderMoves(): void {
    const view = session.treeView(variant);
    const tree = session.snapshot(variant);
    movesHost.replaceChildren();
    if (view.mainline.length === 0) return;

    const panel = document.createElement('section');
    panel.className = 'move-panel';
    const toolbar = document.createElement('div');
    toolbar.className = 'move-toolbar';

    const controls: Array<{ label: string; action: () => void }> = [
      { label: t('moveFirst'), action: () => session.first(variant) },
      { label: t('undo'), action: () => session.undo(variant) },
      { label: t('redo'), action: () => session.redo(variant) },
      { label: t('moveLast'), action: () => session.last(variant) },
    ];
    for (const { label, action } of controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        cancelEngineReply();
        action();
        render();
        scheduleSave();
      });
      toolbar.append(button);
    }

    panel.append(toolbar);
    renderMoveTree({
      host: panel,
      tree,
      prefix: variant,
      collapsed,
      deleteLabel: t('deleteVariation'),
      expandLabel: t('expandBranch'),
      collapseLabel: t('collapseBranch'),
      confirmDelete: t('confirmDeleteVariation'),
      onNavigate: (id) => {
        cancelEngineReply();
        preview = null;
        session.goTo(variant, id);
        render();
        scheduleSave();
      },
      onDelete: (id) => {
        cancelEngineReply();
        preview = null;
        collapsed.clear();
        session.deleteNode(variant, id);
        render();
        scheduleSave();
      },
      onChange: render,
    });

    movesHost.append(panel);
  }

  function renderPromotionOverlay(pending: SessionView['pendingPromotion']): void {
    if (!pending || variant !== 'chess') {
      promotionHost.replaceChildren();
      return;
    }
    renderPromotion({
      host: promotionHost,
      pieceSet: appearance.chessPieceSet,
      dialogLabel: t('choosePromotion'),
      title: t('promotion'),
      cancelLabel: t('cancel'),
      pieceLabels: {
        q: t('queen'),
        r: t('rook'),
        b: t('bishop'),
        n: t('knight'),
      },
      onPromote: (piece) => {
        const promoted = session.promote(piece);
        if (promoted) afterUserMove();
        render();
        scheduleSave();
      },
      onCancel: () => {
        session.cancelPromotion();
        render();
      },
    });
  }

  syncPieceOptions();
  render();
  document.addEventListener('keydown', (event) => {
    if (!root.isConnected || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
    ) {
      return;
    }
    if (event.key === 'Escape') {
      preview = null;
      session.cancelPromotion();
      fenHost.replaceChildren();
      editorHost.replaceChildren();
      settingsHost.replaceChildren();
      render();
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      flipped = !flipped;
    } else if (event.key === 'ArrowLeft') {
      cancelEngineReply();
      preview = null;
      session.undo(variant);
    } else if (event.key === 'ArrowRight') {
      cancelEngineReply();
      preview = null;
      const tree = session.snapshot(variant);
      const next = tree.nodes[tree.cursorId]?.children[0];
      if (next) session.goTo(variant, next);
      else session.redo(variant);
    } else if (event.key === 'ArrowUp') {
      cancelEngineReply();
      preview = null;
      session.first(variant);
    } else if (event.key === 'ArrowDown') {
      cancelEngineReply();
      preview = null;
      session.last(variant);
    } else {
      return;
    }
    event.preventDefault();
    render();
    scheduleSave();
  });

  void restorePersisted();
  if (window.location.hash === '#edit') editButton.click();
}
