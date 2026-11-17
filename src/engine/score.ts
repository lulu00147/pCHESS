import type { Side } from '../board/types';
import type { UciScore } from './uci';

export function perspectiveScore(score: UciScore, turn: Side, perspective: Side): UciScore {
  const sign = turn === perspective ? 1 : -1;
  return {
    ...score,
    value: score.value * sign,
  };
}

export function formatScore(score: UciScore, turn: Side, perspective: Side): string {
  const adjusted = perspectiveScore(score, turn, perspective);
  const bound = adjusted.bound === 'lower' ? '≥' : adjusted.bound === 'upper' ? '≤' : '';

  if (adjusted.type === 'mate') {
    if (adjusted.value === 0) return `${bound}#`;
    return `${bound}#${adjusted.value > 0 ? '' : '-'}${Math.abs(adjusted.value)}`;
  }

  const pawns = adjusted.value / 100;
  return `${bound}${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function scoreOrder(score: UciScore | undefined): [number, number] {
  if (!score) return [2, 0];
  if (score.type === 'mate') return [0, Math.abs(score.value)];
  return [1, score.value];
}

export function compareScores(a: UciScore | undefined, b: UciScore | undefined): number {
  const [aType, aValue] = scoreOrder(a);
  const [bType, bValue] = scoreOrder(b);
  if (aType !== bType) return aType - bType;
  if (aType === 0) {
    return aValue - bValue || (b?.value ?? 0) - (a?.value ?? 0);
  }
  if (aType === 1) return bValue - aValue;
  return 0;
}

export function evaluationProbability(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + 10 ** (-clamped / 400));
}

export function evaluationRatio(score: UciScore, turn: Side): number {
  if (score.type === 'mate') {
    const value = turn === 'w' ? score.value : -score.value;
    return value > 0 ? 1 : value < 0 ? 0 : 0.5;
  }
  return evaluationProbability(turn === 'w' ? score.value : -score.value);
}
