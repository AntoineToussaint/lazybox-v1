/**
 * Conversation tabs, the parts that are not the page's arrangement (that is
 * `workspace-model.ts`, "Conversations"): what a click on a conversation row
 * asks for, the tabs closed recently (⇧⌘T brings the last one back), and the
 * status dot a conversation's tab shows. Pure, so the rules are tested alone.
 */
import type { AttentionState } from './attention';
import type { OpenMode, ViewTarget } from './workspace-model';

/**
 * What a pointer gesture on a conversation row opens: a single click shows
 * it in the preview tab, a double-click keeps it in a tab, ⌘-click (Ctrl-click
 * off a Mac) and a middle-click open it in a tab behind the one in front.
 * Alt-click is Peek's (peek-model.ts); a right-click is the menu's.
 */
export function rowGesture(event: { button: number; detail?: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; type: string }, mac: boolean): OpenMode | undefined {
  if (event.altKey) return undefined;
  if (event.type === 'auxclick') return event.button === 1 ? 'background' : undefined;
  if (event.button !== 0) return undefined;
  if (event.type === 'dblclick') return 'tab';
  return (mac ? event.metaKey : event.ctrlKey) ? 'background' : 'preview';
}

/** A conversation tab closed: where it was, so ⇧⌘T puts it back there. */
export type ClosedTab = { page: string; target: ViewTarget; group: string; index: number };
/** At most this many closed tabs are remembered. */
export const CLOSED_LIMIT = 20;
/** The closed tabs with one more, the latest last; the same conversation is remembered once. */
export function rememberClosed(stack: readonly ClosedTab[], closed: ClosedTab): ClosedTab[] {
  const same = (entry: ClosedTab) => entry.page === closed.page && entry.target.sessionId === closed.target.sessionId && entry.target.collectionId === closed.target.collectionId;
  return [...stack.filter(entry => !same(entry)), closed].slice(-CLOSED_LIMIT);
}
/** The latest closed tab of a page that is not open again, and the stack without it (and without those that are open again). */
export function takeClosed(stack: readonly ClosedTab[], page: string, isOpen: (target: ViewTarget) => boolean): { tab?: ClosedTab; rest: ClosedTab[] } {
  const rest = stack.filter(entry => entry.page !== page || !isOpen(entry.target));
  for (let index = rest.length - 1; index >= 0; index--) {
    if (rest[index].page === page) return { tab: rest[index], rest: [...rest.slice(0, index), ...rest.slice(index + 1)] };
  }
  return { rest };
}

/** The dot before a conversation tab's title: working, needs you, failed, done (a turn ended), or idle. */
export type TabStatus = { state: 'working' | 'needs-you' | 'failed' | 'done' | 'idle'; label: string };
export function tabStatus(state: AttentionState, reason: string): TabStatus {
  switch (state) {
    case 'working': return { state: 'working', label: reason || 'Working' };
    case 'needs-input': return { state: 'needs-you', label: reason ? `Needs you: ${reason}` : 'Needs you' };
    case 'failed': return { state: 'failed', label: reason || 'Failed' };
    case 'review': return { state: 'done', label: reason || 'Turn done' };
    default: return { state: 'idle', label: reason || 'Done' };
  }
}
