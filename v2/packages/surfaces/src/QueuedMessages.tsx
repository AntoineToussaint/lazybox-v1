/**
 * Messages waiting behind the turn in progress, above the message box. A
 * server, a watcher or a long build can keep a turn busy for a long time, so a
 * queued message is never stuck there: **Send now**, one click, interrupts the
 * turn (its tooltip names the step it stops) and sends the message as the next turn, and
 * **Steer**, where the agent can take a message mid-turn (Codex), gives it to
 * the running turn without stopping it. Claude cannot: the strip says so and
 * offers Send now.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { JournalEvent, QueuedMessage, Session } from '@lazybox/protocol';
import { Icon } from './Icons';
import { elapsedLabel, toolLabel, type LiveStatus } from './live-status';
import { useNow } from './LiveIndicator';
import { rootStep, stepDetail } from './live-step';
import { messageOrigin, systemEventView } from './system-events';
import './queued-messages.css';

/**
 * The step a Send now would stop, as the strip names it: its command, else its
 * words; and what it is, with when it started, as the live bar says it.
 */
export function stepName(activity: readonly JournalEvent[]): { code?: string; words?: string; label?: string; startedAt?: number } {
  const step = rootStep(activity);
  if (!step) return {};
  const detail = stepDetail(step);
  const label = detail.code ? toolLabel(step.name) : detail.words;
  return { ...(detail.code ? { code: detail.code } : detail.words ? { words: detail.words } : {}), ...(label ? { label } : {}), startedAt: step.startedAt };
}

const clip = (text: string, length = 140) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > length ? line.slice(0, length - 1) + '…' : line; };

export function QueuedMessages({ api, session, sessionID, live, agentName, activity }: {
  api: RunnerClient;
  session?: Session;
  sessionID: string;
  live: LiveStatus;
  agentName: string;
  /** The conversation's activity, to name the step Send now stops. */
  activity: readonly JournalEvent[];
}) {
  const queued = session?.queuedMessages || [];
  const busy = !!session?.busy && !session.closed;
  const [collapsed, setCollapsed] = useState(false);
  const [working, setWorking] = useState<{ id: string; how: 'now' | 'steer' }>();
  const [error, setError] = useState<{ id: string; text: string }>();
  const step = useMemo(() => busy ? stepName(activity) : {}, [busy, activity]);
  const now = useNow(busy && queued.length > 0);
  // A message that left the queue takes its confirmation, progress and error with it.
  const ids = queued.map(message => message.operationId).join('\0');
  useEffect(() => {
    const present = new Set(ids.split('\0'));
    if (working && !present.has(working.id)) setWorking(undefined);
    if (error && !present.has(error.id)) setError(undefined);
  }, [ids]);
  if (!busy || !queued.length) return null;

  const steer = !!session?.capabilities?.steer;
  const deliver = async (message: QueuedMessage, how: 'now' | 'steer') => {
    setError(undefined); setWorking({ id: message.operationId, how });
    try { await api.apply({ sessionId: sessionID, operationId: crypto.randomUUID(), operation: { case: 'deliverQueued', value: { operationId: message.operationId, how } } }); }
    catch (e) { setWorking(undefined); setError({ id: message.operationId, text: `${how === 'steer' ? 'Could not steer' : 'Could not send it now'}: ${String(e instanceof Error ? e.message : e).replace(/^\[\w+\]\s*/, '')}` }); }
  };
  const many = queued.length > 1;
  const shown = collapsed ? [] : many && queued.length > 2 ? queued.slice(0, 2) : queued;
  // What the agent is busy with, as the live bar says it: the step and its time, else the status line.
  const stops = step.code ? `Stop ${step.code}` : step.words ? `Stop the running step (${step.words.charAt(0).toLowerCase() + step.words.slice(1)})` : `Stop what ${agentName} is doing`;
  const busyWith = step.label ? `${step.label}${step.startedAt !== undefined && now >= step.startedAt ? ` · ${elapsedLabel(now - step.startedAt)}` : ''}`
    : live.tone === 'busy' || live.tone === 'waiting' ? live.text : 'working';

  return <section className="queued-messages" aria-label="Queued messages">
    <header className="queued-head">
      <Icon name="pending" size={12}/>
      <span role="status"><strong>{many ? `${queued.length} messages queued` : 'Queued'}</strong> — {agentName} is busy ({busyWith})</span>
      <button type="button" className="queued-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}
        title={collapsed ? 'Show the queued messages' : 'Hide them here; they still go after the current turn'}>
        <Icon name={collapsed ? 'expand' : 'collapse'} size={11}/><span>{collapsed ? 'Show' : 'Hide'}</span>
      </button>
    </header>
    {shown.length > 0 && <ul className="queued-list">
      {shown.map(message => {
        const mine = working?.id === message.operationId;
        // A message Lazybox wrote says what it is, not the words it carries.
        const origin = messageOrigin(message.origin), event = origin && systemEventView(origin, agentName);
        return <li key={message.operationId} className="queued-message" data-origin={origin?.kind} aria-label={event ? `Queued from Lazybox: ${event.line}` : `Queued message: ${clip(message.text, 80)}`}>
          <div className="queued-row">
            {event ? <span className="queued-text queued-event" title={message.text}><Icon name={event.icon} size={11}/><span>{clip(event.line)}</span>{event.detail && <small>{event.detail}</small>}</span>
              : <q className="queued-text" title={message.text}>{clip(message.text)}</q>}
            <span className="queued-actions">
              {mine ? <span className="queued-working" role="status">{working!.how === 'steer' ? 'Steering…' : 'Stopping the current step…'}</span> : <>
                {steer && <button type="button" onClick={() => void deliver(message, 'steer')}
                  title={`Give ${agentName} this message now, inside the running turn, without stopping it`}><Icon name="send" size={11}/>Steer</button>}
                <button type="button" onClick={() => void deliver(message, 'now')}
                  title={`${stops} and send this as the next turn`}><Icon name="stop" size={11}/>Send now</button>
              </>}
            </span>
          </div>
          {error?.id === message.operationId && <p className="queued-error" role="alert">{error.text}</p>}
        </li>;
      })}
    </ul>}
    {!collapsed && queued.length > shown.length && <p className="queued-more">and {queued.length - shown.length} more, sent in order after these</p>}
    {!collapsed && !steer && <p className="queued-note">{agentName} can’t take a message in the middle of a turn: <strong>Send now</strong> stops its current step first, then sends yours.</p>}
  </section>;
}
