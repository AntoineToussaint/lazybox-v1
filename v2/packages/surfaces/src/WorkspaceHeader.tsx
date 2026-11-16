import { HelpMenu } from './HelpMenu';
import type { Collection, InfoResponse } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';
import { AttentionCenter } from './Inbox';
import type { PanelModule } from './PanelRegistry';
import { RunControl } from './RunControl';
import { RunnerIndicator } from './RunnerControl';
import { shortcut } from './workbench';
import type { ViewTarget, WorkspacePage } from './workspace-model';

/**
 * The window's header: the navigator (on a phone), its pages and Settings,
 * the inbox, the workspace's tools, a new conversation, the Runner, and the
 * page's own actions.
 */
export function WorkspaceHeader({ pages, selectedPage, settings, pending, fixedWorkspace, navigatorOpen, collections, selection, viewState, workspaceID, info, terminalReady, canShowNewSession, editing, hiddenModules, openPreview, canOpenWorkspaceWindow, onOpenNavigator, onSelectPage, onOpenSettings, onOpenAttention, onShowChanges, onBrowseFiles, onShowTerminal, onNewConversation, onOpenRunner, onOpenWorkspaceWindow, onToggleEditing, onToggleConfiguring, onShowModule }: {
  pages: WorkspacePage[];
  selectedPage: string;
  /** Settings are on screen instead of a page. */
  settings: boolean;
  pending: boolean;
  /** A window that shows one workspace: no Settings page and no Runner settings. */
  fixedWorkspace: boolean;
  navigatorOpen: boolean;
  collections: Collection[];
  selection: ViewTarget;
  viewState?: ViewStateStore;
  workspaceID: string;
  info?: InfoResponse;
  terminalReady: boolean;
  canShowNewSession: boolean;
  editing: boolean;
  hiddenModules: [string, PanelModule][];
  /** Opens an action's preview in the system browser (the desktop app). */
  openPreview?(url: string): Promise<void>;
  canOpenWorkspaceWindow: boolean;
  onOpenNavigator(): void;
  onSelectPage(id: string): void;
  onOpenSettings(): void;
  onOpenAttention(target: ViewTarget): void;
  onShowChanges(): void;
  onBrowseFiles(): void;
  onShowTerminal(): void;
  onNewConversation(): void;
  onOpenRunner(): void;
  onOpenWorkspaceWindow(): void;
  onToggleEditing(): void;
  onToggleConfiguring(): void;
  onShowModule(kind: string): void;
}) {
  return <header className="workspace-header">
    <button className="mobile-navigation-button icon-button" aria-label="Open workspace navigator" aria-expanded={navigatorOpen} onClick={onOpenNavigator}><Icon name="sidebar"/></button>
    <div className="workspace-brand"><span className="brand-mark">l<span>↗</span></span><strong>lazybox</strong></div>
    <nav aria-label="Pages">
      {pages.map(value => <button key={value.id} disabled={pending} className={!settings && value.id === selectedPage ? 'selected' : ''} onClick={() => onSelectPage(value.id)}>{value.name}</button>)}
      {!fixedWorkspace && <button className={settings ? 'selected' : ''} onClick={onOpenSettings}>Settings</button>}
    </nav>
    <div className="workspace-header-actions">
      <AttentionCenter collections={collections} selection={selection} viewState={viewState} onOpen={onOpenAttention}/>
      <button className="toolbar-action" disabled={!workspaceID} aria-label="Review changes" title="Review changes" onClick={onShowChanges}><Icon name="branch"/><span>Changes</span></button>
      <button className="toolbar-action" disabled={!workspaceID} aria-label="Browse files" title={`Browse files · Go to file ${shortcut('Mod+P')}`} onClick={onBrowseFiles}><Icon name="folder"/><span>Files</span></button>
      <RunControl workspaceId={workspaceID} disabled={!terminalReady} onShowPanel={onShowModule} openPreview={openPreview}/>
      <button className="toolbar-action" disabled={!terminalReady} aria-label="Open terminal" title="Open a terminal in this workspace" onClick={onShowTerminal}><Icon name="terminal"/><span>Terminal</span></button>
      <button className="toolbar-action new-conversation-action" disabled={!info || pending || !canShowNewSession} aria-label="New conversation" title="New conversation" onClick={onNewConversation}><Icon name="plus"/><span>New conversation</span></button>
      <RunnerIndicator onOpen={fixedWorkspace ? undefined : onOpenRunner}/>
      <HelpMenu settings={!fixedWorkspace}/>
      <ActionMenu label="Page actions">
        {canOpenWorkspaceWindow && <button onClick={onOpenWorkspaceWindow}>Open workspace window</button>}
        <button disabled={settings} onClick={onToggleEditing}>{editing ? 'Finish customizing' : 'Customize page'}</button>
        <button disabled={settings} onClick={onToggleConfiguring}>Layout configuration</button>
        {!settings && !editing && hiddenModules.length > 0 && <>
          <small className="action-menu-heading">Show panel</small>
          {hiddenModules.map(([kind, module]) => <button key={kind} className="show-panel" disabled={kind === 'terminal' && !terminalReady} onClick={() => onShowModule(kind)}><Icon name={module.icon || 'file'}/><span>{module.title}</span></button>)}
        </>}
      </ActionMenu>
    </div>
  </header>;
}
