import {
  XIANGQI_INITIAL_FEN,
  applyXiangqiMove,
  createXiangqiState,
  currentXiangqiFen,
} from '../board/xiangqi/rules';
import { parseXiangqiFen } from '../board/xiangqi/fen';
import { err, ok, type Result } from '../core/result';
import { addMove, createGameTree, mainline, type GameTree, type MoveNode } from './tree';

export interface XiangqiPgnError {
  readonly code: 'invalid-tag' | 'invalid-fen' | 'invalid-move' | 'invalid-token';
  readonly message: string;
}

export interface XiangqiPgnGame {
  readonly headers: Readonly<Record<string, string>>;
  readonly tree: GameTree;
  readonly result: string;
}

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE = /^[a-i][0-9][a-i][0-9]$/;
const TAG = /^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\]/;

function fail(code: XiangqiPgnError['code'], message: string): Result<never, XiangqiPgnError> {
  return err({ code, message });
}

function stripComments(text: string): string {
  return text.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
}

export function parseXiangqiPgn(text: string): Result<XiangqiPgnGame, XiangqiPgnError> {
  const normalized = text.replace(/^\uFEFF/, '');
  if (normalized.length > 2 * 1024 * 1024) {
    return fail('invalid-token', 'PGN exceeds 2 MiB');
  }

  const headers: Record<string, string> = {};
  let rest = stripComments(normalized);
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.startsWith('[')) break;
    const lineEnd = rest.indexOf('\n');
    const line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
    const match = TAG.exec(line);
    if (!match) return fail('invalid-tag', 'malformed tag pair');
    headers[match[1]!] = match[2]!.replace(/\\(["\\])/g, '$1');
    rest = lineEnd < 0 ? '' : rest.slice(lineEnd + 1);
  }

  const rootFen = headers.FEN ?? XIANGQI_INITIAL_FEN;
  const created = createXiangqiState(rootFen);
  if (!created.ok) return fail('invalid-fen', created.error.message);

  let state = created.value;
  let tree = createGameTree(rootFen);
  let result = '*';
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (RESULT.test(token)) {
      result = token;
      continue;
    }
    if (/^\d+\.{1,3}$/.test(token)) continue;
    if (token === '(' || token === ')') {
      return fail('invalid-token', 'variations are not supported in Xiangqi PGN');
    }
    if (!MOVE.test(token)) {
      return fail('invalid-token', `unsupported move token: ${token}`);
    }
    const uci = token.toLowerCase();
    const applied = applyXiangqiMove(state, uci);
    if (!applied.ok) return fail('invalid-move', applied.error.message);
    const added = addMove(tree, tree.cursorId, {
      uci,
      fenAfter: currentXiangqiFen(applied.value),
    });
    tree = added.tree;
    state = applied.value;
  }

  return ok({ headers, tree, result });
}

function escapeHeader(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

export function exportXiangqiPgn(game: XiangqiPgnGame): string {
  const root = parseXiangqiFen(game.tree.rootFen);
  const rootTurn = root.ok ? root.value.turn : 'w';
  const headers: Record<string, string> = {
    Event: game.headers.Event ?? '?',
    Site: game.headers.Site ?? '?',
    Date: game.headers.Date ?? '????.??.??',
    Round: game.headers.Round ?? '?',
    White: game.headers.White ?? '?',
    Black: game.headers.Black ?? '?',
    Result: game.result,
    Variant: 'Xiangqi',
  };
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'Variant'];
  const lines = order.map((key) => `[${key} "${escapeHeader(headers[key] ?? '')}"]`);
  if (game.tree.rootFen !== XIANGQI_INITIAL_FEN) {
    lines.push('[SetUp "1"]', `[FEN "${escapeHeader(game.tree.rootFen)}"]`);
  }

  const tokens: string[] = [];
  const emitMove = (node: MoveNode): void => {
    const moveNumber = Math.ceil(node.ply / 2);
    if (rootTurn === 'w') {
      if (node.ply % 2 === 1) tokens.push(`${moveNumber}.`);
    } else if (node.ply % 2 === 0) {
      tokens.push(`${node.ply / 2 + 1}.`);
    } else {
      tokens.push(`${moveNumber}...`);
    }
    tokens.push(node.uci);
  };

  for (const node of mainline(game.tree)) emitMove(node);
  tokens.push(game.result);
  lines.push('');
  lines.push(tokens.join(' '));
  lines.push('');
  return lines.join('\n');
}
