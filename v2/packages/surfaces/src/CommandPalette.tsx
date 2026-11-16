import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import { actionDefinitions, actionEnabled, bindings, displayBinding, runAction, useActionRevision, type ActionDefinition } from './actions';
import { attentionTitle, type Attention } from './attention';
import { openArtifact } from './artifact-events';
import { conversationTitle } from './conversation-model';
import { FileIcon } from './DirectoryListing';
import { bestMatch, fuzzyMatch } from './fuzzy';
import { Icon } from './Icons';
import { AttentionIcon } from './Inbox';
import { highlight } from './QuickOpen';
import { settingsTabs } from './SettingsPage';
import { userPaletteItems, useUserCommands } from './user-commands';
import type { Keymap } from './keyboard';
import { useArtifacts } from './useArtifacts';
import { useInbox } from './useAttention';
import { useMissions } from './useMissions';
import { selectMission } from './navigate-requests';
import { readPreference, writePreference } from './view-state';
import { modKey, useWorkbenchState, type Workbench } from './workbench';
import type { CommandNavigator } from './CommandCenter';
import './command-center.css';

type Kind = 'action' | 'conversation' | 'workspace' | 'file' | 'setting' | 'panel' | 'artifact' | 'mission';
const kindLabel: Record<Kind, string> = { action: 'Action', conversation: 'Conversation', workspace: 'Workspace', file: 'File', setting: 'Settings', panel: 'Panel', artifact: 'Artifact', mission: 'Mission' };
type Item = { key: string; kind: Kind; title: string; detail?: string; extra?: string; icon: ReactNode; keys?: string[]; current?: boolean; run(how: { side: boolean }): void };
type Shown = Item & { positions: number[]; score: number };
type Section = { title: string; items: Shown[] };

