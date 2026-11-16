import { Icon } from './Icons';
import { dockSides, type DockSide, type LayoutNode, type Panel } from './workspace-model';

export type Split = Extract<LayoutNode, { type: 'split' }>;
export type ResizeSplit = (path: number[], change: (node: Split) => LayoutNode) => void;
/** The page area a dragged panel would dock into, relative to the page layout. */
export type DockArea = { left: number; top: number; width: number; height: number };
export type Docking = { id: string; side?: DockSide; area: DockArea };

const splitName = (path: number[]) => path.join('-') || 'root';

/**
 * A page's layout tree: splits with their resize handles, and a slot for each
 * panel. Panels are not rendered here: each slot receives the panel's stable
 * host element, so rearranging the layout never remounts a panel.
 */
export function LayoutTree({ node, path = [], editing, hostFor, onResize }: { node: LayoutNode; path?: number[]; editing: boolean; hostFor(panel: Panel): HTMLElement; onResize: ResizeSplit }) {
  if (node.type !== 'split') return <PanelSlot host={hostFor(node.panel)}/>;
  return <div className={`layout-split split-${node.direction}`}>
    {editing && <SplitControls node={node} path={path} onResize={onResize}/>}
    {node.children.map((child, index) => {
      const sibling = node.children[index ? 0 : 1];
      const collapsed = child.type === 'panel' && child.panel.collapsed && !editing;
      const siblingCollapsed = sibling.type === 'panel' && sibling.panel.collapsed && !editing;
      const cell = <div key={index} className={`layout-cell${collapsed ? ' collapsed-cell' : ''}`} style={{
        minWidth: node.direction === 'row' && child.type === 'panel' && child.panel.kind === 'collections' && !collapsed ? 240 : undefined,
        flex: collapsed ? `0 0 ${node.direction === 'column' ? 42 : 44}px` : `${siblingCollapsed ? 1 : index ? 1 - node.ratio : node.ratio} 1 0`,
      }}>
        <LayoutTree node={child} path={[...path, index]} editing={editing} hostFor={hostFor} onResize={onResize}/>
      </div>;
      return index === 1 && !collapsed && !siblingCollapsed ? [<SplitHandle key="handle" node={node} path={path} onResize={onResize}/>, cell] : cell;
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
