import { CHESS_INITIAL_FEN, replayChess } from '../board/chess/rules';
import { err, ok, type Result } from '../core/result';
import {
  ROOT_ID,
  addMove,
  createGameTree,
  moveCursor,
  nodeById,
  type GameTree,
  type MoveNode,
} from './tree';

export interface PgnError {
  readonly code:
    | 'invalid-tag'
    | 'invalid-token'
    | 'unterminated-comment'
    | 'unexpected-token'
    | 'invalid-san'
    | 'invalid-fen'
    | 'missing-parent';
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface PgnGame {
  readonly headers: Readonly<Record<string, string>>;
  readonly tree: GameTree;
  readonly result: string;
}

type Token =
  | {
      readonly kind: 'move';
      readonly value: string;
      readonly line: number;
      readonly column: number;
    }
  | {
      readonly kind: 'comment';
      readonly value: string;
      readonly line: number;
      readonly column: number;
    }
  | { readonly kind: 'nag'; readonly value: number; readonly line: number; readonly column: number }
  | { readonly kind: 'open'; readonly line: number; readonly column: number }
  | { readonly kind: 'close'; readonly line: number; readonly column: number }
  | { readonly kind: 'eof'; readonly line: number; readonly column: number }
  | {
      readonly kind: 'result';
      readonly value: string;
      readonly line: number;
      readonly column: number;
    };

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

function lineMap(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function locate(starts: readonly number[], position: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! <= position) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: position - starts[low]! + 1 };
}

function parseTags(
  text: string,
): Result<{ headers: Record<string, string>; start: number }, PgnError> {
  const headers: Record<string, string> = {};
  const starts = lineMap(text);
  let position = 0;

  const skipSpace = (): void => {
    while (position < text.length && /\s/.test(text[position]!)) position += 1;
  };

  skipSpace();
  while (position < text.length && text[position] === '[') {
    const match = /^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\]/.exec(text.slice(position));
    if (!match) {
      const at = locate(starts, position);
      return err({
        code: 'invalid-tag',
        message: 'malformed tag pair',
        ...at,
      });
    }
    const key = match[1]!;
    if (headers[key] !== undefined) {
      const at = locate(starts, position);
      return err({
        code: 'invalid-tag',
        message: `duplicate tag: ${key}`,
        ...at,
      });
    }
    headers[key] = match[2]!.replace(/\\(["\\])/g, '$1');
    position += match[0].length;
    skipSpace();
  }

  return ok({ headers, start: position });
}

function lex(text: string, start: number): Result<Token[], PgnError> {
  const tokens: Token[] = [];
  const starts = lineMap(text);
  let position = start;

  const fail = (code: PgnError['code'], message: string, at: number): Result<never, PgnError> => {
    const location = locate(starts, at);
    return err({ code, message, ...location });
  };

  const isDelimiter = (char: string): boolean => /[\s{}();$]/.test(char);

  while (position < text.length) {
    const char = text[position]!;
    const location = locate(starts, position);

    if (/\s/.test(char)) {
      position += 1;
      continue;
    }
    if (char === '{') {
      const end = text.indexOf('}', position + 1);
      if (end < 0) return fail('unterminated-comment', 'unterminated comment', position);
      const body = text.slice(position + 1, end);
      if (body.includes('{'))
        return fail('invalid-token', 'nested comments are unsupported', position);
      tokens.push({ kind: 'comment', value: body.trim(), ...location });
      position = end + 1;
      continue;
    }
    if (char === ';') {
      const end = text.indexOf('\n', position);
      position = end < 0 ? text.length : end + 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'open' : 'close', ...location });
      position += 1;
      continue;
    }
    if (char === '$') {
      const match = /^\$(\d+)/.exec(text.slice(position));
      if (!match) return fail('invalid-token', 'invalid NAG', position);
      tokens.push({ kind: 'nag', value: Number(match[1]), ...location });
      position += match[0].length;
      continue;
    }
    if (char === '}') return fail('invalid-token', 'unexpected }', position);

    const result = /^(1-0|0-1|1\/2-1\/2|\*)/.exec(text.slice(position));
    if (
      result &&
      (position + result[0].length >= text.length ||
        isDelimiter(text[position + result[0].length]!))
    ) {
      tokens.push({ kind: 'result', value: result[0], ...location });
      position += result[0].length;
      continue;
    }

    if (text.startsWith('...', position)) {
      position += 3;
      continue;
    }

    if (/\d/.test(char)) {
      const number = /^\d+\.(?:\.\.)?/.exec(text.slice(position));
      if (number) {
        position += number[0].length;
        continue;
      }
    }

    let end = position;
    while (end < text.length && !isDelimiter(text[end]!)) end += 1;
    let raw = text.slice(position, end);
    if (!raw) return fail('invalid-token', `unexpected token: ${char}`, position);
    position = end;

    const suffix = /(!!|\?\?|!\?|\?!|!|\?)$/.exec(raw);
    if (suffix) {
      raw = raw.slice(0, -suffix[0].length);
      const nags: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
      tokens.push({ kind: 'move', value: raw, ...location });
      tokens.push({ kind: 'nag', value: nags[suffix[0]]!, ...location });
    } else {
      tokens.push({ kind: 'move', value: raw, ...location });
    }
  }

  tokens.push({ kind: 'eof', ...locate(starts, text.length) });
  return ok(tokens);
}

