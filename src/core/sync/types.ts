export type SyncEntity = string;

export type SyncAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type SyncOperationStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CONFLICT';

export type SyncEnginePhase = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';

export type SyncConflictPolicy = 'LWW' | 'SERVER_WINS' | 'KEEP_LOCAL' | 'MANUAL';

export interface SyncOperation {
  id: string;
  orgId: string;
  entity: SyncEntity;
  entityId: string;
  action: SyncAction;
  payload: Record<string, unknown>;
  status: SyncOperationStatus;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  lastError?: string;
}

export interface SyncConflict {
  id: string;
  orgId: string;
  entity: SyncEntity;
  entityId: string;
  policy: SyncConflictPolicy;
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  createdAt: string;
}

export interface SyncNetworkStatus {
  isOnline: boolean;
  checkedAt: string;
}

export interface SyncTickResult {
  processed: number;
  failed: number;
  conflicts: number;
}

export interface SyncEngineState {
  phase: SyncEnginePhase;
  lastRunAt?: string;
  pendingCount: number;
  network: SyncNetworkStatus;
}

export interface QueueReadOptions {
  limit: number;
}

export interface SyncQueuePort {
  enqueue(operation: Omit<SyncOperation, 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>): Promise<SyncOperation>;
  nextBatch(options: QueueReadOptions): Promise<SyncOperation[]>;
  markDone(operationId: string): Promise<void>;
  markFailed(operationId: string, reason: string): Promise<void>;
  markConflict(operationId: string): Promise<void>;
  countPending(): Promise<number>;
}

export interface ConflictResolverPort {
  resolve(conflict: SyncConflict): Promise<Record<string, unknown> | null>;
}

export interface NetworkWatcherPort {
  getStatus(): SyncNetworkStatus;
  subscribe(listener: (status: SyncNetworkStatus) => void): () => void;
}
