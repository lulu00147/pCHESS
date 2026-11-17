export type Variant = 'chess' | 'xiangqi';
export type Side = 'w' | 'b';
export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface PositionState {
  readonly fen: string;
  readonly history: readonly string[];
}

export interface Move {
  readonly uci: string;
  readonly from: string;
  readonly to: string;
  readonly promotion?: Promotion;
  readonly san?: string;
}

export interface FenIssue {
  readonly code: string;
  readonly message: string;
}

export type RuleErrorCode =
  'invalid-fen' | 'invalid-history' | 'illegal-move' | 'unsupported-variant';

export interface RuleError {
  readonly code: RuleErrorCode;
  readonly message: string;
}
