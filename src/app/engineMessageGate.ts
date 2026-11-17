export interface EngineMessageGate<T> {
  readonly client: T;
  readonly currentClient: T;
  readonly running: boolean;
  readonly type: string;
  readonly searchId?: number | null;
  readonly messageSearchId?: number | null;
}

export function acceptEngineMessage<T>(gate: EngineMessageGate<T>): boolean {
  if (gate.client !== gate.currentClient) return false;
  if (
    gate.searchId !== null &&
    gate.searchId !== undefined &&
    gate.messageSearchId !== null &&
    gate.messageSearchId !== undefined &&
    gate.searchId !== gate.messageSearchId
  ) {
    return false;
  }
  return gate.running || gate.type === 'error';
}
