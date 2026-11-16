import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';
import { sentence, type ModuleProps, type PanelModule } from './PanelRegistry';
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
export function WorkspacePanel({ panel, definition, target, store, module, actions, editing, pending, docking, mobileActive, only, docked, canDetach, canRemove }: {
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
  docked?: DockSide;
  /** The host can open chats in their own window. */
  canDetach: boolean;
  canRemove: boolean;
}) {
  const onTarget = (next: ViewTarget) => actions.retarget(panel, next);
  return <section className={`workspace-panel panel-${panel.kind}${panel.collapsed && !editing ? ' is-collapsed' : ''}${editing ? ' is-editing' : ''}${docking ? ' is-docking' : ''}`} aria-label={definition?.title || panel.kind} data-panel-id={panel.id} data-mobile-active={mobileActive || undefined}>
    <header className="module-header" onPointerDown={editing ? undefined : event => actions.startDrag(event, panel)}>
      {!editing
        ? <PanelHeader panel={panel} definition={definition} actions={actions} pending={pending} only={only} docked={docked}/>
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
          ? <definition.Component {...module} target={target} viewState={store}
            onTarget={panel.kind === 'collections' ? next => next.sessionId ? actions.showSession(next) : onTarget(next) : onTarget}
            onOpenChat={panel.kind === 'chat' && canDetach && target.sessionId ? () => actions.detach(panel) : undefined}/>
          : <p className="module-empty">The “{panel.kind}” module is unavailable. Its configuration has been retained.</p>}
    </div>}
  </section>;
}

/** A panel's own header: its title collapses it, ⋯ docks it at any edge, × closes it. */
function PanelHeader({ panel, definition, actions, pending, only, docked }: { panel: Panel; definition?: PanelModule; actions: PanelActions; pending: boolean; only: boolean; docked?: DockSide }) {
  const title = definition?.title || panel.kind, name = sentence(title);
  const canClose = closable(panel) && !only;
  return <>
    <button className="module-title" aria-label={`${panel.collapsed ? 'Show' : 'Hide'} ${name}`} aria-expanded={!panel.collapsed} title={`${panel.collapsed ? 'Show' : 'Collapse'} ${name} · drag to dock`} onClick={() => actions.toggleCollapsed(panel)}>
      <Icon name={definition?.icon || 'file'}/>
      <span>{title}</span>
      <Icon name="chevron" size={13}/>
    </button>
    <ActionMenu className="panel-menu" label={`${title} panel actions`}>
      {dockSides.map(side => <button key={side} className="dock-option" disabled={only || docked === side || pending} aria-current={docked === side || undefined} onClick={() => actions.dockTo(panel, side)}>
        <Icon name={`dock-${side}`}/>
        <span>Dock {side}</span>
        {docked === side && <small>Current</small>}
      </button>)}
      <button onClick={() => actions.toggleCollapsed(panel)}><Icon name="chevron"/><span>{panel.collapsed ? 'Expand' : 'Collapse'}</span></button>
      {canClose && <button className="danger" onClick={() => actions.close(panel)}><Icon name="close"/><span>Close panel</span></button>}
    </ActionMenu>
    {canClose && <button className="icon-button panel-close" aria-label={`Close ${title} panel`} title={panel.kind === 'terminal' ? 'Close panel (shells keep running)' : 'Close panel'} onClick={() => actions.close(panel)}><Icon name="close" size={14}/></button>}
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
