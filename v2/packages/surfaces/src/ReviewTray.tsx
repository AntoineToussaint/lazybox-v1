import { useEffect, useMemo, useState } from 'react';
import type { ReviewComment, Session } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { errorText } from './PullRequestFlow';
import { Icon } from './Icons';
import { dispositionLabel, freshnessLabel, groupByFile, isPending, linesLabel, matchesFilter, reviewMessage, trayFilters, type TrayFilter, reviewExcerpt } from './review-model';
import type { WorkspaceReviewState } from './useWorkspaceReview';
import './review.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const excerpt = reviewExcerpt;

/** The workspace's open coding conversations, the current one first. */
function useConversations(workspaceId: string, current?: Session) {
  const { api } = useRunner();
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    const control = new AbortController();
    void api.listHistory({ collectionId: workspaceId, limit: 30 }, { signal: control.signal, timeoutMs: 10000 }).then(history => {
      if (!control.signal.aborted) setSessions(history.sessions.filter(s => (!s.purpose || s.purpose === 'coding') && !s.closed));
    }, () => {});
    return () => control.abort();
  }, [api, workspaceId]);
  return useMemo(() => {
    const list = sessions.filter(s => s.id !== current?.id);
    return current ? [current, ...list] : list;
  }, [sessions, current]);
}

/** Every comment on the workspace's changes, by file, and the one action
 * that matters: put the pending ones in a conversation's message box as a
 * single message, for the person to read and send. */
export function ReviewTray({ workspaceId, review, conversation, onJump, onSend, onClose }: {
  workspaceId: string; review: WorkspaceReviewState; conversation?: Session;
  onJump(comment: ReviewComment): void; onSend(text: string, to: Session): void; onClose(): void;
}) {
  const conversations = useConversations(workspaceId, conversation);
  const [filter, setFilter] = useState<TrayFilter>('pending');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const counts = useMemo(() => ({ pending: review.comments.filter(isPending).length, sent: review.comments.filter(c => matchesFilter(c, 'sent')).length, settled: review.comments.filter(c => matchesFilter(c, 'settled')).length, all: review.comments.length }), [review.comments]);
  const shown = groupByFile(review.comments.filter(c => matchesFilter(c, filter)));
  const chosen = review.comments.filter(c => isPending(c) && !excluded.has(c.id));
  const to = conversations.find(s => s.id === target) || conversations[0];
  const toggle = (id: string) => setExcluded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const send = async () => {
    if (!to || !chosen.length || busy) return;
    setBusy(true); setError('');
    try {
      onSend(reviewMessage(chosen), to);
      await review.setDisposition(chosen.map(c => c.id), 'sent', { sessionId: to.id, sessionTitle: to.title || '' });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <aside className="review-tray" aria-label="Review">
    <header>
      <h3><Icon name="chat" size={14}/>Review</h3>
      <small>{counts.all ? [counts.pending && `${counts.pending} pending`, counts.sent && `${counts.sent} sent`, counts.settled && `${counts.settled} done`].filter(Boolean).join(' · ') : 'No comments yet'}</small>
      <button className="review-icon" aria-label="Close review" title="Close review" onClick={onClose}><Icon name="close" size={14}/></button>
    </header>
    <div className="review-filters" role="group" aria-label="Show">
      {trayFilters.map(f => <button key={f.value} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}<span>{counts[f.value]}</span></button>)}
    </div>
    <div className="review-tray-list">
      {!counts.all && <p className="review-empty">Hover a line in the diff and click <b>+</b> to comment on it. Drag or Shift-click to comment on several lines. Comments collect here until you send them to the agent.</p>}
      {counts.all > 0 && !shown.length && <p className="review-empty">{filter === 'pending' ? (counts.sent ? `Nothing pending. ${plural(counts.sent, 'comment')} sent to the agent, under Sent.` : 'Nothing pending. New comments show up here.') : 'Nothing here.'}</p>}
      {shown.map(group => <section key={group.file}>
        <h4 title={group.file}>{group.file}</h4>
        <ul>{group.comments.map(c => {
          const fresh = freshnessLabel(c);
          return <li key={c.id} className={`is-${c.disposition || 'open'}`}>
            {isPending(c) && <input type="checkbox" checked={!excluded.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Include the comment on ${group.file} ${linesLabel(c.side, c.startLine, c.endLine).toLowerCase()}`}/>}
            <button className="review-tray-jump" onClick={() => onJump(c)} title="Show in the diff">
              <span className="review-tray-where">{linesLabel(c.side, c.startLine, c.endLine)}{fresh && <span className={`review-chip fresh-${c.freshness}`}>{fresh}</span>}{!isPending(c) && <span className={`review-chip is-${c.disposition}`}>{dispositionLabel(c)}</span>}</span>
              <span className="review-tray-body">{excerpt(c.body)}</span>
            </button>
          </li>;
        })}</ul>
      </section>)}
    </div>
    <footer>
      {error && <p className="review-error" role="alert">{error}</p>}
      {conversations.length > 1 && <label className="review-target">Send to<select value={to?.id || ''} onChange={event => setTarget(event.target.value)} aria-label="Conversation">
        {conversations.map(s => <option key={s.id} value={s.id}>{s.title || 'Untitled conversation'}{s.id === conversation?.id ? ' (current)' : ''}</option>)}
      </select></label>}
      <button className="primary review-send" disabled={!chosen.length || !to || busy} onClick={() => void send()}>
        <Icon name="send" size={14}/>{chosen.length ? `Send ${plural(chosen.length, 'comment')} to the agent` : 'Send review to the agent'}
      </button>
      <small className="review-muted">{!to ? 'No conversation in this workspace yet. Start one to send it comments.' : `Goes to the message box of “${to.title || 'the conversation'}” as one message. You review it and send it; nothing is sent for you.`}</small>
      <label className="review-auto"><input type="checkbox" checked={review.autoResolve} onChange={event => { const enabled = event.target.checked; void review.setAutoResolve(enabled).catch(e => setError(errorText(e))); }}/>Resolve sent comments when a commit changes their lines</label>
    </footer>
  </aside>;
}
