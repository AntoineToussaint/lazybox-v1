import { useEffect, useState } from 'react';
import type { JournalEvent, Session } from '@lazybox/protocol';
import { liveStatus, type LiveStatus, type LiveTone } from './live-status';
import './live-status.css';

// One clock for every live row in the window, ticking only while one is shown.
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(listener: (now: number) => void) {
  listeners.add(listener);
  if (!timer) timer = setInterval(() => { const now = Date.now(); for (const l of listeners) l(now); }, 1000);
  return () => { listeners.delete(listener); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; } };
}
/** The current time, re-rendering every second while `ticking`. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!ticking) return; setNow(Date.now()); return subscribe(setNow); }, [ticking]);
  return ticking ? now : Date.now();
}

/** A conversation's live status, moving while the agent works. */
export function useLiveStatus(session: Session | undefined, events?: readonly JournalEvent[]): LiveStatus {
  const [ticking, setTicking] = useState(false);
  const now = useNow(ticking);
  const status = liveStatus(session, now, events);
  const timed = status.since !== undefined;
  useEffect(() => setTicking(timed), [timed]);
  return status;
}

/** Spins while busy, pulses while waiting for the person; still otherwise and under reduced motion. */
export function LiveIndicator({ tone }: { tone: LiveTone }) {
  return <span className="live-indicator" data-tone={tone} aria-hidden="true"/>;
}

/**
 * A row's leading mark: the unread dot when the person has something to see,
 * otherwise the live indicator (a turning ring while the agent works).
 */
export function SessionMark({ session, unread, title }: { session: Session; unread?: '' | 'failed' | 'review'; title?: string }) {
  const status = useLiveStatus(session);
  if (unread) return <span className={`session-dot unread unread-${unread}`} title={title}/>;
  return <span className="session-mark" title={title || status.label}><LiveIndicator tone={status.tone}/></span>;
}

/** Indicator and phrase, for rows: "◌ Running · Bash · 12s". */
export function LiveStatusLabel({ session, className = '', hideIdle = false }: { session: Session; className?: string; hideIdle?: boolean }) {
  const status = useLiveStatus(session);
  if (hideIdle && (status.tone === 'idle' || status.tone === 'saved')) return null;
  return <span className={`live-status ${className}`} data-tone={status.tone}><LiveIndicator tone={status.tone}/><span className="live-status-text">{status.text}</span></span>;
}
