import type { SyncNetworkStatus, SyncOperation } from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createSyncId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

export function cloneOperation(operation: SyncOperation): SyncOperation {
  return {
    ...operation,
    payload: { ...operation.payload }
  };
}

export function initialNetworkStatus(): SyncNetworkStatus {
  return {
    // TODO(CFM-1): brancher un vrai watcher réseau (expo-network) dans un lot dédié.
    isOnline: true,
    checkedAt: nowIso()
  };
}

export function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('network') || msg.includes('tempor');
}
