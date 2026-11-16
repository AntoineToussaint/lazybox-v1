import { useEffect, useSyncExternalStore } from 'react';
import type { AppHost, AvailableUpdate, UpdateProgress } from '@lazybox/platform';

/**
 * One update check for the whole window, shared by the header's notice and
 * Settings → About: checked when the window opens and every six hours,
 * quietly; a failure is shown only where the person asked (About).
 */
export type UpdateState = {
  checking: boolean;
  checkedAt?: number;
  available?: AvailableUpdate;
  error?: string;
  installing?: UpdateProgress | { phase: 'starting'; downloaded: 0; total: 0 };
  /** The notice was put away until the next version. */
  dismissed?: string;
};

const CHECK_EVERY = 6 * 60 * 60 * 1000;
let state: UpdateState = { checking: false };
const listeners = new Set<() => void>();
const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export async function checkForUpdate(app: AppHost | undefined, { quiet = false } = {}) {
  if (!app?.checkForUpdate || state.checking || state.installing) return;
  set({ checking: true, ...(quiet ? {} : { error: undefined }) });
  try {
    const available = await app.checkForUpdate();
    set({ checking: false, checkedAt: Date.now(), available, error: undefined });
  } catch (error) {
    set({ checking: false, checkedAt: Date.now(), ...(quiet ? {} : { error: String(error) }) });
  }
}

export async function installUpdate(app: AppHost | undefined) {
  if (!app?.installUpdate || state.installing) return;
  set({ installing: { phase: 'starting', downloaded: 0, total: 0 }, error: undefined });
  try {
    await app.installUpdate(progress => set({ installing: progress }));
    // The app restarts; nothing after this runs on success.
  } catch (error) {
    set({ installing: undefined, error: String(error) });
  }
}

export const dismissUpdate = () => set({ dismissed: state.available?.version });

/** Progress as a sentence: what the person is waiting for. */
export function progressText(p: UpdateState['installing']) {
  if (!p) return '';
  if (p.phase === 'runner') return 'Moving the Runner to the new version…';
  if (p.phase === 'download' && p.total > 0) return `Downloading… ${Math.min(100, Math.round((p.downloaded / p.total) * 100))}%`;
  return 'Downloading…';
}

export function useAppUpdate(app: AppHost | undefined) {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!app?.checkForUpdate) return;
    if (!state.checkedAt || Date.now() - state.checkedAt > CHECK_EVERY) void checkForUpdate(app, { quiet: true });
    const timer = setInterval(() => void checkForUpdate(app, { quiet: true }), CHECK_EVERY);
    return () => clearInterval(timer);
  }, [app]);
  return current;
}

/** Test seam: a fresh store. */
export function resetUpdateState() { state = { checking: false }; listeners.forEach(l => l()); }