/** The prefixes that narrow the palette to one kind of thing. */
export const prefixes: { prefix: string; kind: Kind; label: string }[] = [
  { prefix: '>', kind: 'action', label: 'Actions' },
  { prefix: '@', kind: 'conversation', label: 'Conversations' },
  { prefix: '#', kind: 'workspace', label: 'Workspaces' },
  { prefix: '/', kind: 'file', label: 'Files' },
];
const recentKey = 'palette:recent:v1';
function readRecent(store?: ViewStateStore): string[] {
  try { const value = JSON.parse(readPreference(store, recentKey) || '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 20) : []; } catch { return []; }
}
function remember(store: ViewStateStore | undefined, key: string) {
  try { writePreference(store, recentKey, JSON.stringify([key, ...readRecent(store).filter(value => value !== key)].slice(0, 20))); } catch { /* a convenience */ }
}
/** Rows that need the person: input or approval, an unseen failure, an unseen finished turn. */
export function needsYou(rows: readonly Attention[]): Attention[] {
  return rows.filter(row => row.state === 'needs-input' || (row.unread && (row.state === 'failed' || row.state === 'review')));
}
const firstKeys = (value: string | undefined) => bindings(value).slice(0, 1).map(binding => displayBinding(binding).join(' '));

/**
 * The command palette: every action of the registry plus "go to" anything —
 * conversations in every workspace, workspaces, files, settings sections,
 * panels, artifacts and missions — in one fuzzy list. Keyboard only: type,
 * ↑/↓, Enter. A prefix narrows it: `>` actions, `@` conversations,
 * `#` workspaces, `/` files.
 */
export function CommandPalette({ keymap, navigator, viewState, initialQuery = '', onClose }: { keymap: Keymap; navigator: CommandNavigator; viewState?: ViewStateStore; initialQuery?: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [query, setQuery] = useState(initialQuery), [selected, setSelected] = useState(0);
  const recent = useMemo(() => readRecent(viewState), [viewState]);
  useActionRevision();
  const userActions = useUserCommands('palette');
  // However it closes (Esc, ⌘K again, a choice), focus returns where it was — unless the choice moves it.
  const restore = useRef(true);
  useEffect(() => {
    dialog.current?.showModal(); input.current?.focus();
    const previous = returnFocus.current;
    return () => { if (restore.current && previous?.isConnected) requestAnimationFrame(() => previous.focus?.({ preventScroll: true })); };
  }, []);
  const scope = prefixes.find(value => query.startsWith(value.prefix));
  const term = (scope ? query.slice(1) : query).trim();
  const inbox = useInbox();
  const workspaceId = navigator.current.collectionId;
  const { artifacts } = useArtifacts(navigator.showPanel && !scope ? workspaceId : '');
  const missions = useMissions();
  const files = useFileResults(navigator.workbench, scope?.kind === 'file' || (!scope && term.length >= 2) ? term : null);

  const close = () => onClose();
  const choose = (item: Item | undefined, side = false) => {
    if (!item) return;
    remember(viewState, item.key);
    restore.current = item.kind === 'action';
    close();
    // After the palette is gone, so an action sees the focus it was invoked from.
    requestAnimationFrame(() => item.run({ side }));
  };

  const items = useMemo(() => {
    const workspaceName = (id: string) => navigator.collections.find(value => value.id === id)?.name || (id ? 'Unavailable workspace' : 'No workspace');
    const actions: Item[] = (actionDefinitions as readonly ActionDefinition[]).filter(definition => definition.palette !== false && actionEnabled(definition.id)).map(definition => ({
      key: `action:${definition.id}`, kind: 'action', title: definition.title, detail: definition.group, extra: definition.keywords, icon: <Icon name={definition.icon} size={15}/>,
      keys: firstKeys(keymap[definition.id as keyof Keymap]), run: () => { runAction(definition.id, undefined, 'palette'); },
    }));
    const conversations: Item[] = inbox.rows.map(row => ({
      key: `conversation:${row.key}`, kind: 'conversation', title: conversationTitle(row.session) || 'New conversation',
      detail: `${workspaceName(row.session.collectionId)} · ${row.state === 'idle' ? row.reason : attentionTitle[row.state]}`, extra: workspaceName(row.session.collectionId),
      icon: <AttentionIcon state={row.state} size={15}/>, current: row.session.id === navigator.current.sessionId,
      run: () => navigator.goTo({ collectionId: row.session.collectionId, sessionId: row.session.id, commandId: '' }),
    }));
    const workspaces: Item[] = navigator.collections.map((collection, index) => ({
      key: `workspace:${collection.id}`, kind: 'workspace', title: collection.name || collection.id,
      detail: collection.members.map(member => member.spec?.name).filter(Boolean).join(', ') || 'No repositories', icon: <Icon name="collections" size={15}/>,
      keys: index < 9 ? firstKeys(keymap[`workspace.select.${index + 1}` as keyof Keymap]) : undefined, current: collection.id === workspaceId,
      run: () => navigator.goTo({ collectionId: collection.id, sessionId: '', commandId: '' }),
    }));
    const settings: Item[] = navigator.openSettings ? settingsTabs.map(tab => ({
      key: `setting:${tab.id}`, kind: 'setting', title: `${tab.label} settings`, detail: `Settings · ${tab.group}`, extra: 'settings preferences', icon: <Icon name={tab.icon} size={15}/>,
      run: () => navigator.openSettings!(tab.id),
    })) : [];
    const panels: Item[] = (navigator.panels || []).map(panel => ({
      key: `panel:${panel.kind}`, kind: 'panel', title: `Show ${panel.title}`, detail: 'Panel', extra: panel.title, icon: <Icon name={panel.icon} size={15}/>,
      run: () => navigator.showPanel!(panel.kind),
    }));
    const artifactItems: Item[] = navigator.showPanel ? artifacts.map(artifact => ({
      key: `artifact:${artifact.id}`, kind: 'artifact', title: artifact.title || 'Untitled artifact', detail: `Artifact · ${artifact.kind || artifact.format}`, extra: artifact.trackedPath, icon: <Icon name="artifact" size={15}/>,
      run: () => { if (!openArtifact({ collectionId: artifact.collectionId, artifactId: artifact.id })) navigator.showPanel!('artifacts'); },
    })) : [];
    const missionItems: Item[] = navigator.showPanel ? missions.missions.filter(mission => !mission.canceled).map(mission => ({
      key: `mission:${mission.id}`, kind: 'mission', title: mission.title || 'Untitled mission', detail: `Mission · ${mission.tasks.length} ${mission.tasks.length === 1 ? 'task' : 'tasks'}`, extra: mission.brief.slice(0, 200), icon: <Icon name="target" size={15}/>,
      run: () => { navigator.showPanel!('missions'); selectMission(mission.id); },
    })) : [];
    // The person's own actions (POWER.md), after the built-in ones.
    actions.push(...userPaletteItems().map(item => ({ ...item, icon: <Icon name={item.icon || 'play'} size={15}/> })));
    return { actions, conversations, workspaces, settings, panels, artifactItems, missionItems };
  }, [keymap, navigator, inbox.rows, artifacts, missions.missions, workspaceId, userActions]);

  const fileItem = (path: string): Item => {
    const slash = path.lastIndexOf('/');
    return { key: `file:${workspaceId}:${path}`, kind: 'file', title: path.slice(slash + 1), detail: slash < 0 ? '' : path.slice(0, slash), extra: path, icon: <FileIcon name={path.slice(slash + 1)} size={15}/>, run: ({ side }: { side: boolean }) => navigator.workbench?.open(path, { side: side ? 'row' : undefined, focus: true }) };
  };
  const fileItems: Item[] = useMemo(() => (files.paths || []).map(fileItem), [files.paths, navigator.workbench, workspaceId]);

  const sections: Section[] = useMemo(() => {
    const all: Item[] = [...items.actions, ...items.conversations, ...items.workspaces, ...items.settings, ...items.panels, ...items.artifactItems, ...items.missionItems];
    const plain = (rows: Item[]): Shown[] => rows.map(row => ({ ...row, positions: [], score: 0 }));
    if (!term) {
      if (scope?.kind === 'action') return [{ title: 'Actions', items: plain(items.actions) }];
      if (scope?.kind === 'conversation') return [{ title: 'Conversations', items: plain(items.conversations) }];
      if (scope?.kind === 'workspace') return [{ title: 'Workspaces', items: plain(items.workspaces) }];
      if (scope?.kind === 'file') return [{ title: navigator.workbench ? 'Recently opened' : '', items: plain(fileItems) }];
      const byKey = new Map(all.map(item => [item.key, item]));
      // Files chosen recently in this workspace come back as files.
      if (navigator.workbench) for (const key of recent) if (key.startsWith(`file:${workspaceId}:`)) byKey.set(key, fileItem(key.slice(`file:${workspaceId}:`.length)));
      const recentItems = recent.map(key => byKey.get(key)).filter((item): item is Item => !!item && !item.current).slice(0, 5);
      const used = new Set(recentItems.map(item => item.key));
      const waiting = needsYou(inbox.rows).map(row => byKey.get(`conversation:${row.key}`)).filter((item): item is Item => !!item && !used.has(item.key)).slice(0, 5);
      waiting.forEach(item => used.add(item.key));
      return [
        { title: 'Recent', items: plain(recentItems) },
        { title: 'Needs you', items: plain(waiting) },
        { title: 'Actions', items: plain(items.actions.filter(item => !used.has(item.key))) },
      ].filter(section => section.items.length);
    }
    const pool = scope ? (scope.kind === 'file' ? [] : all.filter(item => item.kind === scope.kind)) : all;
    const ranked: Shown[] = [];
    for (const item of pool) {
      const match = bestMatch(term, item.title, item.extra || item.detail);
      if (!match) continue;
      const seen = recent.indexOf(item.key);
      ranked.push({ ...item, positions: match.positions, score: match.score + (seen >= 0 ? 60 - seen * 2 : 0) + (item.kind === 'action' ? 5 : 0) });
    }
    for (const item of fileItems) {
      const match = fuzzyMatch(term, item.title) || fuzzyMatch(term, item.extra || '');
      ranked.push({ ...item, positions: match && fuzzyMatch(term, item.title) ? match.positions : [], score: (match?.score ?? 0) - (scope ? 0 : 30) });
    }
    ranked.sort((a, b) => b.score - a.score);
    return [{ title: '', items: ranked.slice(0, 60) }];
  }, [items, fileItems, term, scope, recent, inbox.rows, navigator.workbench, workspaceId]);

  const flat = sections.flatMap(section => section.items);
  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected, flat.length]);
  const keydown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (step: number) => { event.preventDefault(); setSelected(value => flat.length ? Math.max(0, Math.min(flat.length - 1, value + step)) : 0); };
    const wrap = (step: number) => { event.preventDefault(); setSelected(value => flat.length ? (value + step + flat.length) % flat.length : 0); };
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) wrap(1);
    else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) wrap(-1);
    else if (event.key === 'PageDown') move(8);
    else if (event.key === 'PageUp') move(-8);
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(flat[selected], modKey(event)); }
    else if (event.key === 'Backspace' && scope && query.length === 1) { event.preventDefault(); setQuery(''); }
  };
  const placeholder = scope ? { action: 'Run an action…', conversation: 'Go to a conversation in any workspace…', workspace: 'Go to a workspace…', file: navigator.workbench ? 'Go to a file in this workspace…' : 'Files open in the main window' }[scope.kind as 'action'] : 'Search actions, conversations, workspaces, files, settings…';
  const empty = scope?.kind === 'file' && !navigator.workbench ? 'Files are searched in a workspace window. Open the main window to go to a file.'
    : files.searching && !flat.length ? '' : files.error && scope?.kind === 'file' ? files.error : term ? `Nothing matches “${term}”.` : scope?.kind === 'file' ? 'Type a file name.' : 'Nothing here yet.';
  let index = -1;
  return <dialog ref={dialog} className="command-palette" aria-label="Command palette" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="command-palette-field">
      <Icon name="search" size={16}/>
      {scope && <span className="command-palette-scope">{scope.label}</span>}
      <input ref={input} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={keydown} placeholder={placeholder} aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="command-palette-results" aria-autocomplete="list" aria-activedescendant={flat[selected] ? `command-palette-${selected}` : undefined} spellCheck={false} autoComplete="off"/>
      {files.searching && <span className="quick-open-busy" aria-hidden="true"/>}
    </div>
    {!query && <div className="command-palette-prefixes" aria-label="Narrow the search">
      {prefixes.map(value => <button key={value.prefix} type="button" onClick={() => { setQuery(value.prefix); input.current?.focus(); }}><kbd>{value.prefix}</kbd>{value.label}</button>)}
    </div>}
    <div ref={list} id="command-palette-results" className="command-palette-results" role="listbox" aria-label="Results">
      {sections.map(section => <div key={section.title || 'results'} role="group" aria-label={section.title || 'Results'}>
        {section.title && <small className="command-palette-heading" aria-hidden="true">{section.title}</small>}
        {section.items.map(item => {
          const i = ++index;
          return <div key={item.key} id={`command-palette-${i}`} role="option" aria-selected={i === selected} className="command-palette-row" data-kind={item.kind} onPointerMove={() => setSelected(i)} onClick={event => choose(item, modKey(event))}>
            <span className="command-palette-icon">{item.icon}</span>
            <span className="command-palette-text">
              <span className="command-palette-title">{highlight(item.title, item.positions)}{item.current && <small className="command-palette-current">Current</small>}</span>
              {item.detail && <span className="command-palette-detail">{item.detail}</span>}
            </span>
            {!!item.keys?.length && <span className="command-palette-keys">{item.keys[0].split(' ').map((key, k) => <kbd key={k}>{key}</kbd>)}</span>}
            {term && !scope && <span className="command-palette-kind">{kindLabel[item.kind]}</span>}
          </div>;
        })}
      </div>)}
      {!flat.length && empty && <p className="command-palette-empty" role="status">{empty}</p>}
    </div>
    <footer className="command-palette-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>↵</kbd> run</span><span><kbd>Esc</kbd> close</span>
      <span className="command-palette-legend">{prefixes.map(value => <span key={value.prefix}><kbd>{value.prefix}</kbd> {value.label.toLowerCase()}</span>)}</span>
    </footer>
  </dialog>;
}

