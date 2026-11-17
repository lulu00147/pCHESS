export type BoardThemeId = 'wood' | 'green' | 'blue' | 'contrast';
export type ChessPieceSetId = 'staunton' | 'duotone' | 'flat' | 'bold';
export type XiangqiPieceSetId = 'disc' | 'flat' | 'stamp' | 'bold';
export type PieceSetId = ChessPieceSetId | XiangqiPieceSetId;

export interface Appearance {
  readonly boardTheme: BoardThemeId;
  readonly chessPieceSet: ChessPieceSetId;
  readonly xiangqiPieceSet: XiangqiPieceSetId;
}

export const DEFAULT_APPEARANCE: Appearance = {
  boardTheme: 'wood',
  chessPieceSet: 'staunton',
  xiangqiPieceSet: 'disc',
};
