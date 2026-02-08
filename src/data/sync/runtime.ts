import { offlineDB } from '../offline/outbox';
import { mediaUploadWorker } from '../media/uploadWorker';
import { SyncRunResult } from './types';
import { syncEngine, SyncEngineStatus, SyncTriggerReason } from './sync-engine';

type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export type SyncStatus = {
  phase: SyncPhase;
  queueDepth: number;
  deadLetterCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  lastResult: SyncRunResult | null;
  lastTriggerReason: SyncTriggerReason | null;
};

type SyncListener = (status: SyncStatus) => void;

function mapPhase(state: SyncEngineStatus['state']): SyncPhase {
  if (state === 'SYNCING') return 'syncing';
  if (state === 'OFFLINE') return 'offline';
  if (state === 'ERROR') return 'error';
  return 'idle';
}

class SyncRuntime {
  private status: SyncStatus = {
    phase: 'idle',
    queueDepth: 0,
    deadLetterCount: 0,
    lastSyncedAt: null,
    lastError: null,
    lastResult: null,
    lastTriggerReason: null
  };

  private listeners = new Set<SyncListener>();
  private unsubscribeEngine: (() => void) | null = null;

  subscribe(listener: SyncListener) {
    this.listeners.add(listener);
    listener(this.status);

    return () => {
      this.listeners.delete(listener);
    };
  }

  start() {
    if (this.unsubscribeEngine) {
      return;
    }

    this.unsubscribeEngine = syncEngine.onStatusChange((engineStatus) => {
      this.patchFromEngine(engineStatus);
      void this.refreshQueueDepth();
    });

    syncEngine.start();
    void this.refreshQueueDepth();
  }

  stop() {
    if (!this.unsubscribeEngine) {
      return;
    }

    this.unsubscribeEngine();
    this.unsubscribeEngine = null;
    syncEngine.stop();
  }

  async runOnce() {
    const result = await syncEngine.triggerSync('MANUAL');
    await this.refreshQueueDepth();
    if (result) {
      this.patchStatus({ lastResult: result });
    }
    return result;
  }

  async trigger(reason: SyncTriggerReason) {
    const result = await syncEngine.triggerSync(reason);
    await this.refreshQueueDepth();
    if (result) {
      this.patchStatus({ lastResult: result });
    }
    return result;
  }

  async refreshQueueDepth() {
    const [outboxQueue, mediaQueue, deadLetterCount] = await Promise.all([
      offlineDB.getUnsyncedCount(),
      mediaUploadWorker.getPendingCount(),
      offlineDB.getDeadCount()
    ]);
    const queueDepth = outboxQueue + mediaQueue;

    this.patchStatus({ queueDepth, deadLetterCount });
    return queueDepth;
  }

  getStatus() {
    return this.status;
  }

  private patchFromEngine(engineStatus: SyncEngineStatus) {
    this.patchStatus({
      phase: mapPhase(engineStatus.state),
      queueDepth: engineStatus.pendingOps,
      lastSyncedAt: engineStatus.lastSyncAt ? Date.parse(engineStatus.lastSyncAt) : null,
      lastError: engineStatus.lastError ?? null,
      lastTriggerReason: engineStatus.lastTriggerReason ?? null
    });
  }

  private patchStatus(next: Partial<SyncStatus>) {
    this.status = { ...this.status, ...next };

    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}

export const syncRuntime = new SyncRuntime();
