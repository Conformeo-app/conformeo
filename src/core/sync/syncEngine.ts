import type {
  ConflictResolverPort,
  NetworkWatcherPort,
  SyncEngineState,
  SyncOperation,
  SyncQueuePort,
  SyncTickResult
} from './types';
import { isRetriableError, nowIso } from './utils';

export class SyncEngine {
  private running = false;

  private lastRunAt: string | undefined;

  constructor(
    private readonly queue: SyncQueuePort,
    private readonly network: NetworkWatcherPort,
    private readonly resolver: ConflictResolverPort
  ) {}

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async getState(): Promise<SyncEngineState> {
    const pendingCount = await this.queue.countPending();
    return {
      phase: this.running ? 'RUNNING' : 'STOPPED',
      lastRunAt: this.lastRunAt,
      pendingCount,
      network: this.network.getStatus()
    };
  }

  async tick(limit = 20): Promise<SyncTickResult> {
    if (!this.running) {
      return { processed: 0, failed: 0, conflicts: 0 };
    }

    if (!this.network.getStatus().isOnline) {
      return { processed: 0, failed: 0, conflicts: 0 };
    }

    const batch = await this.queue.nextBatch({ limit });
    let processed = 0;
    let failed = 0;
    let conflicts = 0;

    for (const operation of batch) {
      const result = await this.applyOperation(operation);
      processed += result.processed;
      failed += result.failed;
      conflicts += result.conflicts;
    }

    this.lastRunAt = nowIso();
    return { processed, failed, conflicts };
  }

  private async applyOperation(operation: SyncOperation): Promise<SyncTickResult> {
    try {
      // TODO(CFM-1): brancher le transport réseau vers backend sync (RPC/Edge function).
      // Placeholder: on marque en DONE pour valider le pipeline technique.
      await this.queue.markDone(operation.id);
      return { processed: 1, failed: 0, conflicts: 0 };
    } catch (error) {
      if (!isRetriableError(error)) {
        await this.queue.markConflict(operation.id);
        await this.resolver.resolve({
          id: operation.id,
          orgId: operation.orgId,
          entity: operation.entity,
          entityId: operation.entityId,
          policy: 'MANUAL',
          localPayload: operation.payload,
          remotePayload: {},
          createdAt: nowIso()
        });

        return { processed: 0, failed: 0, conflicts: 1 };
      }

      const reason = error instanceof Error ? error.message : 'Erreur inconnue';
      await this.queue.markFailed(operation.id, reason);
      return { processed: 0, failed: 1, conflicts: 0 };
    }
  }
}
