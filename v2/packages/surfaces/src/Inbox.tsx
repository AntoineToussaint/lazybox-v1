import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { Icon } from './Icons';
import { useLiveStatus } from './LiveIndicator';
import { useRunner } from './RunnerContext';
import { conversationDetails, conversationTitle } from './conversation-model';
import { useKeyboardAction, useKeymap } from './keyboard';
import { ageLabel, attentionTitle, noticeFor, seenMark, type Attention, type AttentionState, type Inbox } from './attention';
import { useAttentionHost, useInbox, useNotificationPreferences, useViewingReader } from './useAttention';
import type { ViewTarget } from './workspace-model';
import './inbox.css';

const stateIcon: Record<AttentionState, string> = { 'needs-input': 'ask', failed: 'alert', review: 'eye', working: 'working', idle: 'done' };
export function AttentionIcon({ state, size = 16 }: { state: AttentionState; size?: number }) {
  return <span className={`attention-icon attention-${state}`} aria-hidden="true"><Icon name={stateIcon[state]} size={size}/></span>;
}
const doneLimit = 8;
/** A working row says what the agent is doing, and for how long: "Running · Bash · 12s". */
function LiveText({ session }: { session: Inbox['rows'][number]['session'] }) {
  const status = useLiveStatus(session);
  return <em className="inbox-live" data-tone={status.tone}>{status.text}</em>;
}

/**
 * The attention inbox: one header entry with a count, a list of every
 * conversation across workspaces grouped by what it needs, and — in the window
 * whose host can notify — desktop notifications and the dock badge.
 */
export function AttentionCenter({ collections, selection, onOpen, viewState }: { collections: Collection[]; selection: ViewTarget; onOpen(target: ViewTarget): void; viewState?: ViewStateStore }) {
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  const keymap = useKeymap(viewState);
  useKeyboardAction('inbox.open', () => setOpen(true));
  useAttentionNotifier(inbox, collections, selection, onOpen);
  const needsInput = inbox.counts['needs-input'];
  const label = inbox.unread ? `Inbox, ${inbox.unread} ${inbox.unread === 1 ? 'conversation needs' : 'conversations need'} attention` : 'Inbox';
  return <>
    <button className="toolbar-action inbox-action" aria-label={label} title={`Inbox (${keymap['inbox.open']})`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon name="inbox"/><span>Inbox</span>
      {inbox.unread > 0 && <b className={`inbox-count${needsInput ? ' urgent' : ''}`} aria-hidden="true">{inbox.unread > 99 ? '99+' : inbox.unread}</b>}
    </button>
    {open && <InboxDialog inbox={inbox} collections={collections} selection={selection} onClose={() => setOpen(false)} onOpen={target => { setOpen(false); onOpen(target); }}/>}
  </>;
}

function InboxDialog({ inbox, collections, selection, onClose, onOpen }: { inbox: ReturnType<typeof useInbox>; collections: Collection[]; selection: ViewTarget; onClose(): void; onOpen(target: ViewTarget): void }) {
  const { info } = useRunner();
  const dialog = useRef<HTMLDialogElement>(null);
  const [allDone, setAllDone] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    dialog.current?.showModal();
    (dialog.current?.querySelector<HTMLElement>('.inbox-row') || dialog.current?.querySelector<HTMLElement>('[data-close-inbox]'))?.focus();
  }, []);
  useEffect(() => { setNow(Date.now()); }, [inbox.rows]);
  const workspace = (row: Attention) => collections.find(value => value.id === row.session.collectionId)?.name || (row.session.collectionId ? 'Unavailable workspace' : 'No workspace');
  const unseen = inbox.rows.filter(row => row.unread && row.state !== 'needs-input');
  const markSeen = (rows: Attention[]) => inbox.mark(rows.map(row => ({ key: row.key, at: seenMark(row) })));
  const rows = () => [...dialog.current?.querySelectorAll<HTMLButtonElement>('.inbox-row') || []];
  const move = (step: number) => {
    const list = rows(), index = list.indexOf(document.activeElement as HTMLButtonElement);
    list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + step))]?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).matches('input,textarea,select')) return;
    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'm') {
      const key = (document.activeElement as HTMLElement)?.closest<HTMLElement>('.inbox-item')?.dataset.key;
      const row = inbox.rows.find(value => value.key === key);
      if (row?.unread && row.state !== 'needs-input') { event.preventDefault(); markSeen([row]); }
    }
  };
  const summary = inbox.counts['needs-input'] ? `${inbox.counts['needs-input']} waiting for you` : unseen.length ? `${unseen.length} to review` : inbox.rows.length ? 'All caught up' : '';
  return <dialog ref={dialog} className="inbox-dialog" aria-labelledby="inbox-title" onCancel={onClose} onKeyDown={keyDown}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header>
      <h2 id="inbox-title">Inbox</h2>
      {summary && <span className="inbox-summary" role="status">{summary}</span>}
      <button className="inbox-mark-all" disabled={!unseen.length} onClick={() => markSeen(unseen)} title="Mark every finished or failed conversation as seen"><Icon name="checkAll" size={15}/><span>Mark all seen</span></button>
      <button data-close-inbox className="icon-button" aria-label="Close inbox" onClick={onClose}>×</button>
    </header>
    <div className="inbox-body">
      {!inbox.rows.length && <div className="inbox-empty"><Icon name="inbox" size={28}/><strong>No conversations yet</strong><p>Agents that need you will show up here, from every workspace.</p></div>}
      {inbox.rows.length > 0 && !inbox.counts['needs-input'] && !inbox.counts.failed && !inbox.counts.review && <p className="inbox-caught-up"><Icon name="check" size={14}/>Nothing needs you right now.</p>}
      {inbox.groups.map(group => {
        const visible = group.state === 'idle' && !allDone ? group.rows.slice(0, doneLimit) : group.rows;
        return <section key={group.state} className={`inbox-group group-${group.state}`} aria-labelledby={`inbox-group-${group.state}`}>
          <h3 id={`inbox-group-${group.state}`}><AttentionIcon state={group.state} size={13}/>{attentionTitle[group.state]}<span>{group.rows.length}</span></h3>
          <ul>{visible.map(row => <li key={row.key} className="inbox-item" data-key={row.key} data-state={row.state} data-unread={row.unread || undefined}>
            <button className="inbox-row" aria-current={row.session.id === selection.sessionId ? 'true' : undefined} onClick={() => onOpen({ collectionId: row.session.collectionId, sessionId: row.session.id, commandId: '' })}>
              <AttentionIcon state={row.state}/><span className="sr-only">{attentionTitle[row.state]}{row.unread ? ', unread' : ''}: </span>
              <span className="inbox-main">
                <span className="inbox-title">{row.unread && row.state !== 'needs-input' && <i className="unread-dot"/>}<strong>{conversationTitle(row.session) || 'New conversation'}</strong></span>
                <span className="inbox-meta"><span>{workspace(row)}</span><span>{conversationDetails(row.session, info?.profiles || [], false)}</span></span>
                {(row.line || row.state !== 'idle') && <span className="inbox-line">{row.state === 'working' ? <LiveText session={row.session}/> : <em>{row.reason}</em>}{row.line && <> · {row.line}</>}</span>}
              </span>
              <time className="inbox-age" dateTime={row.at ? new Date(row.at).toISOString() : undefined} title={row.at ? new Date(row.at).toLocaleString() : undefined}>{ageLabel(row.at, now)}</time>
            </button>
            {row.unread && row.state !== 'needs-input' && <button className="inbox-seen icon-button" aria-label={`Mark ${row.session.title || 'conversation'} as seen`} title="Mark as seen (m)" onClick={() => markSeen([row])}><Icon name="check" size={14}/></button>}
          </li>)}</ul>
          {visible.length < group.rows.length && <button className="inbox-more" onClick={() => setAllDone(true)}>Show {group.rows.length - visible.length} more</button>}
        </section>;
      })}
    </div>
    <footer><kbd>j</kbd><kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>m</kbd> mark seen <kbd>Esc</kbd> close</footer>
  </dialog>;
}

