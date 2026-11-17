export type Language = 'zh' | 'en';

export const LANGUAGE_KEY = 'pchess:v1:language';

const zh = {
  chess: '国际象棋',
  xiangqi: '中国象棋',
  chessBoard: '国际象棋棋盘',
  xiangqiBoard: '中国象棋棋盘',
  flip: '翻转',
  boardTheme: '棋盘',
  pieces: '棋子',
  importPgn: '导入 PGN',
  newGame: '新建',
  confirmNewGame: '新建棋局将清空当前走法树。继续？',
  exportPgn: '导出 PGN',
  fen: 'FEN',
  edit: '编辑',
  settings: '设置',
  interfaceSettings: '界面',
  engineCache: '引擎缓存',
  engineSettings: '引擎',
  threads: '线程',
  hash: 'Hash MB',
  auto: '自动',
  legal: '许可',
  engineSettingsSaved: '引擎设置已保存，下次分析生效',
  confirmEngineRestart: '修改线程或 Hash 将重启引擎。继续？',
  autoAnalyze: '走子后自动分析',
  engineReply: '电脑应着',
  storageUsage: '站点已用',
  quota: '配额',
  clearCache: '清理引擎缓存',
  cachedNetworks: '已缓存网络',
  analysisStale: '局面已变化，重新分析以更新评估。',
  deleteNetwork: '删除',
  networkRemoved: '网络缓存已删除',
  close: '关闭',
  unknown: '未知',
  cacheCleared: '引擎缓存已清理',
  cacheUnavailable: 'Cache API 不可用',
  importFen: '导入',
  copyCurrent: '复制当前',
  cancel: '取消',
  confirmClearTree: '导入 FEN 将清空走法树。继续？',
  analyze: '分析',
  stop: '停止',
  winRate: '胜率',
  preview: '预览',
  previous: '上一步',
  next: '下一步',
  addToTree: '加入棋谱',
  exitPreview: '退出预览',
  moveFirst: '首',
  undo: '悔',
  redo: '重',
  moveLast: '末',
  expandBranch: '展开变着',
  collapseBranch: '折叠变着',
  deleteVariation: '删除变着',
  confirmDeleteVariation: '删除该着及其全部后续变着？',
  promotion: '升变',
  choosePromotion: '选择升变棋子',
  queen: '后',
  rook: '车',
  bishop: '象',
  knight: '马',
  editChess: '编辑国际象棋',
  editXiangqi: '编辑中国象棋',
  eraser: '橡皮',
  clearBoard: '清空',
  sideToMove: '行棋方',
  redSide: '白/红',
  blackSide: '黑',
  castling: '易位权',
  enPassant: '吃过路兵',
  halfmove: '半回合',
  fullmove: '回合',
  apply: '应用',
  confirmClearMoves: '应用编辑将清空当前走法树。继续？',
  themeSystem: '主题：系统',
  themeLight: '主题：浅色',
  themeDark: '主题：深色',
  language: '语言：中文',
};

const en: Record<keyof typeof zh, string> = {
  chess: 'Chess',
  xiangqi: 'Xiangqi',
  chessBoard: 'Chess board',
  xiangqiBoard: 'Xiangqi board',
  flip: 'Flip',
  boardTheme: 'Board',
  pieces: 'Pieces',
  importPgn: 'Import PGN',
  newGame: 'New',
  confirmNewGame: 'Starting a new game clears the current move tree. Continue?',
  exportPgn: 'Export PGN',
  fen: 'FEN',
  edit: 'Edit',
  settings: 'Settings',
  interfaceSettings: 'Interface',
  engineCache: 'Engine cache',
  engineSettings: 'Engine',
  threads: 'Threads',
  hash: 'Hash MB',
  auto: 'Auto',
  legal: 'Legal',
  engineSettingsSaved: 'Engine settings saved; applies to the next analysis',
  confirmEngineRestart: 'Changing threads or hash restarts the engine. Continue?',
  autoAnalyze: 'Analyze after each move',
  engineReply: 'Computer replies',
  storageUsage: 'Site usage',
  quota: 'Quota',
  clearCache: 'Clear engine cache',
  cachedNetworks: 'Cached networks',
  analysisStale: 'Position changed; analyze again to update the evaluation.',
  deleteNetwork: 'Delete',
  networkRemoved: 'Network cache deleted',
  close: 'Close',
  unknown: 'unknown',
  cacheCleared: 'Engine cache cleared',
  cacheUnavailable: 'Cache API unavailable',
  importFen: 'Import',
  copyCurrent: 'Copy current',
  cancel: 'Cancel',
  confirmClearTree: 'Importing FEN clears the move tree. Continue?',
  analyze: 'Analyze',
  stop: 'Stop',
  winRate: 'Win rate',
  preview: 'Preview',
  previous: 'Previous',
  next: 'Next',
  addToTree: 'Add to tree',
  exitPreview: 'Exit preview',
  moveFirst: 'First',
  undo: 'Undo',
  redo: 'Redo',
  moveLast: 'Last',
  expandBranch: 'Expand variation',
  collapseBranch: 'Collapse variation',
  deleteVariation: 'Delete variation',
  confirmDeleteVariation: 'Delete this move and all following variations?',
  promotion: 'Promotion',
  choosePromotion: 'Choose promotion piece',
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
  editChess: 'Edit chess',
  editXiangqi: 'Edit xiangqi',
  eraser: 'Eraser',
  clearBoard: 'Clear',
  sideToMove: 'Side to move',
  redSide: 'White/Red',
  blackSide: 'Black',
  castling: 'Castling',
  enPassant: 'En passant',
  halfmove: 'Halfmove',
  fullmove: 'Fullmove',
  apply: 'Apply',
  confirmClearMoves: 'Applying clears the current move tree. Continue?',
  themeSystem: 'Theme: system',
  themeLight: 'Theme: light',
  themeDark: 'Theme: dark',
  language: 'Language: English',
};

