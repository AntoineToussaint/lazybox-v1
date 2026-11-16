import { LeaderMenu } from './LeaderMenu';
import { WorkspaceNavigator } from './WorkspaceNavigator';
import { useKeyboardAction, useKeyboardNavigation } from './keyboard';
import { RepositoryHostContext } from './RepositoryBrowser';
import { ArtifactHostContext } from './ArtifactPage';
import { useOpenArtifactRequests } from './artifact-events';
import { WorkspaceRepositories } from './WorkspaceRepositories';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore, WorkspaceHost } from '@lazybox/platform';
import { RunnerProvider, useRunner, type RunnerConnection } from './RunnerContext';
import { AppearanceSync } from './appearance/AppearanceSync';
import { UserThemeSync } from './appearance/useUserThemes';
import { useCommandRuns } from './command-runs';
import { requestTerminal } from './TerminalPanel';
import { retireMonitor, defaultLayout, emptyTarget, insertDocked, mapPanels, movePanel, panels, parseLayout, removePanel, resolveTarget, mainLayout, detachedFor, pinnedTarget, closable, defaultDock, dockPanel, dockedSide, isDockSide, showPanel, dedupeChats, repairLayout, routeChat, returnChat, showCodePanel, type DockSide, type LayoutNode, type Panel, type ViewTarget, type WorkspaceLayout, type WorkspacePage } from './workspace-model';
import './workspace.css';
import './workspace-shell.css';
import { SettingsPage, type SettingsTab } from './SettingsPage';
import { RestartNotice } from './RunnerControl';
import { AttentionScope } from './useAttention';
import { QuickOpen } from './QuickOpen';
import { FilePreview } from './FilePreview';
import type { FileLink } from './file-reference';
import { Workbench, WorkbenchContext } from './workbench';
import { CommandCenter } from './CommandCenter';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import { builtinPanels, pagePanels, sentence, type PanelModule } from './PanelRegistry';
import { WorkspaceHeader } from './WorkspaceHeader';
import { DetachedTabs } from './DetachedTabs';
import { NewConversationDialog } from './NewConversationDialog';
import { LayoutConfiguration, PageConfig } from './PageEditor';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { readPreference, writePreference } from './view-state';
import { clampSidebar, DockOverlay, LayoutTree, MobilePanelSwitcher, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, type Split } from './PanelLayout';
import { WorkspacePanel, type PanelActions, type SharedModuleProps } from './WorkspacePanel';
import { usePanelDocking } from './usePanelDocking';
import { usePanelHosts } from './usePanelHosts';
import { useWorkspaceCatalog } from './useWorkspaceCatalog';
import { useTurnChangesHost } from './turn-checkpoints';
import { Onboarding } from './Onboarding';
import { PeekHost } from './Peek';
import { openArtifact } from './artifact-events';
import { useLinkPreferences, useWebViewer, type ViewerRequest } from './web-links';
import { WebViewsContext } from './WebViewer';
import { lastWebPanel, requestWebPage, WebWindowContext } from './WebPanel';
import { PowerLayer } from './PowerLayer';

export { builtinPanels, type ModuleProps, type PanelModule } from './PanelRegistry';

type Props = { modules?: Readonly<Record<string, PanelModule>>; fixedWorkspaceId?: string; connection: RunnerConnection; viewState?: ViewStateStore; initialTarget?: ViewTarget; host?: WorkspaceHost; onOpenViewer?(sessionId: string, commandId: string): Promise<void>; onTargetChange?(target: ViewTarget): Promise<void> | void };

export function Workspace(props: Props) {
  return <RunnerProvider connection={props.connection} expectRestart={props.host?.expectRunnerRestart}>
    <AppearanceSync store={props.viewState}/><UserThemeSync store={props.viewState}/>
    <AttentionScope root={props.viewState?.root} host={props.host}>
      <RepositoryHostContext.Provider value={props.host || {}}>
        <ArtifactHostContext.Provider value={props.host || {}}>
          <WebViewsContext.Provider value={props.host?.webViews}>
            <WebWindowContext.Provider value={props.host?.openWebWindow}>
              <WorkspaceView {...props}/>
            </WebWindowContext.Provider>
          </WebViewsContext.Provider>
        </ArtifactHostContext.Provider>
      </RepositoryHostContext.Provider>
    </AttentionScope>
  </RunnerProvider>;
}

