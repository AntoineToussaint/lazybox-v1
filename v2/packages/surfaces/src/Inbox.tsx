import { peekProps } from './peek-model';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { Icon } from './Icons';
import { useLiveStatus } from './LiveIndicator';
import { useRunner } from './RunnerContext';
import { conversationDetails, conversationName } from './conversation-model';
import { useKeyboardAction, useKeymap, type Keymap } from './keyboard';
import { ageLabel, attentionTitle, seenMark, type Attention, type AttentionState, type Inbox } from './attention';
import { attentionChanges, deliverAttention } from './attention-alerts';
import { bindings, displayKey, isChord } from './actions';
import { useAttentionHost, useInbox, useNotificationPreferences, useViewingReader } from './useAttention';
import { MissionInboxSection, useAwaitingTasks } from './MissionInbox';
import type { ViewTarget } from './workspace-model';
import './inbox.css';
import { contextMenu } from './ContextMenu';

const stateIcon: Record<AttentionState, string> = { 'needs-input': 'ask', failed: 'alert', review: 'eye', working: 'working', idle: 'done' };
export function AttentionIcon({ state, size = 16 }: { state: AttentionState; size?: number }) {
  return <span className={`attention-icon attention-${state}`} aria-hidden="true"><Icon name={stateIcon[state]} size={size}/></span>;
}
const doneLimit = 8;
/** A working row says what the agent is doing, and for how long: "Running · Bash · 12s". */
export function LiveText({ session }: { session: Inbox['rows'][number]['session'] }) {
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
  useAttentionNotifier(inbox, collections, selection, onOpen, keymap);
  const awaiting = useAwaitingTasks();
  const needsInput = inbox.counts['needs-input'] + awaiting, count = inbox.unread + awaiting;
  const label = [inbox.unread ? `Inbox, ${inbox.unread} ${inbox.unread === 1 ? 'conversation needs' : 'conversations need'} attention` : 'Inbox', awaiting ? `${awaiting} ${awaiting === 1 ? 'task awaits' : 'tasks await'} acceptance` : ''].filter(Boolean).join(', ');
  return <>
    <button className="toolbar-action inbox-action" aria-label={label} title={`Inbox (${keymap['inbox.open']})`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon name="inbox"/><span>Inbox</span>
      {count > 0 && <b className={`inbox-count${needsInput ? ' urgent' : ''}`} aria-hidden="true">{count > 99 ? '99+' : count}</b>}
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
  const waiting = inbox.counts['needs-input'] + useAwaitingTasks();
  const summary = waiting ? `${waiting} waiting for you` : unseen.length ? `${unseen.length} to review` : inbox.rows.length ? 'All caught up' : '';
  return <dialog ref={dialog} className="inbox-dialog" aria-labelledby="inbox-title" onCancel={onClose} onKeyDown={keyDown}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header>
      <h2 id="inbox-title">Inbox</h2>
      {summary && <span className="inbox-summary" role="status">{summary}</span>}
      <button className="inbox-mark-all" disabled={!unseen.length} onClick={() => markSeen(unseen)} title="Mark every finished or failed conversation as seen"><Icon name="checkAll" size={15}/><span>Mark all seen</span></button>
      <button data-close-inbox className="icon-button" aria-label="Close inbox" onClick={onClose}>×</button>
    </header>
    <div className="inbox-body">
      <MissionInboxSection onOpen={onOpen}/>
      {!inbox.rows.length && <div className="inbox-empty"><Icon name="inbox" size={28}/><strong>No conversations yet</strong><p>Agents that need you will show up here, from every workspace.</p></div>}
      {inbox.rows.length > 0 && !waiting && !inbox.counts.failed && !inbox.counts.review && <p className="inbox-caught-up"><Icon name="check" size={14}/>Nothing needs you right now.</p>}
      {inbox.groups.map(group => {
        const visible = group.state === 'idle' && !allDone ? group.rows.slice(0, doneLimit) : group.rows;
        return <section key={group.state} className={`inbox-group group-${group.state}`} aria-labelledby={`inbox-group-${group.state}`}>
          <h3 id={`inbox-group-${group.state}`}><AttentionIcon state={group.state} size={13}/>{attentionTitle[group.state]}<span>{group.rows.length}</span></h3>
          <ul>{visible.map(row => <li key={row.key} className="inbox-item" data-key={row.key} data-state={row.state} data-unread={row.unread || undefined}
            onContextMenu={contextMenu('inbox-item', () => [
              { label: 'Open', icon: 'chat', shortcut: 'Enter', run: () => onOpen({ collectionId: row.session.collectionId, sessionId: row.session.id, commandId: '' }) },
              { label: 'Mark as seen', icon: 'check', shortcut: 'M', disabled: !row.unread ? 'Already seen' : row.state === 'needs-input' && 'It waits for your answer', run: () => markSeen([row]) },
              'separator',
              { label: 'Mark all seen', icon: 'checkAll', disabled: !unseen.length, run: () => markSeen(unseen) },
            ], { sessionId: row.session.id, workspaceId: row.session.collectionId })}>
            <button className="inbox-row" {...peekProps({ kind: 'conversation', sessionId: row.session.id, workspaceId: row.session.collectionId, title: conversationName(row.session) })} aria-current={row.session.id === selection.sessionId ? 'true' : undefined} onClick={() => onOpen({ collectionId: row.session.collectionId, sessionId: row.session.id, commandId: '' })}>
              <AttentionIcon state={row.state}/><span className="sr-only">{attentionTitle[row.state]}{row.unread ? ', unread' : ''}: </span>
              <span className="inbox-main">
                <span className="inbox-title">{row.unread && row.state !== 'needs-input' && <i className="unread-dot"/>}<strong>{conversationName(row.session)}</strong></span>
                <span className="inbox-meta"><span>{workspace(row)}</span><span>{conversationDetails(row.session, info?.profiles || [], false)}</span></span>
                {(row.line || row.state !== 'idle') && <span className="inbox-line">{row.state === 'working' ? <LiveText session={row.session}/> : <em>{row.reason}</em>}{row.line && <> · {row.line}</>}</span>}
              </span>
              <time className="inbox-age" dateTime={row.at ? new Date(row.at).toISOString() : undefined} title={row.at ? new Date(row.at).toLocaleString() : undefined}>{ageLabel(row.at, now)}</time>
            </button>
            {row.unread && row.state !== 'needs-input' && <button className="inbox-seen icon-button" aria-label={`Mark ${conversationName(row.session, 'conversation')} as seen`} title="Mark as seen (m)" onClick={() => markSeen([row])}><Icon name="check" size={14}/></button>}
          </li>)}</ul>
          {visible.length < group.rows.length && <button className="inbox-more" onClick={() => setAllDone(true)}>Show {group.rows.length - visible.length} more</button>}
        </section>;
      })}
    </div>
    <footer><kbd>j</kbd><kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>m</kbd> mark seen <kbd>Esc</kbd> close</footer>
  </dialog>;
}

/** Notifications and the dock badge, from the one window whose host can show them. */
function useAttentionNotifier(inbox: Inbox, collections: Collection[], selection: ViewTarget, onOpen: (target: ViewTarget) => void, keymap: Keymap) {
  const host = useAttentionHost();
  const [preferences] = useNotificationPreferences();
  const viewing = useViewingReader();
  const previous = useRef<Map<string, Attention>>(undefined);
  const open = useRef(onOpen); open.current = onOpen;
  const latest = useRef({ collections, selection, preferences, viewing, keymap }); latest.current = { collections, selection, preferences, viewing, keymap };
  useEffect(() => {
    if (!host?.notifyAttention) return;
    const before = previous.current, { collections, selection, preferences, viewing } = latest.current;
    previous.current = new Map(inbox.rows.map(row => [row.key, row]));
    if (!before) return;
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const here = focused ? inbox.rows.find(row => row.session.id === selection.sessionId)?.key : '';
    const elsewhere = viewing();
    const notices = attentionChanges(before, inbox.rows, row => row.key === here || row.key === elsewhere, row => collections.find(value => value.id === row.session.collectionId)?.name);
    const next = bindings(latest.current.keymap['attention.next']).find(isChord);
    deliverAttention(notices, preferences, { host, focused, nextKey: next ? displayKey(next) : undefined, open: notice => open.current({ collectionId: notice.collectionId, sessionId: notice.sessionId, commandId: '' }) });
  }, [host, inbox.rows]);
  const badge = preferences.badge ? inbox.counts['needs-input'] : 0;
  useEffect(() => {
    if (!host?.setAttentionBadge) return;
    void host.setAttentionBadge(badge).catch(() => {});
  }, [host, badge]);
  useEffect(() => () => { void host?.setAttentionBadge?.(0).catch(() => {}); }, [host]);
  useEffect(() => host?.onAttentionOpen?.(destination => open.current({ collectionId: destination.collectionId, sessionId: destination.sessionId, commandId: '' })), [host]);
}
