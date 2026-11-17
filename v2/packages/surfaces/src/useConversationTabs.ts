import { useEffect, useRef } from 'react';
import { useRunner } from './RunnerContext';
import { useSeen } from './useAttention';
import { conversationKey, deriveAttention, seenAt } from './attention';
import { rememberClosed, tabStatus, takeClosed, type ClosedTab, type TabStatus } from './conversation-tabs';
import { showToast } from './toasts';
import {
  groupOf, isChatTab, keepTab, moveToNewPage, oldestPreview, openConversation, openRelated, pageShowing, PANEL_LIMIT, resolveTarget, shownPanels, tabFor, tabsToClose,
  type OpenMode, type OpenOptions, type Opened, type Panel, type ViewTarget, type WorkspaceLayout, type WorkspacePage,
} from './workspace-model';

/** What the tabs need from the page that holds them (Workspace). */
export type TabHost = {
  /** The page as it is now, and the workspace's pages. */
  livePage(): WorkspacePage;
  layout(): WorkspaceLayout;
  changePage(next: WorkspacePage): boolean;
  commit(next: WorkspaceLayout): boolean;
  /** Closes a panel the way its × does. */
  closePanel(panel: Panel): void;
  /** A tab opened in front: `focus` moves the keyboard there, `reveal` only shows it (a maximized page keeps the zoom on it). */
  shown(panelID: string, how: 'focus' | 'reveal'): void;
  /** The conversation's title, as its tab shows it. */
  title(target: ViewTarget): string;
  /** Said to a screen reader, and shown by the dock's focus ring. */
  announce(text: string): void;
  error(text: string): void;
  /** Which workspace the closed tabs belong to. */
  scope: string;
};

const newID = () => crypto.randomUUID();

/**
 * Conversation tabs, the window's side of them (the rules are in
 * `workspace-model.ts`): opening a conversation in the preview tab, a tab in
 * front or one behind; a related conversation beside its parent; the tabs
 * closed lately (⇧⌘T); a preview tab kept open once typed in; and each tab's
 * status dot. A full page says so and offers to close the oldest preview tab.
 */
