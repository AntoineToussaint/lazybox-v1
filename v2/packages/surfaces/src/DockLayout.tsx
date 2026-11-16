import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createDockview, type DockviewApi, type DockviewGroupPanel, type DockviewTheme, type IDockviewPanel } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './dock.css';
import { iconElement } from './Icons';
import { focusWhenShown } from './focus';
import { refreshNativeWebViews } from './native-web-view';
import { EMPTY_CONTENT, fromDockview, groupStates, needsEmptyContent, paramsOf, PANEL_COMPONENT, sameSizes, structureKey, TAB_COMPONENT, toDockview, type Overlay, type PanelParams } from './dock-bridge';
import { clampSidebar, SIDEBAR_MAX, SIDEBAR_MIN } from './PanelLayout';
import { fitWidth, groups, isSidebar, minWidthOf, sidebarAt, type Group, type LayoutNode, type Panel, type WorkspacePage } from './workspace-model';

type Arranged = Pick<WorkspacePage, 'layout' | 'floating' | 'popouts'>;
/** What a group's header actions and menus need to know about it. */
export type GroupView = {
  id: string;
  panels: Panel[];
  active?: Panel;
  location: 'grid' | 'floating' | 'popout';
  maximized: boolean;
  minimized: boolean;
  /** In a column, where minimizing to the tab bar makes sense. */
  canMinimize: boolean;
};
export type MenuItem = { label: string; icon?: string; action(): void; disabled?: boolean; danger?: boolean; separator?: boolean };
export type DockHandle = {
  toggleMaximize(panelID?: string): void;
  activePanelID(): string | undefined;
  activeGroup(): GroupView | undefined;
  /** Moves the front tab of the active group into a new group beside it; false when it is alone. */
  splitActive(side: 'right' | 'below'): boolean;
  cycleGroups(step: 1 | -1): void;
  /** Opens the panel's group in its own window (same page process: nothing remounts). */
  popout(panelID: string): Promise<boolean>;
  float(panelID: string): void;
  /** A floating or popped-out group back into the page; a popped-out one goes where it was, and the page comes forward on it. */
  dockBack(groupID: string): Promise<void>;
  /** Brings a popped-out group's window to the front. */
  focusWindow(groupID: string): void;
  /** The popped-out group whose window has the focus, if any. */
  focusedPopout(): string | undefined;
  focusPanel(panelID: string): void;
  /** The group a panel is in, as its menus see it. */
  groupOf(panelID: string): GroupView | undefined;
  /** Brings a panel's tab to the front without moving focus into it. */
  focusTab(panelID: string): void;
};
type Props = {
  page: WorkspacePage;
  hostFor(panel: Panel): HTMLElement;
  titleOf(panel: Panel): string;
  iconOf(panel: Panel): string;
  /** An image a panel shows for itself (a web page's icon), in place of its kind's icon. */
  imageOf?(panel: Panel): string | undefined;
  canClose(panel: Panel): boolean;
  /** What closing it does, for its × ("Close Changes page" when it is the last panel of a page that goes with it). */
  closeLabel?(panel: Panel, title: string): string;
  sidebarWidth: number;
  onSidebarWidth(width: number): void;
  /** The person rearranged the dock: drag, drop, resize, tab switch, float, pop out. */
  onArrange(next: Arranged): void;
  onClose(panel: Panel): void;
  /** A minimized group's tab was clicked. */
  onRestore(groupID: string): void;
  renderActions(group: GroupView, handle: DockHandle): ReactNode;
  /** A key pressed in a popped-out group's window (its document is not this one: the page's keys do not see it). */
  onPopoutKey?(event: KeyboardEvent, groupID: string): void;
  popoutUrl: string;
  empty: ReactNode;
};