/** Notifications and the dock badge, from the one window whose host can show them. */
function useAttentionNotifier(inbox: Inbox, collections: Collection[], selection: ViewTarget, onOpen: (target: ViewTarget) => void) {
  const host = useAttentionHost();
  const [preferences] = useNotificationPreferences();
  const viewing = useViewingReader();
  const previous = useRef<Map<string, Attention>>(undefined);
  const latest = useRef({ collections, selection, preferences, viewing }); latest.current = { collections, selection, preferences, viewing };
  useEffect(() => {
    if (!host?.notifyAttention) return;
    const before = previous.current, { collections, selection, preferences, viewing } = latest.current;
    previous.current = new Map(inbox.rows.map(row => [row.key, row]));
    if (!before) return;
    const here = document.visibilityState === 'visible' && document.hasFocus() ? inbox.rows.find(row => row.session.id === selection.sessionId)?.key : '';
    const elsewhere = viewing();
    const notices = inbox.rows.flatMap(row => {
      const notice = noticeFor(before.get(row.key), row, preferences, row.key === here || row.key === elsewhere, collections.find(value => value.id === row.session.collectionId)?.name);
      return notice ? [notice] : [];
    });
    // A burst (many agents failing at once) is one summary, not a wall of banners.
    const shown = notices.length > 3 ? [...notices.slice(0, 2), { ...notices[2], title: `${notices.length - 2} more conversations need you`, body: 'Open the Lazybox inbox to see them all.' }] : notices;
    for (const notice of shown) void host.notifyAttention(notice).catch(() => {});
  }, [host, inbox.rows]);
  const badge = preferences.badge ? inbox.counts['needs-input'] : 0;
  useEffect(() => {
    if (!host?.setAttentionBadge) return;
    void host.setAttentionBadge(badge).catch(() => {});
  }, [host, badge]);
  useEffect(() => () => { void host?.setAttentionBadge?.(0).catch(() => {}); }, [host]);
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => host?.onAttentionOpen?.(destination => open.current({ collectionId: destination.collectionId, sessionId: destination.sessionId, commandId: '' })), [host]);
}
