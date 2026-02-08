import { syncEngine } from './sync-engine';
import { SyncRunOptions, SyncRunResult, SyncTransport } from './types';

// Legacy wrapper: kept for compatibility with existing imports.
export async function syncOnce(
  _transport?: SyncTransport,
  _options: SyncRunOptions = {}
): Promise<SyncRunResult> {
  const result = await syncEngine.triggerSync('MANUAL');

  if (result) {
    return result;
  }

  return {
    pushed: 0,
    failed: 0,
    dead: 0,
    remaining: syncEngine.getStatus().pendingOps
  };
}
