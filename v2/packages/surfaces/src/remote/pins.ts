import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Pinned conversations on the phone, behind one interface so the store can
 * change without the Inbox changing. The computer's pins are moving into the
 * Runner's preferences (audit brief R1); until a device can read them there,
 * the phone keeps its own pins on the phone (`shared: false`, said in its
 * settings). When Runner pins land, a `runnerPinStore` implementing this
 * interface replaces `localPinStore` in RemoteApp, read-only first if the
 * device allowlist only admits reading them.
 */
export interface PinStore {
  /** Whether these pins are the computer's too. */
  readonly shared: boolean;
  /** Whether the phone may change them. */
  readonly writable: boolean;
  list(): readonly string[];
  set(keys: readonly string[]): void;
  subscribe(listener: () => void): () => void;
}

export const maxPins = 64;

/** Pure: the pins after toggling one; the newest pin goes first. */
export function togglePin(pins: readonly string[], key: string): string[] {
  return pins.includes(key) ? pins.filter(value => value !== key) : [key, ...pins].slice(0, maxPins);
}

export function parsePins(text: string | null): string[] {
  try {
    const value = text ? JSON.parse(text) : [];
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string' && key.length < 256).slice(0, maxPins) : [];
  } catch { return []; }
}

/** This phone's pins, in its own storage, per paired device. */
export function localPinStore(root: string): PinStore {
  const key = `${root}:pins:v1`;
  const listeners = new Set<() => void>();
  let cached: { text: string | null; pins: string[] } | undefined;
  const read = () => {
    let text: string | null = null;
    try { text = localStorage.getItem(key); } catch { /* Private mode: pins live in memory for this visit. */ }
    if (!cached || cached.text !== text) cached = { text, pins: parsePins(text) };
    return cached.pins;
  };
  let memory: string[] | undefined;
  return {
    shared: false, writable: true,
    list: () => memory ?? read(),
    set(keys) {
      const text = JSON.stringify(keys.slice(0, maxPins));
      try { localStorage.setItem(key, text); memory = undefined; } catch { memory = [...keys]; }
      cached = undefined;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      const storage = (event: StorageEvent) => { if (event.key === key) { cached = undefined; listener(); } };
      window.addEventListener('storage', storage);
      return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
    },
  };
}

export function usePins(store: PinStore): { pinned: readonly string[]; toggle(key: string): void; shared: boolean; writable: boolean } {
  const pinned = useSyncExternalStore(store.subscribe, store.list);
  const toggle = useCallback((key: string) => { if (store.writable) store.set(togglePin(store.list(), key)); }, [store]);
  return useMemo(() => ({ pinned, toggle, shared: store.shared, writable: store.writable }), [pinned, toggle, store]);
}
