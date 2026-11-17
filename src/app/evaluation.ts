import type { BoardVariant } from '../board/geometry';
import { evaluationRatio, formatScore } from '../engine/score';
import type { ParsedInfo } from '../engine/uci';
import type { GameOutcome } from './session';

export interface EvaluationCache {
  readonly variant: BoardVariant;
  readonly fen: string;
  readonly ratio: number;
  readonly score: string;
}

export interface EvaluationResult {
  readonly cache: EvaluationCache | null;
  readonly ratio: number;
  readonly score: string;
  readonly pending: boolean;
}

export interface EvaluationInput {
  readonly cache: EvaluationCache | null;
  readonly variant: BoardVariant;
  readonly fen: string;
  readonly turn: 'w' | 'b';
  readonly line: ParsedInfo | undefined;
  readonly outcome: GameOutcome;
  readonly running: boolean;
  readonly replyPending: boolean;
}

export function resolveEvaluation(input: EvaluationInput): EvaluationResult {
  if (input.outcome === 'checkmate' || input.outcome === 'stalemate') {
    const ratio = input.turn === 'w' ? 0 : 1;
    return { cache: input.cache, ratio, score: '#', pending: false };
  }
  if (input.outcome === 'draw') {
    return { cache: input.cache, ratio: 0.5, score: '½', pending: false };
  }

  let cache = input.cache;
  if (input.line?.score) {
    cache = {
      variant: input.variant,
      fen: input.fen,
      ratio: evaluationRatio(input.line.score, input.turn),
      score: formatScore(input.line.score, input.turn, 'w'),
    };
  }

  const current = cache?.fen === input.fen ? cache : null;
  const held =
    current ??
    ((input.running || input.replyPending) && cache?.variant === input.variant ? cache : null);
  return {
    cache,
    ratio: held?.ratio ?? 0.5,
    score: held?.score ?? '—',
    pending: held === null,
  };
}
