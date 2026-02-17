import { useSyncExternalStore } from 'react';

export type AppNavigationContext = {
  orgId?: string;
  projectId?: string;
};

let currentContext: AppNavigationContext = {};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors to keep navigation responsive.
    }
  }
}

export function getCurrentContext(): AppNavigationContext {
  return currentContext;
}

export function setCurrentContext(patch: Partial<AppNavigationContext>) {
  currentContext = { ...currentContext, ...patch };
  emit();
}

export function resetCurrentContext(next: AppNavigationContext = {}) {
  currentContext = next;
  emit();
}

export function subscribeContext(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppNavigationContext() {
  return useSyncExternalStore(subscribeContext, getCurrentContext, getCurrentContext);
}

