import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Code, ConnectError, createRunnerClient, type RunnerClient } from '@lazybox/client-core';
import type { InfoResponse } from '@lazybox/protocol';

export type RunnerConnection = { baseUrl: string; token: string; fetch?: typeof globalThis.fetch };
/** A restart the person asked for, from request until a new Runner process serves. */
export type RunnerRestart = { phase: 'idle' } | { phase: 'restarting' } | { phase: 'restarted' } | { phase: 'failed'; message: string };
type RunnerState = { connection: RunnerConnection; api: RunnerClient; info?: InfoResponse; connecting: boolean; error: string; refresh(): void; revision: number; restart: RunnerRestart; restartRunner(): Promise<void>; dismissRestart(): void };
const Context = createContext<RunnerState | null>(null);

// The launcher waits up to three minutes for a Runner to serve; Dev may also
// rebuild it first. Past this, say so rather than spin forever.
export const RESTART_TIMEOUT_MS = 240_000;
// Outcomes that mean the Runner refused: it is not restarting.
const refused = [Code.FailedPrecondition, Code.PermissionDenied, Code.Unauthenticated, Code.Unimplemented, Code.Internal];

/** One resolved authority per window. Panel lifetimes never own execution. */
export function RunnerProvider({ connection, expectRestart, children }: { connection: RunnerConnection; expectRestart?: () => Promise<void>; children: ReactNode }) {
  const api = useMemo(() => createRunnerClient(connection.baseUrl, connection.token, connection.fetch), [connection.baseUrl, connection.token, connection.fetch]);
  const [info, setInfo] = useState<InfoResponse>();
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [restart, setRestart] = useState<RunnerRestart>({ phase: 'idle' });
  // The process being replaced and when to give up. A new connection (the
  // desktop adopting the restarted Runner's port and bearer) keeps it.
  const pending = useRef<{ previous: string; deadline: number } | null>(null);
  const latest = useRef<InfoResponse | undefined>(undefined);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { setConnecting(true); setInfo(undefined); setError(''); }, [api]);
  const restarting = restart.phase === 'restarting';
  useEffect(() => {
    const control = new AbortController();
    if (!connection.token) { setError('A resolved Runner connection is required.'); setConnecting(false); return () => control.abort(); }
    let updating = false;
    const update = async () => {
      if (updating) return; updating = true;
      try {
        const next = await api.info({}, { signal: control.signal, timeoutMs:5000 });
        if (!control.signal.aborted) {
          latest.current = next; setInfo(next); setError('');
          const waiting = pending.current;
          if (waiting && next.instanceId && next.instanceId !== waiting.previous) { pending.current = null; setRestart({ phase: 'restarted' }); }
        }
      }
      catch (error) { if (!control.signal.aborted) setError(String(error)); }
      finally {
        updating = false;
        if (!control.signal.aborted) {
          setConnecting(false);
          if (pending.current && Date.now() > pending.current.deadline) {
            pending.current = null;
            setRestart({ phase: 'failed', message: 'The Runner did not come back within 4 minutes. Check the terminal that launched it. Agents keep running and reconnect once a Runner starts.' });
          }
        }
      }
    };
    // Poll faster while a restart is under way, so the window reconnects promptly.
    void update(); const timer = setInterval(() => void update(), restarting ? 1000 : 3000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, connection.token, revision, restarting]);
  const restartRunner = useCallback(async () => {
    if (pending.current) return;
    const waiting = { previous: latest.current?.instanceId || '', deadline: Date.now() + RESTART_TIMEOUT_MS };
    pending.current = waiting;
    setRestart({ phase: 'restarting' });
    const fail = (message: string) => { if (pending.current === waiting) pending.current = null; setRestart({ phase: 'failed', message }); };
    try { await expectRestart?.(); }
    catch (error) { fail(`This window cannot follow a restarted Runner: ${String(error)}`); return; }
    try {
      const response = await api.restartRunner({}, { timeoutMs: 10000 });
      if (response.instanceId) waiting.previous = response.instanceId;
    } catch (error) {
      const failure = ConnectError.from(error);
      // Anything else means the answer was lost, not refused: the Runner may
      // already be stopping. Keep waiting for a new process to serve.
      if (refused.includes(failure.code)) { fail(failure.rawMessage || String(error)); return; }
    }
  }, [api, expectRestart]);
  const dismissRestart = useCallback(() => setRestart(value => value.phase === 'restarting' ? value : { phase: 'idle' }), []);
  useEffect(() => {
    if (restart.phase !== 'restarted') return;
    const timer = setTimeout(() => setRestart(value => value.phase === 'restarted' ? { phase: 'idle' } : value), 8000);
    return () => clearTimeout(timer);
  }, [restart.phase]);
  return <Context.Provider value={{ connection, api, info, connecting, error, refresh, revision, restart, restartRunner, dismissRestart }}>{children}</Context.Provider>;
}

export function useRunner(): RunnerState {
  const state = useContext(Context);
  if (!state) throw new Error('Runner panels require RunnerProvider');
  return state;
}
