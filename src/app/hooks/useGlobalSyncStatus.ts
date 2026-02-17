import { useEffect, useState } from 'react';
import { useAuth } from '../../core/auth';
import { media } from '../../data/media';
import { conflicts } from '../../data/sync/conflicts';
import { useSyncStatus } from '../../data/sync/useSyncStatus';

export type GlobalSyncStatus = {
  pendingOps: number;
  conflicts: number;
  failedUploads: number;
  isOffline: boolean;
};

const REFRESH_INTERVAL_MS = 5_000;

export function useGlobalSyncStatus(): GlobalSyncStatus {
  const { activeOrgId } = useAuth();
  const { status } = useSyncStatus();

  const [openConflicts, setOpenConflicts] = useState(0);
  const [failedUploads, setFailedUploads] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (!activeOrgId) {
        if (!cancelled) {
          setOpenConflicts(0);
          setFailedUploads(0);
        }
        return;
      }

      const [conflictsCount, failedUploadsCount] = await Promise.all([
        conflicts.getOpenCount(activeOrgId).catch(() => 0),
        media.countFailedUploads().catch(() => 0)
      ]);

      if (cancelled) {
        return;
      }

      setOpenConflicts(conflictsCount);
      setFailedUploads(failedUploadsCount);
    };

    void refresh();
    const intervalId = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // Refresh when the org changes, or when queue depth/phase changes (likely means a sync happened).
  }, [activeOrgId, status.queueDepth, status.phase]);

  return {
    pendingOps: status.queueDepth,
    conflicts: openConflicts,
    failedUploads,
    isOffline: status.phase === 'offline'
  };
}

