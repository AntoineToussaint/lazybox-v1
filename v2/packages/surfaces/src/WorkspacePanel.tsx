import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';
import { ActionMenuItems } from './ActionMenuItems';
import { contextMenu } from './ContextMenu';
import type { MenuItem } from './context-menu-model';
import { sentence, type ModuleProps, type PanelModule, type PanelTitle } from './PanelRegistry';
import { closable, dockSides, type DockSide, type Panel, type ViewTarget } from './workspace-model';

/** What a panel can ask of its page. */
export type PanelActions = {
  toggleCollapsed(panel: Panel): void;
  dockTo(panel: Panel, side: DockSide): void;
  close(panel: Panel): void;
  startDrag(event: ReactPointerEvent<HTMLElement>, panel: Panel): void;
  /** Shows a target in this panel: a pinned panel keeps its own, others move the page. */
  retarget(panel: Panel, target: ViewTarget): void;
  showSession(target: ViewTarget): void;
  /** Customizing: pin the panel to what it shows now, or let it follow the page again. */
  toggleBinding(panel: Panel, target: ViewTarget): void;
  move(panel: Panel, step: -1 | 1): void;
  remove(panel: Panel): void;
  detach(panel: Panel): void;
  dock(panel: Panel): void;
};

/** What every panel module receives from its page, besides its own target and store. */
export type SharedModuleProps = Omit<ModuleProps, 'target' | 'onTarget' | 'viewState' | 'onOpenChat'>;

/** One panel of a page: its header (title, dock menu, close) and its module. */
export function WorkspacePanel({ panel, definition, target, store, module, actions, editing, pending, docking, mobileActive, only, closesPage = false, docked, canDetach, canRemove }: {
  panel: Panel;
  definition?: PanelModule;
  target: ViewTarget;
  store?: ViewStateStore;
  module: SharedModuleProps;
  actions: PanelActions;
  editing: boolean;
  /** A detach or dock is in flight. */
  pending: boolean;
  /** This panel's header is being dragged to a dock. */
  docking: boolean;
  mobileActive: boolean;
  /** The only panel on its page. */
  only: boolean;
  /** Closing the only panel closes its page (the workspace has another page to go to). */
  closesPage?: boolean;
  docked?: DockSide;
  /** The host can open chats in their own window. */
  canDetach: boolean;
  canRemove: boolean;
}) {
  const onTarget = (next: ViewTarget) => actions.retarget(panel, next);
  const detachable = panel.kind === 'chat' && canDetach && !!target.sessionId && !panel.detached;
  // What the module shows instead of its kind's title (a web page's own title and icon).
  const [live, setLive] = useState<PanelTitle>();
  return <section className={`workspace-panel panel-${panel.kind}${panel.collapsed && !editing ? ' is-collapsed' : ''}${editing ? ' is-editing' : ''}${docking ? ' is-docking' : ''}`} aria-label={definition?.title || panel.kind} data-panel-id={panel.id} data-mobile-active={mobileActive || undefined}>
    <header className="module-header" onPointerDown={editing ? undefined : event => actions.startDrag(event, panel)}
      onContextMenu={editing ? undefined : contextMenu('panel', () => panelItems({ panel, actions, pending, only, closesPage, docked, detach: detachable ? () => actions.detach(panel) : undefined }), { kind: panel.kind, id: panel.id })}>
      {!editing
        ? <PanelHeader panel={panel} definition={definition} actions={actions} pending={pending} only={only} closesPage={closesPage} docked={docked} detach={detachable ? () => actions.detach(panel) : undefined} live={live}/>
        : panel.kind === 'console'
          ? <button className="module-title" aria-label={panel.collapsed ? 'Show command output' : 'Hide command output'} aria-expanded={!panel.collapsed} onClick={() => actions.toggleCollapsed(panel)}><Icon name="terminal"/><span>{definition?.title}</span><Icon name="chevron" size={13}/></button>
          : <strong>{definition?.title || panel.kind}</strong>}
      {editing && <span>{panel.binding.mode === 'pinned' ? 'Pinned' : 'Follows page'}</span>}
      {editing && <div className="panel-config">
        <button disabled={panel.detached || pending} onClick={() => actions.toggleBinding(panel, target)}>{panel.binding.mode === 'pinned' ? 'Follow page' : 'Pin view'}</button>
        <button aria-label={`Move ${panel.kind} earlier`} onClick={() => actions.move(panel, -1)}>←</button>
        <button aria-label={`Move ${panel.kind} later`} onClick={() => actions.move(panel, 1)}>→</button>
        <button aria-label={`Remove ${panel.kind} panel`} disabled={!canRemove || panel.detached || pending} onClick={() => actions.remove(panel)}>Remove</button>
      </div>}
    </header>
    {(!panel.collapsed || editing) && <div className="module-body">
      {panel.detached
        ? <DetachedMessage canDetach={canDetach} pending={pending} onOpen={() => actions.detach(panel)} onDock={() => actions.dock(panel)}/>
        : definition
          ? <definition.Component {...module} target={target} viewState={store} panelId={panel.id} onPanelTitle={setLive}
            onTarget={panel.kind === 'collections' ? next => next.sessionId ? actions.showSession(next) : onTarget(next) : onTarget}
            onOpenChat={panel.kind === 'chat' && canDetach && target.sessionId ? () => actions.detach(panel) : undefined}
            onClosePanel={panel.kind === 'terminal' || panel.kind === 'web' ? () => actions.close(panel) : undefined}/>
          : <p className="module-empty">The “{panel.kind}” module is unavailable. Its configuration has been retained.</p>}
    </div>}
  </section>;
}

