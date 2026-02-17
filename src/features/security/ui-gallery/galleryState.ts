import { useSyncExternalStore } from 'react';

export type QuotaLevel = 'OK' | 'WARN' | 'CRIT';

export type GalleryState = {
  offline: boolean;
  pendingOps: number;
  conflicts: number;
  quotaLevel: QuotaLevel;
};

type Listener = () => void;

let state: GalleryState = {
  offline: false,
  pendingOps: 0,
  conflicts: 0,
  quotaLevel: 'OK'
};

const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function setState(patch: Partial<GalleryState>) {
  state = { ...state, ...patch };
  notify();
}

export const gallery = {
  setOffline(value: boolean) {
    setState({ offline: value });
  },
  setPendingOps(value: number) {
    setState({ pendingOps: Math.max(0, Math.floor(value)) });
  },
  setConflicts(value: number) {
    setState({ conflicts: Math.max(0, Math.floor(value)) });
  },
  setQuotaLevel(value: QuotaLevel) {
    setState({ quotaLevel: value });
  },
  getState() {
    return state;
  }
};

export function useGalleryState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

