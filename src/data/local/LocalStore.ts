import { OutboxOperation, SyncDelta, UUID } from '../types';

export interface LocalStore {
  enqueue(op: OutboxOperation): Promise<void>;
  dequeue(limit: number): Promise<OutboxOperation[]>;
  markDone(ids: UUID[]): Promise<void>;
  applyDeltas(deltas: SyncDelta[]): Promise<void>;
  getCursor(entity: string): Promise<string | null>;
  setCursor(entity: string, cursor: string): Promise<void>;
}
