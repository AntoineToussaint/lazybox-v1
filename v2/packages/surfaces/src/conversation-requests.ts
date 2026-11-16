import { useEffect, useRef } from 'react';
import type { ViewTarget } from './workspace-model';

/**
 * What a conversation row can ask of the window it is in, whichever list it
 * sits in (Workspaces, Agents, the Inbox): open the conversation beside the
 * one on screen, in its own window, or reveal the Agents panel. The window's
 * Workspace provides them; a surface without one (a detached chat window)
 * has none, and the menus say so instead of offering a dead item.
 */
export type ConversationOpeners = {
  /** A second chat panel showing this conversation, beside the page's conversation. */
  beside(target: ViewTarget): void;
  /** The conversation in its own native window; absent where the host cannot open one. */
  window?(target: ViewTarget): void;
  /** Bring the page's Agents panel to the front; false when the page has none. */
  showAgents(): boolean;
};

let current: ConversationOpeners | undefined;
export const conversationOpeners = () => current;

/** Provide the openers while mounted (the window's Workspace); the latest closures are used. */
export function useProvideConversationOpeners(openers: ConversationOpeners) {
  const latest = useRef(openers); latest.current = openers;
  useEffect(() => {
    const proxy: ConversationOpeners = {
      beside: target => latest.current.beside(target),
      showAgents: () => latest.current.showAgents(),
    };
    Object.defineProperty(proxy, 'window', { get: () => latest.current.window, enumerable: true });
    current = proxy;
    return () => { if (current === proxy) current = undefined; };
  }, []);
}

/**
 * The Inbox asked for the Agents panel: the panel takes focus on its first
 * row. A panel shown for the request mounts after it was made, so the request
 * waits briefly for one to take it (as Ask Lazybox's does).
 */
const EVENT = 'lazybox-agents-focus';
let pending = 0;
export function requestAgentsFocus() {
  pending = Date.now();
  window.dispatchEvent(new Event(EVENT));
}
export function useAgentsFocusRequests(onFocus: () => void) {
  const latest = useRef(onFocus); latest.current = onFocus;
  useEffect(() => {
    const take = () => { if (!pending) return; pending = 0; requestAnimationFrame(() => latest.current()); };
    if (pending && Date.now() - pending < 3000) queueMicrotask(take); else pending = 0;
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, []);
}