type PanelMenu = { panel: Panel; actions: PanelActions; pending: boolean; only: boolean; closesPage?: boolean; docked?: DockSide; detach?(): void };
/** A page's only panel closes with its page, when there is another page to show. */
const canClosePanel = ({ panel, only, closesPage }: Pick<PanelMenu, 'panel' | 'only' | 'closesPage'>) => closable(panel) && (!only || !!closesPage);
/** What a panel's ⋯ menu and its header's context menu offer: one list for both. */
function panelItems({ panel, actions, pending, only, closesPage, docked, detach }: PanelMenu): MenuItem[] {
  return [
    ...dockSides.map(side => ({ label: `Dock ${side}`, icon: `dock-${side}`, className: 'dock-option', disabled: only || docked === side || pending, checked: docked === side || undefined, note: docked === side ? 'Current' : undefined, run: () => actions.dockTo(panel, side) })),
    'separator' as const,
    { label: panel.collapsed ? 'Expand' : 'Collapse', icon: 'chevron', run: () => actions.toggleCollapsed(panel) },
    detach && { label: 'Open in its own window', icon: 'external', disabled: pending, run: detach },
    canClosePanel({ panel, only, closesPage }) && { label: only ? 'Close page' : 'Close panel', icon: 'close', danger: true, run: () => actions.close(panel) },
  ];
}

/** A panel's own header: its title collapses it, ⋯ docks it at any edge, × closes it. */
function PanelHeader({ panel, definition, actions, pending, only, closesPage, docked, detach, live }: PanelMenu & { definition?: PanelModule; live?: PanelTitle }) {
  const title = definition?.title || panel.kind, name = sentence(title);
  const shown = live?.text || title;
  const canClose = canClosePanel({ panel, only, closesPage });
  return <>
    <button className="module-title" aria-label={`${panel.collapsed ? 'Show' : 'Hide'} ${live ? `${name}: ${live.text}` : name}`} aria-expanded={!panel.collapsed} title={`${live?.tooltip ? `${live.tooltip}\n` : ''}${panel.collapsed ? 'Show' : 'Collapse'} ${name} · drag to dock`} onClick={() => actions.toggleCollapsed(panel)}>
      {live?.icon ? <img className="panel-live-icon" src={live.icon} alt=""/> : <Icon name={definition?.icon || 'file'}/>}
      <span>{shown}</span>
      <Icon name="chevron" size={13}/>
    </button>
    <ActionMenu className="panel-menu" label={`${title} panel actions`}>
      <ActionMenuItems icons items={panelItems({ panel, actions, pending, only, closesPage, docked, detach })}/>
    </ActionMenu>
    {canClose && <button className="icon-button panel-close" aria-label={`Close ${title} ${only ? 'page' : 'panel'}`} title={only ? 'Close this page' : panel.kind === 'terminal' ? 'Close panel (shells keep running)' : 'Close panel'} onClick={() => actions.close(panel)}><Icon name="close" size={14}/></button>}
  </>;
}

/** In place of a chat that is open in its own window. */
function DetachedMessage({ canDetach, pending, onOpen, onDock }: { canDetach: boolean; pending: boolean; onOpen(): void; onDock(): void }) {
  return <div className="module-empty detached-message">
    <Icon name="external" size={24}/>
    <h3>Chat is in its own window</h3>
    <p>Your conversation continues there.</p>
    <button disabled={!canDetach || pending} onClick={onOpen}>Open chat window ↗</button>
    <button disabled={!canDetach || pending} onClick={onDock}>Bring chat back here</button>
  </div>;
}