/** Files for the palette: the workspace's recent files with no query, its fuzzy search with one. */
function useFileResults(workbench: Workbench | undefined, term: string | null): { paths: string[]; searching: boolean; error: string } {
  const state = useOptionalWorkbenchState(workbench);
  const [result, setResult] = useState<{ paths: string[]; searching: boolean; error: string }>({ paths: [], searching: false, error: '' });
  const recent = state?.layout.recent;
  useEffect(() => {
    if (!workbench || term === null) { setResult({ paths: [], searching: false, error: '' }); return; }
    if (!term) { setResult({ paths: [...recent || []], searching: false, error: '' }); return; }
    const control = new AbortController();
    setResult(value => ({ ...value, searching: true }));
    const timer = setTimeout(() => {
      workbench.api.searchWorkspaceFiles({ collectionId: workbench.workspaceId, query: term, limit: 30 }, { signal: control.signal, timeoutMs: 15000 })
        .then(found => { if (!control.signal.aborted) setResult({ paths: found.matches.map(match => match.path), searching: false, error: '' }); },
          error => { if (!control.signal.aborted) setResult({ paths: [], searching: false, error: String(error) }); });
    }, 60);
    return () => { clearTimeout(timer); control.abort(); };
  }, [workbench, term, recent]);
  return result;
}
const noWorkbench = { subscribe: () => () => {}, getState: () => undefined };
function useOptionalWorkbenchState(workbench: Workbench | undefined) {
  return useWorkbenchState((workbench || noWorkbench) as Workbench) as ReturnType<typeof useWorkbenchState> | undefined;
}
