import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import type { ConfigFiles } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { setConfigWriter, type ConfigWrite, type ConfigWriteResult } from './config-writer';
import { defaultKeys, defaultNotifications, errorCount, fileLabel, firstProblem, keysEdits, keysFromFile, layoutFileName, layoutYaml, notificationsFromFile, parseDoc, settingsEdits, type ConfigDoc, type ConfigEdit, type KeysValue, type SettingsValue } from './config-files';
import { parseSavedLayouts, SAVED_LAYOUTS_KEY } from './layout-presets';
import { applyKeysFromFile, keyboardPreset, readKeymap, readMenu, readVimPreferences } from './keyboard';
import { useNotificationPreferences } from './useAttention';
import { readPreference, writePreference } from './view-state';
import { settingsError } from './settings-parts';
import { showToast } from './toasts';
import { runAction } from './actions';

/** How often the files are looked at: the Runner rereads them every second. */
export const CONFIG_POLL_MS = 2000;

export type ConfigState = {
  /** The folder holding them, '' before the first answer. */
  directory: string;
  docs: ConfigDoc[];
  revision: number;
  loaded: boolean;
  error: string;
  /** Problems the app found applying a file the Runner accepted (a keymap it refuses), by file name. */
  appProblems: Record<string, string>;
};

let state: ConfigState = { directory: '', docs: [], revision: -1, loaded: false, error: '', appProblems: {} };
const listeners = new Set<() => void>();
const publish = (next: Partial<ConfigState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const accept = (files: ConfigFiles) => {
  if (Number(files.revision) === state.revision && state.loaded) return;
  publish({ directory: files.directory, docs: files.files.map(file => parseDoc(file)), revision: Number(files.revision), loaded: true, error: '' });
};

type Update = { name: string; edits?: ConfigEdit[]; content?: string; remove?: boolean };
let updater: ((request: Update) => Promise<ConfigFiles>) | undefined;
/** Writes from this window not yet answered: the file is not applied over them. */
let writing = 0;
/**
 * Changes one config file through the Runner (comments kept; nothing written
 * when the result would not load) and publishes what it then holds. Rejects
 * with a sentence for the person.
 */
export async function updateConfigFile(request: Update): Promise<void> {
  if (!updater) throw new Error('This window is not connected to a Runner.');
  try { accept(await updater(request)); }
  catch (error) { throw new Error(settingsError(error)); }
}

/** Every config file as the Runner last loaded it, live. */
export function useConfigFiles(): ConfigState { return useSyncExternalStore(subscribe, () => state, () => state); }
export function configDocs(): ConfigDoc[] { return state.docs; }
export function configDoc<T>(name: string): ConfigDoc<T> | undefined { return state.docs.find(doc => doc.name === name) as ConfigDoc<T> | undefined; }

/** Whether a file was ever in force here, so its removal means "back to the defaults". */
const SEEN = 'config-files:seen:v1';
const readSeen = (store?: ViewStateStore): Record<string, boolean> => { try { return JSON.parse(readPreference(store, SEEN) || '{}') || {}; } catch { return {}; } };
const markSeen = (store: ViewStateStore | undefined, name: string) => { const seen = readSeen(store); if (!seen[name]) writePreference(store, SEEN, JSON.stringify({ ...seen, [name]: true })); };

/**
 * One per workspace window: keeps the config files loaded (polled, and at
 * once when the window regains focus) and writes the app's changes to them.
 * The main window also applies them: a file saved in an editor changes the
 * keys and notifications within two seconds, a file removed puts back the
 * defaults, the shortcuts and notifications a person set before files existed
 * become their files once, and a file with a mistake is announced with its
 * line (the last good version stays in force).
 */
export function useConfigFilesBridge(primary: boolean, viewState?: ViewStateStore) {
  const { api } = useRunner();
  const [notifications, saveNotifications] = useNotificationPreferences();
  const live = useRef({ notifications, saveNotifications, viewState }); live.current = { notifications, saveNotifications, viewState };

  // Reads, and the writer every window registers.
  useEffect(() => {
    updater = request => api.updateConfigFile({ name: request.name, edits: request.edits || [], content: request.content || '', remove: !!request.remove }, { timeoutMs: 10_000 });
    const control = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return; busy = true;
      try { accept(await api.getConfigFiles({}, { signal: control.signal, timeoutMs: 5000 })); }
      catch (error) { if (!control.signal.aborted) publish({ error: settingsError(error, 'load') }); }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, CONFIG_POLL_MS);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    const write = async (request: ConfigWrite, { quiet }: { quiet: boolean }): Promise<ConfigWriteResult> => {
      const { viewState: store } = live.current;
      const name = request.file;
      const doc = configDoc<unknown>(name);
      // A file that does not load now is not overwritten from the app: its text is the person's.
      if (doc?.exists && doc.error && !doc.stale) return report({ saved: false, message: `${fileLabel(name)} does not load (${doc.error}); fix it in your editor first.` }, quiet);
      const edits = request.file === 'keys'
        ? keysEdits({ map: readKeymap(store), menu: readMenu(store), vim: readVimPreferences(store), preset: request.preset }, doc?.exists ? doc.value as KeysValue : undefined)
        : settingsEdits(request.notifications, doc?.exists ? doc.value as SettingsValue : undefined);
      if (!edits.length) return { saved: true, message: doc?.exists ? `Saved to ${fileLabel(name)}.` : 'Saved.' };
      try {
        await updateConfigFile({ name, edits });
        markSeen(store, name);
        return { saved: true, message: `Saved to ${fileLabel(name)}.` };
      } catch (error) {
        return report({ saved: false, message: `Not saved to ${fileLabel(name)}: ${error instanceof Error ? error.message : String(error)}` }, quiet);
      }
    };
    // One write at a time, each computed from what the file holds after the
    // one before (a reset and its Undo in quick succession both land); while
    // any is pending, the main window does not apply the file over them.
    let chain: Promise<unknown> = Promise.resolve();
    const unregister = setConfigWriter((request, options) => {
      writing++;
      const next = chain.then(() => write(request, options)).finally(() => { writing--; publish({}); });
      chain = next.catch(() => undefined);
      return next;
    });
    return () => { control.abort(); clearInterval(timer); window.removeEventListener('focus', focus); unregister(); if (updater) updater = undefined; };
  }, [api]);

  // The main window applies the files.
  const applied = useRef(new Map<string, number>());
  const movedLayouts = useRef(false);
  const announced = useRef(new Map<string, string>());
  const files = useConfigFiles();
  useEffect(() => {
    if (!primary || !files.loaded || writing) return;
    const { viewState: store, notifications: current, saveNotifications: save } = live.current;
    const seen = readSeen(store);
    const problems: Record<string, string> = {};
    for (const name of ['keys', 'settings']) {
      const doc = files.docs.find(d => d.name === name);
      if (!doc) continue;
      if (applied.current.get(name) === doc.revision) { if (state.appProblems[name]) problems[name] = state.appProblems[name]; continue; }
      applied.current.set(name, doc.revision);
      if (doc.exists && doc.value) {
        if (name === 'keys') {
          const next = keysFromFile(doc.value as KeysValue);
          if (next.problem) problems.keys = `The keys do not apply: ${next.problem} The last keys that worked stay in force.`;
          else applyKeysFromFile(store, next);
        } else {
          const next = notificationsFromFile(doc.value as SettingsValue);
          if (JSON.stringify(next) !== JSON.stringify(current)) save(next);
        }
        markSeen(store, name);
      } else if (!doc.exists) {
        const keys = { map: readKeymap(store), menu: readMenu(store), vim: readVimPreferences(store) };
        const isDefault = name === 'keys' ? defaultKeys(keys) : defaultNotifications(current);
        if (seen[name]) {
          // The file was removed: back to the defaults.
          if (!isDefault) {
            if (name === 'keys') applyKeysFromFile(store, { map: keyboardPreset(), menu: [], vim: { composer: false, editor: false } });
            else save(notificationsFromFile({ notifications: {} }));
          }
        } else if (!isDefault) {
          // What the person set before files existed becomes their file, once.
          const edits = name === 'keys' ? keysEdits(keys, undefined) : settingsEdits(current, undefined);
          void updateConfigFile({ name, edits }).then(() => {
            markSeen(store, name);
            showToast({ id: `config-moved-${name}`, tone: 'info', title: `Your ${name === 'keys' ? 'shortcuts' : 'notification settings'} are now in ${fileLabel(name)}`, body: 'Edit it in any editor; Lazybox applies it as you save.', timeout: 6000 });
          }, () => { /* Shown when the person next saves. */ });
        }
      }
    }
    if (JSON.stringify(problems) !== JSON.stringify(state.appProblems)) publish({ appProblems: problems });
    // Layouts saved before they were files become files, once.
    const legacy = parseSavedLayouts(readPreference(store, SAVED_LAYOUTS_KEY));
    if (legacy.length && !movedLayouts.current) {
      movedLayouts.current = true;
      void (async () => {
        const taken = files.docs.map(d => d.name);
        for (const layout of legacy) {
          const name = layoutFileName(layout.name, taken);
          taken.push(name);
          await updateConfigFile({ name, content: layoutYaml(layout) });
        }
        writePreference(store, SAVED_LAYOUTS_KEY, '[]');
        showToast({ id: 'config-moved-layouts', tone: 'info', title: `Your saved layouts are now files`, body: `${legacy.length} in the layouts folder beside your other Lazybox files.`, timeout: 6000 });
      })().catch(() => { movedLayouts.current = false; });
    }
    // A file with a new mistake is announced once, with its line.
    for (const doc of files.docs) {
      const count = errorCount(doc), key = count ? `${doc.revision}` : '';
      if (announced.current.get(doc.name) === key) continue;
      announced.current.set(doc.name, key);
      if (!count) continue;
      const tab = doc.name === 'keys' ? 'keyboard' : doc.name === 'settings' ? 'notifications' : 'power';
      showToast({ id: `config-problem-${doc.name}`, tone: 'failed', title: `${fileLabel(doc.name)}: ${count === 1 ? 'a problem' : `${count} problems`}`, body: `${firstProblem(doc)}${doc.stale ? ' The last version that loaded stays in force.' : ''}`, action: { label: 'Show', run: () => runAction('settings.open', tab) } });
    }
  }, [primary, files]);
}

function report(result: ConfigWriteResult, quiet: boolean): ConfigWriteResult {
  if (!quiet && !result.saved) showToast({ id: 'config-write', tone: 'failed', title: 'Not saved to your config file', body: result.message });
  return result;
}
