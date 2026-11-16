import type { HostedProcess } from '@lazybox/protocol';

/** The Processes view's sections, in order: what this Runner supervises, then what nobody does. */
export type ProcessGroup = { key: 'agent' | 'command' | 'terminal' | 'orphan'; title: string; processes: HostedProcess[] };

const titles = { agent: 'Agents', command: 'Commands', terminal: 'Terminals', orphan: 'Not supervised by this Runner' } as const;

/** Processes this Runner holds, by kind; a host no Runner holds is an orphan whatever it runs. */
export function groupProcesses(processes: readonly HostedProcess[], workspaceId = ''): ProcessGroup[] {
  const shown = workspaceId ? processes.filter(p => p.workspaceId === workspaceId) : processes;
  return (['agent', 'command', 'terminal', 'orphan'] as const)
    .map(key => ({ key, title: titles[key], processes: shown.filter(p => key === 'orphan' ? !p.attached : p.attached && p.kind === key) }))
    .filter(group => group.processes.length > 0);
}

/** "2d 3h", "4h 12m", "7m", "12s". */
export function formatUptime(seconds: bigint | number): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${Math.floor(s)}s`;
}

/** "312 MB", "1.4 GB", "820 KB". */
export function formatMemory(bytes: bigint | number): string {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(1)} GB`;
  if (b >= 1 << 20) return `${Math.round(b / (1 << 20))} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** Plain words for a process's state, and whether it needs attention. */
export function processState(p: HostedProcess): { label: string; tone: 'ok' | 'idle' | 'warn' } {
  if (!p.attached && p.state !== 'unreachable') return { label: 'Orphaned', tone: 'warn' };
  switch (p.state) {
    case 'running': return { label: 'Running', tone: 'ok' };
    case 'starting': return { label: 'Starting', tone: 'idle' };
    case 'exited': return { label: 'Exited', tone: 'idle' };
    default: return { label: 'Not answering', tone: 'warn' };
  }
}

export const backendLabel = (backend: string) => backend === 'tmux' ? 'tmux' : 'session host';

/** What stopping does, said before it happens. */
export function stopConsequence(p: HostedProcess): string {
  if (!p.attached) return 'No Runner supervises this process. Stopping it ends it and everything it started.';
  if (p.kind === 'agent') return 'The agent’s process ends and its conversation stops. The conversation stays in your history: continue it to start a new process.';
  if (p.kind === 'command') return 'The command and everything it started are stopped. Its output so far stays in the console.';
  return 'The shell is hung up, as closing its terminal tab does: programs it started get SIGHUP.';
}
