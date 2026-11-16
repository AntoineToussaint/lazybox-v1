import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Session } from '@lazybox/protocol';
import { ancestry, emptySubagents, type Subagent, type Subagents } from './subagent-model';
import type { FileLink } from './file-reference';
import type { OpenModifiers } from './file-links';

export type SubagentPanelMode = 'float' | 'dock';
export type SubagentActions = {
  /** Scroll the conversation to a transcript message (a top-level card). */
  revealMessage(messageId: string): void;
  /** Stop one running sub-agent; present only when the provider supports it. */
  stop?(agentId: string): Promise<void>;
  openFile?(reference: FileLink, how: OpenModifiers): void;
};

/**
 * What one chat view shows of its sub-agents: which cards are open, which
 * full results are shown, the panel, and what the Runner says of each. One
 * store per chat, so a card re-renders only for its own sub-agent or a
 * change of this presentation, never for a keystroke in the composer.
 */
export class SubagentView {
  index: Subagents = emptySubagents();
  expanded = new Set<string>();
  results = new Set<string>();
  /** Failed sub-agents the person has looked at. */
  seen = new Set<string>();
  stopping = new Set<string>();
  panel: { agentId: string; mode: SubagentPanelMode } | null = null;
  /** A nested card to scroll to once its parent is open. */
  flash: { agentId: string; nonce: number } | null = null;
  runner: Record<string, string> = {};
  /** The Runner's names, for a sub-agent whose journal never named it. */
  names: Record<string, string> = {};
  canStop = false;
  /** The conversation's folder: tool lines show paths inside it relative to it. */
  root = '';
  actions: SubagentActions = { revealMessage() {} };
  /** Bumped by every change of presentation. */
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  notify = () => { this.version++; for (const listener of this.listeners) listener(); };

  /** Adopt the latest fold; listeners are told after the render that carried it commits. */
  setIndex(index: Subagents) { this.index = index; }
  setSession(session: Session | undefined) {
    const runner: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const agent of session?.agents || []) if (agent.id !== 'root') { runner[agent.id] = agent.status; if (agent.name && agent.name !== 'Agent') names[agent.id] = agent.name; }
    const canStop = !!session?.capabilities?.stopAgent && !session.closed;
    const changed = canStop !== this.canStop || Object.keys(runner).length !== Object.keys(this.runner).length || Object.entries(runner).some(([id, status]) => this.runner[id] !== status);
    const renamed = Object.entries(names).some(([id, name]) => this.names[id] !== name);
    const root = session?.workingDirectory || '', moved = root !== this.root;
    this.runner = runner; this.names = names; this.canStop = canStop; this.root = root;
    return changed || renamed || moved;
  }
  toggle(id: string, open = !this.expanded.has(id)) {
    if (open) { this.expanded.add(id); this.seen.add(id); } else this.expanded.delete(id);
    this.notify();
  }
  toggleResult(id: string) { if (this.results.has(id)) this.results.delete(id); else { this.results.add(id); this.seen.add(id); } this.notify(); }
  open(id: string, mode?: SubagentPanelMode) { this.panel = { agentId: id, mode: mode || this.panel?.mode || 'dock' }; this.seen.add(id); this.notify(); }
  closePanel() { this.panel = null; this.notify(); }
  setMode(mode: SubagentPanelMode) { if (this.panel) { this.panel = { ...this.panel, mode }; this.notify(); } }
  markSeen(ids: string[]) { for (const id of ids) this.seen.add(id); this.notify(); }
  /** Scroll to a sub-agent's card, opening every card on the way so it can be seen. */
  reveal(id: string) {
    if (this.index.byId[id]?.kind === 'command') { this.open(id); return; }
    const chain = ancestry(this.index, id);
    if (!chain.length) return;
    for (const member of chain) this.expanded.add(member);
    this.seen.add(id);
    const top = this.index.byId[chain[0]];
    this.flash = chain.length > 1 ? { agentId: id, nonce: Date.now() } : null;
    this.notify();
    if (top?.anchor) this.actions.revealMessage(top.anchor);
  }
  /** Stops one sub-agent, by the id the Runner knows it by. */
  async stop(agent: Subagent) {
    const id = agent.id;
    if (!this.actions.stop || this.stopping.has(id)) return;
    this.stopping.add(id); this.notify();
    try { await this.actions.stop(agent.runnerId || id); }
    finally { this.stopping.delete(id); this.notify(); }
  }
}

export const SubagentContext = createContext<SubagentView | null>(null);
export function useSubagentView(): SubagentView | null { return useContext(SubagentContext); }

const noop = () => () => {};
/** One sub-agent, re-rendering only when it changes. */
export function useSubagent(view: SubagentView | null, id: string): Subagent | undefined {
  return useSyncExternalStore(view ? view.subscribe : noop, () => view?.index.byId[id]);
}
/** The presentation (open cards, panel…); re-renders on any change to it. */
export function usePresentation(view: SubagentView | null): number {
  return useSyncExternalStore(view ? view.subscribe : noop, () => view?.version ?? 0);
}
/** The whole index, for the tray and the panel. */
export function useSubagentIndex(view: SubagentView | null): Subagents {
  return useSyncExternalStore(view ? view.subscribe : noop, () => view?.index ?? emptyIndex);
}
const emptyIndex = emptySubagents();
