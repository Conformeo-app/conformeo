import { LocalStore } from '../local/LocalStore';
import { OutboxOperation } from '../types';
import { OUTBOX_MAX_PENDING } from '../../core/config';

export class Outbox {
  constructor(private store: LocalStore) {}

  async push(op: OutboxOperation) {
    await this.store.enqueue(op);
  }

  async nextBatch(limit = 50) {
    return this.store.dequeue(Math.min(limit, OUTBOX_MAX_PENDING));
  }
}
