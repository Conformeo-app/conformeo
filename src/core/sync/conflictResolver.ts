import type { ConflictResolverPort, SyncConflict } from './types';

export class ConflictResolver implements ConflictResolverPort {
  async resolve(conflict: SyncConflict): Promise<Record<string, unknown> | null> {
    switch (conflict.policy) {
      case 'LWW':
      case 'KEEP_LOCAL':
        return { ...conflict.localPayload };
      case 'SERVER_WINS':
        return { ...conflict.remotePayload };
      case 'MANUAL':
      default:
        // TODO(CFM-1): brancher le flux de résolution manuelle (UI + storage conflict journal).
        return null;
    }
  }
}
