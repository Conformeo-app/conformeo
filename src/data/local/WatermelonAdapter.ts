import { LocalStore } from './LocalStore';
import { OutboxOperation, SyncDelta, UUID } from '../types';

export class WatermelonAdapter implements LocalStore {
  async enqueue(_op: OutboxOperation): Promise<void> {
    throw new Error('Not implemented');
  }

  async dequeue(_limit: number): Promise<OutboxOperation[]> {
    throw new Error('Not implemented');
  }

  async markDone(_ids: UUID[]): Promise<void> {
    throw new Error('Not implemented');
  }

  async applyDeltas(_deltas: SyncDelta[]): Promise<void> {
    throw new Error('Not implemented');
  }

  async getCursor(_entity: string): Promise<string | null> {
    throw new Error('Not implemented');
  }

  async setCursor(_entity: string, _cursor: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
