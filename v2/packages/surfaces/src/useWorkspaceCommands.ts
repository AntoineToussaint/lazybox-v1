import { useMemo, useRef } from 'react';
import type { Collection } from '@lazybox/protocol';
import { useActions } from './actions';
import type { CommandNavigator } from './CommandCenter';
import { useNavigationRequests } from './navigate-requests';
import type { PanelModule } from './PanelRegistry';
import type { Workbench } from './workbench';
import type { ViewTarget } from './workspace-model';

type Commands = {
  root: string;
  /** The main window (not a window fixed to one workspace): it takes other windows' requests and has Settings. */
  main: boolean;
  collections: Collection[];
  selection: ViewTarget;
  workspaceId: string;
  workbench?: Workbench;
  registry: Readonly<Record<string, PanelModule>>;
  canStartConversation: boolean;
  terminalReady: boolean;
  canOpenWorkspaceWindow: boolean;
  showSession(target: ViewTarget): void;
  selectWorkspace(target: ViewTarget): void;
  showPanel(kind: string): void;
  openSettings(tab: string): void;
  closeSettings(): void;
  newConversation(): void;
  openWorkspaceWindow(): void;
  toggleEditing(): void;
  toggleConfiguring(): void;
};

/** Panels the palette does not offer: the page is made of them. */
const pageOnly = new Set(['collections', 'chat']);

/**
 * The Workspace's actions in the registry (what its header buttons and page
 * menu do), and the navigator the command palette and navigation keys use.
 */
export function useWorkspaceCommands(commands: Commands): CommandNavigator {
  const latest = useRef(commands); latest.current = commands;
  const c = () => latest.current;
  useActions({
    'settings.open': commands.main && { run: tab => c().openSettings(typeof tab === 'string' ? tab : 'subscriptions') },
    'conversation.new': { run: () => c().newConversation(), enabled: () => c().canStartConversation },
    'changes.show': { run: () => c().showPanel('changes'), enabled: () => !!c().workspaceId },
    'terminal.open': { run: () => c().showPanel('terminal'), enabled: () => c().terminalReady },
    'workspace.window': { run: () => c().openWorkspaceWindow(), enabled: () => c().canOpenWorkspaceWindow },
    'page.customize': () => c().toggleEditing(),
    'layout.configure': () => c().toggleConfiguring(),
  });
  // A detached chat window asks this window to show a conversation.
  useNavigationRequests(commands.root, commands.main, target => goTo(target));
  const goTo = (target: ViewTarget) => {
    const { showSession, selectWorkspace, closeSettings, workspaceId } = latest.current;
    closeSettings();
    if (target.sessionId) showSession(target);
    else if (target.collectionId !== workspaceId) selectWorkspace(target);
  };
  const panels = useMemo(() => Object.entries(commands.registry).filter(([kind]) => !pageOnly.has(kind)).map(([kind, module]) => ({ kind, title: module.title, icon: module.icon || 'file' })), [commands.registry]);
  return useMemo(() => ({
    collections: commands.collections, current: commands.selection, workbench: commands.workbench, panels,
    goTo, showPanel: (kind: string) => latest.current.showPanel(kind),
    openSettings: commands.main ? (tab: string) => latest.current.openSettings(tab) : undefined,
  }), [commands.collections, commands.selection, commands.workbench, panels, commands.main]);
}
