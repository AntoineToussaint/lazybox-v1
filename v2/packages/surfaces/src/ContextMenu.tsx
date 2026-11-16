import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import './artifacts.css';

export type ContextMenuItem = { label: string; icon?: string; hint?: string; disabled?: boolean; danger?: boolean; separatorBefore?: boolean; run(): void };
export type ContextMenuState = { x: number; y: number; items: ContextMenuItem[]; label: string; returnFocus?: HTMLElement | null };

/**
 * A right-click menu at the pointer (or under the focused element for the
 * keyboard's menu key / Shift+F10). It lives in the top layer, like the panel
 * menus: arrows move, Enter runs, Escape or a click elsewhere closes, and focus
 * goes back where it was.
 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose(): void }) {
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = popup.current!;
    node.showPopover();
    const bounds = node.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    node.style.left = `${Math.max(8, Math.min(menu.x, width - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y, height - bounds.height - 8))}px`;
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const close = () => onClose();
    window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  }, [menu]);
  const close = (restore = true) => { if (restore) menu.returnFocus?.focus({ preventScroll: true }); onClose(); };
  return createPortal(<div ref={popup} popover="auto" role="menu" aria-label={menu.label} className="context-menu"
    onToggle={event => { if (event.newState === 'closed') onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') { event.preventDefault(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {menu.items.map((item, i) => <MenuButton key={i} item={item} onRun={() => { close(false); item.run(); }}/>)}
  </div>, document.body);
}
function MenuButton({ item, onRun }: { item: ContextMenuItem; onRun(): void }): ReactNode {
  return <>{item.separatorBefore && <hr role="separator"/>}<button type="button" role="menuitem" disabled={item.disabled} className={item.danger ? 'danger' : undefined} onClick={onRun}>
    <Icon name={item.icon || 'file'} size={15}/><span>{item.label}</span>{item.hint && <small>{item.hint}</small>}
  </button></>;
}

/** Where a context menu opens: the pointer, or below the element for the keyboard. */
export function menuPoint(event: { clientX: number; clientY: number; currentTarget: Element; target: EventTarget }): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const bounds = (event.target instanceof Element ? event.target : event.currentTarget).getBoundingClientRect();
  return { x: bounds.left + 12, y: bounds.top + Math.min(bounds.height, 28) };
}
