import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DockArea, Docking } from './PanelLayout';
import { contentIndex, type DockSide, type LayoutNode, type Panel } from './workspace-model';

/**
 * Dragging a panel header shows where it would dock; releasing near an edge of the page
 * docks it there (the panel menu is the keyboard equivalent). Escape or a release away
 * from the edges cancels. Not on touch or phone layouts, which show one panel at a time.
 */
export function usePanelDocking({ editing, displayedLayout, onDock }: { editing: boolean; displayedLayout: LayoutNode | null; onDock(panel: Panel, side: DockSide): void }) {
  const [docking, setDocking] = useState<Docking | null>(null);
  const startDrag = (event: ReactPointerEvent<HTMLElement>, panel: Panel) => {
    if (event.button !== 0 || event.pointerType === 'touch' || editing || matchMedia('(max-width: 760px)').matches) return;
    if (event.target instanceof Element && event.target.closest('.panel-menu, .panel-close')) return;
    const header = event.currentTarget, from = { x: event.clientX, y: event.clientY }, pointer = event.pointerId;
    let active = false, side: DockSide | undefined, area: DOMRect | undefined, relative: DockArea = { left: 0, top: 0, width: 0, height: 0 };
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
      if (next.type === 'pointerup' && side) onDock(panel, side);
    };
    const cancel = (key: KeyboardEvent) => { if (key.key !== 'Escape' || !active) return; key.preventDefault(); key.stopPropagation(); side = undefined; finish(key); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('keydown', cancel, true);
  };
  return { docking, startDrag };
}
