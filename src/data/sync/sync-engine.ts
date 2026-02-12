import * as Network from 'expo-network';
import { securityPolicies } from '../../core/security/policies';
import { offlineDB, OfflineOperation } from '../offline/outbox';
import { mediaUploadWorker } from '../media/uploadWorker';
import { createSyncTransport } from './transport';
import { ApplyOperationResponse, SyncRunResult, SyncTransport } from './types';
import { conflicts } from './conflicts';

const BATCH_SIZE = 50;
const MAX_OPS_PER_CYCLE = 500;
const TIMER_INTERVAL_MS = 10 * 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 8;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

type SyncTriggerReason = 'NETWORK_RESTORED' | 'MANUAL' | 'APP_START' | 'TIMER';
type SyncEngineState = 'IDLE' | 'SYNCING' | 'OFFLINE' | 'ERROR';

export type SyncEngineStatus = {
  state: SyncEngineState;
  pendingOps: number;
  lastSyncAt?: string;
  lastError?: string;
  lastTriggerReason?: SyncTriggerReason;
};

type SyncEngineListener = (status: SyncEngineStatus) => void;

function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Unknown sync error';
}

function isLikelyOfflineError(message: string) {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('network') ||
    lowered.includes('offline') ||
    lowered.includes('timed out') ||
    lowered.includes('failed to fetch')
  );
}

function ensurePayloadObject(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  return {};
}

function valueAsString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function valueAsNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function resolveOrgIdFromPayload(payload: Record<string, unknown>) {
  return valueAsString(payload.org_id) ?? valueAsString(payload.orgId);
}

function resolveActorIdFromPayload(payload: Record<string, unknown>) {
  return (
    valueAsString(payload.user_id) ??
    valueAsString(payload.userId) ??
    valueAsString(payload.created_by) ??
    valueAsString(payload.updated_by)
  );
}

function resolveLocalVersion(payload: Record<string, unknown>) {
  return (
    valueAsNumber(payload.local_version) ??
    valueAsNumber(payload.localVersion) ??
    valueAsNumber(payload.version)
  );
}

function isConflictReason(reason: string) {
  const lowered = reason.toLowerCase();
  return (
    lowered.includes('conflict') ||
    lowered.includes('version') ||
    lowered.includes('stale') ||
    lowered.includes('precondition') ||
    lowered.includes('concurrent') ||
    lowered.includes('already modified')
  );
}

class SyncEngine {
  private status: SyncEngineStatus = {
    state: 'IDLE',
    pendingOps: 0
  };

  private listeners = new Set<SyncEngineListener>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private networkSubscription: { remove: () => void } | null = null;
  private transport: SyncTransport = createSyncTransport();

  private started = false;
  private isSyncing = false;
  private isOnline = false;

  private consecutiveFailures = 0;
  private circuitOpenUntil: number | null = null;

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.transport = createSyncTransport();

    this.networkSubscription = Network.addNetworkStateListener((state) => {
      const nextOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
      const restored = !this.isOnline && nextOnline;

      this.isOnline = nextOnline;

      if (!this.isOnline) {
        this.patchStatus({ state: 'OFFLINE', lastError: 'Aucun reseau detecte' });
        return;
      }

      if (this.status.state === 'OFFLINE') {
        this.patchStatus({ state: 'IDLE', lastError: undefined });
      }

      if (restored) {
        void this.triggerSync('NETWORK_RESTORED');
      }
    });

    this.intervalId = setInterval(() => {
      void this.triggerSync('TIMER');
    }, TIMER_INTERVAL_MS);

