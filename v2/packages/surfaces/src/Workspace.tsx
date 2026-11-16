import { ActionMenu } from './ActionMenu';
import { LeaderMenu } from './LeaderMenu';
import { WorkspaceNavigator } from './WorkspaceNavigator';
import {useKeyboardAction, useKeyboardNavigation} from './keyboard';
import {RepositoryHostContext} from './RepositoryBrowser';
import {conversationReader} from './transcript-cache';
import { WorkspaceRepositories } from './WorkspaceRepositories';
import { ChangesPanel } from './ChangesPanel';
import { TelemetryPanel } from './TelemetryPanel';
import { ProcessesPanel } from './ProcessesPanel';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore, WorkspaceHost } from '@lazybox/platform';
import { RunnerProvider, useRunner, type RunnerConnection } from './RunnerContext';
import { ChatPanel } from './AgentWindow';
import { WorkspaceHome } from './WorkspaceHome';
import { ConversationList } from './ConversationList';
import { CollectionPanel } from './CollectionPanel';
import { CommandPanel } from './CommandPanel';
import { useCommandRuns } from './command-runs';
import { TerminalPanel, requestTerminal } from './TerminalPanel';
import { conversationTitle, mergeConversations } from './conversation-model';
import { retireMonitor, clonePage, defaultLayout, emptyTarget, mapPanels, movePanel, panels, parseLayout, removePanel, resolveTarget, mainLayout, detachedFor, pinnedTarget, closable, contentIndex, defaultDock, dockPanel, dockedSide, dockSides, isDockSide, showPanel, dedupeChats, repairLayout, routeChat, returnChat, showCodePanel, type DockSide, type LayoutNode, type Panel, type ViewTarget, type WorkspaceLayout, type WorkspacePage } from './workspace-model';
import './workspace.css';
import './workspace-shell.css';
import { Icon } from './Icons';
import { sessionStatus } from './agent-status';
import { SettingsPage, type SettingsTab } from './SettingsPage';
import { RestartNotice, RunnerIndicator } from './RunnerControl';
import { AttentionCenter } from './Inbox';
import { AttentionScope } from './useAttention';
import { FileExplorer } from './FileExplorer';
import { EditorArea } from './EditorArea';
import { QuickOpen } from './QuickOpen';
import { FilePreview } from './FilePreview';
import type { FileLink } from './file-reference';
import { Workbench, WorkbenchContext, modKey, shortcut } from './workbench';

export type ModuleProps = { workspaceId: string; chooseRepositoryFolder?(): Promise<string | null>; target: ViewTarget; onTarget(target: ViewTarget): void; collections: Collection[]; error: string; loaded?: boolean; refresh(): void; viewState?: ViewStateStore; onOpenViewer?(sessionId: string, commandId: string): Promise<void>; onOpenChat?(): void; onNewConversation?(workspaceId: string): void; onShowSession?(target: ViewTarget): void; onShowPanel?(kind: string, target?: ViewTarget): void; onShowModule?(kind: 'terminal' | 'changes'): void };
export type PanelModule = { title: string; icon?: string; Component: ComponentType<ModuleProps> };
function ChatModule({ target, onTarget, viewState, collections, onOpenChat, onNewConversation, onShowModule }: ModuleProps) {
  const {api}=useRunner();
  const collection = collections.find(value => value.id === target.collectionId);
  // A workspace with no conversation open shows what it holds and how to start, not a form.
  if (collection && !target.sessionId) return <WorkspaceHome workspace={collection} viewState={viewState} onNewConversation={onNewConversation} onShowModule={onShowModule} onTarget={onTarget}/>;
  return <ChatPanel key={JSON.stringify([target.collectionId, conversationReader(api,target.sessionId).identity])} embedded showCommands={false} onOpenChat={onOpenChat} collectionId={target.collectionId} initialSessionId={target.sessionId} allowStart={!!collection && collection.state === 'ready' && !collection.ownershipUncertain} viewState={viewState} onSessionChange={sessionId => onTarget({ ...target, sessionId, commandId: '' })}/>;
}
function AssistantModule({ viewState,workspaceId }: ModuleProps) {
 const key=`${viewState?.key}:assistant-session`;
 const [sessionId,setSessionId]=useState(()=>viewState?.getItem(key)||'');
 const [purpose,setPurpose]=useState<'help'|'planning'|'summary'>(()=>{const saved=viewState?.getItem(`${key}:purpose`);return saved==='planning'||saved==='summary'?saved:'help';});
 return <><label className="assistant-purpose">Conversation<select aria-label="Assistant purpose" value={purpose} onChange={e=>{setPurpose(e.target.value as typeof purpose);viewState?.setItem(`${key}:purpose`,e.target.value);setSessionId('');viewState?.setItem(key,'');}}><option value="help">Help</option><option value="planning">Planning</option><option value="summary">Summary</option></select></label><ChatPanel key={purpose} collectionId={workspaceId} purpose={purpose} embedded showCommands={false} initialSessionId={sessionId} viewState={viewState} onSessionChange={id=>{setSessionId(id);viewState?.setItem(key,id);}}/></>;
}
/** First-party modules use the same runtime and target contract in every page. */
export const builtinPanels: Readonly<Record<string, PanelModule>> = {
  collections: { title: 'Workspaces', icon: 'collections', Component: CollectionPanel },
  chat: { title: 'Agent chat', icon: 'chat', Component: ChatModule },
  console: { title: 'Command output', icon: 'output', Component: CommandPanel },
  terminal: { title: 'Terminal', icon: 'terminal', Component: ({workspaceId,collections,viewState}) => <TerminalPanel key={workspaceId} workspaceId={workspaceId} collections={collections} viewState={viewState}/> },
  assistant: { title: 'Ask Lazybox', icon: 'chat', Component: AssistantModule },
  changes: { title: 'Changes', icon: 'branch', Component: ({workspaceId,viewState,target,onShowSession}) => <ChangesPanel key={workspaceId} workspaceId={workspaceId} sessionId={target.collectionId===workspaceId?target.sessionId:''} onShowSession={onShowSession} viewState={viewState}/> },
  usage: { title: 'Usage & cost', icon: 'sliders', Component: ({workspaceId}) => <TelemetryPanel workspaceId={workspaceId}/> },
  sessions: { title: 'Sessions', icon: 'history', Component: ({workspaceId,target,onTarget}) => <ConversationList collectionId={workspaceId} target={target} onTarget={onTarget}/> },
  processes: { title: 'Processes', icon: 'processes', Component: ({workspaceId,onShowSession,onShowPanel}) => <ProcessesPanel workspaceId={workspaceId} onShowSession={onShowSession} onShowPanel={onShowPanel}/> },
  files: { title: 'Files', icon: 'folder', Component: ({workspaceId,collections}) => <FileExplorer workspaceId={workspaceId} collections={collections}/> },
  editor: { title: 'Editor', icon: 'file', Component: ({workspaceId,viewState}) => <EditorArea workspaceId={workspaceId} viewState={viewState}/> },
};
/** Panels the page itself is made of: they are rearranged, not shown from the page menu. */
const pagePanels = new Set(['collections', 'chat', 'changes']);
const sentence = (title: string) => title.charAt(0).toLowerCase() + title.slice(1);
type Props = { modules?: Readonly<Record<string, PanelModule>>; fixedWorkspaceId?: string; connection: RunnerConnection; viewState?: ViewStateStore; initialTarget?: ViewTarget; host?: WorkspaceHost; onOpenViewer?(sessionId: string, commandId: string): Promise<void>; onTargetChange?(target: ViewTarget): Promise<void> | void };
export function Workspace(props: Props) { return <RunnerProvider connection={props.connection} expectRestart={props.host?.expectRunnerRestart}><AttentionScope root={props.viewState?.root} host={props.host}><RepositoryHostContext.Provider value={props.host||{}}><WorkspaceView {...props}/></RepositoryHostContext.Provider></AttentionScope></RunnerProvider>; }

