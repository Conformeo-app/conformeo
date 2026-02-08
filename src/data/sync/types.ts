import { OfflineOperation } from '../offline/outbox';

export type ApplyOperationStatus = 'OK' | 'DUPLICATE' | 'REJECTED';

export type ApplyOperationResponse = {
  status: ApplyOperationStatus;
  reason?: string;
  server_version?: number;
  server_updated_at?: string;
};

export type SyncTransport = {
  pushOperation(operation: OfflineOperation): Promise<ApplyOperationResponse>;
};

export type SyncRunOptions = {
  batchSize?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
};

export type SyncRunResult = {
  pushed: number;
  failed: number;
  dead: number;
  remaining: number;
};
