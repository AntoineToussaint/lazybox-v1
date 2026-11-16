import { useEffect, useRef, useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { BrowserAction, BrowserFrame, BrowserSettings, BrowserState } from '@lazybox/protocol';
import { applyAction, browsing, mergeHistory } from './browser-model';

export type BrowserWatch = {
  state?: BrowserState;
  actions: BrowserAction[];
  /** The latest frame, and how many arrived: a counter the canvas redraws on. */
  frame?: BrowserFrame;
  frames: number;
  connected: boolean;
  error: string;
  /** Takes a state the Runner answered a control with, ahead of the stream. */
  adopt(state?: BrowserState): void;
};

/**
 * Follows one conversation's agent browser (WatchBrowser): its state, its
 * action log and, while this is mounted, its frames. Reconnects after a
 * dropped stream (a Runner restart) with a short backoff.
 */
export function useBrowserWatch(api: RunnerClient, sessionId: string): BrowserWatch {
  const [watch, setWatch] = useState<Omit<BrowserWatch, 'adopt'>>({ actions: [], frames: 0, connected: false, error: '' });
  useEffect(() => {
    setWatch({ actions: [], frames: 0, connected: false, error: '' });
    if (!sessionId) return;
    const control = new AbortController();
    let delay = 500;
    void (async () => {
      while (!control.signal.aborted) {
        let first = true;
        try {
          for await (const event of api.watchBrowser({ sessionId }, { signal: control.signal })) {
            delay = 500;
            setWatch(current => {
              let next = { ...current, connected: true, error: '' };
              if (first) { next.actions = mergeHistory(event.history); first = false; }
              else for (const action of event.history) next.actions = applyAction(next.actions, action);
              if (event.state) next.state = event.state;
              if (event.action) next.actions = applyAction(next.actions, event.action);
              if (event.frame && event.frame.jpeg.length) { next.frame = event.frame; next.frames = current.frames + 1; }
              return next;
            });
          }
        } catch (error) {
          if (control.signal.aborted) return;
          setWatch(current => ({ ...current, connected: false, error: String(error instanceof Error ? error.message : error) }));
        }
        if (control.signal.aborted) return;
        setWatch(current => ({ ...current, connected: false }));
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5000);
      }
    })();
    return () => control.abort();
  }, [api, sessionId]);
  const adopt = useRef((state?: BrowserState) => { if (state) setWatch(current => ({ ...current, state })); }).current;
  return { ...watch, adopt };
}

// Settings → Browser, read once per window and kept fresh by saves.
let cached: BrowserSettings | undefined;
const listeners = new Set<(settings: BrowserSettings) => void>();
/** Tells every reader of the browser settings in this window about a save. */
export function publishBrowserSettings(settings: BrowserSettings) { cached = settings; for (const listener of listeners) listener(settings); }
/** The Runner's browser settings, loaded on first use. */
export function useBrowserSettings(api: RunnerClient): BrowserSettings | undefined {
  const [settings, setSettings] = useState(cached);
  useEffect(() => {
    listeners.add(setSettings);
    if (!cached) void api.getBrowserSettings({}).then(publishBrowserSettings, () => { /* the default (show the panel) applies */ });
    return () => { listeners.delete(setSettings); };
  }, [api]);
  return settings;
}

// Conversations whose browser this window has seen, and how: a browser that
// starts while seen closed shows its panel once.
const seen = new Map<string, boolean>();
/**
 * Shows the agent browser beside the chat when the conversation's browser
 * starts (Settings → Browser, "Show the agent browser…"), once per browsing:
 * a panel the person closes stays closed until the agent opens a browser again.
 */
export function useBrowserAutoShow(api: RunnerClient, conversation: string, state: BrowserState | undefined, show?: () => void) {
  const settings = useBrowserSettings(api);
  const latest = useRef(show); latest.current = show;
  const live = browsing(state);
  useEffect(() => {
    if (!conversation) return;
    const before = seen.get(conversation);
    seen.set(conversation, live);
    // First sight is not a start: a window opening on a browsing conversation does not move panels.
    if (before === false && live && settings?.showPanel !== false) latest.current?.();
  }, [conversation, live]);
}