function WorkspaceView({ modules, fixedWorkspaceId, viewState, initialTarget = emptyTarget(), host, onOpenViewer, onTargetChange }: Props) {
  const keyboardHint=useKeyboardNavigation(viewState);
  const { api, info, error: connectionError, refresh: refreshRunner, restart } = useRunner();
  const registry=useMemo(()=>({...builtinPanels,...modules}),[modules]);
  const [workspaceID,setWorkspaceID]=useState(()=>fixedWorkspaceId || initialTarget.collectionId || viewState?.getItem(`${viewState.key}:active-workspace`) || '');
  const workspaceKey=(id:string)=>`${viewState?.scope || viewState?.key}:workspace:${id || 'home'}:pages`;
  const key=workspaceKey(workspaceID);
  const [restored] = useState(() => {
    try { const saved = viewState?.getItem(key); return { layout: saved ? repairLayout(retireMonitor(parseLayout(saved))) : defaultLayout({...initialTarget,collectionId:workspaceID}), error: '' }; }
    catch (error) { return { layout: defaultLayout({...initialTarget,collectionId:workspaceID}), error: `Saved pages could not be restored: ${String(error)}. Their data has been retained.` }; }
  });
  const [layout, setLayout] = useState(restored.layout), [locked, setLocked] = useState(!!restored.error);
  const [error, setError] = useState(restored.error), [editing, setEditing] = useState(false), [configuring, setConfiguring] = useState(false), [json, setJSON] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]), [catalogError, setCatalogError] = useState(''), [revision, setRevision] = useState(0);
  // Whether this window has heard the Runner's list at all: until then there is
  // nothing to show, which is not the same as having no workspaces.
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [repositoryWorkspace,setRepositoryWorkspace]=useState<Collection>();
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [mobilePanelId, setMobilePanelId] = useState('');
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('subscriptions');
  const [newSession, setNewSession] = useState(false);
  const [quickStart, setQuickStart] = useState(false);
  const sessionStore=useMemo(()=>viewState ? {...viewState,scope:`${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}`} : undefined,[viewState,workspaceID]);
  const sessionDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (newSession) sessionDialog.current?.showModal(); else sessionDialog.current?.close(); }, [newSession]);
  const [module, setModule] = useState<string>('console'), [pending, setPending] = useState<string>('');
  // The workspace's open files and folders: one per workspace for the window's
  // lifetime, so unsaved edits survive switching workspaces and closing panels.
  const workbench = useMemo(() => workspaceID ? Workbench.for(api, workspaceID, viewState) : undefined, [api, workspaceID, viewState]);
  useEffect(() => workbench?.attach(), [workbench]);
  const [quickOpen, setQuickOpen] = useState(false), [quickLook, setQuickLook] = useState<FileLink>();
  const current = useRef(layout); current.current = layout;
  const stores = useMemo(() => new Map<string, ViewStateStore>(), [viewState,workspaceID]);
  // One element per displayed panel, created once: React renders each panel into its own
  // host (a portal) and the layout only moves that host, so docking or closing a panel
  // never remounts the others. Hosts are keyed by kind and occurrence ("chat:0"), not by
  // panel ID, so the same panel also stays mounted when another workspace's page (with
  // its own IDs) takes its place, as the workspace list must.
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const hostFor = (slot: string) => {
    let element = hosts.current.get(slot);
    if (!element) { element = document.createElement('div'); element.className = 'panel-host'; hosts.current.set(slot, element); }
    return element;
  };
  useEffect(() => {
    const retained = new Set(layout.pages.flatMap(page => panels(page.layout).map(panel => panel.id)));
    for (const id of stores.keys()) if (!retained.has(id)) stores.delete(id);
  }, [layout, stores]);
  const hasDetached = layout.pages.some(page => panels(page.layout).some(panel => panel.detached));
  const page = layout.pages.find(value => value.id === layout.selectedPage)!;
  const refreshCatalog = () => setRevision(value => value + 1);
  const refresh = () => { refreshCatalog(); refreshRunner(); };
  useEffect(() => {
    const control = new AbortController(); let updating = false;
    const update = async () => {
      if (updating) return; updating = true;
      // Bounded: a request stuck on a Runner that is going away must not stop
      // this poll from reaching its successor.
      try { const result = await api.listCollections({}, { signal: control.signal, timeoutMs: 10000 }); if (!control.signal.aborted) { setCollections(result.collections); setCatalogLoaded(true); setCatalogError(''); } }
      catch (error) { if (!control.signal.aborted) setCatalogError(String(error)); }
      finally { updating = false; }
    };
    void update(); const timer = setInterval(() => void update(), 3000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, revision]);
  const commit = (next: WorkspaceLayout, reset = false) => {
    try {
      if (locked && !reset) throw new Error('Restore, import, or explicitly reset the retained layout before editing.');
      const checked = parseLayout(JSON.stringify(next));
      viewState?.setItem(key, JSON.stringify(checked)); current.current = checked; setLayout(checked); setError(''); if (reset) setLocked(false);
      return true;
    } catch (error) { setError(String(error)); return false; }
  };
  const changePage = (next: WorkspacePage) => commit({ ...current.current, pages: current.current.pages.map(value => value.id === next.id ? next : value) });
  const changePanel = (panelID: string, change: (panel: Panel) => Panel) => {
    const live = current.current.pages.find(value => value.id === page.id);
    if (live) return changePage({ ...live, layout: mapPanels(live.layout, panel => panel.id === panelID ? change(panel) : panel) });
    return false;
  };
  const select = (target: ViewTarget) => {
    if(target.collectionId!==workspaceID){
      if(fixedWorkspaceId){if(target.collectionId)void host?.openWorkspace?.(target.collectionId);return;}
      try{
        if (!locked) viewState?.setItem(workspaceKey(workspaceID), JSON.stringify(current.current));
        const saved=viewState?.getItem(workspaceKey(target.collectionId));
        let next=saved?retireMonitor(parseLayout(saved)):defaultLayout(target);
        if(target.sessionId)next={...next,pages:next.pages.map(page=>page.id===next.selectedPage?{...page,selection:target}:page)};
        next=repairLayout(next);
        viewState?.setItem(`${viewState.key}:active-workspace`,target.collectionId);
        setWorkspaceID(target.collectionId);current.current=next;setLayout(next);setLocked(false);setEditing(false);setConfiguring(false);setError('');
      }catch(error){setError(`Could not open workspace layout: ${String(error)}`);}
      return;
    }
    const live = current.current.pages.find(value => value.id === page.id);
    if (live) changePage({ ...live, selection: target, layout: dedupeChats(live.layout, target) });
  };
  useEffect(() => {
    if (page.selection.sessionId && !page.selection.collectionId) {
      const session = info?.sessions.find(value => value.id === page.selection.sessionId);
      if (session?.collectionId) select({ ...page.selection, collectionId: session.collectionId });
    }
  }, [info, page.id, page.selection.sessionId, page.selection.collectionId]);
  useEffect(() => {
    if (onTargetChange) void Promise.resolve(onTargetChange(page.selection)).catch(error => setError(String(error)));
  }, [onTargetChange, page.selection.collectionId, page.selection.sessionId, page.selection.commandId]);
  // A run starting in the viewed session opens the console on it, once per run:
  // closing the console keeps it closed until the next run. Focus stays put.
  useCommandRuns(api, page.selection.sessionId, commandId => {
    const live = current.current.pages.find(value => value.id === page.id);
    if (!live || locked || editing || live.selection.sessionId !== page.selection.sessionId) return;
    const follows = (panel: Panel) => panel.kind === 'console' && panel.binding.mode === 'follow' && !panel.detached;
    if (!panels(live.layout).some(follows)) return;
    changePage({ ...live, selection: { ...live.selection, commandId }, layout: mapPanels(live.layout, panel => follows(panel) ? { ...panel, collapsed: false } : panel) });
  });
  const canShowNewSession = panels(page.layout).some(p => p.kind === 'chat' && p.binding.mode === 'follow' && !p.detached) || panels(page.layout).length < 12;
  const showSession = (selection: ViewTarget) => {
    setMobilePanelId('');
    if(selection.collectionId!==workspaceID){select(selection);setSettings(false);setNewSession(false);return;}
    const live = current.current.pages.find(value => value.id === page.id)!;
    const open = detachedFor(live.layout, selection);
    if (open && host) { if (changePage({ ...live, selection })) { setSettings(false); setNewSession(false); } void host.openChat({ panelId: open.id, ...pinnedTarget(open) }).catch(error => setError(String(error))); return; }
    // Reuse the page's chat panel; never stack a second panel on the same conversation.
    const shown = routeChat(live.layout, selection, () => crypto.randomUUID());
    if (changePage({ ...live, selection, layout: shown.layout })) { setSettings(false); setNewSession(false); setMobilePanelId(shown.id); }
  };
  const showChanges = () => {
    const existing = current.current.pages.find(value=>panels(value.layout).some(panel=>panel.kind==='changes'));
    if(existing){commit({...current.current,selectedPage:existing.id});setSettings(false);return;}
    const id=crypto.randomUUID();
    const review:WorkspacePage={id,name:'Changes',selection:{...page.selection,collectionId:workspaceID},layout:{type:'panel',panel:{id:crypto.randomUUID(),kind:'changes',binding:{mode:'follow'},detached:false}}};
    if(commit({...current.current,selectedPage:id,pages:[...current.current.pages,review]}))setSettings(false);
  };
  // The edge a person last docked each kind of panel at is a personal preference,
  // shared by every workspace and window: a terminal they moved left opens left.
  const dockKey = (kind: string) => `${viewState?.root || viewState?.key}:dock:${kind}`;
  const rememberedDock = (kind: string): DockSide => { try { const side = viewState?.getItem(dockKey(kind)); return isDockSide(side) ? side : defaultDock(kind); } catch { return defaultDock(kind); } };
  // Focus follows a panel that moved, or returns to the conversation when one closes.
  const focusAfter = useRef<{ panel: string } | 'content' | null>(null);
  useEffect(() => {
    const request = focusAfter.current; if (!request) return; focusAfter.current = null;
    const frame = requestAnimationFrame(() => {
      const element = request === 'content'
        ? document.querySelector<HTMLElement>('.page-layout .panel-chat textarea:not(:disabled)') || document.querySelector<HTMLElement>('.page-layout .workspace-panel:not(.panel-collections) button:not(:disabled)')
        : document.querySelector<HTMLElement>(`.page-layout [data-panel-id="${CSS.escape(request.panel)}"] .panel-menu>summary`);
      element?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [layout]);
  const livePage = () => current.current.pages.find(value => value.id === page.id)!;
  /** Show the page's panel of this kind, or dock a new one where this kind was last docked. */
  const showModule = (kind: string) => {
    const live = livePage();
    if (!panels(live.layout).some(panel => panel.kind === kind && !panel.detached) && panels(live.layout).length >= 12) { setError(`This page already has 12 panels; close one to add ${sentence(registry[kind]?.title || kind)}.`); return ''; }
    const shown = kind === 'files' || kind === 'editor' ? showCodePanel(live.layout, kind, rememberedDock(kind), () => crypto.randomUUID()) : showPanel(live.layout, kind, rememberedDock(kind), () => crypto.randomUUID());
    if (!changePage({ ...live, layout: shown.layout })) return '';
    setSettings(false); setMobilePanelId(shown.id);
    return shown.id;
  };
  /** Bring the Files or Editor panel into view: shown as it is, or docked with its partner. */
  const showCode = (kind: 'files' | 'editor') => {
    const existing = panels(livePage().layout).find(panel => panel.kind === kind && !panel.detached);
    if (existing && !existing.collapsed && !settings) { setMobilePanelId(existing.id); return existing.id; }
    return showModule(kind);
  };
  useEffect(() => {
    if (!workbench) return;
    workbench.host = { showEditor: () => void showCode('editor'), showFiles: () => void showCode('files'), quickOpen: () => setQuickOpen(true), quickLook: (path, line) => setQuickLook({ path, line }) };
  });
  const focusFiles = () => { if (showCode('files')) workbench?.focusTree(); };
  // Go to file is the editor's own shortcut, wherever focus is, as in any editor.
  useEffect(() => {
    if (!workbench) return;
    const keydown = (event: KeyboardEvent) => {
      if (!modKey(event) || event.altKey || event.shiftKey || event.code !== 'KeyP' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation(); setQuickOpen(true);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [workbench]);
  useKeyboardAction('files.find', () => { if (workbench) setQuickOpen(true); });
  useKeyboardAction('files.explorer', () => { if (workbench) focusFiles(); });
  /** Show this workspace's terminal: the open panel, or one docked beside the work. It starts a shell only when none is running. */
  const showTerminal = () => { if (workspaceID && showModule('terminal')) requestTerminal(workspaceID); };
  // A panel asked for in another workspace is shown once that workspace's page is.
  const pendingModule = useRef('');
  useEffect(() => { const kind = pendingModule.current; if (!kind) return; pendingModule.current = ''; showModule(kind); }, [workspaceID]);
  /** Show the panel of this kind for target: its workspace and conversation first, then the panel. */
  const showPanelFor = (kind: string, target?: ViewTarget) => {
    if (target && target.collectionId !== workspaceID && !fixedWorkspaceId) {
      pendingModule.current = kind;
      if (target.sessionId) showSession(target); else select(target);
      setSettings(false);
      return;
    }
    if (target?.sessionId) showSession(target);
    showModule(kind);
  };
  const dockTo = (panel: Panel, side: DockSide) => {
    const live = livePage();
    if (!changePage({ ...live, layout: dockPanel(live.layout, panel.id, side) })) return;
    try { viewState?.setItem(dockKey(panel.kind), side); } catch { /* the side is a convenience */ }
    focusAfter.current = { panel: panel.id };
  };
  const closePanel = (panel: Panel) => {
    const live = livePage(), next = removePanel(live.layout, panel.id);
    if (!next || !closable(panel)) return;
    if (changePage({ ...live, layout: next })) focusAfter.current = 'content';
  };
  const toggleCollapsed = (panel: Panel) => changePanel(panel.id, value => ({ ...value, collapsed: !value.collapsed }));
  const beginConversation = (collectionId = workspaceID) => {
    if (collectionId !== workspaceID) select({ collectionId, sessionId: '', commandId: '' });
    setNavigatorOpen(false); setQuickStart(false); setNewSession(true);
  };
  const showNewSession = (sessionId: string) => {
    showSession({ collectionId: workspaceID || info?.sessions.find(s => s.id === sessionId)?.collectionId || '', sessionId, commandId: '' });
    refreshRunner();
  };
  const detach = async (panel: Panel) => {
    if (!host || pending) return;
    const target = resolveTarget(panel, page.selection);
    if (!target.sessionId) return;
    const open = detachedFor(page.layout, target);
    if (open) { try { await host.openChat({ panelId: open.id, ...pinnedTarget(open) }); } catch (error) { setError(String(error)); } return; }
    setPending(panel.id);
    try {
      if (!changePanel(panel.id, panel => ({ ...panel, binding: { mode: 'pinned', target: { ...target } }, detached: true }))) return;
      await host.openChat({ panelId: panel.id, collectionId: target.collectionId, sessionId: target.sessionId });
    }
    catch (error) { changePanel(panel.id, () => panel); setError(String(error)); }
    finally { setPending(''); }
  };
  const dock = async (panel: Panel) => {
    if (!host || pending) return;
    setPending(panel.id);
    try {
      await host.dockChat(panel.id);
      const live = current.current.pages.find(value => value.id === page.id);
      if (live) changePage({ ...live, layout: returnChat(live.layout, panel.id, live.selection) });
    }
    catch (error) { setError(String(error)); }
    finally { setPending(''); }
  };
  const resize = (path: number[], change: (node: Extract<LayoutNode, { type: 'split' }>) => LayoutNode) => {
    const update = (node: LayoutNode, rest: number[]): LayoutNode => {
      if (node.type !== 'split') return node;
      if (!rest.length) return change(node);
      return { ...node, children: [rest[0] === 0 ? update(node.children[0], rest.slice(1)) : node.children[0], rest[0] === 1 ? update(node.children[1], rest.slice(1)) : node.children[1]] };
    };
    changePage({ ...page, layout: update(page.layout, path) });
  };
  // Drag resizes the two cells in place and saves the ratio once on release,
  // so a drag does not re-render the workspace on every pointer move.
  const splitHandle = (node: Extract<LayoutNode, { type: 'split' }>, path: number[]) => {
    const row = node.direction === 'row', clamp = (value: number) => Math.round(Math.min(0.85, Math.max(0.15, value)) * 100) / 100;
    const save = (ratio: number) => resize(path, value => ({ ...value, ratio: clamp(ratio) }));
    return <div key="handle" className="split-handle" role="separator" tabIndex={0} aria-orientation={row ? 'vertical' : 'horizontal'} aria-label={`Resize split ${path.join('-') || 'root'}`} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(node.ratio * 100)}
      onKeyDown={event => {
        const step = { ArrowLeft: -0.02, ArrowUp: -0.02, ArrowRight: 0.02, ArrowDown: 0.02 }[event.key];
        if (step === undefined) return; event.preventDefault(); save(node.ratio + step);
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const handle = event.currentTarget, first = handle.previousElementSibling as HTMLElement, second = handle.nextElementSibling as HTMLElement;
        const start = first.getBoundingClientRect(), end = second.getBoundingClientRect();
        const from = row ? start.left : start.top, span = (row ? end.right : end.bottom) - from;
        if (span <= 0) return;
        event.preventDefault(); handle.setPointerCapture(event.pointerId); handle.dataset.dragging = 'true';
        let ratio = node.ratio;
        const move = (next: PointerEvent) => {
          ratio = clamp(((row ? next.clientX : next.clientY) - from) / span);
          first.style.flex = `${ratio} 1 0`; second.style.flex = `${1 - ratio} 1 0`;
        };
        const stop = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop);
          delete handle.dataset.dragging; save(ratio);
        };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
      }}/>;
  };
  // Dragging a panel header shows where it would dock; releasing near an edge of the page
  // docks it there (the panel menu is the keyboard equivalent). Escape or a release away
  // from the edges cancels. Not on touch or phone layouts, which show one panel at a time.
  type Area = { left: number; top: number; width: number; height: number };
  const [docking, setDocking] = useState<{ id: string; side?: DockSide; area: Area } | null>(null);
  const startDrag = (event: ReactPointerEvent<HTMLElement>, panel: Panel) => {
    if (event.button !== 0 || event.pointerType === 'touch' || editing || matchMedia('(max-width: 760px)').matches) return;
    if (event.target instanceof Element && event.target.closest('.panel-menu, .panel-close')) return;
    const header = event.currentTarget, from = { x: event.clientX, y: event.clientY }, pointer = event.pointerId;
    let active = false, side: DockSide | undefined, area: DOMRect | undefined, relative: Area = { left: 0, top: 0, width: 0, height: 0 };
    // Zones cover the content area a dock lands in: beside the workspace list, not over it.
    const measure = () => {
      const page = document.querySelector('.page-layout'), index = displayedLayout ? contentIndex(displayedLayout, panel) : -1;
      const cell = index === -1 ? null : page?.querySelectorAll(':scope>.layout-split>.layout-cell')[index];
      const bounds = page?.getBoundingClientRect(); area = (cell || page)?.getBoundingClientRect();
      if (bounds && area) relative = { left: area.left - bounds.left, top: area.top - bounds.top, width: area.width, height: area.height };
    };
    const zone = (x: number, y: number): DockSide | undefined => {
      if (!area || x < area.left || x > area.right || y < area.top || y > area.bottom) return undefined;
      const distance: [DockSide, number][] = [['left', (x - area.left) / area.width], ['right', (area.right - x) / area.width], ['top', (y - area.top) / area.height], ['bottom', (area.bottom - y) / area.height]];
      const [nearest, value] = distance.reduce((best, item) => item[1] < best[1] ? item : best);
      return value < 0.25 ? nearest : undefined;
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      if (!active) { if (Math.hypot(next.clientX - from.x, next.clientY - from.y) < 6) return; active = true; header.setPointerCapture(pointer); measure(); }
      side = zone(next.clientX, next.clientY);
      setDocking(current => current?.id === panel.id && current.side === side ? current : { id: panel.id, side, area: relative });
    };
    const finish = (next: Event) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', cancel, true);
      if (!active) return;
      // The release that ends a drag is not a click on the title.
      const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };
      header.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => header.removeEventListener('click', swallow, { capture: true }), 0);
      setDocking(null);
      if (next.type === 'pointerup' && side) dockTo(panel, side);
    };
    const cancel = (key: KeyboardEvent) => { if (key.key !== 'Escape' || !active) return; key.preventDefault(); key.stopPropagation(); side = undefined; finish(key); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('keydown', cancel, true);
  };
  /** A panel's own header: its title collapses it, ⋯ docks it at any edge, × closes it. */
  const panelHeader = (panel: Panel, definition: PanelModule | undefined) => {
    const title = definition?.title || panel.kind, name = sentence(title);
    const only = panels(page.layout).length <= 1, docked = dockedSide(page.layout, panel.id);
    const canClose = closable(panel) && !only;
    return <>
      <button className="module-title" aria-label={`${panel.collapsed ? 'Show' : 'Hide'} ${name}`} aria-expanded={!panel.collapsed} title={`${panel.collapsed ? 'Show' : 'Collapse'} ${name} · drag to dock`} onClick={() => toggleCollapsed(panel)}><Icon name={definition?.icon || 'file'}/><span>{title}</span><Icon name="chevron" size={13}/></button>
      <ActionMenu className="panel-menu" label={`${title} panel actions`}>
        {dockSides.map(side => <button key={side} className="dock-option" disabled={only || docked === side || !!pending} aria-current={docked === side || undefined} onClick={() => dockTo(panel, side)}><Icon name={`dock-${side}`}/><span>Dock {side}</span>{docked === side && <small>Current</small>}</button>)}
        <button onClick={() => toggleCollapsed(panel)}><Icon name="chevron"/><span>{panel.collapsed ? 'Expand' : 'Collapse'}</span></button>
        {canClose && <button className="danger" onClick={() => closePanel(panel)}><Icon name="close"/><span>Close panel</span></button>}
      </ActionMenu>
      {canClose && <button className="icon-button panel-close" aria-label={`Close ${title} panel`} title={panel.kind === 'terminal' ? 'Close panel (shells keep running)' : 'Close panel'} onClick={() => closePanel(panel)}><Icon name="close" size={14}/></button>}
    </>;
  };
  const renderNode = (node: LayoutNode, path: number[] = []): ReactNode => {
    if (node.type === 'split') return <div className={`layout-split split-${node.direction}`}>
      {editing && <div className="split-controls"><label>Direction<select aria-label={`Direction split ${path.join('-') || 'root'}`} value={node.direction} onChange={event => resize(path, node => ({ ...node, direction: event.target.value as 'row' | 'column' }))}><option value="row">Side by side</option><option value="column">Stacked</option></select></label><label>Size<input aria-label={`Resize split ${path.join('-') || 'root'}`} type="range" min={15} max={85} value={Math.round(node.ratio * 100)} onChange={event => resize(path, node => ({ ...node, ratio: Number(event.target.value) / 100 }))}/></label></div>}
      {node.children.map((child, index) => {
        const sibling = node.children[index ? 0 : 1];
        const collapsed = child.type === 'panel' && child.panel.collapsed && !editing;
        const siblingCollapsed = sibling.type === 'panel' && sibling.panel.collapsed && !editing;
        const cell = <div key={index} className={`layout-cell${collapsed ? ' collapsed-cell' : ''}`} style={{ minWidth: node.direction === 'row' && child.type === 'panel' && child.panel.kind === 'collections' && !collapsed ? 240 : undefined, flex: collapsed ? `0 0 ${node.direction === 'column' ? 42 : 44}px` : `${siblingCollapsed ? 1 : index ? 1 - node.ratio : node.ratio} 1 0` }}>{renderNode(child, [...path, index])}</div>;
        return index === 1 && !collapsed && !siblingCollapsed ? [splitHandle(node, path), cell] : cell;
      })}
    </div>;
    return <PanelSlot host={hostFor(slots.get(node.panel.id) || node.panel.id)}/>;
  };
  const renderPanel = (panel: Panel): ReactNode => {
    const definition = Object.hasOwn(registry, panel.kind) ? registry[panel.kind] : undefined, target = resolveTarget(panel, page.selection);
    if (viewState && !stores.has(panel.id)) stores.set(panel.id, { ...viewState, scope: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}`, key: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}:panel:${panel.id}` });
    const store = stores.get(panel.id);
    const onTarget = (target: ViewTarget) => panel.binding.mode === 'pinned' ? changePanel(panel.id, value => ({ ...value, binding: { mode: 'pinned', target } })) : select(target);
    return <section className={`workspace-panel panel-${panel.kind}${panel.collapsed && !editing ? ' is-collapsed' : ''}${editing ? ' is-editing' : ''}${docking?.id === panel.id ? ' is-docking' : ''}`} aria-label={definition?.title || panel.kind} data-panel-id={panel.id} data-mobile-active={panel.id === mobilePanel?.id || undefined}>
      <header className="module-header" onPointerDown={editing ? undefined : event => startDrag(event, panel)}>{!editing ? panelHeader(panel, definition) : panel.kind === 'console' ?<button className="module-title" aria-label={panel.collapsed ? 'Show command output' : 'Hide command output'} aria-expanded={!panel.collapsed} onClick={() => changePanel(panel.id, value => ({ ...value, collapsed: !value.collapsed }))}><Icon name="terminal"/><span>{definition?.title}</span><Icon name="chevron" size={13}/></button> : <strong>{definition?.title || panel.kind}</strong>}{editing && <span>{panel.binding.mode === 'pinned' ? 'Pinned' : 'Follows page'}</span>}
        {editing && <div className="panel-config"><button disabled={panel.detached || !!pending} onClick={() => changePanel(panel.id, value => ({ ...value, binding: value.binding.mode === 'pinned' ? { mode: 'follow' } : { mode: 'pinned', target: { ...target } } }))}>{panel.binding.mode === 'pinned' ? 'Follow page' : 'Pin view'}</button><button aria-label={`Move ${panel.kind} earlier`} onClick={() => changePage({ ...page, layout: movePanel(page.layout, panel.id, -1) })}>←</button><button aria-label={`Move ${panel.kind} later`} onClick={() => changePage({ ...page, layout: movePanel(page.layout, panel.id, 1) })}>→</button><button aria-label={`Remove ${panel.kind} panel`} disabled={panels(page.layout).length === 1 || panel.detached || !!pending} onClick={() => { const next = removePanel(page.layout, panel.id); if (next) changePage({ ...page, layout: next }); }}>Remove</button></div>}
      </header>
      {(!panel.collapsed || editing) && <div className="module-body">{panel.detached ? <div className="module-empty detached-message"><Icon name="external" size={24}/><h3>Chat is in its own window</h3><p>Your conversation continues there.</p><button disabled={!host || !!pending} onClick={() => void detach(panel)}>Open chat window ↗</button><button disabled={!host || !!pending} onClick={() => void dock(panel)}>Bring chat back here</button></div> : definition ? <definition.Component workspaceId={workspaceID} chooseRepositoryFolder={host?.chooseRepositoryFolder} target={target} onTarget={panel.kind==='collections' ? target => target.sessionId ? showSession(target) : onTarget(target) : onTarget} collections={collections} error={catalogError} loaded={catalogLoaded} refresh={refreshCatalog} onNewConversation={beginConversation} onShowSession={showSession} onShowPanel={showPanelFor} onShowModule={kind => kind === 'terminal' ? showTerminal() : showChanges()} viewState={store} onOpenViewer={onOpenViewer} onOpenChat={panel.kind === 'chat' && host && target.sessionId ? () => void detach(panel) : undefined}/> : <p className="module-empty">The “{panel.kind}” module is unavailable. Its configuration has been retained.</p>}</div>}
    </section>;
  };
  const displayedLayout = editing ? page.layout : mainLayout(page.layout);
  const shownPanels = displayedLayout ? panels(displayedLayout) : [];
  const slots = new Map<string, string>(), occurrences = new Map<string, number>();
  for (const panel of shownPanels) { const n = occurrences.get(panel.kind) || 0; occurrences.set(panel.kind, n + 1); slots.set(panel.id, `${panel.kind}:${n}`); }
  useEffect(() => {
    const shown = new Set(slots.values());
    for (const slot of hosts.current.keys()) if (!shown.has(slot)) hosts.current.delete(slot);
  });
  const mobilePanels = panels(displayedLayout || page.layout).filter(panel => panel.kind !== 'collections');
  const terminalReady = !!workspaceID && collections.find(value => value.id === workspaceID)?.state === 'ready';
  // Panels this page could show but does not (or shows collapsed), offered from the page menu.
  const hiddenModules = Object.entries(registry).filter(([kind]) => !pagePanels.has(kind) && !panels(page.layout).some(panel => panel.kind === kind && !panel.detached && !panel.collapsed));
  const mobilePanel = mobilePanels.find(panel => panel.id === mobilePanelId) ||mobilePanels.find(panel => panel.kind === 'chat') || mobilePanels[0];
  return <WorkbenchContext.Provider value={workbench}><main className={`workspace-shell${editing ? ' layout-editing' : ''}`}><LeaderMenu hint={keyboardHint}/>
    <header className="workspace-header">
      <button className="mobile-navigation-button icon-button" aria-label="Open workspace navigator" aria-expanded={navigatorOpen} onClick={() => setNavigatorOpen(true)}><Icon name="sidebar"/></button>
      <div className="workspace-brand"><span className="brand-mark">l<span>↗</span></span><strong>lazybox</strong></div>
      <nav aria-label="Pages">{layout.pages.map(value => <button key={value.id} disabled={!!pending} className={!settings && value.id === page.id ? 'selected' : ''} onClick={() => { setSettings(false); commit({ ...layout, selectedPage: value.id }); }}>{value.name}</button>)}{!fixedWorkspaceId&&<button className={settings ? 'selected' : ''} onClick={() => setSettings(true)}>Settings</button>}</nav>
      <div className="workspace-header-actions">
        <AttentionCenter collections={collections} selection={page.selection} viewState={viewState} onOpen={target => { setSettings(false); showSession(target); }}/>
        <button className="toolbar-action" disabled={!workspaceID} aria-label="Review changes" title="Review changes" onClick={showChanges}><Icon name="branch"/><span>Changes</span></button>
        <button className="toolbar-action" disabled={!workspaceID} aria-label="Browse files" title={`Browse files · Go to file ${shortcut('Mod+P')}`} onClick={focusFiles}><Icon name="folder"/><span>Files</span></button>
        <button className="toolbar-action" disabled={!terminalReady} aria-label="Open terminal" title="Open a terminal in this workspace" onClick={showTerminal}><Icon name="terminal"/><span>Terminal</span></button>
        <button className="toolbar-action new-conversation-action" disabled={!info || !!pending || !canShowNewSession} aria-label="New conversation" title="New conversation" onClick={() => beginConversation()}><Icon name="plus"/><span>New conversation</span></button>
        <RunnerIndicator onOpen={fixedWorkspaceId ? undefined : () => { setSettingsTab('runner'); setSettings(true); }}/>
        <ActionMenu label="Page actions">
          {workspaceID&&host?.openWorkspace&&!fixedWorkspaceId&&<button onClick={()=>void host.openWorkspace!(workspaceID)}>Open workspace window</button>}
          <button disabled={settings} onClick={() => setEditing(value => !value)}>{editing ? 'Finish customizing' : 'Customize page'}</button>
          <button disabled={settings} onClick={() => { setJSON(JSON.stringify(layout, null, 2)); setConfiguring(value => !value); }}>Layout configuration</button>
          {!settings && !editing && hiddenModules.length > 0 && <><small className="action-menu-heading">Show panel</small>
            {hiddenModules.map(([kind, module]) => <button key={kind} className="show-panel" disabled={kind === 'terminal' && !terminalReady} onClick={() => kind === 'terminal' ? showTerminal() : void showModule(kind)}><Icon name={module.icon || 'file'}/><span>{module.title}</span></button>)}</>}
        </ActionMenu>
      </div>
    </header>
    {!settings&&panels(page.layout).some(p=>p.detached)&&<div className="detached-tabs">{panels(page.layout).filter(p=>p.detached).map(p=><span key={p.id}><button onClick={()=>void detach(p)}>↗ {info?.sessions.find(s=>s.id===resolveTarget(p,page.selection).sessionId)?.title||'Chat in separate window'}</button><button onClick={()=>void dock(p)}>Bring back</button></span>)}</div>}
    {repositoryWorkspace&&<WorkspaceRepositories workspace={collections.find(value=>value.id===repositoryWorkspace.id)||repositoryWorkspace} onClose={()=>setRepositoryWorkspace(undefined)} onSaved={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder}/>}
    <DraggableDialog ref={sessionDialog} className="new-session-dialog" onCancel={() => setNewSession(false)} onClose={() => setNewSession(false)} aria-label="New conversation">
      <DialogHeader><strong>New conversation</strong><button aria-label="Close new conversation" onClick={() => setNewSession(false)}>×</button></DialogHeader>
      <p className="conversation-scope">{workspaceID ? <>In <strong>{collections.find(value => value.id === workspaceID)?.name || 'this workspace'}</strong></> : 'Starts in a new workspace without repositories.'}</p>
      {newSession && !quickStart && <button className="quick-start-option" onClick={() => setQuickStart(true)}>Start with last settings</button>}
      {newSession && <ChatPanel autoStart={quickStart} viewState={sessionStore} embedded emptyWorkspace={!workspaceID} collectionId={workspaceID} showCommands={false} onSessionChange={showNewSession}/>}
    </DraggableDialog>
    <RestartNotice/>
    {/* A restart the person asked for explains the dropped connection; RestartNotice says so instead. */}
    {(error || (connectionError && restart.phase !== 'restarting')) && <div className="error" role="alert">{connectionError && restart.phase !== 'restarting' ? <><strong>Runner disconnected.</strong> Reconnecting automatically… <details><summary>Connection details</summary>{connectionError}</details></> : error}<button onClick={()=>{if(host?.reconnect)void host.reconnect().catch(e=>setError(String(e)));else refresh();}}>Retry now</button></div>}
    {settings ? <SettingsPage tab={settingsTab} onTab={setSettingsTab} onShowProcesses={() => showModule('processes')} chooseRepositoryFolder={host?.chooseRepositoryFolder} viewState={viewState} openSignIn={host?.openSignIn} copySignInCode={host?.copySignInCode}/> : <>
    {locked && <button onClick={() => commit(defaultLayout({...initialTarget,collectionId:workspaceID}), true)}>Reset retained layout</button>}
    {configuring && <section className="layout-json"><div className="inspector-heading"><strong>Page configuration</strong><button className="icon-button" aria-label="Close layout configuration" onClick={() => setConfiguring(false)}>×</button></div><label className="sr-only" htmlFor="page-config-json">Page configuration</label><textarea id="page-config-json" value={json} onChange={event => setJSON(event.target.value)} spellCheck={false}/><button disabled={hasDetached || !!pending} onClick={() => { try { if (commit(parseLayout(json), true)) setConfiguring(false); } catch (error) { setError(String(error)); } }}>Import layout</button><small>Panel references and arrangement only. Your account and permissions stay unchanged.</small></section>}
    <div className="workspace-context">
      <div className="collection-breadcrumb"><Icon name="folder" size={17}/><label><span className="sr-only">Workspace</span><select disabled={!!pending || !!fixedWorkspaceId} value={page.selection.collectionId} onChange={event => { if (event.target.value !== workspaceID) select({ collectionId: event.target.value, sessionId: '', commandId: '' }); }}><option value="">Choose a workspace</option>{page.selection.collectionId && !collections.some(value => value.id === page.selection.collectionId) && <option value={page.selection.collectionId}>Unavailable workspace</option>}{collections.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><button className="workspace-repositories-link" disabled={!collections.some(value=>value.id===workspaceID)} onClick={()=>setRepositoryWorkspace(collections.find(value=>value.id===workspaceID))}>{collections.find(value=>value.id===workspaceID)?.members.length||0} {collections.find(value=>value.id===workspaceID)?.members.length===1?'repository':'repositories'}</button></div>
      <label className="session-switcher"><span className="sr-only">Session</span><select value={page.selection.sessionId} onChange={event => { const session = info?.sessions.find(value => value.id === event.target.value); select({ collectionId: session ? session.collectionId : page.selection.collectionId, sessionId: event.target.value, commandId: '' }); }}><option value="">Choose a conversation</option>{page.selection.sessionId && !info?.sessions.some(value => value.id === page.selection.sessionId) && <option value={page.selection.sessionId}>Unavailable session</option>}{mergeConversations([], info?.sessions || []).filter(value => !page.selection.collectionId || value.collectionId === page.selection.collectionId).map(value => <option key={value.id} value={value.id}>{conversationTitle(value)||'New conversation'} · {info?.profiles.find(profile => profile.id === value.profileId)?.provider === 'codex' ? 'Codex' : 'Claude'} · {info?.profiles.find(profile => profile.id === value.profileId)?.label || value.id.slice(0, 6)}</option>)}</select></label>
    </div>
    {editing && <div className="page-config"><PageName key={page.id} name={page.name} onSave={name => changePage({ ...page, name })}/><button disabled={layout.pages.length >= 8} onClick={() => { const next = clonePage(page, () => crypto.randomUUID()); commit({ ...layout, selectedPage: next.id, pages: [...layout.pages, next] }); }}>Duplicate page</button><button disabled={layout.pages.length <= 1 || layout.pages.some(value => value.id === page.id && panels(value.layout).some(panel => panel.detached))} onClick={() => commit({ ...layout, selectedPage: layout.pages.find(value => value.id !== page.id)!.id, pages: layout.pages.filter(value => value.id !== page.id) })}>Remove page</button><label>Add panel<select value={module} onChange={event => setModule(event.target.value)}>{Object.entries(registry).map(([kind,module]) => <option key={kind} value={kind}>{module.title}</option>)}</select></label><button disabled={panels(page.layout).length >= 12} onClick={() => changePage({ ...page, layout: { type: 'split', direction: 'row', ratio: 0.65, children: [page.layout, { type: 'panel', panel: { id: crypto.randomUUID(), kind: module, binding: { mode: 'follow' }, detached: false } }] } })}>Add panel</button><button disabled={hasDetached || !!pending} onClick={() => commit(defaultLayout(page.selection), true)}>Reset pages</button></div>}
    {mobilePanels.length > 1 && <nav className="mobile-panel-switcher" aria-label="Workspace panels">{mobilePanels.map(panel => <button key={panel.id} aria-pressed={panel.id === mobilePanel?.id} onClick={() => { setMobilePanelId(panel.id); if (panel.collapsed) changePanel(panel.id, value => ({ ...value, collapsed: false })); }}>{registry[panel.kind]?.title || panel.kind}</button>)}</nav>}
    <div className="page-layout" data-page-id={page.id}>{displayedLayout ? renderNode(displayedLayout) : <p className="module-empty">Your conversations are open in separate windows.</p>}
      {docking && <div className="dock-overlay" aria-hidden="true" style={docking.area.width ? docking.area : undefined}>{dockSides.map(side => <div key={side} className={`dock-zone zone-${side}${docking.side === side ? ' active' : ''}`}>{docking.side === side && <span><Icon name={`dock-${side}`}/>Dock {side}</span>}</div>)}</div>}
    </div>
    {!settings && shownPanels.map(panel => createPortal(renderPanel(panel), hostFor(slots.get(panel.id)!), slots.get(panel.id)))}
    </>}
    {quickOpen && workbench && <QuickOpen key={workbench.workspaceId} workbench={workbench} onClose={() => setQuickOpen(false)}/>}
    {quickLook && workspaceID && <FilePreview key={`${workspaceID}:${quickLook.path}`} workspaceId={workspaceID} reference={quickLook} viewState={viewState} onClose={() => setQuickLook(undefined)}/>}
    {navigatorOpen && <WorkspaceNavigator target={page.selection} onTarget={target => target.sessionId ? showSession(target) : select(target)} collections={collections} error={catalogError} loaded={catalogLoaded} refresh={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder} onNewConversation={beginConversation} onClose={() => setNavigatorOpen(false)}/>}
  </main></WorkbenchContext.Provider>;
}

/** Where the layout wants a panel: its stable host element is moved in, not re-rendered. */
function PanelSlot({ host }: { host: HTMLElement }) {
  return <div className="panel-slot" ref={node => { if (node && host.parentNode !== node) node.replaceChildren(host); }}/>;
}

function PageName({ name, onSave }: { name: string; onSave(name: string): void }) {
  const [draft, setDraft] = useState(name);
  return <form onSubmit={event => { event.preventDefault(); onSave(draft); }}><label>Page name<input required maxLength={64} value={draft} onChange={event => setDraft(event.target.value)}/></label><button>Rename page</button></form>;
}
