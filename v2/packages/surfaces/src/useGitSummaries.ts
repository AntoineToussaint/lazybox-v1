import { useEffect, useSyncExternalStore } from 'react';
import { Code, ConnectError, type RunnerClient } from '@lazybox/client-core';
import type { WorkspaceGitSummary } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';

/**
 * Every workspace's git state for the sidebar, polled gently: one request for
 * all workspaces every 20 seconds while the window is visible, at once when it
 * comes back into view, and shortly after something nudges it (an agent
 * finishing a turn, a commit). One poll per Runner client, however many
 * sidebars (the docked one, the phone navigator) show it.
 */
const INTERVAL_MS = 20_000;
const NUDGE_DELAY_MS = 1_200;

type Snapshot = { byWorkspace: ReadonlyMap<string, WorkspaceGitSummary>; unsupported: boolean; loaded: boolean };
const empty: Snapshot = { byWorkspace: new Map(), unsupported: false, loaded: false };

class GitSummaryPoll {
  snapshot: Snapshot = empty;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private control = new AbortController();
  constructor(private api: RunnerClient) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  };
  private emit(next: Snapshot) { this.snapshot = next; for (const listener of this.listeners) listener(); }
  private visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  private onVisible = () => { if (this.visible()) void this.load(); };
  private start() {
    this.control = new AbortController();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    void this.load();
  }
  private stop() {
    this.control.abort(); clearTimeout(this.timer); clearTimeout(this.nudgeTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.load(), INTERVAL_MS); }
  /** Ask again soon: something changed the worktrees. Several nudges in a row make one request. */
  nudge() { clearTimeout(this.nudgeTimer); this.nudgeTimer = setTimeout(() => void this.load(), NUDGE_DELAY_MS); }
  async load() {
    if (this.busy || this.snapshot.unsupported || !this.listeners.size) return;
    if (!this.visible()) { this.schedule(); return; }
    this.busy = true;
    const signal = this.control.signal;
    try {
      const answer = await this.api.listWorkspaceGitSummaries({}, { signal, timeoutMs: 15_000 });
      if (!signal.aborted) this.emit({ byWorkspace: new Map(answer.workspaces.map(w => [w.collectionId, w])), unsupported: false, loaded: true });
    } catch (error) {
      // An older Runner has no summaries: the rows simply show none.
      if (!signal.aborted && ConnectError.from(error).code === Code.Unimplemented) this.emit({ ...this.snapshot, unsupported: true, loaded: true });
    } finally {
      this.busy = false;
      if (!signal.aborted && !this.snapshot.unsupported) this.schedule();
    }
  }
}

const polls = new WeakMap<RunnerClient, GitSummaryPoll>();
function pollFor(api: RunnerClient) {
  let poll = polls.get(api);
  if (!poll) { poll = new GitSummaryPoll(api); polls.set(api, poll); }
  return poll;
}

/** The sidebar's git summaries. A change of `nudge` asks the Runner again shortly. */
export function useGitSummaries(nudge = '') {
  const { api } = useRunner();
  const poll = pollFor(api);
  const snapshot = useSyncExternalStore(poll.subscribe, () => poll.snapshot);
  useEffect(() => { if (nudge) poll.nudge(); }, [poll, nudge]);
  return snapshot;
}

/** Ask every sidebar to refresh its git state (after a commit, push or merge). */
export function nudgeGitSummaries(api: RunnerClient) { polls.get(api)?.nudge(); }