const theme: DockviewTheme = { name: 'lazybox', className: 'dockview-theme-lazybox', colorScheme: 'dark', gap: 0, dndOverlayMounting: 'absolute', dndPanelOverlay: 'group' };
/** A tab bar's height (see dock.css): a minimized group keeps exactly this. */
export const TAB_BAR = 32;
const BIG = Number.MAX_SAFE_INTEGER;
const panelFrom = (id: string, params: unknown): Panel => { const value = (params || {}) as Partial<PanelParams>; return { id, kind: value.kind || 'unknown', binding: value.binding || { mode: 'follow' }, detached: !!value.detached }; };
const sameArrangement = (a: Arranged, b: Arranged) => structureKey(a) === structureKey(b) && sameSizes(a.layout, b.layout) && [...groupStates(a).entries()].every(([id, group]) => groupStates(b).get(id)?.active === group.active)
  && a.floating.every((value, index) => ['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Math.abs((value.box[key as 'width'] ?? 0) - (b.floating[index]?.box[key as 'width'] ?? 0)) <= 2));
const overlayOf = (page: Arranged): Overlay => {
  const minimized = new Map<string, number>();
  const visit = (node: LayoutNode | null) => {
    if (node?.type !== 'split') return;
    node.children.forEach((child, index) => { if (node.direction === 'column' && child.type === 'group' && child.minimized) minimized.set(child.id, node.sizes[index]); visit(child); });
  };
  visit(page.layout);
  return { minimized };
};
/** Every group's parent direction in the docked tree. */
const parents = (node: LayoutNode | null, into = new Map<string, 'row' | 'column'>()) => {
  if (node?.type === 'split') for (const child of node.children) { if (child.type === 'group') into.set(child.id, node.direction); parents(child, into); }
  return into;
};

/** The page's sidebar group and its side: at an edge of the root row, or alone (beside the empty content area). */
const sidebarOf = (layout: LayoutNode | null): { group: Group; at: 'first' | 'last' } | undefined => {
  if (layout && isSidebar(layout)) return { group: layout as Group, at: 'first' };
  const at = sidebarAt(layout);
  return at && layout?.type === 'split' ? { group: layout.children[at === 'first' ? 0 : layout.children.length - 1] as Group, at } : undefined;
};

/**
 * The page's dock, drawn by dockview: drag a tab onto any panel's edge to
 * split it or onto its middle to join its tabs, with a live preview; drag
 * dividers; float a group over the page or pop it out into its own window.
 *
 * Each panel's content is its stable host element (see usePanelHosts), handed
 * to dockview as is and rendered with the "always" renderer, so neither a
 * move, a tab switch, nor a rebuild of the arrangement remounts or reparents
 * a panel. The saved arrangement (`page`) is the source of truth: dockview is
 * brought to it in place when it changes, and every rearrangement made in
 * dockview is reported back through `onArrange`.
 */
export const DockLayout = forwardRef<DockHandle, Props>(function DockLayout(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<DockviewApi>(undefined);
  const latest = useRef(props); latest.current = props;
  /** Set while this component changes dockview, so the change is not reported back as the person's. */
  const applying = useRef(0);
  const applied = useRef<Arranged>(undefined);
  /** Each panel's content element in dockview, which holds the panel's host. */
  const contents = useRef(new Map<string, HTMLElement>());
  /** Each tab's close button, whose label follows what closing does. */
  const closes = useRef(new Map<string, HTMLButtonElement>());
  const size = useRef({ width: 0, height: 0 });
  const [actionHosts, setActionHosts] = useState(() => new Map<string, HTMLElement>());
  /** Where the empty content area (`EMPTY_CONTENT`) draws the page's empty state. */
  const [emptyHost, setEmptyHost] = useState<HTMLElement>();
  const [, setVersion] = useState(0);
  const bump = () => setVersion(value => value + 1);

  const geometry = () => ({ width: size.current.width, height: size.current.height, sidebarWidth: latest.current.sidebarWidth, header: TAB_BAR, title: latest.current.titleOf });
  const read = (): Arranged | undefined => api.current ? fromDockview(api.current.toJSON(), overlayOf(latest.current.page)) : undefined;
  const silently = (change: () => void) => { applying.current++; try { change(); } finally { applying.current--; } };

  /** Sidebar width, minimized groups, and every other group's limits, from the saved arrangement. */
  const applyConstraints = () => {
    const dock = api.current, page = latest.current.page;
    if (!dock) return;
    const sidebar = sidebarOf(page.layout)?.group;
    const direction = parents(page.layout), states = groupStates(page);
    silently(() => {
      for (const group of dock.groups) {
        const saved = states.get(group.id), minimized = !!saved?.minimized && direction.get(group.id) === 'column';
        if (sidebar && group.id === sidebar.id) group.api.setConstraints({ minimumWidth: SIDEBAR_MIN, maximumWidth: SIDEBAR_MAX, minimumHeight: 120, maximumHeight: BIG });
        else {
          // No narrower than its widest panel needs (a conversation 360px, Files 200px…).
          const minimumWidth = Math.max(160, ...(saved?.panels || []).map(panel => minWidthOf(panel.kind)));
          if (minimized) group.api.setConstraints({ minimumHeight: TAB_BAR, maximumHeight: TAB_BAR, minimumWidth, maximumWidth: BIG });
          else group.api.setConstraints({ minimumWidth, minimumHeight: 96, maximumWidth: BIG, maximumHeight: BIG });
        }
        group.element.classList.toggle('dock-group-minimized', minimized);
        // Its content is drawn over the page by dockview, outside the group: hide it there too.
        for (const panel of group.panels) contents.current.get(panel.id)?.classList.toggle('dock-content-hidden', minimized);
        group.element.dataset.groupId = group.id;
      }
      if (sidebar) {
        const group = dock.getGroup(sidebar.id);
        if (group && Math.abs((group.api.width ?? 0) - latest.current.sidebarWidth) > 1) group.api.setSize({ width: latest.current.sidebarWidth });
      }
      for (const group of dock.groups) {
        const saved = states.get(group.id);
        if (saved?.minimized && direction.get(group.id) === 'column' && Math.abs(group.api.height - TAB_BAR) > 1) group.api.setSize({ height: TAB_BAR });
      }
    });
  };
  /** A minimized group restored to the share it had. */
  const restoreSizes = (before: Arranged | undefined) => {
    const dock = api.current, page = latest.current.page;
    if (!dock || !before) return;
    const was = groupStates(before), now = groupStates(page), direction = parents(page.layout);
    const visit = (node: LayoutNode | null) => {
      if (node?.type !== 'split') return;
      node.children.forEach((child, index) => {
        if (child.type !== 'group' || !was.get(child.id)?.minimized || now.get(child.id)?.minimized || direction.get(child.id) !== 'column') return;
        const group = dock.getGroup(child.id) as DockviewGroupPanel | undefined, column = group?.element.closest('.dv-split-view-container');
        const extent = column?.getBoundingClientRect().height || size.current.height;
        silently(() => group?.api.setSize({ height: Math.round(extent * node.sizes[index]) }));
      });
      node.children.forEach(visit);
    };
    visit(page.layout);
  };

  /** Brings dockview to the saved arrangement, in place where it can. */
  /** Panels that would be crushed below their minimum width become tabs instead (reported, then drawn). */
  const fits = () => {
    const page = latest.current.page, fitted = fitWidth(page.layout, size.current.width, latest.current.sidebarWidth);
    if (fitted === page.layout) return true;
    latest.current.onArrange({ layout: fitted, floating: page.floating, popouts: page.popouts });
    return false;
  };
  const reconcile = () => {
    const dock = api.current, target = latest.current.page;
    if (!dock || !size.current.width || !size.current.height) return;
    if (!fits()) return;
    const before = applied.current, current = read()!;
    const popped = current.popouts.length > 0 || target.popouts.length > 0;
    if (structureKey(current) !== structureKey(target) || (!popped && !sameSizes(current.layout, target.layout))) {
      // A rebuild with the same panels keeps their content where it is; a window
      // of its own would close, so then only what changed is done in place.
      if (!popped || !before) {
        // A rebuild hides the panels' overlays for a frame, which drops the focus inside
        // one: whatever had it (a message box being typed in) gets it back once drawn.
        const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest('.dock-panel-content') ? document.activeElement : undefined;
        silently(() => dock.fromJSON(toDockview(target, geometry()), { reuseExistingPanels: true }));
        if (focused && document.activeElement !== focused) focusWhenShown(focused, { preventScroll: true });
      }
      else incremental(dock, target);
    }
    silently(() => {
      const states = groupStates(target);
      for (const panel of dock.panels) {
        const saved = [...states.values()].flatMap(group => group.panels).find(value => value.id === panel.id);
        if (!saved) continue;
        const params = paramsOf(saved);
        if (JSON.stringify(panel.params) !== JSON.stringify(params)) panel.api.updateParameters(params);
        const title = latest.current.titleOf(saved);
        if (panel.title !== title) panel.api.setTitle(title);
      }
      for (const [id, group] of states) {
        const live = dock.getGroup(id);
        if (live && live.activePanel?.id !== group.active) dock.getPanel(group.active)?.api.setActive();
      }
    });
    // A panel kept by id whose kind changed (an imported layout) shows its new host.
    for (const group of groupStates(target).values()) for (const panel of group.panels) {
      const content = contents.current.get(panel.id), host = latest.current.hostFor(panel);
      if (content && host.parentNode !== content) content.replaceChildren(host);
    }
    emptyContent(dock, target);
    applied.current = target;
    applyConstraints();
    restoreSizes(before);
    decorateSashes();
    bump();
    // Anything dockview could not place exactly is reported back as it now is.
    const after = read();
    if (after && !sameArrangement(after, target)) latest.current.onArrange(after);
  };
  /**
   * The empty content area beside a sidebar left alone: added or removed in
   * place as the page needs it. It has no tab bar and takes no drop (a panel
   * dropped in it would hide under its missing tabs): panels dock beside it.
   */
  const emptyContent = (dock: DockviewApi, target: Arranged) => {
    const placeholder = dock.getPanel(EMPTY_CONTENT), need = needsEmptyContent(target);
    silently(() => {
      if (need && !placeholder) {
        const sidebar = sidebarOf(target.layout)?.group.id;
        dock.addPanel({ id: EMPTY_CONTENT, component: PANEL_COMPONENT, tabComponent: TAB_COMPONENT, title: '', position: sidebar && dock.getGroup(sidebar) ? { referenceGroup: sidebar, direction: 'right' } : { direction: 'right' } });
      }
      if (!need && placeholder) dock.removePanel(placeholder);
      const group = dock.getPanel(EMPTY_CONTENT)?.group;
      if (group) { group.header.hidden = true; group.locked = 'no-drop-target'; group.element.classList.add('dock-group-empty-content'); }
    });
  };
  /** Adds and removes panels without a rebuild, while a group is in its own window. */
  const incremental = (dock: DockviewApi, target: Arranged) => {
    const want = new Map([...groupStates(target).values()].flatMap(group => group.panels.map(panel => [panel.id, group] as const)));
    silently(() => {
      for (const panel of [...dock.panels]) if (!want.has(panel.id) && panel.id !== EMPTY_CONTENT) dock.removePanel(panel);
      const have = new Set(dock.panels.map(panel => panel.id));
      for (const [id, group] of want) {
        if (have.has(id)) continue;
        const saved = group.panels.find(panel => panel.id === id)!;
        const options = { id, component: PANEL_COMPONENT, tabComponent: TAB_COMPONENT, title: latest.current.titleOf(saved), params: paramsOf(saved) };
        if (dock.getGroup(group.id)) { dock.addPanel({ ...options, position: { referenceGroup: group.id } }); continue; }
        const near = neighbour(target.layout, group.id, new Set(dock.groups.map(value => value.id)));
        dock.addPanel(near ? { ...options, position: { referenceGroup: near.group, direction: near.direction } } : { ...options, position: { direction: 'right' } });
        have.add(id);
      }
    });
  };

  /** Keyboard and screen reader access to every divider: arrows resize, the sidebar's edge in pixels. */
  const decorateSashes = () => {
    const dock = api.current, root = container.current;
    if (!dock || !root) return;
    const page = latest.current.page, sidebarID = sidebarOf(page.layout)?.group.id || '';
    for (const sash of root.querySelectorAll<HTMLElement>('.dv-sash')) {
      const split = sash.closest('.dv-split-view-container'), views = split ? [...split.querySelectorAll<HTMLElement>(':scope > .dv-view-container > .dv-view')] : [];
      const index = [...(sash.parentElement?.children || [])].indexOf(sash);
      const first = views[index], second = views[index + 1];
      if (!first || !second) continue;
      const vertical = split!.classList.contains('dv-horizontal');
      const groupIn = (view: HTMLElement) => dock.groups.filter(group => view.contains(group.element));
      const label = (view: HTMLElement) => groupIn(view).map(group => group.activePanel?.title).filter(Boolean).join(', ') || 'panel';
      const sidebar = groupIn(first).length === 1 && groupIn(first)[0].id === sidebarID ? 'first' : groupIn(second).length === 1 && groupIn(second)[0].id === sidebarID ? 'second' : '';
      const extent = (view: HTMLElement) => vertical ? view.getBoundingClientRect().width : view.getBoundingClientRect().height;
      sash.tabIndex = 0;
      sash.setAttribute('role', 'separator');
      sash.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
      if (sidebar) {
        sash.setAttribute('aria-label', 'Resize Workspaces sidebar');
        sash.setAttribute('aria-valuemin', String(SIDEBAR_MIN)); sash.setAttribute('aria-valuemax', String(SIDEBAR_MAX)); sash.setAttribute('aria-valuenow', String(latest.current.sidebarWidth));
      } else {
        sash.setAttribute('aria-label', `Resize ${label(first)} and ${label(second)}`);
        sash.setAttribute('aria-valuemin', '5'); sash.setAttribute('aria-valuemax', '95'); sash.setAttribute('aria-valuenow', String(Math.round(100 * extent(first) / Math.max(1, extent(first) + extent(second)))));
      }
      sash.onkeydown = event => {
        const step = vertical ? { ArrowLeft: -1, ArrowRight: 1 }[event.key] : { ArrowUp: -1, ArrowDown: 1 }[event.key];
        if (!step) return;
        event.preventDefault();
        if (sidebar) { latest.current.onSidebarWidth(clampSidebar(latest.current.sidebarWidth + (sidebar === 'first' ? step : -step) * 16)); return; }
        const target = groupIn(first)[0], amount = Math.max(16, Math.round((extent(first) + extent(second)) * 0.02));
        target?.api.setSize(vertical ? { width: Math.round(extent(first) + step * amount) } : { height: Math.round(extent(first) + step * amount) });
        requestAnimationFrame(() => decorateSashes());
      };
    }
  };

  useLayoutEffect(() => {
    const element = container.current!;
    const dock = createDockview(element, {
      theme, dndStrategy: 'pointer', defaultRenderer: 'always', disableAutoResizing: true, popoutUrl: latest.current.popoutUrl,
      groupIdGenerator: () => `g-${crypto.randomUUID().slice(0, 12)}`,
      createComponent: ({ id }) => {
        if (id === EMPTY_CONTENT) {
          const area = document.createElement('div');
          area.className = 'dock-empty-content';
          return { element: area, init: () => setEmptyHost(area), dispose: () => setEmptyHost(host => host === area ? undefined : host) };
        }
        const content = document.createElement('div');
        content.className = 'dock-panel-content';
        content.dataset.dockPanel = id;
        // Working in a panel makes its group the active one (the target of keyboard commands).
        const activate = () => { const panel = api.current?.getPanel(id); if (panel && api.current?.activeGroup !== panel.group) silently(() => panel.group.api.setActive()); };
        content.addEventListener('pointerdown', activate, true);
        // Panels are moved with pointer events; an HTML5 drag over a panel is the
        // panel's own (files into the chat, text into a field) and must not reach
        // dockview's drop targets, which would cancel it.
        for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) content.addEventListener(type, event => event.stopPropagation());
        content.addEventListener('focusin', activate);
        contents.current.set(id, content);
        return {
          element: content,
          init: parameters => { const host = latest.current.hostFor(panelFrom(id, parameters.params)); if (host.parentNode !== content) content.replaceChildren(host); },
          dispose: () => { if (contents.current.get(id) === content) contents.current.delete(id); },
        };
      },
      createTabComponent: ({ id }) => {
        const tab = document.createElement('div');
        tab.className = 'dock-tab';
        const title = document.createElement('span'); title.className = 'dock-tab-title';
        const close = document.createElement('button'); close.type = 'button'; close.className = 'dock-tab-close';
        const disposers: (() => void)[] = [];
        return {
          element: tab,
          init: parameters => {
            const panel = panelFrom(id, parameters.params);
            tab.dataset.panelTab = id; tab.dataset.kind = panel.kind;
            // Right-click: the group's menu, through the shared context menu (Workspace contributes it).
            tab.dataset.contextMenu = 'dock-tab';
            title.textContent = parameters.title;
            const icon = () => {
              const src = latest.current.imageOf?.(panel);
              if (!src) return iconElement(latest.current.iconOf(panel), 14);
              const image = tab.ownerDocument.createElement('img'); image.className = 'dock-tab-image'; image.src = src; image.alt = ''; return image;
            };
            tab.replaceChildren(icon(), title);
            const name = () => parameters.api.title || latest.current.titleOf(panel);
            tab.title = `${name()} · drag to move, double-click to maximize`;
            if (latest.current.canClose(panel)) {
              close.replaceChildren(iconElement('close', 12));
              close.setAttribute('aria-label', latest.current.closeLabel?.(panel, name()) ?? `Close ${name()} panel`); closes.current.set(id, close); close.title = panel.kind === 'terminal' ? 'Close panel (shells keep running)' : 'Close panel';
              close.onpointerdown = event => event.stopPropagation();
              close.onclick = event => { event.stopPropagation(); latest.current.onClose(panelFrom(id, api.current?.getPanel(id)?.params)); };
              tab.append(close);
            }
            const titled = parameters.api.onDidTitleChange(event => { title.textContent = event.title; tab.firstChild?.replaceWith(icon()); close.setAttribute('aria-label', latest.current.closeLabel?.(panel, event.title) ?? `Close ${event.title} panel`); tab.title = `${event.title} · drag to move, double-click to maximize`; });
            disposers.push(() => titled.dispose());
            tab.ondblclick = event => { event.preventDefault(); handle.toggleMaximize(id); };
            // A minimized group opens again from its tab.
            tab.onclick = () => { const group = api.current?.getPanel(id)?.group; if (group?.element.classList.contains('dock-group-minimized')) latest.current.onRestore(group.id); };
          },
          dispose: () => { for (const dispose of disposers.splice(0)) dispose(); },
        };
      },
      createRightHeaderActionComponent: group => {
        const actions = document.createElement('div');
        actions.className = 'dock-group-actions';
        actions.dataset.group = group.id;
        return {
          element: actions,
          init: () => setActionHosts(hosts => new Map(hosts).set(group.id, actions)),
          dispose: () => setActionHosts(hosts => { if (hosts.get(group.id) !== actions) return hosts; const next = new Map(hosts); next.delete(group.id); return next; }),
        };
      },
    });
    api.current = dock;
    // A rearrangement is reported on the next frame; a resize once it settles,
    // so dragging a divider does not save on every pointer move.
    let frame = 0, timer = 0;
    const report = (delay: number) => {
      if (applying.current) return;
      clearTimeout(timer); cancelAnimationFrame(frame);
      const run = () => {
        frame = 0; timer = 0;
        const next = read();
        if (!next) return;
        decorateSashes(); bump();
        // The sidebar's edge was dragged: that width becomes everyone's.
        const page = latest.current.page, found = sidebarOf(next.layout);
        if (found) {
          const sidebar = dock.getGroup(found.group.id);
          if (sidebar && Math.abs(sidebar.api.width - latest.current.sidebarWidth) > 1 && sidebarOf(page.layout)?.at === found.at) {
            // Only a divider the person dragged changes it; a drop that squeezed it is undone.
            if (dividerDrag) latest.current.onSidebarWidth(clampSidebar(sidebar.api.width));
            else applyConstraints();
          }
        }
        if (!sameArrangement(next, page)) latest.current.onArrange(next);
      };
      if (delay) timer = window.setTimeout(run, delay); else frame = requestAnimationFrame(run);
    };
    // Whether a divider is being dragged, until its last resize is reported.
    let dividerDrag = false, released = 0;
    const pressed = (event: PointerEvent) => { dividerDrag = event.target instanceof Element && !!event.target.closest('.dv-sash'); clearTimeout(released); };
    const lifted = () => { if (document.documentElement.classList.contains('dock-dragging')) { document.documentElement.classList.remove('dock-dragging'); refreshNativeWebViews(); } if (dividerDrag) { clearTimeout(released); released = window.setTimeout(() => { dividerDrag = false; }, 450); } };
    element.addEventListener('pointerdown', pressed, true);
    // Enter or Space on a minimized group's tab opens it, as a click does.
    const tabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const group = event.target instanceof Element && event.target.matches('.dv-tab') ? event.target.closest<HTMLElement>('.dock-group-minimized') : null;
      if (group?.dataset.groupId) { event.preventDefault(); latest.current.onRestore(group.dataset.groupId); }
    };
    element.addEventListener('keydown', tabKey);
    window.addEventListener('pointerup', lifted, true);
    // Text is not selected while a tab is dragged.
    // Native web views step aside while dragging (native-web-view.ts), and come back after.
    const dragging = (on: boolean) => () => { if (document.documentElement.classList.toggle('dock-dragging', on) !== on) return; refreshNativeWebViews(); };
    // A Web panel's native view belongs to this window: it is not dropped into a popped-out one.
    const webOnly = dock.onWillDrop(event => {
      const data = event.getData(), moved = data?.panelId ? [dock.getPanel(data.panelId)] : data ? dock.getGroup(data.groupId)?.panels || [] : [];
      if (event.group?.api.location.type === 'popout' && moved.some(panel => (panel?.params as Partial<PanelParams> | undefined)?.kind === 'web')) event.preventDefault();
    });
    const subscriptions = [webOnly, dock.onWillDragPanel(dragging(true)), dock.onWillDragGroup(dragging(true)), dock.onDidDrop(dragging(false)), dock.onDidLayoutChange(dragging(false)),
      { dispose: () => { element.removeEventListener('keydown', tabKey); element.removeEventListener('pointerdown', pressed, true); window.removeEventListener('pointerup', lifted, true); clearTimeout(released); } },
      dock.onDidLayoutChange(event => report([...event.reasons].every(reason => reason === 'geometry') ? 200 : 0)), dock.onDidMaximizedGroupChange(() => { bump(); refreshNativeWebViews(); }), dock.onDidActiveGroupChange(bump), dock.onDidAddPopoutGroup(event => { bump(); refreshNativeWebViews(); listenInPopout(event.window); }), dock.onDidRemovePopoutGroup(() => { bump(); refreshNativeWebViews(); })];
    // Keys pressed in a popped-out window go to `onPopoutKey`, with the group that window holds.
    function listenInPopout(popout: Window | undefined) {
      popout?.addEventListener('keydown', event => {
        const group = dock.getPopouts().find(value => value.window === popout)?.group;
        if (group) latest.current.onPopoutKey?.(event, group.id);
      });
    }
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect(), next = { width: Math.round(box.width), height: Math.round(box.height) };
      if (!next.width || !next.height || (next.width === size.current.width && next.height === size.current.height)) return;
      const first = !size.current.width;
      size.current = next;
      if (first) { reconcile(); return; }
      silently(() => dock.layout(next.width, next.height));
      applyConstraints(); decorateSashes();
      fits();
    });
    observer.observe(element);
    // Measured now, so the first arrangement is in place before panels focus anything in it.
    const box = element.getBoundingClientRect();
    if (box.width && box.height) { size.current = { width: Math.round(box.width), height: Math.round(box.height) }; reconcile(); }
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); for (const subscription of subscriptions) subscription.dispose(); api.current = undefined; applied.current = undefined; size.current = { width: 0, height: 0 }; dock.dispose(); };
  }, []);

  // The saved arrangement changed (a command, another workspace, a preset): bring dockview to it.
  useLayoutEffect(() => { reconcile(); }, [props.page]);
  useLayoutEffect(() => { applyConstraints(); decorateSashes(); }, [props.sidebarWidth]);
  // Titles a panel gives itself (a web page's) change without the arrangement changing.
  useEffect(() => {
    const dock = api.current;
    if (!dock) return;
    silently(() => {
      for (const panel of dock.panels) {
        if (panel.id === EMPTY_CONTENT) continue;
        const saved = panelFrom(panel.id, panel.params), title = latest.current.titleOf(saved);
        if (panel.title !== title) panel.api.setTitle(title);
        const close = closes.current.get(panel.id), label = latest.current.closeLabel?.(saved, title) ?? `Close ${title} panel`;
        if (close && close.getAttribute('aria-label') !== label) close.setAttribute('aria-label', label);
      }
    });
  });

  const view = (group: DockviewGroupPanel): GroupView => {
    const saved = groupStates(latest.current.page).get(group.id), direction = parents(latest.current.page.layout).get(group.id);
    const members = group.panels.map(panel => panelFrom(panel.id, panel.params));
    return {
      id: group.id, panels: members, active: members.find(panel => panel.id === group.activePanel?.id),
      location: group.api.location.type === 'floating' ? 'floating' : group.api.location.type === 'popout' ? 'popout' : 'grid',
      maximized: group.api.isMaximized(), minimized: !!saved?.minimized && direction === 'column', canMinimize: direction === 'column',
    };
  };
  const panelOf = (panelID?: string): IDockviewPanel | undefined => panelID ? api.current?.getPanel(panelID) : api.current?.activePanel;
  const handle: DockHandle = {
    toggleMaximize: panelID => {
      const dock = api.current, panel = panelOf(panelID);
      if (!dock || !panel) return;
      if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup(); else if (panel.group.api.location.type === 'grid' && dock.groups.length > 1) dock.maximizeGroup(panel);
    },
    activePanelID: () => api.current?.activePanel?.id,
    activeGroup: () => { const group = api.current?.activeGroup; return group ? view(group) : undefined; },
    splitActive: side => {
      const panel = api.current?.activePanel;
      if (!panel || panel.group.panels.length < 2) return false;
      panel.api.moveTo({ group: panel.group, position: side === 'right' ? 'right' : 'bottom' });
      return true;
    },
    cycleGroups: step => {
      const dock = api.current;
      if (!dock || !dock.groups.length) return;
      const order = dock.groups.filter(group => !group.panels.some(panel => panel.id === EMPTY_CONTENT)), index = order.findIndex(group => group === dock.activeGroup);
      const next = order[(index + step + order.length) % order.length];
      next.api.setActive();
      if (next.activePanel) handle.focusPanel(next.activePanel.id);
    },
    popout: async panelID => {
      const dock = api.current, panel = panelOf(panelID);
      if (!dock || !panel) return false;
      const target = panel.group.panels.length > 1 ? panel : panel.group;
      return dock.addPopoutGroup(target, { popoutUrl: latest.current.popoutUrl });
    },
    float: panelID => {
      const dock = api.current, panel = panelOf(panelID);
      if (!dock || !panel) return;
      const box = container.current!.getBoundingClientRect();
      dock.addFloatingGroup(panel.group.panels.length > 1 ? panel : panel.group, { x: Math.round(box.width * 0.2), y: 48, width: Math.round(box.width * 0.5), height: Math.round(box.height * 0.6) });
    },
    dockBack: async groupID => {
      const dock = api.current, group = dock?.getGroup(groupID);
      if (!dock || !group) return;
      if (group.api.location.type === 'popout') {
        // Closing its window puts the group back where it was (dockview's reference group); the page comes forward on it.
        const front = group.activePanel?.id, popout = group.api.getWindow();
        const back = new Promise<void>(resolve => {
          const finish = () => {
            done.dispose(); clearTimeout(timer);
            // Reported at once, so what is put back next (Put all back) finds this group in place.
            const next = read();
            if (next && !sameArrangement(next, latest.current.page)) latest.current.onArrange(next);
            resolve();
          };
          const done = dock.onDidRemovePopoutGroup(event => { if (event.group === group || event.id === groupID) finish(); });
          // A window that never reports closing does not hold up what comes after it.
          const timer = window.setTimeout(finish, 2000);
        });
        popout.close();
        window.focus();
        await back;
        if (front) requestAnimationFrame(() => handle.focusPanel(front));
        return;
      }
      // Into the page beside its largest docked group.
      const docked = dock.groups.filter(value => value.api.location.type === 'grid' && value !== group).sort((a, b) => b.api.width * b.api.height - a.api.width * a.api.height)[0];
      if (docked) group.api.moveTo({ group: docked, position: 'right' });
      else group.api.moveTo({ position: 'center' });
    },
    focusWindow: groupID => { const group = api.current?.getGroup(groupID); if (group?.api.location.type === 'popout') group.api.getWindow().focus(); },
    // While this page has the focus no popped-out window does (the palette here does not offer to put one back).
    focusedPopout: () => document.hasFocus() ? undefined : api.current?.getPopouts().find(popout => { try { return popout.window.document.hasFocus(); } catch { return false; } })?.group.id,
    focusPanel: panelID => {
      const panel = api.current?.getPanel(panelID);
      if (!panel) return;
      panel.api.setActive();
      requestAnimationFrame(() => {
        const host = latest.current.hostFor(panelFrom(panel.id, panel.params));
        host.querySelector<HTMLElement>('textarea:not(:disabled), [tabindex="0"], button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
      });
    },
    groupOf: panelID => { const panel = api.current?.getPanel(panelID); return panel ? view(panel.group) : undefined; },
    focusTab: panelID => { const panel = api.current?.getPanel(panelID); if (panel && panel.group.activePanel !== panel) panel.api.setActive(); },
  };
  useImperativeHandle(ref, () => handle);

  const dock = api.current, empty = !props.page.layout && !props.page.floating.length && !props.page.popouts.length;
  return <div className="dock-layout">
    <div ref={container} className="dock-container"/>
    {empty && <div className="dock-empty">{props.empty}</div>}
    {emptyHost && needsEmptyContent(props.page) && createPortal(props.empty, emptyHost)}
    {dock && [...actionHosts].map(([id, element]) => { const group = dock.getGroup(id); return group ? createPortal(props.renderActions(view(group as DockviewGroupPanel), handle), element, id) : null; })}
  </div>;
});

/** The group nearest a new one in the saved tree that dockview already has, and which side of it the new one goes. */
function neighbour(root: LayoutNode | null, groupID: string, existing: Set<string>): { group: string; direction: 'left' | 'right' | 'above' | 'below' } | undefined {
  let found: { group: string; direction: 'left' | 'right' | 'above' | 'below' } | undefined;
  const visit = (node: LayoutNode | null) => {
    if (found || node?.type !== 'split') return;
    const index = node.children.findIndex(child => child.type === 'group' && child.id === groupID);
    if (index >= 0) {
      const row = node.direction === 'row', previous = node.children[index - 1], next = node.children[index + 1];
      const pick = (child: LayoutNode | undefined, last: boolean) => { const all = groups(child || null).filter(group => existing.has(group.id)); return last ? all[all.length - 1] : all[0]; };
      const before = pick(previous, true), after = pick(next, false);
      if (before) found = { group: before.id, direction: row ? 'right' : 'below' };
      else if (after) found = { group: after.id, direction: row ? 'left' : 'above' };
      return;
    }
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}