function attach(
  tree: GameTree,
  nodeId: string,
  patch: { readonly comment?: string; readonly nag?: number },
): GameTree {
  const node = nodeById(tree, nodeId);
  const comment = patch.comment
    ? node.comment
      ? `${node.comment} ${patch.comment}`
      : patch.comment
    : node.comment;
  const nags = patch.nag === undefined ? node.nags : [...(node.nags ?? []), patch.nag];
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [nodeId]: {
        ...node,
        ...(comment === undefined ? {} : { comment }),
        ...(nags === undefined ? {} : { nags }),
      },
    },
  };
}

interface ParseResult {
  readonly lastNodeId: string | null;
}

export function parsePgn(text: string): Result<PgnGame, PgnError> {
  const normalized = text.replace(/^\uFEFF/, '');
  if (normalized.length > 2 * 1024 * 1024) {
    return err({ code: 'invalid-token', message: 'PGN exceeds 2 MiB', line: 1, column: 1 });
  }

  const tagged = parseTags(normalized);
  if (!tagged.ok) return tagged;
  const rootFen = tagged.value.headers.FEN ?? CHESS_INITIAL_FEN;
  if (tagged.value.headers.SetUp !== undefined && tagged.value.headers.SetUp !== '1') {
    return err({
      code: 'invalid-fen',
      message: 'SetUp must be "1" when FEN is present',
      line: 1,
      column: 1,
    });
  }
  const replayed = replayChess({ fen: rootFen, history: [] });
  if (!replayed.ok) {
    return err({ code: 'invalid-fen', message: replayed.error.message, line: 1, column: 1 });
  }

  const lexed = lex(normalized, tagged.value.start);
  if (!lexed.ok) return lexed;
  const tokens = lexed.value;
  let tree = createGameTree(rootFen);
  let index = 0;
  let result = '*';
  let resultSeen = false;

  const parseSequence = (parentId: string, inVariation: boolean): Result<ParseResult, PgnError> => {
    let currentParent = parentId;
    let lastNodeId: string | null = null;
    let lastParentId: string | null = null;

    while (true) {
      const token = tokens[index]!;
      if (token.kind === 'eof') {
        if (inVariation) {
          return err({
            code: 'unexpected-token',
            message: 'unclosed variation',
            line: token.line,
            column: token.column,
          });
        }
        return ok({ lastNodeId });
      }
      if (token.kind === 'close') {
        if (!inVariation) {
          return err({
            code: 'unexpected-token',
            message: 'unexpected )',
            line: token.line,
            column: token.column,
          });
        }
        index += 1;
        return ok({ lastNodeId });
      }
      if (token.kind === 'result') {
        if (inVariation) {
          return err({
            code: 'unexpected-token',
            message: 'result inside variation',
            line: token.line,
            column: token.column,
          });
        }
        result = token.value;
        resultSeen = true;
        index += 1;
        return ok({ lastNodeId });
      }
      if (token.kind === 'open') {
        if (!lastParentId) {
          return err({
            code: 'unexpected-token',
            message: 'variation has no preceding move',
            line: token.line,
            column: token.column,
          });
        }
        index += 1;
        const nested = parseSequence(lastParentId, true);
        if (!nested.ok) return nested;
        continue;
      }
      if (token.kind === 'comment' || token.kind === 'nag') {
        if (!lastNodeId) {
          return err({
            code: 'unexpected-token',
            message: `${token.kind} has no preceding move`,
            line: token.line,
            column: token.column,
          });
        }
        tree =
          token.kind === 'comment'
            ? attach(tree, lastNodeId, { comment: token.value })
            : attach(tree, lastNodeId, { nag: token.value });
        index += 1;
        continue;
      }

      const parent = tree.nodes[currentParent];
      if (!parent) {
        return err({
          code: 'missing-parent',
          message: `missing parent: ${currentParent}`,
          line: token.line,
          column: token.column,
        });
      }
      const chess = replayChess({ fen: parent.fenAfter, history: [] });
      if (!chess.ok) {
        return err({
          code: 'invalid-fen',
          message: chess.error.message,
          line: token.line,
          column: token.column,
        });
      }
      const move = (() => {
        try {
          return chess.value.move(token.value);
        } catch {
          return null;
        }
      })();
      if (!move) {
        return err({
          code: 'invalid-san',
          message: `illegal SAN: ${token.value}`,
          line: token.line,
          column: token.column,
        });
      }
      const added = addMove(tree, currentParent, {
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        san: move.san,
        fenAfter: chess.value.fen(),
      });
      tree = added.tree;
      lastParentId = currentParent;
      lastNodeId = added.nodeId;
      currentParent = added.nodeId;
      index += 1;
    }
  };

  const parsed = parseSequence(ROOT_ID, false);
  if (!parsed.ok) return parsed;
  const trailing = tokens[index];
  if (resultSeen && trailing && trailing.kind !== 'eof') {
    return err({
      code: 'unexpected-token',
      message: 'tokens after result',
      line: trailing.line,
      column: trailing.column,
    });
  }

  const headerResult = tagged.value.headers.Result;
  if (!resultSeen && headerResult) {
    if (!RESULTS.has(headerResult)) {
      return err({
        code: 'invalid-token',
        message: `invalid Result: ${headerResult}`,
        line: 1,
        column: 1,
      });
    }
    result = headerResult;
  }

  const headers = { ...tagged.value.headers, Result: result };
  const cursorId = parsed.value.lastNodeId ?? ROOT_ID;
  return ok({ headers, tree: moveCursor(tree, cursorId), result });
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function exportPgn(game: PgnGame): string {
  const defaults: Record<string, string> = {
    Event: '?',
    Site: '?',
    Date: '????.??.??',
    Round: '?',
    White: '?',
    Black: '?',
    Result: game.result,
  };
  const headerKeys = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const lines: string[] = [];
  for (const key of headerKeys) {
    const value = key === 'Result' ? game.result : (game.headers[key] ?? defaults[key]!);
    lines.push(`[${key} "${escapeHeader(value)}"]`);
  }
  if (game.tree.rootFen !== CHESS_INITIAL_FEN) {
    lines.push('[SetUp "1"]', `[FEN "${escapeHeader(game.tree.rootFen)}"]`);
  }

  const tokens: string[] = [];
  const nodes = game.tree.nodes;

  const emitMove = (node: MoveNode, forceNumber: boolean): void => {
    if (node.ply % 2 === 1) tokens.push(`${Math.ceil(node.ply / 2)}.`);
    else if (forceNumber) tokens.push(`${node.ply / 2}...`);
    tokens.push(node.san ?? node.uci);
    if (node.comment) tokens.push(`{${node.comment}}`);
    for (const nag of node.nags ?? []) tokens.push(`$${nag}`);
  };

  const emitFrom = (parentId: string, forceFirst: boolean): void => {
    const parent = nodes[parentId];
    const mainId = parent?.children[0];
    if (!parent || !mainId) return;
    const main = nodes[mainId];
    if (!main) return;
    emitMove(main, forceFirst);
    for (const altId of parent.children.slice(1)) {
      const alt = nodes[altId];
      if (!alt) continue;
      tokens.push('(');
      emitMove(alt, true);
      emitFrom(alt.id, false);
      tokens.push(')');
    }
    emitFrom(main.id, false);
  };

  emitFrom(ROOT_ID, false);
  tokens.push(game.result);

  lines.push('');
  let line = '';
  const compact = (value: string): string => value.replace(/\( /g, '(').replace(/ \)/g, ')');
  for (const token of tokens) {
    if (line.length > 0 && line.length + token.length + 1 > 80) {
      lines.push(compact(line));
      line = token;
    } else {
      line = line.length === 0 ? token : `${line} ${token}`;
    }
  }
  if (line) lines.push(compact(line));
  lines.push('');
  return lines.join('\n');
}
