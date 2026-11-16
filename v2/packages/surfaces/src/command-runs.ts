import { useEffect, useRef } from 'react';
import type { CommandReport } from '@lazybox/protocol';
import type { RunnerClient } from '@lazybox/client-core';

// Sizes read the way `lazybox run` prints them to the agent.
export function formatBytes(value: bigint | number): string {
  const n = Number(value);
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MiB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KiB`;
  return `${n} B`;
}

// reportSummary labels a `lazybox run` with what its agent received,
// e.g. "exit 1 · agent saw 2.1 KiB of 1.4 MiB (go-test filter)".
export function reportSummary(report: CommandReport): string {
  const filter = report.filter === 'raw' ? 'raw output' : !report.filter || report.filter === 'passthrough' ? 'no filter' : `${report.filter} filter`;
  return `exit ${report.exitCode} · agent saw ${formatBytes(report.agentBytes)} of ${formatBytes(report.outputBytes)} (${filter})`;
}

// RunTracker reports each command once, the first time it is listed. The first
// listing is the baseline: commands that already existed are never reported, so
// reloading or revisiting a session does not reopen a console the user closed.
export class RunTracker {
  private seen?: Set<string>;
  next(ids: readonly string[]): string[] {
    if (!this.seen) { this.seen = new Set(ids); return []; }
    const fresh = ids.filter(id => !this.seen!.has(id));
    for (const id of fresh) this.seen.add(id);
    return fresh;
  }
}

// useCommandRuns calls onRun when a command starts in the session, so a
// collapsed console can open for it. It polls at the console's own interval.
export function useCommandRuns(api: RunnerClient, sessionId: string, onRun: (commandId: string) => void) {
  const handler = useRef(onRun); handler.current = onRun;
  useEffect(() => {
    if (!sessionId) return;
    const tracker = new RunTracker(), control = new AbortController(); let updating = false;
    const update = async () => {
      if (updating) return; updating = true;
      try {
        const { commands } = await api.listCommands({ sessionId }, { signal: control.signal });
        if (control.signal.aborted) return;
        const fresh = tracker.next(commands.map(command => command.id));
        if (fresh.length) handler.current(fresh[fresh.length - 1]);
      }
      catch { /* The console panel reports listing errors when it is open. */ }
      finally { updating = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, sessionId]);
}