    void this.initialize();
  }

  stop() {
    this.started = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.networkSubscription) {
      this.networkSubscription.remove();
      this.networkSubscription = null;
    }
  }

  async triggerSync(reason: SyncTriggerReason = 'MANUAL') {
    await this.refreshPendingOps();

    if (!this.isOnline) {
      this.patchStatus({
        state: 'OFFLINE',
        lastError: 'Aucun reseau detecte',
        lastTriggerReason: reason
      });
      return null;
    }

    const now = Date.now();
    if (this.circuitOpenUntil && now < this.circuitOpenUntil) {
      const reopenAt = new Date(this.circuitOpenUntil).toISOString();
      this.patchStatus({
        state: 'ERROR',
        lastError: `Circuit breaker actif jusqu'a ${reopenAt}`,
        lastTriggerReason: reason
      });
      return null;
    }

    if (this.isSyncing) {
      return null;
    }

    this.isSyncing = true;
    this.patchStatus({ state: 'SYNCING', lastError: undefined, lastTriggerReason: reason });

    try {
      const result = await this.pushOutbox();

      if (result.failed === 0 && result.dead === 0) {
        this.consecutiveFailures = 0;
      }

      this.patchStatus({
        state: this.isOnline ? 'IDLE' : 'OFFLINE',
        pendingOps: result.remaining,
        lastSyncAt: nowIso(),
        lastError:
          result.failed > 0 || result.dead > 0
            ? `${result.failed} operation(s) en retry, ${result.dead} en echec terminal`
            : undefined
      });

      if (__DEV__) {
        console.info('[sync-engine] cycle ok', { reason, ...result });
      }

      return result;
    } catch (error) {
      const message = toErrorMessage(error);
      this.consecutiveFailures += 1;

      if (isLikelyOfflineError(message)) {
        this.isOnline = false;
        this.patchStatus({ state: 'OFFLINE', lastError: message });
      } else {
        this.patchStatus({ state: 'ERROR', lastError: message });
      }

      this.applyCircuitBreaker(message);

      if (__DEV__) {
        console.warn('[sync-engine] cycle error', { reason, error: message });
      }

      await this.refreshPendingOps();
      return null;
    } finally {
      this.isSyncing = false;
    }
  }

  getStatus(): SyncEngineStatus {
    return this.status;
  }

  onStatusChange(listener: SyncEngineListener) {
    this.listeners.add(listener);
    listener(this.status);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async pushOutbox(): Promise<SyncRunResult> {
    let pushed = 0;
    let failed = 0;
    let dead = 0;
    let processed = 0;
    let shouldStopCycle = false;

    while (processed < MAX_OPS_PER_CYCLE && !shouldStopCycle) {
      const batchSize = Math.min(BATCH_SIZE, MAX_OPS_PER_CYCLE - processed);
      const batch = await offlineDB.flushOutbox(batchSize, Date.now());

      if (batch.length === 0) {
        break;
      }

      for (const operation of batch) {
        const outcome = await this.applyOperation(operation);
        processed += 1;

        if (outcome === 'PUSHED') {
          pushed += 1;
        } else if (outcome === 'FAILED') {
          failed += 1;
          // Fail-fast on transient failures to avoid a long "syncing" lock.
          shouldStopCycle = true;
          break;
        } else {
          dead += 1;
        }

        if (processed >= MAX_OPS_PER_CYCLE) {
          break;
        }
      }

      if (batch.length < batchSize) {
        break;
      }
    }

    const mediaResult = await mediaUploadWorker.runPendingUploads(12);
    pushed += mediaResult.uploaded;
    failed += mediaResult.failed;

    if (mediaResult.failed > 0) {
      this.consecutiveFailures += mediaResult.failed;
      this.applyCircuitBreaker('media upload failures');
    }

    const [remainingOutbox, remainingMedia] = await Promise.all([
      offlineDB.getUnsyncedCount(),
      mediaUploadWorker.getPendingCount()
    ]);

    return { pushed, failed, dead, remaining: remainingOutbox + remainingMedia };
  }

  async applyOperation(operation: OfflineOperation): Promise<'PUSHED' | 'FAILED' | 'DEAD'> {
    try {
      const response = await this.transport.pushOperation(operation);

      if (response.status === 'OK' || response.status === 'DUPLICATE') {
        await this.markSynced(operation.id);
        this.consecutiveFailures = 0;
        return 'PUSHED';
      }

      const reason = response.reason ?? 'Operation rejected by server';

      if (response.status === 'REJECTED') {
        const conflictOutcome = await this.handleConflictReject(operation, response, reason);
        if (conflictOutcome) {
          return conflictOutcome;
        }
      }

      const terminal = this.isTerminalRejectReason(reason);

      await this.markFailed(operation.id, reason, {
        retryCount: operation.retry_count,
        terminal
      });

      if (terminal) {
        return 'DEAD';
      }

      if (operation.retry_count + 1 >= securityPolicies.maxSyncAttempts) {
        return 'DEAD';
      }

      return 'FAILED';
    } catch (error) {
      const reason = toErrorMessage(error);
      await this.markFailed(operation.id, reason, {
        retryCount: operation.retry_count,
        terminal: false
      });

      if (operation.retry_count + 1 >= securityPolicies.maxSyncAttempts) {
        return 'DEAD';
      }

      return 'FAILED';
    }
  }

  private async handleConflictReject(
    operation: OfflineOperation,
    response: ApplyOperationResponse,
    reason: string
  ): Promise<'FAILED' | 'DEAD' | null> {
    if (!this.isConflictReject(operation, response, reason)) {
      return null;
    }

    const payload = ensurePayloadObject(operation.payload);
    const orgId = resolveOrgIdFromPayload(payload);

    if (!orgId) {
      return null;
    }

    const actorId = resolveActorIdFromPayload(payload);

    conflicts.setContext({
      org_id: orgId,
      user_id: actorId ?? undefined
    });

    const policy = await conflicts.getPolicy(operation.entity, orgId);

    const conflict = await conflicts.record({
      org_id: orgId,
      entity: operation.entity,
      entity_id: operation.entity_id,
      operation_id: operation.id,
      operation_type: operation.type,
      local_payload: payload,
      server_payload: {
        status: response.status,
        reason,
        server_version: response.server_version,
        server_updated_at: response.server_updated_at
      },
      policy,
      reason
    });

    if (policy === 'SERVER_WINS') {
      await conflicts.autoResolve(conflict.id, 'KEEP_SERVER');
      await this.markFailed(operation.id, `Conflict server-wins: ${reason}`, {
        retryCount: operation.retry_count,
        terminal: true
      });
      return 'DEAD';
    }

    if (policy === 'LWW') {
      await conflicts.autoResolve(conflict.id, 'KEEP_LOCAL');
      await this.markFailed(operation.id, `Conflict lww retry: ${reason}`, {
        retryCount: operation.retry_count,
        terminal: false
      });

      if (operation.retry_count + 1 >= securityPolicies.maxSyncAttempts) {
        return 'DEAD';
      }

      return 'FAILED';
    }

    await this.markFailed(operation.id, `Conflict manual required: ${reason}`, {
      retryCount: operation.retry_count,
      terminal: true
    });
    return 'DEAD';
  }

  private isConflictReject(operation: OfflineOperation, response: ApplyOperationResponse, reason: string) {
    if (isConflictReason(reason)) {
      return true;
    }

    const payload = ensurePayloadObject(operation.payload);
    const localVersion = resolveLocalVersion(payload);

    if (localVersion === null || typeof response.server_version !== 'number') {
      return false;
    }

    return response.server_version !== localVersion;
  }

  async markSynced(operationId: string) {
    await offlineDB.markAsSynced(operationId);
  }

  async markFailed(
    operationId: string,
    reason: string,
    options: { retryCount?: number; terminal?: boolean } = {}
  ) {
    const retryCount = options.retryCount ?? 0;
    const nextRetryCount = retryCount + 1;
    const isTerminal = options.terminal === true || nextRetryCount >= securityPolicies.maxSyncAttempts;

    if (isTerminal) {
      await offlineDB.markAsDead(operationId, reason);
      this.consecutiveFailures += 1;
      this.applyCircuitBreaker(reason);
      return;
    }

    const delay = this.backoffSchedule(nextRetryCount);
    await offlineDB.markAsFailed(operationId, reason, Date.now() + delay);
    this.consecutiveFailures += 1;
    this.applyCircuitBreaker(reason);
  }

  backoffSchedule(retryCount: number) {
    const baseMs = 1_500;
    const maxMs = 5 * 60_000;
    const multiplier = 2 ** Math.max(0, retryCount - 1);
    return Math.min(maxMs, baseMs * multiplier);
  }

  private isTerminalRejectReason(reason: string) {
    const lowered = reason.toLowerCase();

    return (
      lowered.includes('forbidden') ||
      lowered.includes('not authenticated') ||
      lowered.includes('unauthorized') ||
      lowered.includes('permission') ||
      lowered.includes('policy') ||
      lowered.includes('invalid') ||
      lowered.includes('required') ||
      lowered.includes('violates') ||
      lowered.includes('mismatch') ||
      lowered.includes('does not exist') ||
      lowered.includes('not found') ||
      lowered.includes('undefined function') ||
      lowered.includes('schema cache')
    );
  }

  private async initialize() {
    const state = await Network.getNetworkStateAsync();
    this.isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);

    await this.refreshPendingOps();

    if (this.isOnline) {
      void this.triggerSync('APP_START');
      return;
    }

    this.patchStatus({ state: 'OFFLINE', lastError: 'Aucun reseau detecte' });
  }

  private async refreshPendingOps() {
    const [outboxPending, mediaPending] = await Promise.all([
      offlineDB.getUnsyncedCount(),
      mediaUploadWorker.getPendingCount()
    ]);
    const pendingOps = outboxPending + mediaPending;
    this.patchStatus({ pendingOps });
    return pendingOps;
  }

  private applyCircuitBreaker(reason: string) {
    if (this.consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) {
      return;
    }

    this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    this.patchStatus({
      state: 'ERROR',
      lastError: `Circuit breaker ouvert: ${reason}`
    });

    if (__DEV__) {
      console.warn('[sync-engine] circuit breaker opened', {
        consecutiveFailures: this.consecutiveFailures,
        reopenAt: new Date(this.circuitOpenUntil).toISOString()
      });
    }
  }

  private patchStatus(next: Partial<SyncEngineStatus>) {
    this.status = { ...this.status, ...next };
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}

export const syncEngine = new SyncEngine();

export type { SyncTriggerReason, SyncEngineState };
