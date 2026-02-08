import { AppState } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { offlineDB } from '../offline/outbox';
import { syncRuntime, SyncStatus } from './runtime';

const initialStatus: SyncStatus = {
  phase: 'idle',
  queueDepth: 0,
  deadLetterCount: 0,
  lastSyncedAt: null,
  lastError: null,
  lastResult: null,
  lastTriggerReason: null
};

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(initialStatus);

  useEffect(() => {
    const unsubscribe = syncRuntime.subscribe(setStatus);
    syncRuntime.start();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void syncRuntime.refreshQueueDepth();
        void syncRuntime.trigger('APP_START');
      }
    });

    return () => {
      unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  const actions = useMemo(
    () => ({
      syncNow: () => syncRuntime.trigger('MANUAL'),
      refreshQueue: () => syncRuntime.refreshQueueDepth(),
      retryDead: async () => {
        const retriedCount = await offlineDB.retryAllDeadOperations();
        await syncRuntime.refreshQueueDepth();
        if (retriedCount > 0) {
          await syncRuntime.trigger('MANUAL');
        }
        return retriedCount;
      }
    }),
    []
  );

  return { status, ...actions };
}
