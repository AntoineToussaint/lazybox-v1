import { useEffect, useRef, type RefObject } from 'react';
import type { NativeWebViews, WebViewFrame } from '@lazybox/platform';

/**
 * Keeps each native web view over its panel. A native view is drawn above
 * the whole page, so it follows the panel's box on every layout change and
 * steps aside whenever something of the app's own would be under it: a menu,
 * a popover, a dialog, the dock preview while a panel is dragged, a
 * collapsed or hidden panel, another page. A view whose panel goes away is
 * hidden at once and closed a minute later, so visiting Settings or another
 * page and coming back keeps the page (and its scroll, its form) as it was.
 */
type Slot = { id: string; element: HTMLElement; views: NativeWebViews; url: string; zoom: number; shown: string; /** Shown once already: later shows only move it. */ placed: boolean; report(error: unknown): void; onShown(shown: boolean): void };
const slots = new Map<string, Slot>();
const closing = new Map<string, ReturnType<typeof setTimeout>>();
export const RELEASE_MS = 60_000;
let frame = 0;
let stop: (() => void) | undefined;

/** Elements of the app's own that a native view must never cover. */
function covers(): Element[] {
  // The dock's drop preview while a panel is dragged, and groups floating over the page.
  const fixed = '.dv-drop-target-anchor, .dv-drop-target-selection, .dv-resize-container, [data-covers-web-view]';
  try { return [...document.querySelectorAll(`:popover-open, dialog[open], ${fixed}`)]; }
  catch { return [...document.querySelectorAll(`dialog[open], ${fixed}`)]; }
}
const overlaps = (a: DOMRect, b: DOMRect) => a.width > 0 && a.height > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Where a view goes, or undefined when it must be hidden. */
export function placement(rect: DOMRect, viewport: { width: number; height: number }, blockers: DOMRect[], modal: boolean): Omit<WebViewFrame, 'viewportWidth' | 'viewportHeight'> | undefined {
  if (modal) return undefined;
  const x = Math.max(0, rect.left), y = Math.max(0, rect.top), right = Math.min(viewport.width, rect.right), bottom = Math.min(viewport.height, rect.bottom);
  if (right - x < 8 || bottom - y < 8) return undefined;
  if (blockers.some(blocker => overlaps(blocker, rect))) return undefined;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) };
}

function sync() {
  frame = 0;
  const found = covers();
  // While a panel is dragged the drop preview can land anywhere: every view steps aside.
  const modal = document.documentElement.classList.contains('dock-dragging') || found.some(element => { try { return element.matches('dialog:modal'); } catch { return false; } });
  const boxes = found.map(element => ({ element, rect: element.getBoundingClientRect() }));
  const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  for (const slot of slots.values()) {
    const element = slot.element;
    // A panel moved into a window of its own is not where this window's view can be.
    const visible = element.isConnected && element.ownerDocument === document && document.visibilityState === 'visible' && (element.checkVisibility?.({ visibilityProperty: true } as CheckVisibilityOptions) ?? true);
    // What covers a view is anything of the app's own over it, except the floating group it is in.
    const blockers = boxes.filter(box => !box.element.contains(element)).map(box => box.rect);
    const place = visible ? placement(element.getBoundingClientRect(), viewport, blockers, modal) : undefined;
    const key = place ? `${place.x},${place.y},${place.width},${place.height},${window.innerWidth},${window.innerHeight}` : 'hidden';
    if (key === slot.shown) continue;
    const wasShown = slot.shown !== 'hidden' && slot.shown !== '';
    slot.shown = key;
    if (place) { const url = slot.placed ? '' : slot.url; slot.placed = true; void slot.views.show(slot.id, url, { ...place, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }, slot.zoom).catch(slot.report); }
    else void slot.views.hide(slot.id).catch(slot.report);
    if (wasShown !== !!place) slot.onShown(!!place);
  }
}
const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };

function observe() {
  if (stop) return;
  const resize = new ResizeObserver(schedule);
  for (const slot of slots.values()) resize.observe(slot.element);
  const mutations = new MutationObserver(schedule);
  mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'style', 'hidden', 'popover'] });
  // A popover opening is not a mutation: measure as it toggles, not a frame later.
  const toggled = () => sync();
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('toggle', toggled, true);
  document.addEventListener('visibilitychange', schedule);
  stop = () => {
    resize.disconnect(); mutations.disconnect();
    window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('toggle', toggled, true); document.removeEventListener('visibilitychange', schedule);
    stop = undefined;
  };
  observeElements = element => resize.observe(element);
}
let observeElements: ((element: HTMLElement) => void) | undefined;

function acquire(slot: Slot) {
  const timer = closing.get(slot.id);
  if (timer) { clearTimeout(timer); closing.delete(slot.id); }
  slots.set(slot.id, slot);
  observe(); observeElements?.(slot.element);
  schedule();
}
function release(slot: Slot) {
  if (slots.get(slot.id) !== slot) return;
  slots.delete(slot.id);
  void slot.views.hide(slot.id).catch(() => {});
  closing.set(slot.id, setTimeout(() => { closing.delete(slot.id); void slot.views.action(slot.id, 'close').catch(() => {}); }, RELEASE_MS));
  if (!slots.size) stop?.();
}
/** Closes a view now: its panel was closed for good. */
export function closeNativeWebView(views: NativeWebViews, id: string) {
  const timer = closing.get(id);
  if (timer) { clearTimeout(timer); closing.delete(id); }
  const slot = slots.get(id);
  if (slot) { slots.delete(id); if (!slots.size) stop?.(); }
  void views.action(id, 'close').catch(() => {});
}
/** Measure again now, for a change the observers cannot see. */
export const refreshNativeWebViews = schedule;

/**
 * Shows the native view `id` over `surface` while the component is mounted.
 * `url` is what a new view loads first; later navigation goes through the
 * views' own `navigate`. `onShown` says whether it is on screen.
 */
export function useNativeWebView(views: NativeWebViews | undefined, id: string, surface: RefObject<HTMLElement | null>, url: string, zoom: number, report: (error: unknown) => void, onShown: (shown: boolean) => void) {
  const latest = useRef({ url, zoom, report, onShown });
  latest.current = { url, zoom, report, onShown };
  const active = !!views && !!url && !!id;
  useEffect(() => {
    const element = surface.current;
    if (!views || !active || !element) return;
    const slot: Slot = { id, element, views, url: latest.current.url, zoom: latest.current.zoom, shown: '', placed: false, report: error => latest.current.report(error), onShown: shown => latest.current.onShown(shown) };
    acquire(slot);
    return () => release(slot);
  }, [views, id, active]);
  useEffect(() => {
    const slot = slots.get(id);
    if (!slot || !views) return;
    slot.url = url;
    if (slot.zoom !== zoom) { slot.zoom = zoom; void views.zoom(id, zoom).catch(report); }
  }, [views, id, url, zoom]);
}