/** Copies split ratios from `from` onto `to` where the trees match: dividers stay where they were. */
function adoptGeometry(to: WorkspaceLayout, from: WorkspaceLayout): WorkspaceLayout {
  const same = (a: LayoutNode, b: LayoutNode): LayoutNode => {
    if (a.type === 'split' && b.type === 'split' && a.direction === b.direction) return { ...a, ratio: b.ratio, children: [same(a.children[0], b.children[0]), same(a.children[1], b.children[1])] };
    return a;
  };
  return { ...to, pages: to.pages.map(page => { const match = from.pages.find(value => value.id === page.id) || (page.id === to.selectedPage ? from.pages.find(value => value.id === from.selectedPage) : undefined); return match ? { ...page, layout: same(page.layout, match.layout) } : page; }) };
}

function WorkspaceView({ modules, fixedWorkspaceId, viewState, initialTarget = emptyTarget(), host, onOpenViewer, onTargetChange }: Props) {
  const keyboardHint = useKeyboardNavigation(viewState);
  const { api, info, error: connectionError, refresh: refreshRunner, restart } = useRunner();
  const registry = useMemo(() => ({ ...builtinPanels, ...modules }), [modules]);
  const [workspaceID, setWorkspaceID] = useState(() => fixedWorkspaceId || initialTarget.collectionId || viewState?.getItem(`${viewState.key}:active-workspace`) || '');
  const workspaceKey = (id: string) => `${viewState?.scope || viewState?.key}:workspace:${id || 'home'}:pages`;
  const key = workspaceKey(workspaceID);
  const [restored] = useState(() => {
    try { const saved = viewState?.getItem(key); return { layout: saved ? repairLayout(retireMonitor(parseLayout(saved))) : defaultLayout({ ...initialTarget, collectionId: workspaceID }), error: '' }; }
    catch (error) { return { layout: defaultLayout({ ...initialTarget, collectionId: workspaceID }), error: `Saved pages could not be restored: ${String(error)}. Their data has been retained.` }; }
  });
  const [layout, setLayout] = useState(restored.layout), [locked, setLocked] = useState(!!restored.error);
  const [error, setError] = useState(restored.error), [editing, setEditing] = useState(false), [configuring, setConfiguring] = useState(false), [json, setJSON] = useState('');
  const { collections, catalogError, catalogLoaded, refreshCatalog } = useWorkspaceCatalog(api);
  const [repositoryWorkspace, setRepositoryWorkspace] = useState<Collection>();
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [mobilePanelId, setMobilePanelId] = useState('');
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('subscriptions');
  const [newSession, setNewSession] = useState(false);
  const [quickStart, setQuickStart] = useState(false);
  const sessionStore = useMemo(() => viewState ? { ...viewState, scope: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}` } : undefined, [viewState, workspaceID]);
  const [module, setModule] = useState<string>('console'), [pending, setPending] = useState<string>('');
  // The workspace's open files and folders: one per workspace for the window's
  // lifetime, so unsaved edits survive switching workspaces and closing panels.
  const workbench = useMemo(() => workspaceID ? Workbench.for(api, workspaceID, viewState) : undefined, [api, workspaceID, viewState]);
  useEffect(() => workbench?.attach(), [workbench]);
  const [quickOpen, setQuickOpen] = useState(false), [quickLook, setQuickLook] = useState<FileLink>();
  const current = useRef(layout); current.current = layout;
  const stores = useMemo(() => new Map<string, ViewStateStore>(), [viewState, workspaceID]);
  useEffect(() => {
    const retained = new Set(layout.pages.flatMap(page => panels(page.layout).map(panel => panel.id)));
    for (const id of stores.keys()) if (!retained.has(id)) stores.delete(id);
  }, [layout, stores]);
  const hasDetached = layout.pages.some(page => panels(page.layout).some(panel => panel.detached));
  const page = layout.pages.find(value => value.id === layout.selectedPage)!;
  const refresh = () => { refreshCatalog(); refreshRunner(); };

  // Page and layout commands. Each one reads the live layout (`current`), so
  // commands issued in one event build on each other.
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
    if (target.collectionId !== workspaceID) {
      if (fixedWorkspaceId) { if (target.collectionId) void host?.openWorkspace?.(target.collectionId); return; }
      try {
        if (!locked) viewState?.setItem(workspaceKey(workspaceID), JSON.stringify(current.current));
        const saved = viewState?.getItem(workspaceKey(target.collectionId));
        let next = saved ? retireMonitor(parseLayout(saved)) : defaultLayout(target);
        if (target.sessionId) next = { ...next, pages: next.pages.map(page => page.id === next.selectedPage ? { ...page, selection: target } : page) };
        // Switching workspace never moves the dividers: the target keeps its own
        // pages and panels, but takes the current split sizes wherever its
        // arrangement matches (the sidebar has one fixed width everywhere).
        if (workspaceID) next = adoptGeometry(next, current.current);
        next = repairLayout(next);
        viewState?.setItem(`${viewState.key}:active-workspace`, target.collectionId);
        setWorkspaceID(target.collectionId); current.current = next; setLayout(next); setLocked(false); setEditing(false); setConfiguring(false); setError('');
      } catch (error) { setError(`Could not open workspace layout: ${String(error)}`); }
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
  // Putting the console away is a choice that holds: hidden or closed by the
  // person, it stays that way through later runs, until they open it again.
  // Remembered per workspace, so a reload does not undo it.
  const consolePutAway = useRef(new Map<string, boolean>());
  const consoleKey = `${viewState?.scope || viewState?.key}:workspace:${workspaceID || 'home'}:console-put-away`;
  const isConsolePutAway = () => {
    if (!consolePutAway.current.has(consoleKey)) { let saved = false; try { saved = viewState?.getItem(consoleKey) === '1'; } catch { /* a convenience */ } consolePutAway.current.set(consoleKey, saved); }
    return consolePutAway.current.get(consoleKey)!;
  };
  const putConsoleAway = (away: boolean) => {
    if (isConsolePutAway() === away) return;
    consolePutAway.current.set(consoleKey, away);
    try { viewState?.setItem(consoleKey, away ? '1' : '0'); } catch { /* holds for this window */ }
  };
  // A run starting in the viewed session opens the console on it, unless the
  // person put the console away. Focus stays put.
  useCommandRuns(api, page.selection.sessionId, commandId => {
    const live = current.current.pages.find(value => value.id === page.id);
    if (!live || locked || editing || live.selection.sessionId !== page.selection.sessionId) return;
    const follows = (panel: Panel) => panel.kind === 'console' && panel.binding.mode === 'follow' && !panel.detached;
    // Put away, the console still points at the newest run: opening it shows that one.
    changePage({ ...live, selection: { ...live.selection, commandId }, layout: isConsolePutAway() ? live.layout : mapPanels(live.layout, panel => follows(panel) ? { ...panel, collapsed: false } : panel) });
  });
  const canShowNewSession = panels(page.layout).some(p => p.kind === 'chat' && p.binding.mode === 'follow' && !p.detached) || panels(page.layout).length < 12;
  const showSession = (selection: ViewTarget) => {
    setMobilePanelId('');
    if (selection.collectionId !== workspaceID) { select(selection); setSettings(false); setNewSession(false); return; }
    const live = current.current.pages.find(value => value.id === page.id)!;
    const open = detachedFor(live.layout, selection);
    if (open && host) { if (changePage({ ...live, selection })) { setSettings(false); setNewSession(false); } void host.openChat({ panelId: open.id, ...pinnedTarget(open) }).catch(error => setError(String(error))); return; }
    // Reuse the page's chat panel; never stack a second panel on the same conversation.
    const shown = routeChat(live.layout, selection, () => crypto.randomUUID());
    if (changePage({ ...live, selection, layout: shown.layout })) { setSettings(false); setNewSession(false); setMobilePanelId(shown.id); }
  };
  const showChanges = () => {
    const existing = current.current.pages.find(value => panels(value.layout).some(panel => panel.kind === 'changes'));
    if (existing) { commit({ ...current.current, selectedPage: existing.id }); setSettings(false); return; }
    const id = crypto.randomUUID();
    const review: WorkspacePage = { id, name: 'Changes', selection: { ...page.selection, collectionId: workspaceID }, layout: { type: 'panel', panel: { id: crypto.randomUUID(), kind: 'changes', binding: { mode: 'follow' }, detached: false } } };
    if (commit({ ...current.current, selectedPage: id, pages: [...current.current.pages, review] })) setSettings(false);
  };
  // "Show changes in this turn" in a conversation of this workspace opens its Changes page.
  useTurnChangesHost(workspaceID, showChanges);
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
    if (kind === 'console') putConsoleAway(false);
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
  // Go to file (Mod+P or ] ] f, from the keymap) works wherever focus is, as in any editor.
  useKeyboardAction('files.find', () => { if (workbench) setQuickOpen(true); }, () => !!workbench);
  useKeyboardAction('files.explorer', () => { if (workbench) focusFiles(); }, () => !!workbench);
  // An artifact asked for (tracked from a message or a file) is shown in the Artifacts panel.
  useOpenArtifactRequests(workspaceID, () => void showModule('artifacts'));
  useKeyboardAction('artifacts.open', () => { if (workspaceID) showModule('artifacts'); }, () => !!workspaceID);
  /** A web page in the page's Web panel (the one used last), or in a new one beside the work. */
  useLinkPreferences(viewState);
  const openWeb = ({ url, newPanel }: ViewerRequest): boolean => {
    const live = livePage();
    const shown = panels(live.layout).filter(panel => panel.kind === 'web' && !panel.detached);
    let chosen = newPanel ? undefined : shown.find(panel => panel.id === lastWebPanel()) || shown[0];
    if (!chosen) {
      if (panels(live.layout).length >= 12) { setError('This page already has 12 panels; close one to open a web page here.'); return false; }
      chosen = { id: crypto.randomUUID(), kind: 'web', binding: { mode: 'follow' }, detached: false };
      if (!changePage({ ...live, layout: insertDocked(live.layout, chosen, rememberedDock('web')) })) return false;
    } else if (chosen.collapsed) changePanel(chosen.id, value => ({ ...value, collapsed: false }));
    requestWebPage(chosen.id, url);
    setSettings(false); setMobilePanelId(chosen.id);
    return true;
  };
  useWebViewer(openWeb);
  useKeyboardAction('web.open', () => { openWeb({ url: '', newPanel: !panels(livePage().layout).some(panel => panel.kind === 'web' && !panel.detached) }); });
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
    if (panel.kind === 'console') putConsoleAway(false);
    try { viewState?.setItem(dockKey(panel.kind), side); } catch { /* the side is a convenience */ }
    focusAfter.current = { panel: panel.id };
  };
  const closePanel = (panel: Panel) => {
    const live = livePage(), next = removePanel(live.layout, panel.id);
    if (!closable(panel)) return;
    if (!next) {
      // The last panel of a page takes the page with it: a Changes page opened from the header closes like any panel.
      const all = current.current, index = all.pages.findIndex(value => value.id === live.id), pages = all.pages.filter(value => value.id !== live.id);
      if (pages.length) commit({ ...all, pages, selectedPage: pages[Math.max(0, index - 1)].id });
      return;
    }
    if (!changePage({ ...live, layout: next })) return;
    if (panel.kind === 'console') putConsoleAway(true);
    focusAfter.current = 'content';
  };
  // Command output from the keyboard: put it away when it is open, bring it back when it is not.
  useKeyboardAction('console.toggle', () => {
    if (!workspaceID || settings) return;
    const open = panels(livePage().layout).find(panel => panel.kind === 'console' && !panel.detached && !panel.collapsed);
    if (open) toggleCollapsed(open); else showModule('console');
  }, () => !!workspaceID && !settings);
  const toggleCollapsed = (panel: Panel) => { if (changePanel(panel.id, value => ({ ...value, collapsed: !panel.collapsed })) && panel.kind === 'console') putConsoleAway(!panel.collapsed); };
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
  // One sidebar width for every workspace (see PanelLayout).
  const [sidebarWidth, setSidebarWidth] = useState(() => { const saved = Number(readPreference(viewState, 'workspace.sidebar-width')); return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT; });
  const saveSidebarWidth = (width: number) => { const next = clampSidebar(width); setSidebarWidth(next); try { writePreference(viewState, 'workspace.sidebar-width', String(next)); } catch { /* a convenience */ } };
  const resize = (path: number[], change: (node: Split) => LayoutNode) => {
    const update = (node: LayoutNode, rest: number[]): LayoutNode => {
      if (node.type !== 'split') return node;
      if (!rest.length) return change(node);
      return { ...node, children: [rest[0] === 0 ? update(node.children[0], rest.slice(1)) : node.children[0], rest[0] === 1 ? update(node.children[1], rest.slice(1)) : node.children[1]] };
    };
    changePage({ ...page, layout: update(page.layout, path) });
  };

  const displayedLayout = editing ? page.layout : mainLayout(page.layout);
  const shownPanels = displayedLayout ? panels(displayedLayout) : [];
  const { docking, startDrag } = usePanelDocking({ editing, displayedLayout, onDock: dockTo });
  const panelHosts = usePanelHosts(shownPanels);
  const mobilePanels = panels(displayedLayout || page.layout).filter(panel => panel.kind !== 'collections');
  const terminalReady = !!workspaceID && collections.find(value => value.id === workspaceID)?.state === 'ready';
  // Panels this page could show but does not (or shows collapsed), offered from the page menu.
  const hiddenModules = Object.entries(registry).filter(([kind, value]) => !pagePanels.has(kind) && (value.multiple || !panels(page.layout).some(panel => panel.kind === kind && !panel.detached && !panel.collapsed)));
  const mobilePanel = mobilePanels.find(panel => panel.id === mobilePanelId) || mobilePanels.find(panel => panel.kind === 'chat') || mobilePanels[0];
  const detachedPanels = panels(page.layout).filter(p => p.detached);
  const navigator = useWorkspaceCommands({
    root: viewState?.root || '', main: !fixedWorkspaceId, collections, selection: page.selection, workspaceId: workspaceID, workbench, registry,
    canStartConversation: !!info && !pending && canShowNewSession, terminalReady, canOpenWorkspaceWindow: !!workspaceID && !!host?.openWorkspace && !fixedWorkspaceId,
    showSession, selectWorkspace: select, closeSettings: () => setSettings(false),
    showPanel: kind => kind === 'terminal' ? showTerminal() : kind === 'changes' ? showChanges() : void showModule(kind),
    openSettings: tab => { setSettingsTab(tab as SettingsTab); setSettings(true); },
    newConversation: () => beginConversation(), openWorkspaceWindow: () => void host?.openWorkspace?.(workspaceID),
    toggleEditing: () => { if (!settings) setEditing(value => !value); }, toggleConfiguring: () => { if (!settings) { setJSON(JSON.stringify(current.current, null, 2)); setConfiguring(value => !value); } },
  });

  const panelActions: PanelActions = {
    toggleCollapsed, dockTo, close: closePanel, startDrag, showSession,
    retarget: (panel, target) => panel.binding.mode === 'pinned' ? changePanel(panel.id, value => ({ ...value, binding: { mode: 'pinned', target } })) : select(target),
    toggleBinding: (panel, target) => changePanel(panel.id, value => ({ ...value, binding: value.binding.mode === 'pinned' ? { mode: 'follow' } : { mode: 'pinned', target: { ...target } } })),
    move: (panel, step) => changePage({ ...page, layout: movePanel(page.layout, panel.id, step) }),
    remove: panel => { const next = removePanel(page.layout, panel.id); if (next) changePage({ ...page, layout: next }); },
    detach: panel => void detach(panel),
    dock: panel => void dock(panel),
  };
  const moduleProps: SharedModuleProps = {
    workspaceId: workspaceID, chooseRepositoryFolder: host?.chooseRepositoryFolder, collections, error: catalogError, loaded: catalogLoaded, refresh: refreshCatalog,
    onNewConversation: beginConversation, onShowSession: showSession, onShowPanel: showPanelFor, onShowModule: kind => kind === 'terminal' ? showTerminal() : showChanges(), onOpenViewer,
  };
  const storeFor = (panel: Panel) => {
    if (viewState && !stores.has(panel.id)) stores.set(panel.id, { ...viewState, scope: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}`, key: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}:panel:${panel.id}` });
    return stores.get(panel.id);
  };
  const renderPanel = (panel: Panel) => <WorkspacePanel panel={panel} definition={Object.hasOwn(registry, panel.kind) ? registry[panel.kind] : undefined} target={resolveTarget(panel, page.selection)} store={storeFor(panel)}
    module={moduleProps} actions={panelActions} editing={editing} pending={!!pending} docking={docking?.id === panel.id} mobileActive={panel.id === mobilePanel?.id}
    only={panels(page.layout).length <= 1} closesPage={layout.pages.length > 1} docked={dockedSide(page.layout, panel.id)} canDetach={!!host} canRemove={panels(page.layout).length !== 1}/>;

  return <WorkbenchContext.Provider value={workbench}><main className={`workspace-shell${editing ? ' layout-editing' : ''}`}>
    <LeaderMenu hint={keyboardHint}/>
    <CommandCenter viewState={viewState} navigator={navigator}/>
    <WorkspaceHeader pages={layout.pages} selectedPage={page.id} settings={settings} pending={!!pending} fixedWorkspace={!!fixedWorkspaceId} navigatorOpen={navigatorOpen}
      collections={collections} selection={page.selection} viewState={viewState} workspaceID={workspaceID} info={info} terminalReady={terminalReady} canShowNewSession={canShowNewSession}
      editing={editing} hiddenModules={hiddenModules} canOpenWorkspaceWindow={!!workspaceID && !!host?.openWorkspace && !fixedWorkspaceId}
      onOpenNavigator={() => setNavigatorOpen(true)}
      onSelectPage={id => { setSettings(false); commit({ ...layout, selectedPage: id }); }}
      onOpenSettings={() => setSettings(true)}
      onOpenAttention={target => { setSettings(false); showSession(target); }}
      onShowChanges={showChanges}
      onBrowseFiles={focusFiles}
      onShowTerminal={showTerminal}
      onNewConversation={() => beginConversation()}
      onOpenRunner={() => { setSettingsTab('runner'); setSettings(true); }}
      onOpenWorkspaceWindow={() => void host!.openWorkspace!(workspaceID)}
      onToggleEditing={() => setEditing(value => !value)}
      onToggleConfiguring={() => { setJSON(JSON.stringify(layout, null, 2)); setConfiguring(value => !value); }}
      onShowModule={kind => kind === 'terminal' ? showTerminal() : kind === 'web' ? void openWeb({ url: '', newPanel: true }) : void showModule(kind)}/>
    {!settings && detachedPanels.length > 0 && <DetachedTabs panels={detachedPanels} selection={page.selection} sessions={info?.sessions} onOpen={p => void detach(p)} onDock={p => void dock(p)}/>}
    {repositoryWorkspace && <WorkspaceRepositories workspace={collections.find(value => value.id === repositoryWorkspace.id) || repositoryWorkspace} onClose={() => setRepositoryWorkspace(undefined)} onSaved={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder}/>}
    <NewConversationDialog open={newSession} quickStart={quickStart} workspaceID={workspaceID} workspaceName={collections.find(value => value.id === workspaceID)?.name} viewState={sessionStore}
      onQuickStart={() => setQuickStart(true)} onClose={() => setNewSession(false)} onStarted={showNewSession}/>
    <RestartNotice/>
    {/* A restart the person asked for explains the dropped connection; RestartNotice says so instead. */}
    {(error || (connectionError && restart.phase !== 'restarting')) && <div className="error" role="alert">
      {connectionError && restart.phase !== 'restarting'
        ? <><strong>Runner disconnected.</strong> Reconnecting automatically… <details><summary>Connection details</summary>{connectionError}</details></>
        : error}
      <button onClick={() => { if (host?.reconnect) void host.reconnect().catch(e => setError(String(e))); else refresh(); }}>Retry now</button>
    </div>}
    {settings
      ? <SettingsPage zoom={host?.zoom} tab={settingsTab} onTab={setSettingsTab} onShowProcesses={() => showModule('processes')} chooseRepositoryFolder={host?.chooseRepositoryFolder} viewState={viewState} openSignIn={host?.openSignIn} copySignInCode={host?.copySignInCode}/>
      : <>
        {locked && <button onClick={() => commit(defaultLayout({ ...initialTarget, collectionId: workspaceID }), true)}>Reset retained layout</button>}
        {configuring && <LayoutConfiguration json={json} disabled={hasDetached || !!pending} onChange={setJSON} onClose={() => setConfiguring(false)}
          onImport={() => { try { if (commit(parseLayout(json), true)) setConfiguring(false); } catch (error) { setError(String(error)); } }}/>}
        <WorkspaceSwitcher selection={page.selection} workspaceID={workspaceID} collections={collections} info={info} locked={!!pending || !!fixedWorkspaceId}
          onSelect={select} onShowRepositories={setRepositoryWorkspace}/>
        {editing && <PageConfig page={page} layout={layout} registry={registry} module={module} hasDetached={hasDetached} pending={!!pending} onModule={setModule} commit={commit} changePage={changePage}/>}
        {mobilePanels.length > 1 && <MobilePanelSwitcher panels={mobilePanels} active={mobilePanel} title={panel => registry[panel.kind]?.title || panel.kind}
          onChoose={panel => { setMobilePanelId(panel.id); if (panel.collapsed) changePanel(panel.id, value => ({ ...value, collapsed: false })); if (panel.kind === 'console') putConsoleAway(false); }}/>}
        <div className="page-layout" data-page-id={page.id}>
          {displayedLayout ? <LayoutTree node={displayedLayout} editing={editing} hostFor={panelHosts.hostFor} onResize={resize} sidebar={{ width: sidebarWidth, onWidth: saveSidebarWidth }}/> : <p className="module-empty">Your conversations are open in separate windows.</p>}
          {docking && <DockOverlay docking={docking}/>}
        </div>
        {!settings && shownPanels.map(panel => createPortal(renderPanel(panel), panelHosts.hostFor(panel), panelHosts.slotOf(panel)))}
      </>}
    <PeekHost navigation={{ showSession, showModule: kind => void showModule(kind), showTerminal, openArtifact: (collectionId, artifactId) => { if (!openArtifact({ collectionId, artifactId })) showModule('artifacts'); },
      openFile: (collectionId, path, line) => { if (!workbench || collectionId !== workspaceID) return false; workbench.open(path, { line, focus: true }); return true; } }}/>
    <Onboarding viewState={viewState} collections={collections} collectionsLoaded={catalogLoaded} automatic={!fixedWorkspaceId} onOpenSettings={tab => { if (fixedWorkspaceId) return; setSettingsTab(tab); setSettings(true); }}/>
    {quickOpen && workbench && <QuickOpen key={workbench.workspaceId} workbench={workbench} onClose={() => setQuickOpen(false)}/>}
    {quickLook && workspaceID && <FilePreview key={`${workspaceID}:${quickLook.path}`} workspaceId={workspaceID} reference={quickLook} viewState={viewState} onClose={() => setQuickLook(undefined)}/>}
    <PowerLayer workspaceId={workspaceID} selection={{ collectionId: page.selection.collectionId || workspaceID, sessionId: page.selection.sessionId }} primary={!fixedWorkspaceId} host={host} viewState={viewState}
      onSelect={target => select({ ...target, commandId: '' })} onShowSession={target => showSession({ ...target, commandId: '' })}
      onShowPanel={(kind, target) => kind === 'terminal' ? showTerminal() : kind === 'changes' ? showChanges() : showPanelFor(kind, { ...target, commandId: '' })}
      onOpenSettings={tab => { setSettingsTab(tab); setSettings(true); }} onQuickLook={(path, line) => setQuickLook({ path, line })}
      describe={target => [collections.find(c => c.id === target.collectionId)?.name, info?.sessions.find(s => s.id === target.sessionId)?.title].filter(Boolean).join(' · ') || 'the workspace'}/>
    {navigatorOpen && <WorkspaceNavigator target={page.selection} onTarget={target => target.sessionId ? showSession(target) : select(target)} collections={collections} error={catalogError} loaded={catalogLoaded} refresh={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder} onNewConversation={beginConversation} onClose={() => setNavigatorOpen(false)}/>}
  </main></WorkbenchContext.Provider>;
}