export type MessageKey = keyof typeof zh;

const messages: Record<Language, Record<MessageKey, string>> = { zh, en };

export function loadLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function translate(language: Language, key: MessageKey): string {
  return messages[language][key];
}

export function translateStatus(language: Language, status: string): string {
  if (language === 'zh') return status;
  const map: Record<string, string> = {
    将死: 'Checkmate',
    和棋: 'Draw',
    困毙: 'Stalemate',
    白方走子: 'White to move',
    黑方走子: 'Black to move',
    红方走子: 'Red to move',
    白方被将军: 'White in check',
    黑方被将军: 'Black in check',
    红方被将军: 'Red in check',
  };
  return map[status] ?? status;
}

export function translateEngineStatus(language: Language, status: string): string {
  if (language === 'zh') return status;
  const map: Record<string, string> = {
    引擎未连接: 'Engine not connected',
    初始化引擎: 'Initializing engine',
    搜索中: 'Searching',
    '搜索中（单线程分片）': 'Searching (single-thread chunks)',
    停止请求已发送: 'Stop requested',
    已取消初始化: 'Initialization cancelled',
    完成: 'Done',
    网络就绪: 'Network ready',
    'Hash 降级重试': 'Hash lowered, retrying',
    局面已变化: 'Position changed',
    引擎无响应: 'Engine unresponsive',
    电脑已走子: 'Engine moved',
  };
  if (map[status]) return map[status];
  if (status.startsWith('深度 ')) {
    const depth = status.slice(3).replace('（单线程）', ' (single-thread)');
    return `Depth ${depth}`;
  }
  if (status.startsWith('下载网络')) return status.replace('下载网络', 'Downloading network');
  if (status.startsWith('分析失败：')) return `Analysis failed: ${status.slice(5)}`;
  if (status.startsWith('电脑应着失败：')) return `Engine reply failed: ${status.slice(7)}`;
  return status;
}

export function translateNotice(language: Language, notice: string): string {
  if (language === 'zh' || notice.length === 0) return notice;
  const map: Record<string, string> = {
    本地存储写入失败: 'Local storage write failed',
    本地存储读取失败: 'Local storage read failed',
    本地存储不可用: 'Local storage unavailable',
    存档版本不兼容: 'Saved game schema is incompatible',
    存档恢复失败: 'Saved game could not be restored',
    'PGN 已导入': 'PGN imported',
  };
  if (map[notice]) return map[notice];
  const pgnFailure = 'PGN 导入失败：';
  if (notice.startsWith(pgnFailure)) {
    return `PGN import failed: ${notice.slice(pgnFailure.length)}`;
  }
  const fenFailure = 'FEN 应用失败：';
  if (notice.startsWith(fenFailure)) {
    return `FEN apply failed: ${notice.slice(fenFailure.length)}`;
  }
  const addFailure = '加入失败：';
  if (notice.startsWith(addFailure)) {
    return `Add failed: ${notice.slice(addFailure.length)}`;
  }
  const added = /^加入 (\d+) 着$/.exec(notice);
  if (added) return `Added ${added[1]} moves`;
  const analysisFailure = '分析失败：';
  if (notice.startsWith(analysisFailure)) {
    return `Analysis failed: ${notice.slice(analysisFailure.length)}`;
  }
  return notice;
}
