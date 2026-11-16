import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { Icon } from './Icons';
import { AttentionIcon, LiveText } from './Inbox';
import { conversationName } from './conversation-model';
import { ageLabel, attentionTitle, seenMark, type Attention } from './attention';
import { useInbox } from './useAttention';
import { readPreference, writePreference } from './view-state';
import type { ViewTarget } from './workspace-model';
import './agents-panel.css';

type Grouping = 'priority' | 'workspace';
type Section = { id: string; title: string; icon?: Attention['state']; rows: Attention[] };
const read = <T,>(store: ViewStateStore | undefined, name: string, fallback: T): T => { try { const value = JSON.parse(readPreference(store, name) || 'null'); return value ?? fallback; } catch { return fallback; } };
const write = (store: ViewStateStore | undefined, name: string, value: unknown) => { try { writePreference(store, name, JSON.stringify(value)); } catch { /* a convenience */ } };

/**
 * Every conversation across workspaces, most urgent first: needs you, failed,
 * ready for review, working, done. Pinned ones stay on top; groups fold. The
 * same attention data as the Inbox, always on screen (it docks like any panel;
 * by default it is a tab beside Workspaces).
 */
export function AgentsPanel({ collections, target, viewState, onShowSession }: { collections: Collection[]; target: ViewTarget; viewState?: ViewStateStore; onShowSession?(target: ViewTarget): void }) {
  const inbox = useInbox();
  const [grouping, setGrouping] = useState<Grouping>(() => read<string>(viewState, 'agents.grouping', 'priority') === 'workspace' ? 'workspace' : 'priority');
  const [pinned, setPinned] = useState<string[]>(() => { const value = read<unknown>(viewState, 'agents.pinned', []); return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string').slice(0, 64) : []; });
  const [folded, setFolded] = useState<string[]>(() => { const value = read<unknown>(viewState, 'agents.folded', ['idle']); return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []; });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setNow(Date.now()); }, [inbox.rows]);
  const workspace = (row: Attention) => collections.find(value => value.id === row.session.collectionId)?.name || (row.session.collectionId ? 'Unavailable workspace' : 'No workspace');
  const sections = useMemo<Section[]>(() => {
    const pins = inbox.rows.filter(row => pinned.includes(row.key)), rest = inbox.rows.filter(row => !pinned.includes(row.key));
    const out: Section[] = pins.length ? [{ id: 'pinned', title: 'Pinned', rows: pins }] : [];
    if (grouping === 'priority') return [...out, ...inbox.groups.map(group => ({ id: group.state, title: attentionTitle[group.state], icon: group.state, rows: group.rows.filter(row => !pinned.includes(row.key)) })).filter(group => group.rows.length)];
    // By workspace, each workspace's conversations in urgency order.
    const byWorkspace = new Map<string, Attention[]>();
    for (const row of rest) byWorkspace.set(row.session.collectionId, [...(byWorkspace.get(row.session.collectionId) || []), row]);
    return [...out, ...[...byWorkspace].map(([id, rows]) => ({ id: `w:${id}`, title: workspace(rows[0]), rows }))];
  }, [inbox, pinned, grouping, collections]);
  const togglePin = (key: string) => { const next = pinned.includes(key) ? pinned.filter(value => value !== key) : [key, ...pinned].slice(0, 64); setPinned(next); write(viewState, 'agents.pinned', next); };
  const toggleFold = (id: string) => { const next = folded.includes(id) ? folded.filter(value => value !== id) : [...folded, id]; setFolded(next); write(viewState, 'agents.folded', next); };
  const choose = (next: Grouping) => { setGrouping(next); write(viewState, 'agents.grouping', next); };
  const open = (row: Attention) => onShowSession?.({ collectionId: row.session.collectionId, sessionId: row.session.id, commandId: '' });
  // j/k (or arrows) move between rows, p pins, Enter opens.
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).matches('input,textarea,select')) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.agent-row')], index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[event.key];
    if (step) { event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + step))]?.focus(); return; }
    const key = (document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (event.key === 'p' && key) { event.preventDefault(); togglePin(key); }
  };
  const waiting = inbox.counts['needs-input'];
  return <div className="agents-panel" onKeyDown={keyDown}>
    <header className="agents-heading">
      <span className="agents-summary" role="status">{waiting ? `${waiting} waiting for you` : inbox.rows.length ? `${inbox.rows.length} conversation${inbox.rows.length === 1 ? '' : 's'}` : ''}</span>
      <div className="agents-grouping" role="group" aria-label="Group agents">
        <button aria-pressed={grouping === 'priority'} onClick={() => choose('priority')}>Priority</button>
        <button aria-pressed={grouping === 'workspace'} onClick={() => choose('workspace')}>By workspace</button>
      </div>
    </header>
    {!inbox.rows.length && <div className="module-empty agents-empty"><Icon name="inbox" size={22}/><p>Agents from every workspace show up here, the ones that need you first.</p></div>}
    {sections.map(section => {
      const closed = folded.includes(section.id);
      return <section key={section.id} className="agents-group" data-group={section.id}>
        <button className="agents-group-title" aria-expanded={!closed} onClick={() => toggleFold(section.id)}>
          <Icon name={closed ? 'chevronRight' : 'chevron'} size={12}/>
          {section.icon && <AttentionIcon state={section.icon} size={12}/>}
          <span className="agents-group-name">{section.title}</span><b>{section.rows.length}</b>
        </button>
        {!closed && <ul>{section.rows.map(row => <li key={row.key} data-key={row.key} data-state={row.state} data-unread={row.unread || undefined}>
          <button className="agent-row" aria-current={row.session.id === target.sessionId ? 'true' : undefined} onClick={() => open(row)}>
            <AttentionIcon state={row.state} size={14}/><span className="sr-only">{attentionTitle[row.state]}{row.unread ? ', unread' : ''}: </span>
            <span className="agent-main">
              <span className="agent-title">{row.unread && row.state !== 'needs-input' && <i className="unread-dot"/>}<strong>{conversationName(row.session)}</strong></span>
              <span className="agent-meta">{grouping === 'priority' && <span>{workspace(row)}</span>}{row.state === 'working' ? <LiveText session={row.session}/> : <em>{row.reason || attentionTitle[row.state]}</em>}</span>
            </span>
            <time className="agent-age" dateTime={row.at ? new Date(row.at).toISOString() : undefined}>{ageLabel(row.at, now)}</time>
          </button>
          <button className="icon-button agent-pin" aria-pressed={pinned.includes(row.key)} aria-label={`${pinned.includes(row.key) ? 'Unpin' : 'Pin'} ${conversationName(row.session, 'conversation')}`} title={pinned.includes(row.key) ? 'Unpin (p)' : 'Pin to the top (p)'} onClick={() => togglePin(row.key)}><Icon name="target" size={12}/></button>
          {row.unread && row.state !== 'needs-input' && <button className="icon-button agent-seen" aria-label={`Mark ${conversationName(row.session, 'conversation')} as seen`} title="Mark as seen" onClick={() => inbox.mark([{ key: row.key, at: seenMark(row) }])}><Icon name="check" size={12}/></button>}
        </li>)}</ul>}
      </section>;
    })}
  </div>;
}
