import type { NetworkWatcherPort, SyncNetworkStatus } from './types';
import { initialNetworkStatus, nowIso } from './utils';

export class NetworkWatcher implements NetworkWatcherPort {
  private status: SyncNetworkStatus = initialNetworkStatus();

  private readonly listeners = new Set<(status: SyncNetworkStatus) => void>();

  getStatus(): SyncNetworkStatus {
    return this.status;
  }

  subscribe(listener: (status: SyncNetworkStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);

    return () => {
      this.listeners.delete(listener);
    };
  }

  setOnline(isOnline: boolean): void {
    this.status = {
      isOnline,
      checkedAt: nowIso()
    };

    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}

// TODO(CFM-1): connecter aux événements réseau natifs (expo-network) sans dépendance implicite côté core.
