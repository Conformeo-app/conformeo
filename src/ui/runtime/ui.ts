import { Alert } from 'react-native';
import { useSyncExternalStore } from 'react';
import type React from 'react';

export type ToastTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type ToastState = {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type DrawerState = {
  title: string;
  content: React.ReactNode;
  width?: number;
};

type UIState = {
  toast: ToastState | null;
  drawer: DrawerState | null;
};

let state: UIState = {
  toast: null,
  drawer: null
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

function setState(patch: Partial<UIState>) {
  state = { ...state, ...patch };
  notify();
}

function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

export const ui = {
  showToast(message: string, tone: ToastTone = 'neutral', opts?: { durationMs?: number }) {
    const next: ToastState = {
      id: uid('toast'),
      message,
      tone,
      durationMs: opts?.durationMs ?? 3200
    };
    setState({ toast: next });
    return next.id;
  },

  clearToast(id?: string) {
    if (!state.toast) return;
    if (id && state.toast.id !== id) return;
    setState({ toast: null });
  },

  openDrawer(
    input: React.ReactNode | { title?: string; content: React.ReactNode; width?: number },
    opts?: { title?: string; width?: number }
  ) {
    // Signature support:
    // - ui.openDrawer(<Content />)
    // - ui.openDrawer(<Content />, { title, width })
    // - ui.openDrawer({ title, content, width })
    const hasContentObject =
      typeof input === 'object' && input !== null && 'content' in (input as any) && (input as any).content != null;

    if (hasContentObject) {
      const cfg = input as { title?: string; content: React.ReactNode; width?: number };
      setState({ drawer: { title: cfg.title ?? 'Options', content: cfg.content, width: cfg.width } });
      return;
    }

    setState({
      drawer: { title: opts?.title ?? 'Options', content: input as React.ReactNode, width: opts?.width }
    });
  },

  closeDrawer() {
    setState({ drawer: null });
  },

  async showConfirm(input: { title: string; body: string; confirmLabel?: string; destructive?: boolean }) {
    return new Promise<boolean>((resolve) => {
      Alert.alert(input.title, input.body, [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        {
          text: input.confirmLabel ?? 'Confirmer',
          style: input.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true)
        }
      ]);
    });
  }
};

export function useUIState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
