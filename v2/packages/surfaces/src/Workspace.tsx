import { conversationTitle } from './conversation-model';
import { LeaderMenu } from './LeaderMenu';
import { WorkspaceNavigator } from './WorkspaceNavigator';
import { resetKeymap, useKeyboardAction, useKeyboardNavigation, useKeymap } from './keyboard';
import { RepositoryHostContext } from './RepositoryBrowser';
import { ArtifactHostContext } from './ArtifactPage';
import { useOpenArtifactRequests } from './artifact-events';
import { WorkspaceRepositories } from './WorkspaceRepositories';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Collection } from '@lazybox/protocol';
import type { ChatReturn, ViewStateStore, WorkspaceHost } from '@lazybox/platform';
import { RunnerProvider, useRunner, type RunnerConnection } from './RunnerContext';
import { AppearanceSync } from './appearance/AppearanceSync';
import { UserThemeSync } from './appearance/useUserThemes';
import { useCommandRuns } from './command-runs';
import { requestTerminal } from './TerminalPanel';
import { groups, retireMonitor, defaultLayout, emptyTarget, parseLayout, resolveTarget, detachedFor, pinnedTarget, defaultDock, isDockSide, showPanel, dedupeChats, repairLayout, routeChat, returnDetached, detachedChats, showCodePanel, adoptGeometry, allPanels, shownPanels, activatePanel, removeFromPage, insertDocked, mapPageGroups, mapPagePanels, groupOf, splitBeside, addToGroup, detachChat, sidebarKinds, pageGroups, PANEL_LIMIT, type DockSide, type Panel, type ViewTarget, type WorkspaceLayout, type WorkspacePage } from './workspace-model';
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
import { builtinPanels, sentence, type PanelModule, type PanelTitle } from './PanelRegistry';
import { WorkspaceHeader } from './WorkspaceHeader';
import { OtherWindows, type OtherWindow } from './OtherWindows';
import { NewConversationDialog } from './NewConversationDialog';
import { NewTaskHost } from './NewTaskSheet';
import { useHandoffMenus, useTerminalAction } from './handoff';
import { LayoutConfiguration, PageConfig } from './PageEditor';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { readPreference, writePreference } from './view-state';
import { clampSidebar, MobilePanel, MobilePanelSwitcher, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './PanelLayout';
import { WorkspacePanel, type PanelActions, type SharedModuleProps } from './WorkspacePanel';
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
import { DockLayout, type DockHandle } from './DockLayout';
import { GroupActions, GroupAdd, groupMenuItems, LayoutMenu, PanelsMenu, type AddCommands, type GroupCommands } from './DockMenus';
import { useContextMenuContribution } from './ContextMenu';
import { bindings, canonicalBinding, canonicalKey, chordFromEvent, displayBinding, layoutDirections, useActions, type LayoutDirection } from './actions';
import { movePanel } from './dock-keyboard';
import { showToast } from './toasts';
import { provideLayoutCommands, type LayoutCommand } from './layout-commands';
import { applyTemplate, builtinPresets, DEFAULT_PRESET, sameTemplate, templateOf, type LayoutPreset } from './layout-presets';
import { LayoutImportDialog, useLayoutFiles } from './layout-files';
import { requestAsk } from './help-requests';
import { useProvideConversationOpeners } from './conversation-requests';
import { ReviewActions } from './ReviewActions';
import { useConversationRequests, useReviewHost } from './review-client';
import { useMissionsPageHost } from './navigate-requests';

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

/** Phone and narrow windows show one panel at a time. */
const NARROW = '(max-width: 760px)';
const useNarrow = () => useSyncExternalStore(listener => { const query = matchMedia(NARROW); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, () => matchMedia(NARROW).matches);
/** Where popped-out panels are drawn: a blank page of this origin (apps/*\/public/popout.html). */
const POPOUT_URL = '/popout.html';
/** A group of the page by its own id (`groupOf` finds the group holding a panel). */
const groupById = (page: WorkspacePage, id: string) => pageGroups(page).find(group => group.id === id);

/**
 * Reads a workspace's saved pages. Pages saved by an older version are
 * migrated, and the original text is kept beside them, once, so a migration
 * never loses a person's layout. A layout that cannot be read throws: the
 * caller keeps it untouched and says so.
 */
function loadPages(viewState: ViewStateStore | undefined, key: string, fallback: ViewTarget): WorkspaceLayout {
  const saved = viewState?.getItem(key);
  if (!saved) return defaultLayout(fallback);
  const layout = repairLayout(retireMonitor(parseLayout(saved)));
  if (/^\s*\{\s*"version"\s*:\s*1\b/.test(saved)) { try { if (!viewState?.getItem(`${key}:v1`)) viewState?.setItem(`${key}:v1`, saved); } catch { /* the backup is a precaution */ } }
  return layout;
}

function WorkspaceView({ modules, fixedWorkspaceId, viewState, initialTarget = emptyTarget(), host, onOpenViewer, onTargetChange }: Props) {
  const keyboardHint = useKeyboardNavigation(viewState);
  const keymap = useKeymap(viewState);
  const { api, info, error: connectionError, refresh: refreshRunner, restart } = useRunner();
  const registry = useMemo(() => ({ ...builtinPanels, ...modules }), [modules]);
  const [workspaceID, setWorkspaceID] = useState(() => fixedWorkspaceId || initialTarget.collectionId || viewState?.getItem(`${viewState.key}:active-workspace`) || '');
  const workspaceKey = (id: string) => `${viewState?.scope || viewState?.key}:workspace:${id || 'home'}:pages`;
  const key = workspaceKey(workspaceID);
  const [restored] = useState(() => {
    try { return { layout: loadPages(viewState, key, { ...initialTarget, collectionId: workspaceID }), error: '' }; }
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
  const narrow = useNarrow();
  /** Titles panels give themselves (a web page's), shown on their tabs. */
  const [liveTitles, setLiveTitles] = useState<Record<string, PanelTitle | undefined>>({});
  const dock = useRef<DockHandle>(null);
  const panelsMenu = useRef<HTMLDetailsElement>(null), layoutMenu = useRef<HTMLDetailsElement>(null);
  /** ⌘\ on a panel alone in its group: the Panels menu opens, and what is chosen goes beside it. */
  const [beside, setBeside] = useState<{ group: string; side: 'right' | 'below'; title: string }>();
  const sessionStore = useMemo(() => viewState ? { ...viewState, scope: `${viewState.scope || viewState.key}:workspace:${workspaceID || 'home'}` } : undefined, [viewState, workspaceID]);
  const [pending, setPending] = useState<string>('');
  // The workspace's open files and folders: one per workspace for the window's
  // lifetime, so unsaved edits survive switching workspaces, moving, popping
  // out and closing the Files and Editor panels.
  const workbench = useMemo(() => workspaceID ? Workbench.for(api, workspaceID, viewState) : undefined, [api, workspaceID, viewState]);
  useEffect(() => workbench?.attach(), [workbench]);
  const [quickOpen, setQuickOpen] = useState(false), [quickLook, setQuickLook] = useState<FileLink>();
  const current = useRef(layout); current.current = layout;
  const shownWorkspace = useRef(workspaceID); shownWorkspace.current = workspaceID;
  const stores = useMemo(() => new Map<string, ViewStateStore>(), [viewState, workspaceID]);
  useEffect(() => {
    const retained = new Set(layout.pages.flatMap(page => allPanels(page).map(panel => panel.id)));
    for (const id of stores.keys()) if (!retained.has(id)) stores.delete(id);
  }, [layout, stores]);
  const hasDetached = layout.pages.some(page => allPanels(page).some(panel => panel.detached));
  const page = layout.pages.find(value => value.id === layout.selectedPage)!;
  const refresh = () => { refreshCatalog(); refreshRunner(); };
  // Open in Terminal and Continue in… in this window's menus, and the palette's Open in Terminal.
  useHandoffMenus();
  useTerminalAction(workspaceID, page.selection.collectionId === workspaceID ? page.selection.sessionId : '');

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
  const livePage = () => current.current.pages.find(value => value.id === page.id)!;
  const changePage = (next: WorkspacePage) => commit({ ...current.current, pages: current.current.pages.map(value => value.id === next.id ? next : value) });
  const changePanel = (panelID: string, change: (panel: Panel) => Panel) => changePage(mapPagePanels(livePage(), panel => panel.id === panelID ? change(panel) : panel));
  const select = (target: ViewTarget) => {
    if (target.collectionId !== workspaceID) {
      if (fixedWorkspaceId) { if (target.collectionId) void host?.openWorkspace?.(target.collectionId); return; }
      try {
        if (!locked) viewState?.setItem(workspaceKey(workspaceID), JSON.stringify(current.current));
        let next = loadPages(viewState, workspaceKey(target.collectionId), target);
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
    changePage(dedupeChats({ ...livePage(), selection: target }, target));
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
    const live = livePage();
    if (!live || locked || live.selection.sessionId !== page.selection.sessionId) return;
    const output = shownPanels(live).find(panel => panel.kind === 'console' && panel.binding.mode === 'follow' && !panel.detached);
    // Put away, the console still points at the newest run: opening it shows that one.
    if (!output || isConsolePutAway()) { changePage({ ...live, selection: { ...live.selection, commandId } }); return; }
    changePage({ ...activatePanel(live, output.id), selection: { ...live.selection, commandId } });
  });
  const canShowNewSession = shownPanels(page).some(p => p.kind === 'chat' && p.binding.mode === 'follow' && !p.detached) || allPanels(page).length < PANEL_LIMIT;
  const showSession = (selection: ViewTarget) => {
    setMobilePanelId('');
    if (selection.collectionId !== workspaceID) { select(selection); setSettings(false); setNewSession(false); return; }
    const live = livePage();
    const open = detachedFor(live, selection);
    if (open && host) { if (changePage({ ...live, selection })) { setSettings(false); setNewSession(false); } void host.openChat({ panelId: open.id, ...pinnedTarget(open) }).catch(error => setError(String(error))); return; }
    // Reuse the page's chat panel; never stack a second panel on the same conversation.
    const shown = routeChat({ ...live, selection }, selection, () => crypto.randomUUID());
    // While a panel is maximized, the conversation shows maximized (the zoom moves to the chat; ⌘J, ⌘] keep it).
    if (changePage({ ...shown.page, selection })) { setSettings(false); setNewSession(false); setMobilePanelId(shown.id); revealAfter.current = shown.id; }
  };
  const showChanges = () => {
    const existing = current.current.pages.find(value => shownPanels(value).some(panel => panel.kind === 'changes'));
    if (existing) { commit({ ...current.current, selectedPage: existing.id }); setSettings(false); return; }
    const id = crypto.randomUUID(), panel: Panel = { id: crypto.randomUUID(), kind: 'changes', binding: { mode: 'follow' }, detached: false };
    const review: WorkspacePage = { id, name: 'Changes', selection: { ...page.selection, collectionId: workspaceID }, layout: { type: 'group', id: `g-${panel.id}`, panels: [panel], active: panel.id }, floating: [], popouts: [], detached: [] };
    if (commit({ ...current.current, selectedPage: id, pages: [...current.current.pages, review] })) setSettings(false);
  };
  // The missions board is a page of its own: its columns, timeline and messages need the room.
  const showMissionsPage = () => {
    const existing = current.current.pages.find(value => shownPanels(value).some(panel => panel.kind === 'missions'));
    if (existing) { commit({ ...current.current, selectedPage: existing.id }); setSettings(false); return; }
    const id = crypto.randomUUID(), panel: Panel = { id: crypto.randomUUID(), kind: 'missions', binding: { mode: 'follow' }, detached: false };
    const board: WorkspacePage = { id, name: 'Missions', selection: { ...page.selection, collectionId: workspaceID }, layout: { type: 'group', id: `g-${panel.id}`, panels: [panel], active: panel.id }, floating: [], popouts: [], detached: [] };
    if (commit({ ...current.current, selectedPage: id, pages: [...current.current.pages, board] })) setSettings(false);
  };
  useMissionsPageHost(showMissionsPage);
  // "Show changes in this turn" in a conversation of this workspace opens its Changes page.
  useTurnChangesHost(workspaceID, showChanges);
  // A review started anywhere shows its reviewer conversation; "Open review" its findings.
  useConversationRequests(workspaceID, request => showSession({ collectionId: request.collectionId, sessionId: request.sessionId, commandId: '' }));
  useReviewHost(workspaceID, showChanges);
  // The edge a person last docked each kind of panel at is a personal preference,
  // shared by every workspace and window: a terminal they moved left opens left.
  const dockKey = (kind: string) => `${viewState?.root || viewState?.key}:dock:${kind}`;
  const rememberedDock = (kind: string): DockSide => { try { const side = viewState?.getItem(dockKey(kind)); return isDockSide(side) ? side : defaultDock(kind); } catch { return defaultDock(kind); } };
  // Focus follows a panel that moved or was asked for, or returns to the conversation when one closes.
  const focusAfter = useRef<{ panel: string } | 'content' | null>(null);
  /** A panel navigated to (a conversation opened): a maximized group gives it the zoom, without taking the focus. */
  const revealAfter = useRef('');
  useEffect(() => {
    const reveal = revealAfter.current; revealAfter.current = '';
    if (reveal) dock.current?.reveal(reveal);
    // Kept until it runs: the dock reporting its settled sizes changes the layout again within the frame.
    const request = focusAfter.current; if (!request) return;
    const frame = requestAnimationFrame(() => {
      if (focusAfter.current === request) focusAfter.current = null;
      if (request !== 'content') { dock.current?.focusPanel(request.panel); return; }
      document.querySelector<HTMLElement>('.page-layout .panel-chat textarea:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [layout]);
  /** Show the page's panel of this kind, or dock a new one where this kind was last docked (or beside the group ⌘\ asked from). */
  const showModule = (kind: string) => {
    const live = livePage(), placement = beside;
    setBeside(undefined);
    if (kind === 'console') putConsoleAway(false);
    if (kind === 'web' && !placement) return openWeb({ url: '', newPanel: true }) ? 'web' : '';
    const existing = shownPanels(live).find(panel => panel.kind === kind && !panel.detached);
    if (!existing && allPanels(live).length >= PANEL_LIMIT) { setError(`This page already has ${PANEL_LIMIT} panels; close one to add ${sentence(registry[kind]?.title || kind)}.`); return ''; }
    if (placement && groupById(live, placement.group)) {
      // Beside the asking group: a new panel, or the existing one moved there.
      const panel = existing || { id: crypto.randomUUID(), kind, binding: { mode: 'follow' as const }, detached: false };
      const without = existing ? removeFromPage(live, existing.id) : live;
      if (!changePage({ ...without, layout: splitBeside(without.layout, placement.group, panel, placement.side === 'right' ? 'right' : 'bottom') })) return '';
      setSettings(false); setMobilePanelId(panel.id); focusAfter.current = { panel: panel.id };
      return panel.id;
    }
    const shown = kind === 'files' || kind === 'editor' ? showCodePanel(live, kind, rememberedDock(kind), () => crypto.randomUUID()) : showPanel(live, kind, rememberedDock(kind), () => crypto.randomUUID());
    if (!changePage(shown.page)) return '';
    setSettings(false); setMobilePanelId(shown.id);
    return shown.id;
  };
  /** Bring the Files or Editor panel forward: the nearest one shown, or one docked with its partner. */
  const showCode = (kind: 'files' | 'editor') => {
    const live = livePage(), existing = shownPanels(live).find(panel => panel.kind === kind && !panel.detached);
    const group = existing && groupOf(live, existing.id);
    if (existing && group?.active === existing.id && !group.minimized && !settings) { setMobilePanelId(existing.id); return existing.id; }
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
    const shown = shownPanels(live).filter(panel => panel.kind === 'web' && !panel.detached);
    let chosen = newPanel ? undefined : shown.find(panel => panel.id === lastWebPanel()) || shown[0];
    if (!chosen) {
      if (allPanels(live).length >= PANEL_LIMIT) { setError(`This page already has ${PANEL_LIMIT} panels; close one to open a web page here.`); return false; }
      chosen = { id: crypto.randomUUID(), kind: 'web', binding: { mode: 'follow' }, detached: false };
      if (!changePage({ ...live, layout: insertDocked(live.layout, chosen, rememberedDock('web')) })) return false;
    } else if (!changePage(activatePanel(live, chosen.id))) return false;
    requestWebPage(chosen.id, url);
    setSettings(false); setMobilePanelId(chosen.id);
    return true;
  };
  useWebViewer(openWeb);
  useKeyboardAction('web.open', () => { openWeb({ url: '', newPanel: !shownPanels(livePage()).some(panel => panel.kind === 'web' && !panel.detached) }); });
  // Ask Lazybox (Help menu, ⌘K, ]] h): its panel on this page, with the message box focused.
  useKeyboardAction('help.ask', () => { if (showModule('assistant')) requestAsk(); });
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
  /** Move a panel to an edge of the page's content area, in a group of its own (the keyboard way to drag it there). */
  const dockTo = (panel: Panel, side: DockSide) => {
    const live = livePage(), without = removeFromPage(live, panel.id);
    if (!shownPanels(without).length) return;
    if (!changePage({ ...without, layout: insertDocked(without.layout, { ...panel }, side) })) return;
    if (panel.kind === 'console') putConsoleAway(false);
    try { viewState?.setItem(dockKey(panel.kind), side); } catch { /* the side is a convenience */ }
    focusAfter.current = { panel: panel.id };
  };
  const closePanel = (panel: Panel) => {
    if (panel.detached) return;
    const live = livePage(), next = removeFromPage(live, panel.id);
    if (!shownPanels(next).length && !next.detached.length) {
      // The last panel of a page takes the page with it (a Changes page opened from the header closes like any panel);
      // the last page keeps its last panel.
      const all = current.current, index = all.pages.findIndex(value => value.id === live.id), pages = all.pages.filter(value => value.id !== live.id);
      if (pages.length) commit({ ...all, pages, selectedPage: pages[Math.max(0, index - 1)].id });
      return;
    }
    if (!changePage(next)) return;
    if (panel.kind === 'console') putConsoleAway(true);
    focusAfter.current = 'content';
  };
  const setMinimized = (groupID: string, minimized: boolean) => {
    const live = livePage();
    if (!changePage(mapPageGroups(live, value => value.id === groupID ? { ...value, minimized } : value))) return;
    // Minimizing the command output puts it away; restoring it brings it back (see useCommandRuns below).
    if (shownPanels(live).some(panel => panel.kind === 'console' && groupOf(live, panel.id)?.id === groupID)) putConsoleAway(minimized);
  };
  // Command output from the keyboard: put it away (minimized to its tab) when it is open, bring it back when it is not.
  useKeyboardAction('console.toggle', () => {
    if (!workspaceID || settings) return;
    const live = livePage(), output = shownPanels(live).find(panel => panel.kind === 'console' && !panel.detached), group = output && groupOf(live, output.id);
    if (output && group && group.active === output.id && !group.minimized && !dock.current?.groupOf(output.id)?.canMinimize) { closePanel(output); return; }
    if (output && group && group.active === output.id && !group.minimized) { setMinimized(group.id, true); return; }
    showModule('console');
  }, () => !!workspaceID && !settings);
  const beginConversation = (collectionId = workspaceID) => {
    if (collectionId !== workspaceID) select({ collectionId, sessionId: '', commandId: '' });
    setNavigatorOpen(false); setQuickStart(false); setNewSession(true);
  };
  /** The group whose `+` started the conversation being created: it shows there. */
  const conversationGroup = useRef('');
  const showNewSession = (sessionId: string) => {
    showSession({ collectionId: workspaceID || info?.sessions.find(s => s.id === sessionId)?.collectionId || '', sessionId, commandId: '' });
    const group = conversationGroup.current; conversationGroup.current = '';
    if (group) openHere(group, 'chat');
    refreshRunner();
  };
  /**
   * A kind of panel opened in a group as its front tab (a group's `+`): the
   * page's panel of that kind moves there, or a new one is made (always for Web).
   */
  const openHere = (groupID: string, kind: string) => {
    const live = livePage(), target = groupById(live, groupID);
    if (!target || sidebarKinds.has(kind)) return;
    const multiple = !!registry[kind]?.multiple;
    const existing = multiple ? undefined : shownPanels(live).find(panel => panel.kind === kind && !panel.detached && (kind !== 'chat' || panel.binding.mode === 'follow')) || (kind === 'chat' ? shownPanels(live).find(panel => panel.kind === 'chat' && !panel.detached) : undefined);
    if (existing && target.panels.some(panel => panel.id === existing.id)) { changePage(activatePanel(live, existing.id)); focusAfter.current = { panel: existing.id }; return; }
    if (!existing && allPanels(live).length >= PANEL_LIMIT) { setError(`This page already has ${PANEL_LIMIT} panels; close one to add ${sentence(registry[kind]?.title || kind)}.`); return; }
    const panel: Panel = existing || { id: crypto.randomUUID(), kind, binding: { mode: 'follow' }, detached: false };
    if (!changePage(addToGroup(existing ? removeFromPage(live, existing.id) : live, groupID, panel))) return;
    if (kind === 'console') putConsoleAway(false);
    if (kind === 'web') requestWebPage(panel.id, '');
    if (kind === 'terminal' && workspaceID) requestTerminal(workspaceID);
    setSettings(false); setMobilePanelId(panel.id);
    focusAfter.current = { panel: panel.id };
    dock.current?.announce(`${existing ? 'Moved' : 'Opened'} ${titleOf(panel)} here`);
  };
  /** A chat to its own native window (the host's), pinned to its conversation. */
  const detach = async (panel: Panel) => {
    if (!host || pending) return;
    const live = livePage(), target = resolveTarget(panel, live.selection);
    if (!target.sessionId) return;
    const open = detachedFor(live, target);
    if (open) { try { await host.openChat({ panelId: open.id, ...pinnedTarget(open) }); } catch (error) { setError(String(error)); } return; }
    setPending(panel.id);
    const before = live;
    try {
      if (!changePage(detachChat(live, panel.id, target))) return;
      await host.openChat({ panelId: panel.id, collectionId: target.collectionId, sessionId: target.sessionId });
    }
    catch (error) { changePage(before); setError(String(error)); }
    finally { setPending(''); }
  };
  // A conversation row (Workspaces, Agents, the Inbox) opens its conversation
  // beside the one on screen or in its own window, and the Inbox shows the
  // Agents panel: ConversationActions and Inbox ask through these.
  useProvideConversationOpeners({
    beside: target => {
      const live = livePage(), chats = shownPanels(live).filter(panel => panel.kind === 'chat' && !panel.detached);
      const already = chats.find(panel => resolveTarget(panel, live.selection).sessionId === target.sessionId);
      if (already) { if (changePage(activatePanel(live, already.id))) { setSettings(false); setMobilePanelId(already.id); focusAfter.current = { panel: already.id }; } return; }
      if (allPanels(live).length >= PANEL_LIMIT) { setError(`This page already has ${PANEL_LIMIT} panels; close one to open a conversation beside.`); return; }
      const panel: Panel = { id: crypto.randomUUID(), kind: 'chat', binding: { mode: 'pinned', target: { ...target, commandId: '' } }, detached: false };
      const anchor = chats.find(value => value.binding.mode === 'follow') || chats[0], group = anchor && groupOf(live, anchor.id);
      const docked = !!group && groups(live.layout).some(value => value.id === group.id);
      if (!changePage({ ...live, layout: docked ? splitBeside(live.layout, group!.id, panel, 'right') : insertDocked(live.layout, panel, 'right', 0.5) })) return;
      setSettings(false); setMobilePanelId(panel.id); focusAfter.current = { panel: panel.id };
    },
    window: host ? target => {
      const live = livePage(), open = detachedFor(live, target);
      if (open) { void host.openChat({ panelId: open.id, ...pinnedTarget(open) }).catch(error => setError(String(error))); return; }
      const shown = shownPanels(live).find(panel => panel.kind === 'chat' && !panel.detached && resolveTarget(panel, live.selection).sessionId === target.sessionId);
      if (shown) { void detach(shown); return; }
      if (allPanels(live).length >= PANEL_LIMIT) { setError(`This page already has ${PANEL_LIMIT} panels; close one to open a conversation in its own window.`); return; }
      const panel: Panel = { id: crypto.randomUUID(), kind: 'chat', binding: { mode: 'pinned', target: { ...target, commandId: '' } }, detached: true };
      if (!changePage({ ...live, detached: [...live.detached, panel] })) return;
      void host.openChat({ panelId: panel.id, collectionId: target.collectionId, sessionId: target.sessionId }).catch(error => { changePage(live); setError(String(error)); });
    } : undefined,
    showAgents: () => {
      const live = livePage(), agents = shownPanels(live).find(panel => panel.kind === 'agents');
      if (!agents || !changePage(activatePanel(live, agents.id))) return false;
      setSettings(false); setMobilePanelId(agents.id);
      return true;
    },
  });
  /** A chat back from its own window: where it was, on its page, in front; its window closes and this one comes forward. */
  const bringBack = async (panel: Panel) => {
    if (!host || pending) return;
    setPending(panel.id);
    try {
      await host.dockChat(panel.id);
      const back = returnDetached(current.current, panel.id);
      if (back && commit({ ...back.layout, selectedPage: back.page })) { setSettings(false); focusAfter.current = { panel: panel.id }; }
    }
    catch (error) { setError(String(error)); }
    finally { setPending(''); }
  };
  /**
   * A chat window asked to go back, or was closed: the chat returns where it
   * was. Put back, this window shows it (switching to its page, or to its
   * workspace when this window shows another); closed, it returns quietly.
   */
  const chatReturned = useRef<(request: ChatReturn) => void>(() => {});
  chatReturned.current = ({ panelId, collectionId, reason }) => {
    if (locked) return;
    const shown = reason === 'put-back';
    const back = returnDetached(current.current, panelId);
    if (back) {
      if (commit({ ...back.layout, selectedPage: shown ? back.page : current.current.selectedPage }) && shown) { setSettings(false); focusAfter.current = { panel: panelId }; }
      return;
    }
    // Saved with another workspace's pages: this window shows a different one now.
    if (fixedWorkspaceId || !collectionId || collectionId === workspaceID || !viewState) return;
    try {
      const saved = viewState.getItem(workspaceKey(collectionId));
      const other = saved ? returnDetached(repairLayout(retireMonitor(parseLayout(saved))), panelId) : undefined;
      if (!other) return;
      viewState.setItem(workspaceKey(collectionId), JSON.stringify({ ...other.layout, selectedPage: shown ? other.page : other.layout.selectedPage }));
      if (shown) { setSettings(false); select({ collectionId, sessionId: '', commandId: '' }); focusAfter.current = { panel: panelId }; }
    } catch (error) { setError(`Could not put the chat back: ${String(error)}`); }
  };
  useEffect(() => host?.onChatReturn?.(request => chatReturned.current(request)), [host]);
  // A saved chat whose window is gone (closed while this window was, or not restored) comes back to the page.
  useEffect(() => {
    if (!host?.chatWindowOpen) return;
    let live = true;
    for (const { panel } of detachedChats(current.current)) {
      void host.chatWindowOpen(panel.id).then(open => { if (!open && live) chatReturned.current({ panelId: panel.id, collectionId: workspaceID, reason: 'closed' }); }).catch(() => {});
    }
    return () => { live = false; };
  }, [host, workspaceID]);
  // One sidebar width for every workspace (see DockLayout).
  const [sidebarWidth, setSidebarWidth] = useState(() => { const saved = Number(readPreference(viewState, 'workspace.sidebar-width')); return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT; });
  const saveSidebarWidth = (width: number) => { const next = clampSidebar(width); setSidebarWidth(next); try { writePreference(viewState, 'workspace.sidebar-width', String(next)); } catch { /* a convenience */ } };

  // Layout presets, and the person's layouts: files in layouts/ (POWER.md, "Config files"), in every workspace.
  const layoutFiles = useLayoutFiles();
  const savedLayouts = layoutFiles.layouts;
  const [importing, setImporting] = useState<string | null>(null);
  const applyLayout = (preset: LayoutPreset) => {
    const live = livePage(), next = dedupeChats(applyTemplate(live, preset.layout, () => crypto.randomUUID()), live.selection);
    if (allPanels(next).length > PANEL_LIMIT) { setError(`That layout needs more than ${PANEL_LIMIT} panels.`); return; }
    changePage(next);
  };
  const saveLayout = (name: string) => { const layout = templateOf(livePage()); if (layout) void layoutFiles.save(name, layout).catch(() => undefined); };
  /** ⌘⇧L: the next layout (presets, then yours), with where it is in the cycle. */
  const cycleLayout = () => {
    const { layout, index, count } = layoutFiles.next(templateOf(livePage()));
    applyLayout(layout);
    showToast({ id: 'layout-cycle', tone: 'info', title: `Layout: ${layout.name}`, body: `${index + 1} of ${count}${keymap['layout.cycle'] ? ` · ${displayBinding(bindings(keymap['layout.cycle'])[0]).join('')} for the next` : ''}`, timeout: 1800 });
  };
  /** The arrangement shown, or a listed layout, as YAML on the clipboard. */
  const copyLayout = (preset?: LayoutPreset) => {
    const layout = preset?.layout || templateOf(livePage());
    const named = preset || [...builtinPresets, ...savedLayouts].find(value => layout && sameTemplate(layout, value.layout));
    if (layout) layoutFiles.copy({ name: named?.name || 'My layout', description: named?.description, layout });
  };

  const shown = shownPanels(page);
  const panelHosts = usePanelHosts(shown);
  const mobilePanels = shown.filter(panel => panel.kind !== 'collections');
  const terminalReady = !!workspaceID && collections.find(value => value.id === workspaceID)?.state === 'ready';
  const mobilePanel = mobilePanels.find(panel => panel.id === mobilePanelId) || mobilePanels.find(panel => panel.kind === 'chat') || mobilePanels[0];
  const detachedPanels = allPanels(page).filter(p => p.detached);
  const titleOf = (panel: Panel) => {
    const base = liveTitles[panel.id]?.text || registry[panel.kind]?.title || panel.kind;
    if (panel.kind !== 'chat') return base;
    const session = info?.sessions.find(value => value.id === resolveTarget(panel, page.selection).sessionId);
    return conversationTitle(session) || base;
  };
  const iconOf = (panel: Panel) => registry[panel.kind]?.icon || 'file';
  // Panels of this workspace in windows of their own: chats (of any page) and the page's popped-out groups.
  const later = useRef({ bringBack }); later.current = { bringBack };
  const otherWindows: OtherWindow[] = [
    ...detachedChats(layout).map(({ panel }) => ({ id: panel.id, title: titleOf(panel), icon: iconOf(panel),
      show: () => void host?.openChat({ panelId: panel.id, ...pinnedTarget(panel) }).catch(error => setError(String(error))),
      putBack: () => later.current.bringBack(panel), kind: 'chat' as const })),
    ...page.popouts.map(group => { const front = group.panels.find(value => value.id === group.active) || group.panels[0]; return { id: group.id,
      title: titleOf(front) + (group.panels.length > 1 ? ` +${group.panels.length - 1}` : ''), icon: iconOf(front),
      show: () => dock.current?.focusWindow(group.id), putBack: () => dock.current?.dockBack(group.id), kind: 'popout' as const }; }),
  ];
  // Popped-out groups first: a chat put back after them finds its neighbours in place.
  const putAllBack = async () => {
    const all = otherWindows;
    await Promise.all(all.filter(item => item.kind === 'popout').map(item => item.putBack()));
    for (const item of all.filter(item => item.kind === 'chat')) await item.putBack();
  };
  useKeyboardAction('window.put-all-back', putAllBack, () => otherWindows.length > 0 && !locked);
  // ⇧⌘D (or the Window menu) with a popped-out group's window in front: that group goes back.
  useKeyboardAction('window.put-back', () => { const group = dock.current?.focusedPopout(); if (group) dock.current?.dockBack(group); }, () => !!dock.current?.focusedPopout());
  const navigator = useWorkspaceCommands({
    root: viewState?.root || '', main: !fixedWorkspaceId, collections, selection: page.selection, workspaceId: workspaceID, workbench, registry,
    windows: otherWindows, canStartConversation: !!info && !pending && canShowNewSession, terminalReady, canOpenWorkspaceWindow: !!workspaceID && !!host?.openWorkspace && !fixedWorkspaceId,
    showSession, selectWorkspace: select, closeSettings: () => setSettings(false),
    showPanel: kind => kind === 'terminal' ? showTerminal() : kind === 'changes' ? showChanges() : void showModule(kind),
    openSettings: tab => { setSettingsTab(tab as SettingsTab); setSettings(true); },
    newConversation: () => beginConversation(), openWorkspaceWindow: () => void host?.openWorkspace?.(workspaceID),
    toggleEditing: () => { if (!settings) setEditing(value => !value); }, toggleConfiguring: () => { if (!settings) { setJSON(JSON.stringify(current.current, null, 2)); setConfiguring(value => !value); } },
  });
  const kindIcons = useMemo(() => Object.fromEntries(Object.entries(registry).map(([kind, module]) => [kind, module.icon])), [registry]);
  const togglePin = (panel: Panel) => {
    const target = resolveTarget(panel, page.selection);
    changePanel(panel.id, value => ({ ...value, binding: value.binding.mode === 'pinned' ? { mode: 'follow' } : { mode: 'pinned', target: { ...target } } }));
  };
  const groupCommands: GroupCommands = {
    title: titleOf,
    canClose: panel => !panel.detached,
    close: closePanel,
    // A Web panel has its own window (its ⋯ → Move to a new window): its native view belongs to one window.
    canOpenWindow: panel => panel.kind === 'chat' ? !!host && !!resolveTarget(panel, page.selection).sessionId : panel.kind !== 'web' && !narrow,
    openWindow: (panel, handle) => {
      if (panel.kind === 'chat') { void detach(panel); return; }
      void handle.popout(panel.id).then(opened => { if (!opened) setError('The new window was blocked. Allow pop-ups for Lazybox and try again.'); });
    },
    minimize: setMinimized,
    dockTo,
    splitWith: (groupID, panel, side) => {
      const group = groupById(livePage(), groupID);
      if (group && group.panels.length > 1) {
        const without = removeFromPage(livePage(), panel.id);
        // The group stays (it still has tabs): the panel goes beside it.
        changePage({ ...without, layout: splitBeside(without.layout, groupID, panel, side === 'right' ? 'right' : 'bottom') });
        focusAfter.current = { panel: panel.id };
        return;
      }
      setBeside({ group: groupID, side, title: titleOf(panel) });
      requestAnimationFrame(() => { if (panelsMenu.current) panelsMenu.current.open = true; });
    },
    togglePin,
  };
  const newConversationKeys = bindings(keymap['conversation.new'])[0];
  const addCommands: AddCommands = {
    title: titleOf, registry, hidden: sidebarKinds,
    newConversation: groupID => { conversationGroup.current = groupID; beginConversation(); },
    whyNoConversation: () => !info ? 'Connecting to the Runner…' : pending ? 'Wait for the window to open' : !canShowNewSession ? `This page already has ${PANEL_LIMIT} panels` : '',
    newConversationKeys: newConversationKeys ? displayBinding(newConversationKeys).join(' ') : undefined,
    addKeys: bindings(keymap['layout.add'])[0] ? displayBinding(bindings(keymap['layout.add'])[0]).join(' ') : undefined,
    where: (kind, groupID) => { const panel = shownPanels(page).find(value => value.kind === kind && !value.detached); return !panel ? 'none' : groupOf(page, panel.id)?.id === groupID ? 'here' : 'elsewhere'; },
    disabled: kind => locked ? 'Reset or import the retained layout first' : kind === 'terminal' && !terminalReady ? 'The workspace is not ready for a terminal' : '',
    openHere,
  };
  // The first binding of each, in shortcut() notation for menus.
  const menuKey = (id: 'layout.split' | 'layout.close' | 'layout.maximize') => (bindings(keymap[id])[0] || '').replace(/\bMeta\+/g, 'Mod+');
  const putBackKeys = bindings(keymap['window.put-back'])[0] ? displayBinding(bindings(keymap['window.put-back'])[0]).join(' ') : '';
  const layoutKeys = { split: menuKey('layout.split'), close: menuKey('layout.close'), maximize: menuKey('layout.maximize'), putBack: putBackKeys };
  // Right-clicking a tab opens its group's menu, through the shared context menu.
  useContextMenuContribution<{ panelTab?: string }>('dock-tab', context => {
    const id = context.detail?.panelTab, group = id ? dock.current?.groupOf(id) : undefined;
    if (!group || !dock.current) return [];
    dock.current.focusTab(id!);
    return groupMenuItems({ ...group, active: group.panels.find(panel => panel.id === id) || group.active }, dock.current, groupCommands, layoutKeys);
  });
  // The layout's commands, for the keys below and for any action list (layout-commands.ts).
  const activePanel = () => { const id = dock.current?.activePanelID(); return shownPanels(livePage()).find(value => value.id === id); };
  const splitActive = (side: 'right' | 'below') => { const group = dock.current?.activeGroup(); if (group?.active) groupCommands.splitWith(group.id, group.active, side); };
  const closeActive = () => { const panel = activePanel(); if (panel) closePanel(panel); };
  const commandsRef = useRef<() => LayoutCommand[]>(() => []);
  commandsRef.current = () => {
    const docked = !narrow && !settings && !locked, panel = activePanel(), group = dock.current?.activeGroup();
    const command = (id: string, label: string, group: LayoutCommand['group'], run: () => void, enabled = () => docked, keys?: string): LayoutCommand => ({ id, label, group, run, enabled, keys });
    return [
      command('layout.split', 'Split right', 'Layout', () => splitActive('right'), () => docked && !!panel, keymap['layout.split']),
      command('layout.split-down', 'Split down', 'Layout', () => splitActive('below'), () => docked && !!panel),
      command('layout.close', 'Close panel', 'Layout', closeActive, () => docked && !!panel && !panel.detached, keymap['layout.close']),
      command('layout.maximize', 'Maximize or restore panel', 'Layout', () => dock.current?.toggleMaximize(), () => docked && !!panel, keymap['layout.maximize']),
      command('layout.next-group', 'Next panel group', 'Layout', () => dock.current?.cycleGroups(1), () => docked, keymap['layout.next-group']),
      command('layout.previous-group', 'Previous panel group', 'Layout', () => dock.current?.cycleGroups(-1)),
      command('layout.float', 'Float panel over the page', 'Layout', () => panel && dock.current?.float(panel.id), () => docked && !!panel && group?.location === 'grid'),
      command('layout.window', 'Open panel in new window', 'Layout', () => panel && dock.current && groupCommands.openWindow(panel, dock.current), () => docked && !!panel && groupCommands.canOpenWindow(panel)),
      command('layout.minimize', 'Minimize or restore panel group', 'Layout', () => group && setMinimized(group.id, !group.minimized), () => docked && !!group?.canMinimize),
      ...layoutDirections.flatMap(direction => [
        command(`layout.focus-${direction}`, `Focus the panel group ${{ left: 'to the left', right: 'to the right', up: 'above', down: 'below' }[direction]}`, 'Layout', () => dock.current?.focusDirection(direction), () => docked, keymap[`layout.focus-${direction}`]),
        command(`layout.move-${direction}`, `Move the active panel ${direction}`, 'Layout', () => moveActive(direction), () => docked && !!panel, keymap[`layout.move-${direction}`]),
        command(`layout.resize-${direction}`, `Resize: move the active group’s edge ${direction}`, 'Layout', () => dock.current?.resize(direction, false), () => docked && !!panel, keymap[`layout.resize-${direction}`]),
      ]),
      command('layout.add', 'New tab in the active group…', 'Layout', () => group && openAddMenu(group.id), () => docked && canAdd(group), keymap['layout.add']),
      command('layout.reset', 'Reset layout to default', 'Layouts', () => applyLayout(builtinPresets.find(value => value.id === DEFAULT_PRESET)!), () => !locked),
      command('layout.reset-all', 'Reset the layout and shortcuts', 'Layouts', () => resetEverything(), () => true, keymap['layout.reset-all']),
      ...[...builtinPresets, ...savedLayouts].map(preset => command(`layout.preset:${preset.id}`, `Layout: ${preset.name}`, 'Layouts', () => applyLayout(preset), () => !locked)),
      ...Object.entries(registry).map(([kind, module]) => command(`panel.show:${kind}`, `Show ${module.title}`, 'Panels', () => kind === 'terminal' ? showTerminal() : kind === 'chat' ? showSession(livePage().selection) : void showModule(kind), () => !locked && !settings && (kind !== 'terminal' || terminalReady))),
    ];
  };
  useEffect(() => provideLayoutCommands(() => commandsRef.current()), []);
  // The registry's layout actions (keys, palette, menus) run the same functions.
  const docked = () => !narrow && !settings && !locked && !!dock.current;
  const hasActive = () => docked() && !!activePanel();
  useKeyboardAction('layout.split', () => splitActive('right'), hasActive);
  useKeyboardAction('layout.split-down', () => splitActive('below'), hasActive);
  useKeyboardAction('layout.close', closeActive, () => hasActive() && !activePanel()!.detached);
  useKeyboardAction('layout.maximize', () => dock.current?.toggleMaximize(), hasActive);
  useKeyboardAction('layout.next-group', () => dock.current?.cycleGroups(1), docked);
  useKeyboardAction('layout.previous-group', () => dock.current?.cycleGroups(-1), docked);
  useKeyboardAction('layout.float', () => { const panel = activePanel(); if (panel) dock.current?.float(panel.id); }, () => hasActive() && dock.current?.activeGroup()?.location === 'grid');
  useKeyboardAction('layout.window', () => { const panel = activePanel(); if (panel && dock.current) groupCommands.openWindow(panel, dock.current); }, () => hasActive() && groupCommands.canOpenWindow(activePanel()!));
  useKeyboardAction('layout.minimize', () => { const group = dock.current?.activeGroup(); if (group) setMinimized(group.id, !group.minimized); }, () => docked() && !!dock.current?.activeGroup()?.canMinimize);
  useKeyboardAction('layout.panels', () => requestAnimationFrame(() => { if (panelsMenu.current) panelsMenu.current.open = true; }), () => !narrow && !settings);
  useKeyboardAction('layout.presets', () => requestAnimationFrame(() => { if (layoutMenu.current) layoutMenu.current.open = true; }), () => !narrow && !settings);
  useKeyboardAction('layout.reset', () => applyLayout(builtinPresets.find(value => value.id === DEFAULT_PRESET)!), () => !locked);
  useKeyboardAction('layout.cycle', cycleLayout, () => !narrow && !settings && !locked);
  useKeyboardAction('layout.copy', () => copyLayout(), () => !narrow && !settings && !!page.layout);
  useKeyboardAction('layout.import', (argument?: unknown) => setImporting(typeof argument === 'string' ? argument : ''), () => !narrow && !settings && !locked);

  // Panel groups from the keyboard (dock-keyboard.ts): focus, move or swap, resize, tabs, +.
  const moveActive = (direction: LayoutDirection) => {
    const handle = dock.current, panel = activePanel();
    if (!handle || !panel) return;
    const where = handle.activeGroup()?.location;
    if (where && where !== 'grid') { handle.announce(`${titleOf(panel)} is ${where === 'floating' ? 'floating' : 'in its own window'}: dock it from its menu first`, direction); return; }
    const live = livePage(), neighbour = handle.neighbour(direction), next = neighbour ? groupById(live, neighbour) : undefined;
    const moved = movePanel(live, panel.id, direction, neighbour);
    const name = titleOf(panel), other = next && titleOf(next.panels.find(value => value.id === next.active) || next.panels[0]);
    if (!moved) {
      handle.announce(sidebarKinds.has(panel.kind) ? `${name} stays in the sidebar` : next && sidebarKinds.has(next.panels[0]?.kind) ? `${name} cannot go into the sidebar` : `${name} is already at the ${{ left: 'left', right: 'right', up: 'top', down: 'bottom' }[direction]} edge`, direction);
      return;
    }
    if (!changePage(moved.page)) return;
    focusAfter.current = { panel: panel.id };
    handle.announce(moved.how === 'joined' ? `Moved ${name} into the ${other} group` : moved.how === 'swapped' ? `Swapped ${name} with ${other}` : `Moved ${name} to a new group ${{ left: 'on the left', right: 'on the right', up: 'above', down: 'below' }[direction]}`);
  };
  const directional = (prefix: 'focus' | 'move' | 'resize', run: (direction: LayoutDirection, argument?: unknown) => void) => Object.fromEntries(layoutDirections.map(direction => [`layout.${prefix}-${direction}`, { run: (argument?: unknown) => run(direction, argument), enabled: prefix === 'focus' ? docked : hasActive }]));
  const tabSlots = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`layout.tab.${i + 1}`, { run: () => dock.current?.selectTab(i + 1), enabled: hasActive }]));
  useActions({
    ...directional('focus', direction => dock.current?.focusDirection(direction)),
    ...directional('move', moveActive),
    ...directional('resize', (direction, argument) => dock.current?.resize(direction, !!(argument as { repeat?: boolean } | undefined)?.repeat)),
    ...tabSlots,
    'layout.add': { run: () => { const group = dock.current?.activeGroup(); if (group) openAddMenu(group.id); }, enabled: () => hasActive() && canAdd(dock.current?.activeGroup()) },
    'layout.reset-all': () => resetEverything(),
  } as Parameters<typeof useActions>[0]);
  /** Whether a group has a `+`: not the sidebar (its panels are the workspace list), and not a group in a window of its own. */
  const canAdd = (group?: { panels: Panel[]; location: string }) => !!group && group.location !== 'popout' && !group.panels.every(panel => sidebarKinds.has(panel.kind));
  const openAddMenu = (groupID: string) => requestAnimationFrame(() => {
    const menu = document.querySelector<HTMLDetailsElement>(`.dock-group-add[data-group="${CSS.escape(groupID)}"] details`);
    if (menu) menu.open = true;
  });
  /**
   * The escape hatch (⌃⌥⇧Esc, which cannot be rebound): the default layout, the
   * default sidebar width and the default keys, in one step, with Undo.
   */
  const resetEverything = () => {
    // A retained layout that could not be read is kept as saved, so Undo can put it back untouched.
    const before = { layout: current.current, workspace: workspaceID, sidebar: sidebarWidth, locked, error, saved: locked ? viewState?.getItem(key) : undefined };
    dock.current?.restore();
    const restoreKeys = resetKeymap(viewState);
    saveSidebarWidth(SIDEBAR_DEFAULT);
    setSettings(false); setEditing(false); setConfiguring(false);
    if (locked) commit(defaultLayout({ ...page.selection, collectionId: workspaceID }), true);
    else {
      const live = livePage(), next = dedupeChats(applyTemplate(live, builtinPresets.find(value => value.id === DEFAULT_PRESET)!.layout, () => crypto.randomUUID()), live.selection);
      changePage(next);
    }
    focusAfter.current = 'content';
    showToast({ id: 'layout:reset-all', tone: 'info', title: 'Layout and shortcuts reset', body: 'The default layout and keys are back.', timeout: 10000,
      button: { label: 'Undo', run: () => {
        restoreKeys();
        saveSidebarWidth(before.sidebar);
        // Another workspace shown since: its layout is not the one that was reset.
        if (shownWorkspace.current !== before.workspace) return;
        if (!before.locked) { commit(before.layout); return; }
        try { if (typeof before.saved === 'string') viewState?.setItem(key, before.saved); } catch { /* shown as retained either way */ }
        current.current = before.layout; setLayout(before.layout); setLocked(true); setError(before.error);
      } } });
  };

  const panelActions: PanelActions = {
    close: closePanel, showSession,
    title: (panel, title) => setLiveTitles(titles => titles[panel.id]?.text === title?.text && titles[panel.id]?.icon === title?.icon ? titles : { ...titles, [panel.id]: title }),
    retarget: (panel, target) => panel.binding.mode === 'pinned' ? changePanel(panel.id, value => ({ ...value, binding: { mode: 'pinned', target } })) : select(target),
    detach: panel => void detach(panel),
    dock: panel => void bringBack(panel),
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
    module={moduleProps} actions={panelActions} pending={!!pending} mobileActive={panel.id === mobilePanel?.id} canDetach={!!host}/>;
  const kindsShown = new Map<string, 'shown' | 'window'>([...detachedPanels.map(panel => [panel.kind, 'window'] as const), ...page.popouts.flatMap(group => group.panels.map(panel => [panel.kind, 'window'] as const)), ...shown.filter(panel => !page.popouts.some(group => group.panels.includes(panel)) && !panel.detached).map(panel => [panel.kind, 'shown'] as const)]);

  return <WorkbenchContext.Provider value={workbench}><main className="workspace-shell">
    <LeaderMenu hint={keyboardHint}/>
    <CommandCenter viewState={viewState} navigator={navigator}/>
    <WorkspaceHeader app={fixedWorkspaceId ? undefined : host?.app} pages={layout.pages} selectedPage={page.id} settings={settings} pending={!!pending} fixedWorkspace={!!fixedWorkspaceId} navigatorOpen={navigatorOpen}
      collections={collections} selection={page.selection} viewState={viewState} workspaceID={workspaceID} info={info} terminalReady={terminalReady} canShowNewSession={canShowNewSession}
      editing={editing} changesShown={layout.pages.some(value => shownPanels(value).some(panel => panel.kind === 'changes'))} canOpenWorkspaceWindow={!!workspaceID && !!host?.openWorkspace && !fixedWorkspaceId}
      layoutMenu={!settings && !narrow && <>
        <PanelsMenu menu={panelsMenu} registry={registry} shown={kindsShown} beside={beside?.title} disabled={kind => locked || (kind === 'terminal' && !terminalReady)}
          onShow={kind => { if (kind === 'terminal') showTerminal(); else if (kind === 'chat' && !beside) showSession(page.selection); else { const id = showModule(kind); if (id) focusAfter.current = { panel: id }; } }}
          onClose={() => setBeside(undefined)}/>
        <LayoutMenu menu={layoutMenu} current={templateOf(page)} saved={savedLayouts} broken={layoutFiles.broken} folder={layoutFiles.folder} cycleKey={keymap['layout.cycle'] ? displayBinding(bindings(keymap['layout.cycle'])[0]).join('') : undefined}
          icons={kindIcons} disabled={locked || !!pending} onApply={applyLayout} onSave={saveLayout}
          onRename={layoutFiles.rename} onDelete={layoutFiles.remove} onCopy={copyLayout} onImport={() => setImporting('')}
          onReset={() => applyLayout(builtinPresets.find(value => value.id === DEFAULT_PRESET)!)}/>
      </>}
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
    {!settings && <OtherWindows windows={otherWindows} putBackKeys={putBackKeys} onPutAllBack={putAllBack}/>}
    {repositoryWorkspace && <WorkspaceRepositories workspace={collections.find(value => value.id === repositoryWorkspace.id) || repositoryWorkspace} onClose={() => setRepositoryWorkspace(undefined)} onSaved={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder}/>}
    {!fixedWorkspaceId && <NewTaskHost viewState={viewState} onStarted={target => { refreshCatalog(); refreshRunner(); showSession(target); }}/>}
    <NewConversationDialog open={newSession} quickStart={quickStart} workspaceID={workspaceID} workspaceName={collections.find(value => value.id === workspaceID)?.name} viewState={sessionStore}
      onQuickStart={() => setQuickStart(true)} onClose={() => { setNewSession(false); conversationGroup.current = ''; }} onStarted={showNewSession}/>
    <RestartNotice/>
    {/* A restart the person asked for explains the dropped connection; RestartNotice says so instead. */}
    {(error || (connectionError && restart.phase !== 'restarting')) && <div className="error" role="alert">
      {connectionError && restart.phase !== 'restarting'
        ? <><strong>Runner disconnected.</strong> Reconnecting automatically… <details><summary>Connection details</summary>{connectionError}</details></>
        : error}
      <button onClick={() => { if (host?.reconnect) void host.reconnect().catch(e => setError(String(e))); else refresh(); }}>Retry now</button>
    </div>}
    {settings
      ? <SettingsPage app={host?.app} zoom={host?.zoom} tab={settingsTab} onTab={setSettingsTab} onShowProcesses={() => showModule('processes')} chooseRepositoryFolder={host?.chooseRepositoryFolder} viewState={viewState} openSignIn={host?.openSignIn} copySignInCode={host?.copySignInCode}/>
      : <>
        {locked && <button onClick={() => commit(defaultLayout({ ...initialTarget, collectionId: workspaceID }), true)}>Reset retained layout</button>}
        {configuring && <LayoutConfiguration json={json} disabled={hasDetached || !!pending} onChange={setJSON} onClose={() => setConfiguring(false)}
          onImport={() => { try { if (commit(repairLayout(parseLayout(json)), true)) setConfiguring(false); } catch (error) { setError(String(error)); } }}/>}
        <WorkspaceSwitcher selection={page.selection} workspaceID={workspaceID} collections={collections} info={info} locked={!!pending || !!fixedWorkspaceId} conversationShown={kindsShown.get('chat') === 'shown' && !!page.selection.sessionId}
          onSelect={select} onShowRepositories={setRepositoryWorkspace}/>
        {editing && <PageConfig page={page} layout={layout} hasDetached={hasDetached} pending={!!pending} commit={commit} changePage={changePage} onDone={() => setEditing(false)}/>}
        {narrow && mobilePanels.length > 1 && <MobilePanelSwitcher panels={mobilePanels} active={mobilePanel} title={panel => registry[panel.kind]?.title || panel.kind}
          onChoose={panel => { setMobilePanelId(panel.id); const group = groupOf(livePage(), panel.id); if (group && (group.minimized || group.active !== panel.id)) changePage(activatePanel(livePage(), panel.id)); if (panel.kind === 'console') putConsoleAway(false); }}/>}
        <div className="page-layout" data-page-id={page.id}>
          {narrow
            ? mobilePanel ? <MobilePanel host={panelHosts.hostFor(mobilePanel)} title={titleOf(mobilePanel)} onClose={mobilePanel.kind === 'chat' || mobilePanel.detached ? undefined : () => closePanel(mobilePanel)}/> : <p className="module-empty">Your conversations are open in separate windows.</p>
            : <DockLayout ref={dock} page={page} hostFor={panelHosts.hostFor} titleOf={titleOf} iconOf={iconOf} imageOf={panel => liveTitles[panel.id]?.icon} canClose={groupCommands.canClose}
              sidebarWidth={sidebarWidth} onSidebarWidth={saveSidebarWidth} popoutUrl={POPOUT_URL}
              closeLabel={(panel, title) => layout.pages.length > 1 && shownPanels(page).length === 1 && !page.detached.length && shownPanels(page)[0].id === panel.id ? `Close ${title} page` : `Close ${title} panel`}
              onArrange={next => changePage({ ...livePage(), ...next })}
              onClose={closePanel}
              onRestore={groupID => setMinimized(groupID, false)}
              onPopoutKey={(event, groupID) => {
                const pressed = canonicalKey(chordFromEvent(event));
                if (!bindings(keymap['window.put-back']).some(binding => canonicalBinding(binding) === pressed)) return;
                event.preventDefault(); dock.current?.dockBack(groupID);
              }}
              renderActions={(group, handle) => <GroupActions group={group} handle={handle} commands={groupCommands} keys={layoutKeys}/>}
              renderAdd={group => canAdd(group) ? <GroupAdd group={group} commands={addCommands}/> : null}
              empty={<div className="module-empty dock-empty-state">
                <h3>No panels on this page</h3>
                <p>Open one from Panels, or give the page a layout.</p>
                <button onClick={() => showSession(page.selection)}>Show the conversation</button>
                <button onClick={() => applyLayout(builtinPresets.find(value => value.id === DEFAULT_PRESET)!)}>Reset to default</button>
              </div>}/>}
        </div>
        {shown.map(panel => createPortal(renderPanel(panel), panelHosts.hostFor(panel), panelHosts.slotOf(panel)))}
      </>}
    <PeekHost navigation={{ showSession, showModule: kind => void showModule(kind), showTerminal, openArtifact: (collectionId, artifactId) => { if (!openArtifact({ collectionId, artifactId })) showModule('artifacts'); },
      openFile: (collectionId, path, line) => { if (!workbench || collectionId !== workspaceID) return false; workbench.open(path, { line, focus: true }); return true; } }}/>
    <Onboarding viewState={viewState} collections={collections} collectionsLoaded={catalogLoaded} automatic={!fixedWorkspaceId} host={host} sessionId={page.selection.sessionId} onOpenSettings={tab => { if (fixedWorkspaceId) return; setSettingsTab(tab); setSettings(true); }}/>
    {quickOpen && workbench && <QuickOpen key={workbench.workspaceId} workbench={workbench} onClose={() => setQuickOpen(false)}/>}
    {quickLook && workspaceID && <FilePreview key={`${workspaceID}:${quickLook.path}`} workspaceId={workspaceID} reference={quickLook} viewState={viewState} onClose={() => setQuickLook(undefined)}/>}
    {workspaceID && <ReviewActions workspaceId={workspaceID} sessionId={page.selection.collectionId === workspaceID ? page.selection.sessionId : ''}/>}
    {importing !== null && <LayoutImportDialog initial={importing} onClose={() => setImporting(null)} onImported={layout => { applyLayout(layout); showToast({ id: 'layout-file', tone: 'info', title: `Imported “${layout.name}”`, body: `${layout.file}.yaml in your layouts folder`, timeout: 3600 }); }}/>}
    <PowerLayer workspaceId={workspaceID} selection={{ collectionId: page.selection.collectionId || workspaceID, sessionId: page.selection.sessionId }} primary={!fixedWorkspaceId} host={host} viewState={viewState}
      onSelect={target => select({ ...target, commandId: '' })} onShowSession={target => showSession({ ...target, commandId: '' })}
      onShowPanel={(kind, target) => kind === 'terminal' ? showTerminal() : kind === 'changes' ? showChanges() : showPanelFor(kind, { ...target, commandId: '' })}
      onOpenSettings={tab => { setSettingsTab(tab); setSettings(true); }} onQuickLook={(path, line) => setQuickLook({ path, line })}
      describe={target => [collections.find(c => c.id === target.collectionId)?.name, info?.sessions.find(s => s.id === target.sessionId)?.title].filter(Boolean).join(' · ') || 'the workspace'}/>
    {navigatorOpen && <WorkspaceNavigator target={page.selection} onTarget={target => target.sessionId ? showSession(target) : select(target)} collections={collections} error={catalogError} loaded={catalogLoaded} refresh={refreshCatalog} chooseRepositoryFolder={host?.chooseRepositoryFolder} onNewConversation={beginConversation} onClose={() => setNavigatorOpen(false)}/>}
  </main></WorkbenchContext.Provider>;
}
