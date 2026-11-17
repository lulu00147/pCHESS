export interface UciScore {
  readonly type: 'cp' | 'mate';
  readonly value: number;
  readonly bound?: 'lower' | 'upper';
}

export interface ParsedInfo {
  readonly depth?: number;
  readonly seldepth?: number;
  readonly multipv: number;
  readonly score?: UciScore;
  readonly wdl?: readonly [number, number, number];
  readonly nodes?: number;
  readonly nps?: number;
  readonly hashfull?: number;
  readonly timeMs?: number;
  readonly tbhits?: number;
  readonly pv: readonly string[];
  readonly raw: string;
}

export type UciOptionType = 'string' | 'spin' | 'check' | 'button' | 'combo';

export interface UciOption {
  readonly name: string;
  readonly type: UciOptionType;
  readonly default?: string;
  readonly min?: number;
  readonly max?: number;
  readonly vars?: readonly string[];
}

export type UciEvent =
  | { readonly kind: 'id'; readonly name?: string; readonly author?: string; readonly raw: string }
  | { readonly kind: 'option'; readonly option: UciOption; readonly raw: string }
  | { readonly kind: 'uciok' | 'readyok'; readonly raw: string }
  | { readonly kind: 'info'; readonly info: ParsedInfo; readonly raw: string }
  | { readonly kind: 'string'; readonly value: string; readonly raw: string }
  | {
      readonly kind: 'bestmove';
      readonly bestMove: string | null;
      readonly ponder?: string;
      readonly raw: string;
    }
  | { readonly kind: 'unknown'; readonly raw: string };

function integer(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBound(value: string | undefined): UciScore['bound'] | undefined {
  if (value === 'lowerbound') return 'lower';
  if (value === 'upperbound') return 'upper';
  return undefined;
}

function parseInfo(line: string): ParsedInfo {
  const tokens = line.trim().split(/\s+/);
  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let score: UciScore | undefined;
  let wdl: [number, number, number] | undefined;
  let nodes: number | undefined;
  let nps: number | undefined;
  let hashfull: number | undefined;
  let timeMs: number | undefined;
  let tbhits: number | undefined;
  let pv: string[] = [];

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    switch (token) {
      case 'depth':
        depth = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'seldepth':
        seldepth = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'multipv':
        multipv = integer(tokens[index + 1]) ?? 1;
        index += 2;
        break;
      case 'score': {
        const type = tokens[index + 1];
        const value = integer(tokens[index + 2]);
        if ((type === 'cp' || type === 'mate') && value !== undefined) {
          score = {
            type,
            value,
            ...(parseBound(tokens[index + 3]) ? { bound: parseBound(tokens[index + 3]) } : {}),
          };
          index += parseBound(tokens[index + 3]) ? 4 : 3;
        } else {
          index += 2;
        }
        break;
      }
      case 'wdl': {
        const w = integer(tokens[index + 1]);
        const d = integer(tokens[index + 2]);
        const l = integer(tokens[index + 3]);
        if (w !== undefined && d !== undefined && l !== undefined) wdl = [w, d, l];
        index += 4;
        break;
      }
      case 'nodes':
        nodes = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'nps':
        nps = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'hashfull':
        hashfull = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'time':
        timeMs = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'tbhits':
        tbhits = integer(tokens[index + 1]);
        index += 2;
        break;
      case 'pv':
        pv = tokens.slice(index + 1);
        index = tokens.length;
        break;
      default:
        index += 1;
    }
  }

  return {
    multipv,
    pv,
    raw: line,
    ...(depth === undefined ? {} : { depth }),
    ...(seldepth === undefined ? {} : { seldepth }),
    ...(score === undefined ? {} : { score }),
    ...(wdl === undefined ? {} : { wdl }),
    ...(nodes === undefined ? {} : { nodes }),
    ...(nps === undefined ? {} : { nps }),
    ...(hashfull === undefined ? {} : { hashfull }),
    ...(timeMs === undefined ? {} : { timeMs }),
    ...(tbhits === undefined ? {} : { tbhits }),
  };
}

function parseOption(line: string): UciOption | null {
  const match = /^option name (.+?) type (string|spin|check|button|combo)(?:\s+(.*))?$/.exec(line);
  if (!match) return null;
  const name = match[1]!;
  const type = match[2] as UciOptionType;
  const tail = match[3]?.trim() ?? '';
  const tokens = tail.length > 0 ? tail.split(/\s+/) : [];
  let defaultValue: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  const vars: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    if (tokens[index] === 'default') {
      const values: string[] = [];
      index += 1;
      while (index < tokens.length && !['min', 'max', 'var'].includes(tokens[index]!)) {
        values.push(tokens[index]!);
        index += 1;
      }
      defaultValue = values.join(' ');
    } else if (tokens[index] === 'min') {
      min = integer(tokens[index + 1]);
      index += 2;
    } else if (tokens[index] === 'max') {
      max = integer(tokens[index + 1]);
      index += 2;
    } else if (tokens[index] === 'var') {
      if (tokens[index + 1] !== undefined) vars.push(tokens[index + 1]!);
      index += 2;
    } else {
      index += 1;
    }
  }

  return {
    name,
    type,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(vars.length === 0 ? {} : { vars }),
  };
}

export function parseUciLine(rawLine: string): UciEvent | null {
  const line = rawLine.replace(/\r$/, '').trimEnd();
  if (line.trim().length === 0) return null;

  if (line === 'uciok') return { kind: 'uciok', raw: line };
  if (line === 'readyok') return { kind: 'readyok', raw: line };

  if (line.startsWith('id name ')) {
    return { kind: 'id', name: line.slice('id name '.length), raw: line };
  }
  if (line.startsWith('id author ')) {
    return { kind: 'id', author: line.slice('id author '.length), raw: line };
  }
  if (line.startsWith('option ')) {
    const option = parseOption(line);
    return option ? { kind: 'option', option, raw: line } : { kind: 'unknown', raw: line };
  }
  if (line.startsWith('info string')) {
    return { kind: 'string', value: line.slice('info string'.length).trim(), raw: line };
  }
  if (line.startsWith('info ')) {
    return { kind: 'info', info: parseInfo(line), raw: line };
  }
  if (line.startsWith('bestmove')) {
    const match = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line);
    if (!match) return { kind: 'unknown', raw: line };
    return {
      kind: 'bestmove',
      bestMove: match[1] === '(none)' ? null : match[1]!,
      ...(match[2] === undefined ? {} : { ponder: match[2] }),
      raw: line,
    };
  }

  return { kind: 'unknown', raw: line };
}
