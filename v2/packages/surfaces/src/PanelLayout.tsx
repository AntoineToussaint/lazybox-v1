import { Icon } from './Icons';
import { dockSides, type DockSide, type LayoutNode, type Panel } from './workspace-model';

export type Split = Extract<LayoutNode, { type: 'split' }>;
export type ResizeSplit = (path: number[], change: (node: Split) => LayoutNode) => void;
/** The page area a dragged panel would dock into, relative to the page layout. */
export type DockArea = { left: number; top: number; width: number; height: number };
export type Docking = { id: string; side?: DockSide; area: DockArea };

const splitName = (path: number[]) => path.join('-') || 'root';

/**
 * The Workspaces sidebar keeps one width in pixels for every workspace and
 * window size, so switching workspace never moves it; dragging its edge
 * changes it everywhere.
 */
export type SidebarWidth = { width: number; onWidth(width: number): void };
export const SIDEBAR_MIN = 200, SIDEBAR_MAX = 640, SIDEBAR_DEFAULT = 280;
export const clampSidebar = (width: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
const isSidebar = (node: LayoutNode, direction: string, editing: boolean) => direction === 'row' && node.type === 'panel' && node.panel.kind === 'collections' && !(node.panel.collapsed && !editing);

/**
 * A page's layout tree: splits with their resize handles, and a slot for each
 * panel. Panels are not rendered here: each slot receives the panel's stable
 * host element, so rearranging the layout never remounts a panel.
 */
export function LayoutTree({ node, path = [], editing, hostFor, onResize, sidebar }: { node: LayoutNode; path?: number[]; editing: boolean; hostFor(panel: Panel): HTMLElement; onResize: ResizeSplit; sidebar?: SidebarWidth }) {
  if (node.type !== 'split') return <PanelSlot host={hostFor(node.panel)}/>;
  return <div className={`layout-split split-${node.direction}`}>
    {editing && <SplitControls node={node} path={path} onResize={onResize}/>}
    {node.children.map((child, index) => {
      const sibling = node.children[index ? 0 : 1];
      const collapsed = child.type === 'panel' && child.panel.collapsed && !editing;
      const siblingCollapsed = sibling.type === 'panel' && sibling.panel.collapsed && !editing;
      const isFixed = !!sidebar && !siblingCollapsed && isSidebar(child, node.direction, editing);
      const besideFixed = !!sidebar && !collapsed && isSidebar(sibling, node.direction, editing);
      const cell = <div key={index} className={`layout-cell${collapsed ? ' collapsed-cell' : ''}${isFixed ? ' sidebar-cell' : ''}`} style={{
        flex: collapsed ? `0 0 ${node.direction === 'column' ? 42 : 44}px` : isFixed ? `0 0 ${sidebar!.width}px` : besideFixed ? '1 1 0' : `${siblingCollapsed ? 1 : index ? 1 - node.ratio : node.ratio} 1 0`,
      }}>
        <LayoutTree node={child} path={[...path, index]} editing={editing} hostFor={hostFor} onResize={onResize} sidebar={sidebar}/>
      </div>;
      if (index !== 1 || collapsed || siblingCollapsed) return cell;
      const fixedFirst = !!sidebar && isSidebar(sibling, node.direction, editing);
      return [isFixed || besideFixed ? <SidebarHandle key="handle" path={path} first={fixedFirst} sidebar={sidebar!}/> : <SplitHandle key="handle" node={node} path={path} onResize={onResize}/>, cell];
    })}
  </div>;
}

/** Direction and size of a split, while the page is being customized. */
function SplitControls({ node, path, onResize }: { node: Split; path: number[]; onResize: ResizeSplit }) {
  return <div className="split-controls">
    <label>Direction<select aria-label={`Direction split ${splitName(path)}`} value={node.direction} onChange={event => onResize(path, node => ({ ...node, direction: event.target.value as 'row' | 'column' }))}>
      <option value="row">Side by side</option>
      <option value="column">Stacked</option>
    </select></label>
    <label>Size<input aria-label={`Resize split ${splitName(path)}`} type="range" min={15} max={85} value={Math.round(node.ratio * 100)} onChange={event => onResize(path, node => ({ ...node, ratio: Number(event.target.value) / 100 }))}/></label>
  </div>;
}

/**
 * The divider between a split's two cells, dragged or moved with arrow keys.
 * Drag resizes the two cells in place and saves the ratio once on release,
 * so a drag does not re-render the workspace on every pointer move.
 */
function SplitHandle({ node, path, onResize }: { node: Split; path: number[]; onResize: ResizeSplit }) {
  const row = node.direction === 'row', clamp = (value: number) => Math.round(Math.min(0.85, Math.max(0.15, value)) * 100) / 100;
  const save = (ratio: number) => onResize(path, value => ({ ...value, ratio: clamp(ratio) }));
  return <div className="split-handle" role="separator" tabIndex={0} aria-orientation={row ? 'vertical' : 'horizontal'} aria-label={`Resize split ${splitName(path)}`} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(node.ratio * 100)}
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
}

/** The Workspaces sidebar's edge: resizes it in pixels, for every workspace. */
function SidebarHandle({ path, first, sidebar }: { path: number[]; first: boolean; sidebar: SidebarWidth }) {
  return <div className="split-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize split ${splitName(path)}`} aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={sidebar.width}
    onKeyDown={event => {
      const step = { ArrowLeft: first ? -16 : 16, ArrowRight: first ? 16 : -16 }[event.key];
      if (step === undefined) return; event.preventDefault(); sidebar.onWidth(clampSidebar(sidebar.width + step));
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      const handle = event.currentTarget, cell = (first ? handle.previousElementSibling : handle.nextElementSibling) as HTMLElement;
      const box = cell.getBoundingClientRect();
      event.preventDefault(); handle.setPointerCapture(event.pointerId); handle.dataset.dragging = 'true';
      let width = box.width;
      const move = (next: PointerEvent) => { width = clampSidebar(first ? next.clientX - box.left : box.right - next.clientX); cell.style.flex = `0 0 ${width}px`; };
      const stop = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop);
        delete handle.dataset.dragging; sidebar.onWidth(width);
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
    }}/>;
}

/** Where the layout wants a panel: its stable host element is moved in, not re-rendered. */
function PanelSlot({ host }: { host: HTMLElement }) {
  return <div className="panel-slot" ref={node => { if (node && host.parentNode !== node) node.replaceChildren(host); }}/>;
}

/** The dock zones shown while a panel header is dragged. */
export function DockOverlay({ docking }: { docking: Docking }) {
  return <div className="dock-overlay" aria-hidden="true" style={docking.area.width ? docking.area : undefined}>
    {dockSides.map(side => <div key={side} className={`dock-zone zone-${side}${docking.side === side ? ' active' : ''}`}>
      {docking.side === side && <span><Icon name={`dock-${side}`}/>Dock {side}</span>}
    </div>)}
  </div>;
}

/** On a phone, one panel at a time: this chooses which. */
export function MobilePanelSwitcher({ panels, active, title, onChoose }: { panels: Panel[]; active?: Panel; title(panel: Panel): string; onChoose(panel: Panel): void }) {
  return <nav className="mobile-panel-switcher" aria-label="Workspace panels">
    {panels.map(panel => <button key={panel.id} aria-pressed={panel.id === active?.id} onClick={() => onChoose(panel)}>{title(panel)}</button>)}
  </nav>;
}
