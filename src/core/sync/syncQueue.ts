import type { QueueReadOptions, SyncOperation, SyncQueuePort } from './types';
import { createSyncId, nowIso } from './utils';

export class SyncQueue implements SyncQueuePort {
  private readonly operations = new Map<string, SyncOperation>();

  async enqueue(operation: Omit<SyncOperation, 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>): Promise<SyncOperation> {
    const timestamp = nowIso();
    const row: SyncOperation = {
      ...operation,
      id: operation.id || createSyncId('syncop'),
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
      retryCount: 0
    };

    this.operations.set(row.id, row);
    return row;
  }

  async nextBatch(options: QueueReadOptions): Promise<SyncOperation[]> {
    const limit = Math.max(1, options.limit);
    const batch: SyncOperation[] = [];

    for (const op of this.operations.values()) {
      if (op.status !== 'PENDING') {
        continue;
      }

      batch.push({ ...op, payload: { ...op.payload } });
      if (batch.length >= limit) {
        break;
      }
    }

    return batch;
  }

  async markDone(operationId: string): Promise<void> {
    const op = this.operations.get(operationId);
    if (!op) return;

    this.operations.set(operationId, {
      ...op,
      status: 'DONE',
      updatedAt: nowIso(),
      lastError: undefined
    });
  }

  async markFailed(operationId: string, reason: string): Promise<void> {
    const op = this.operations.get(operationId);
    if (!op) return;

    this.operations.set(operationId, {
      ...op,
      status: 'FAILED',
      updatedAt: nowIso(),
      retryCount: op.retryCount + 1,
      lastError: reason
    });
  }

  async markConflict(operationId: string): Promise<void> {
    const op = this.operations.get(operationId);
    if (!op) return;

    this.operations.set(operationId, {
      ...op,
      status: 'CONFLICT',
      updatedAt: nowIso()
    });
  }

  async countPending(): Promise<number> {
    let count = 0;
    for (const op of this.operations.values()) {
      if (op.status === 'PENDING') {
        count += 1;
      }
    }
    return count;
  }
}

// TODO(CFM-1): remplacer le stockage en mémoire par une queue persistante locale (SQLite/outbox).
