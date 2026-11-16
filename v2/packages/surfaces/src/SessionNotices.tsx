import { useState } from 'react';
import type { Session } from '@lazybox/protocol';
import { statusLabel } from './agent-status';
import { LiveIndicator } from './LiveIndicator';
import type { LiveStatus } from './live-status';

/** A saved conversation: continue it by sending, or resume it explicitly when it needs recovery first. */
export function ResumeBar({ session, canResumeOnSend, onResume, onError }: {
  session: Session;
  canResumeOnSend: boolean;
  /** Resumes the conversation; true once it continues in a new execution. */
  onResume(processesStopped: boolean): Promise<boolean>;
  onError(message: string): void;
}) {
  const [resuming, setResuming] = useState(false);
  const [processesStopped, setProcessesStopped] = useState(false);
  const resume = async () => {
    if (resuming) return; setResuming(true); onError('');
    try { if (await onResume(processesStopped)) setProcessesStopped(false); }
    catch (error) { onError(String(error)); } finally { setResuming(false); }
  };
  return <div className="resume-bar">
    <span>{'Saved conversation'}</span>
    {session.resumeBlocked
      ? <p>{session.resumeBlocked}</p>
      : canResumeOnSend
        ? <small>Send a message to continue with this conversation’s saved account and permissions.</small>
        : <>
          {session.recoveryRequired && <label><input type="checkbox" checked={processesStopped} onChange={event => setProcessesStopped(event.target.checked)}/>I have stopped or reconciled the previous agent and its commands.</label>}
          <button disabled={resuming || !session.providerReference || !session.capabilities?.resume || (session.recoveryRequired && !processesStopped)} onClick={() => void resume()}>{resuming ? 'Resuming…' : 'Resume conversation'}</button>
        </>}
  </div>;
}

/** The sub-agents the root agent started, and their state. */
const childState = (status = '') => ({ running: 'Running', starting: 'Starting', waiting_input: 'Needs input', waiting_approval: 'Needs approval', done: 'Done', interrupted: 'Stopped', failed: 'Failed', stopped: 'Stopped' } as Record<string, string>)[status] || 'Working';
const childTone = (status = '') => status === 'failed' ? 'failed' : status === 'done' ? 'done' : status === 'interrupted' || status === 'stopped' ? 'stopped' : 'running';

/**
 * Background agents and commands the agent started. One line each (the full
 * text on hover), running ones first, newest first, with a plain state.
 */
export function AgentActivity({ session }: { session?: Session }) {
  if (!session || session.agents.length <= 1) return null;
  const children = session.agents.filter(a => a.id !== 'root');
  const running = children.filter(a => childTone(a.status) === 'running').length;
  const failed = children.filter(a => childTone(a.status) === 'failed').length;
  const ordered = [...children].reverse().sort((a, b) => Number(childTone(b.status) === 'running') - Number(childTone(a.status) === 'running'));
  return <details className="agent-activity">
    <summary>Background work · {running ? `${running} running` : 'nothing running'}{failed ? ` · ${failed} failed` : ''} · {children.length} in all</summary>
    <ul>{ordered.map(a => {
      const name = (a.name || 'Sub-agent').trim(), line = name.split('\n', 1)[0];
      return <li key={a.id} data-parent={a.parentId} data-tone={childTone(a.status)} title={name}>
        <span className="activity-name">{line}{line.length < name.length ? ' …' : ''}</span>
        <small className="activity-state">{childState(a.status)}</small>
      </li>;
    })}</ul>
    {session.activityTruncated && <small>Additional activity was omitted.</small>}
  </details>;
}

export function TranscriptNotice({ error, onRetry }: { error: string; onRetry(): void }) {
  return <div className="transcript-notice error" role="alert"><span>Conversation could not be loaded. {error}</span><button onClick={onRetry}>Retry conversation</button></div>;
}

/** The line above the composer while the agent works, or while the connection recovers. */
export function LiveActivity({ disconnected, live, session }: { disconnected: boolean; live: LiveStatus; session?: Session }) {
  if (disconnected) return <div key="reconnecting" className="live-activity" data-tone="busy" role="status"><LiveIndicator tone="busy"/>Connection interrupted · reconnecting…</div>;
  if (live.tone === 'busy' && session && !session.closed) return <div key="working" className="live-activity" data-tone="busy" aria-hidden="true"><LiveIndicator tone="busy"/>{live.text}</div>;
  return null;
}