export function useConversationTabs(host: TabHost) {
  const latest = useRef(host); latest.current = host;
  const closed = useRef<ClosedTab[]>([]);
  const { info } = useRunner();
  const { seen } = useSeen();

  /** The page is full: say so, and offer to close the oldest preview tab to make room. */
  const offerRoom = (target: ViewTarget, retry: () => void) => {
    const h = latest.current, preview = oldestPreview(h.livePage());
    const name = h.title(target), previewName = preview ? h.title(resolveTarget(preview, h.livePage().selection)) : '';
    showToast({
      id: 'conversation-tabs:full', tone: 'info', timeout: 10000,
      title: `This page already has ${PANEL_LIMIT} panels`,
      body: preview ? `Close the preview tab “${previewName}” to open “${name}”, or close another tab.` : `Close a tab to open “${name}”.`,
      ...(preview ? { button: { label: 'Close preview and open', run: () => { latest.current.closePanel(preview); retry(); } } } : {}),
    });
  };
  const apply = (result: Opened, target: ViewTarget, front: boolean, retry: () => void, said?: string): string => {
    const h = latest.current;
    if (result.full) { offerRoom(target, retry); return ''; }
    if (!h.changePage(result.page)) return '';
    if (front) h.shown(result.id, 'focus');
    else h.announce(said || (result.added ? `Opened “${h.title(target)}” in a tab behind this one` : `“${h.title(target)}” is already open in a tab`));
    return result.id;
  };

  /** A conversation as a tab; the panel showing it ('' when nothing opened). A preview open only reveals it: the click's list keeps the keyboard. */
  const open = (target: ViewTarget, mode: OpenMode, place: Omit<OpenOptions, 'mode'> = {}): string => {
    const h = latest.current, before = tabFor(h.livePage(), target), result = openConversation(h.livePage(), target, { mode, ...place }, newID);
    if (mode !== 'preview') return apply(result, target, mode === 'tab', () => open(target, mode, place));
    if (result.full) { offerRoom(target, () => open(target, mode, place)); return ''; }
    if (!h.changePage(result.page)) return '';
    // A conversation already in a tab of its own (a review beside the work) comes forward with the focus.
    h.shown(result.id, before && !before.preview ? 'focus' : 'reveal');
    return result.id;
  };
  /** A conversation opened from another (a review, an orchestrator's agent): a tab right after its parent's. */
  const related = (parent: ViewTarget, target: ViewTarget, { background = true }: { background?: boolean } = {}) => {
    const h = latest.current, layout = h.layout(), live = h.livePage();
    // On the page that shows the parent (this one first), so a review joins the conversation it reviews.
    const host = (parent.sessionId && pageShowing(layout, parent.sessionId)) || live;
    const result = openRelated(host, parent, target, { background }, newID), retry = () => related(parent, target, { background });
    if (host.id === live.id) { apply(result, target, !background, retry, result.added ? `Opened “${h.title(target)}” in a tab next to “${h.title(parent)}”` : undefined); return; }
    if (result.full) { offerRoom(target, retry); return; }
    if (h.commit({ ...layout, selectedPage: background ? layout.selectedPage : host.id, pages: layout.pages.map(page => page.id === host.id ? result.page : page) }) && !background) h.shown(result.id, 'focus');
  };
  /** A conversation on a page of its own. */
  const newPage = (target: ViewTarget, title: string) => {
    const h = latest.current, moved = moveToNewPage(h.layout(), h.livePage().id, target, title, newID);
    if ('error' in moved) { h.error(moved.error); return; }
    if (!h.commit(moved.layout)) return;
    const page = moved.layout.pages.find(value => value.id === moved.page), tab = page && tabFor(page, target);
    if (tab) h.shown(tab.id, 'focus');
  };
  /** Close the other tabs of a tab's group, or those to its right; it stays in front. */
  const closeTabs = (panel: Panel, which: 'others' | 'right') => {
    const h = latest.current;
    for (const other of tabsToClose(h.livePage(), panel.id, which)) h.closePanel(other);
  };
  const tabOf = (target: ViewTarget) => {
    const page = latest.current.livePage(), tab = tabFor(page, target);
    return tab ? { panel: tab, others: tabsToClose(page, tab.id, 'others').length, right: tabsToClose(page, tab.id, 'right').length } : undefined;
  };
  /** A chat tab about to close: remembered, so ⇧⌘T puts it back where it was. */
  const remember = (page: WorkspacePage, panel: Panel) => {
    const group = groupOf(page, panel.id);
    if (!isChatTab(panel) || !group) return;
    closed.current = rememberClosed(closed.current, { page: `${latest.current.scope}:${page.id}`, target: { ...resolveTarget(panel, page.selection), commandId: '' }, group: group.id, index: group.panels.findIndex(value => value.id === panel.id) });
  };
  /** ⇧⌘T: the last conversation tab closed on this page, back where it was. */
  const reopen = () => {
    const h = latest.current, page = h.livePage();
    const { tab, rest } = takeClosed(closed.current, `${h.scope}:${page.id}`, target => !!tabFor(page, target));
    closed.current = rest;
    if (!tab) { h.announce('No closed conversation tab to reopen'); return; }
    open(tab.target, 'tab', { group: tab.group, index: tab.index });
  };
  const canReopen = () => closed.current.some(entry => entry.page.startsWith(`${latest.current.scope}:`));
  /** A tab's status dot: working, needs you, failed, done (unread), or idle. */
  const statusOf = (panel: Panel, selection: ViewTarget): TabStatus | undefined => {
    if (!isChatTab(panel)) return undefined;
    const id = resolveTarget(panel, selection).sessionId, session = id ? info?.sessions.find(value => value.id === id) : undefined;
    if (!session) return undefined;
    const attention = deriveAttention(session, seenAt(seen, conversationKey(session)));
    return tabStatus(attention.state, attention.reason);
  };

  // Typing in a preview tab keeps it open, as editing a previewed file does in an IDE. After the
  // message box has taken the keystroke (bubbling, then a microtask): a render before React's own
  // change handler would put the controlled box back to its old value and lose what was typed.
  useEffect(() => {
    const typed = (event: Event) => {
      const id = event.target instanceof Element ? event.target.closest('[data-panel-id]')?.getAttribute('data-panel-id') : undefined;
      if (!id) return;
      queueMicrotask(() => {
        const h = latest.current, page = h.livePage();
        if (shownPanels(page).some(panel => panel.id === id && panel.preview)) h.changePage(keepTab(page, id));
      });
    };
    document.addEventListener('input', typed);
    return () => document.removeEventListener('input', typed);
  }, []);

  return { open, related, newPage, closeTabs, tabOf, remember, reopen, canReopen, statusOf };
}
