/**
 * A workspace's saved pages and how each one arranges its panels.
 *
 * Persisted personal composition contains references, never credentials or
 * operations. A page is a dock: a tree of splits whose leaves are tab groups,
 * plus groups floating over the page, groups popped out into their own
 * windows (same window process), and chats open in their own native window.
 * Sizes are fractions, so a page looks the same in any window size; the
 * Workspaces sidebar alone has one fixed width in pixels, kept outside the
 * page (see DockLayout).
 *
 * Version 1 was a binary tree of single panels; `parseLayout` migrates it.
 */
export type ViewTarget = { collectionId: string; sessionId: string; commandId: string };
export type Binding = { mode: 'follow' } | { mode: 'pinned'; target: ViewTarget };
export type Panel = { id: string; kind: string; binding: Binding; detached: boolean };
/** Panels shown as tabs in one place; `active` is the one in front. A minimized group shows only its tabs. */
export type Group = { type: 'group'; id: string; panels: Panel[]; active: string; minimized?: boolean };
/** Children side by side ('row') or stacked ('column'); `sizes` are their shares, summing to 1. */
export type Split = { type: 'split'; direction: 'row' | 'column'; sizes: number[]; children: LayoutNode[] };
export type LayoutNode = Group | Split;
/** A floating group's place over the page, in pixels from one corner. */
export type Box = { left?: number; top?: number; right?: number; bottom?: number; width: number; height: number };
export type FloatingGroup = { group: Group; box: Box };
export type WorkspacePage = {
  id: string;
  name: string;
  selection: ViewTarget;
  /** The docked arrangement; null when every panel was closed. */
  layout: LayoutNode | null;
  floating: FloatingGroup[];
  /** Groups in their own window. They come back docked when the page is loaded again. */
  popouts: Group[];
  /** Chats open in their own native window that left no card behind. */
  detached: Panel[];
};
export type WorkspaceLayout = { version: 2; selectedPage: string; pages: WorkspacePage[] };
export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export const emptyTarget = (): ViewTarget => ({ collectionId: '', sessionId: '', commandId: '' });
export const dockSides: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];
export const isDockSide = (value: unknown): value is DockSide => dockSides.includes(value as DockSide);
/** At most this many panels on one page, wherever they are. */
export const PANEL_LIMIT = 16;
const PAGE_LIMIT = 8, SIZE_LIMIT = 192 << 10, DEPTH_LIMIT = 10;

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const kindPattern = /^[a-z][a-z0-9-]{0,63}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const id = (value: unknown, optional = false): value is string => typeof value === 'string' && ((optional && value === '') || idPattern.test(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validTarget(value: unknown): value is ViewTarget {
  return object(value) && keys(value, ['collectionId', 'sessionId', 'commandId']) && id(value.collectionId, true) && id(value.sessionId, true) && id(value.commandId, true) && (!value.commandId || !!value.sessionId);
}
export function resolveTarget(panel: Panel, selection: ViewTarget): ViewTarget { return panel.binding.mode === 'pinned' ? panel.binding.target : selection; }
export function pinnedTarget(panel: Panel): { collectionId: string; sessionId: string } {
  return panel.binding.mode === 'pinned' ? { collectionId: panel.binding.target.collectionId, sessionId: panel.binding.target.sessionId } : { collectionId: '', sessionId: '' };
}

// ---------------------------------------------------------------------------
// Reading a tree.

export function groups(node: LayoutNode | null): Group[] { return !node ? [] : node.type === 'group' ? [node] : node.children.flatMap(groups); }
/** The docked panels, in reading order. */
export function panels(node: LayoutNode | null): Panel[] { return groups(node).flatMap(group => group.panels); }
/** Every group of a page: docked, floating and popped out. */
export function pageGroups(page: WorkspacePage): Group[] { return [...groups(page.layout), ...page.floating.map(value => value.group), ...page.popouts]; }
/** Every panel of a page, including chats in their own window. */
export function allPanels(page: WorkspacePage): Panel[] { return [...pageGroups(page).flatMap(group => group.panels), ...page.detached]; }
/** Panels a person can see on this page (not those in other native windows). */
export function shownPanels(page: WorkspacePage): Panel[] { return pageGroups(page).flatMap(group => group.panels); }
export function groupOf(page: WorkspacePage, panelID: string): Group | undefined { return pageGroups(page).find(group => group.panels.some(panel => panel.id === panelID)); }

// ---------------------------------------------------------------------------
// Changing a tree. Every function returns a normalized tree: no empty groups,
// no split with one child, no split nested in one going the same way, and
// sizes that sum to 1.

const MIN_SHARE = 0.02;
const round = (value: number) => Math.round(value * 10000) / 10000;
function shares(sizes: number[]): number[] {
  const clean = sizes.map(value => finite(value) && value > 0 ? value : MIN_SHARE), total = clean.reduce((sum, value) => sum + value, 0);
  return clean.map(value => round(Math.max(MIN_SHARE, value / total)));
}
export function normalize(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;
  if (node.type === 'group') {
    if (!node.panels.length) return null;
    return node.panels.some(panel => panel.id === node.active) ? node : { ...node, active: node.panels[0].id };
  }
  const children: LayoutNode[] = [], sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = normalize(child), size = node.sizes[index] ?? 1 / node.children.length;
    if (!next) return;
    // A split inside a split going the same way is the same split.
    if (next.type === 'split' && next.direction === node.direction) next.children.forEach((inner, at) => { children.push(inner); sizes.push(size * next.sizes[at]); });
    else { children.push(next); sizes.push(size); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { type: 'split', direction: node.direction, sizes: shares(sizes), children };
}
export function mapPanels(node: LayoutNode, change: (panel: Panel) => Panel): LayoutNode;
export function mapPanels(node: LayoutNode | null, change: (panel: Panel) => Panel): LayoutNode | null;
export function mapPanels(node: LayoutNode | null, change: (panel: Panel) => Panel): LayoutNode | null {
  if (!node) return null;
  if (node.type === 'group') { const next = node.panels.map(change); return { ...node, panels: next, active: next[node.panels.findIndex(panel => panel.id === node.active)]?.id ?? next[0]?.id }; }
  return { ...node, children: node.children.map(child => mapPanels(child, change)) };
}
export function mapGroups(node: LayoutNode | null, change: (group: Group) => Group): LayoutNode | null {
  if (!node) return null;
  return node.type === 'group' ? change(node) : { ...node, children: node.children.map(child => mapGroups(child, change)!) };
}
/** The page with one change to every group, wherever it is. */
export function mapPageGroups(page: WorkspacePage, change: (group: Group) => Group): WorkspacePage {
  return { ...page, layout: mapGroups(page.layout, change), floating: page.floating.map(value => ({ ...value, group: change(value.group) })), popouts: page.popouts.map(change) };
}
export function mapPagePanels(page: WorkspacePage, change: (panel: Panel) => Panel): WorkspacePage {
  const group = (value: Group): Group => ({ ...value, panels: value.panels.map(change) });
  return { ...mapPageGroups(page, group), detached: page.detached.map(change) };
}
export function removePanel(node: LayoutNode | null, panelID: string): LayoutNode | null {
  return normalize(mapGroups(node, group => group.panels.some(panel => panel.id === panelID) ? { ...group, panels: group.panels.filter(panel => panel.id !== panelID) } : group));
}
/** The page without this panel, wherever it was. */
export function removeFromPage(page: WorkspacePage, panelID: string): WorkspacePage {
  const without = (group: Group): Group | null => normalize({ ...group, panels: group.panels.filter(panel => panel.id !== panelID) }) as Group | null;
  return {
    ...page,
    layout: removePanel(page.layout, panelID),
    floating: page.floating.flatMap(value => { const group = without(value.group); return group ? [{ ...value, group }] : []; }),
    popouts: page.popouts.flatMap(value => { const group = without(value); return group ? [group] : []; }),
    detached: page.detached.filter(panel => panel.id !== panelID),
  };
}
/** Bring a panel to the front of its group, restoring a minimized group. */
export function activatePanel(page: WorkspacePage, panelID: string): WorkspacePage {
  return mapPageGroups(page, group => group.panels.some(panel => panel.id === panelID) ? { ...group, active: panelID, minimized: false } : group);
}

/** A group's id derived from the panel it was made for, unique on the page. */
export function groupID(panelID: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let candidate = `g-${panelID}`.slice(0, 128), n = 1;
  while (used.has(candidate)) candidate = `g-${panelID}`.slice(0, 120) + `-${++n}`;
  return candidate;
}
const groupFor = (panel: Panel, taken: Iterable<string> = []): Group => ({ type: 'group', id: groupID(panel.id, taken), panels: [panel], active: panel.id });

/** Panels that make up the page's sidebar: the workspace list and the agents list, as tabs of one group. */
export const sidebarKinds: ReadonlySet<string> = new Set(['collections', 'agents']);
/** A group of sidebar panels at the left or right edge of the page is its sidebar, with one fixed width. */
export const isSidebar = (node: LayoutNode) => node.type === 'group' && node.panels.every(panel => sidebarKinds.has(panel.kind));
/** Where the sidebar is in a page's root row: 'first', 'last', or not there. */
export function sidebarAt(node: LayoutNode | null): 'first' | 'last' | undefined {
  if (!node || node.type !== 'split' || node.direction !== 'row') return undefined;
  if (isSidebar(node.children[0])) return 'first';
  if (isSidebar(node.children[node.children.length - 1])) return 'last';
  return undefined;
}

/**
 * The narrowest a panel of this kind stays usable, in pixels: a conversation
 * needs room for its messages and composer, Files for its names and find box.
 * A page narrower than its panels' minimums puts panels together as tabs
 * (fitWidth) rather than crushing them.
 */
const MIN_WIDTH: Readonly<Record<string, number>> = { chat: 360, assistant: 360, editor: 320, changes: 320, web: 320, preview: 320, terminal: 280, console: 240, files: 200 };
export const minWidthOf = (kind: string) => MIN_WIDTH[kind] ?? 220;
/** The width an arrangement needs: side-by-side panels add up, stacked ones take the widest; a sidebar takes its fixed width. */
export function minimumWidth(node: LayoutNode | null, sidebarWidth: number): number {
  if (!node) return 0;
  if (node.type === 'group') return isSidebar(node) ? sidebarWidth : Math.max(...node.panels.map(panel => minWidthOf(panel.kind)));
  const widths = node.children.map(child => minimumWidth(child, sidebarWidth));
  return node.direction === 'row' ? widths.reduce((sum, value) => sum + value, 0) : Math.max(...widths);
}
/**
 * The arrangement fitted to `available` pixels: while its panels' minimum
 * widths do not fit, the rightmost two side-by-side panels (never the
 * sidebar) become tabs of one group, showing the one that was on the right
 * (usually the one just opened). Unchanged when it already fits.
 */
export function fitWidth(node: LayoutNode | null, available: number, sidebarWidth: number): LayoutNode | null {
  let current = node;
  for (let step = 0; step < PANEL_LIMIT && current && available > 0 && minimumWidth(current, sidebarWidth) > available; step++) {
    const next = mergeRightmost(current);
    if (next === current) break;
    current = next;
  }
  return current;
}
function mergeRightmost(root: LayoutNode): LayoutNode {
  let done = false;
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'group') return node;
    const children = [...node.children];
    // Deepest first: a row inside the last column is merged before the row it sits in.
    for (let index = children.length - 1; index >= 0 && !done; index--) children[index] = visit(children[index]);
    if (done || node.direction !== 'row') return { ...node, children };
    const open = children.map((child, index) => ({ child, index })).filter(item => !isSidebar(item.child));
    if (open.length < 2) return { ...node, children };
    const last = open[open.length - 1], previous = open[open.length - 2];
    const moved = groups(last.child), into = groups(previous.child), target = into.reduce((best, group) => group.panels.length >= best.panels.length ? group : best, into[0]);
    const merged: Group = { ...target, panels: [...target.panels, ...moved.flatMap(group => group.panels)], active: moved[moved.length - 1]?.active || target.active, minimized: false };
    const replaced = mapGroups(previous.child, group => group.id === target.id ? merged : group)!;
    const sizes = [...node.sizes];
    sizes[previous.index] += sizes[last.index];
    done = true;
    return normalize({ ...node, children: children.map((child, index) => index === previous.index ? replaced : child).filter((_, index) => index !== last.index), sizes: sizes.filter((_, index) => index !== last.index) })!;
  };
  return visit(root);
}

/** Where a panel of this kind goes the first time it is shown. */
export const defaultDock = (kind: string): DockSide => kind === 'console' || kind === 'actions' ? 'bottom' : kind === 'sessions' ? 'left' : 'right';
/** The share of the content area a docked panel takes: a terminal wants columns, the rest stay secondary. */
export const dockShare = (kind: string, side: DockSide) => {
  const across = side === 'left' || side === 'right';
  // An editor beside the conversation gets the larger half: code wants columns.
  if (kind === 'editor') return across ? 0.55 : 0.5;
  if (kind === 'files') return across ? 0.24 : 0.3;
  // A page wants width; the action list wants room for a log.
  if (kind === 'preview' || kind === 'web' || kind === 'browser') return across ? 0.45 : 0.5;
  if (kind === 'actions') return across ? 0.35 : 0.38;
  // Command output opens tall enough that its output, not its tools, fills it.
  if (kind === 'console' && !across) return 0.38;
  return kind === 'terminal' && across ? 0.4 : 0.3;
};
const along = (side: DockSide): 'row' | 'column' => side === 'left' || side === 'right' ? 'row' : 'column';
const before = (side: DockSide) => side === 'left' || side === 'top';
/** `node` with `leaf` added at one edge, taking `share` of it. */
function edge(node: LayoutNode | null, leaf: LayoutNode, side: DockSide, share: number): LayoutNode {
  if (!node) return leaf;
  share = Math.min(0.85, Math.max(0.1, share));
  if (node.type === 'split' && node.direction === along(side)) {
    const rest = node.sizes.map(size => size * (1 - share));
    return normalize({ ...node, children: before(side) ? [leaf, ...node.children] : [...node.children, leaf], sizes: before(side) ? [share, ...rest] : [...rest, share] })!;
  }
  return normalize({ type: 'split', direction: along(side), sizes: before(side) ? [share, 1 - share] : [1 - share, share], children: before(side) ? [leaf, node] : [node, leaf] })!;
}
/**
 * Put `leaf` at one edge of the page's content area, taking `share` of it: a
 * sidebar at the page edge stays there, and the panel docks beside it.
 */
export function dockAt(root: LayoutNode | null, leaf: LayoutNode, side: DockSide, share: number, movingKind = ''): LayoutNode {
  const at = sidebarKinds.has(movingKind) ? undefined : sidebarAt(root);
  if (!at || !root || root.type !== 'split') return edge(root, leaf, side, share);
  const index = at === 'first' ? 0 : root.children.length - 1;
  const sidebar = root.children[index], sidebarSize = root.sizes[index];
  const contentChildren = root.children.filter((_, at) => at !== index), contentSizes = root.sizes.filter((_, at) => at !== index);
  const content = normalize({ type: 'split', direction: 'row', sizes: contentSizes, children: contentChildren });
  const docked = edge(content, leaf, side, share);
  const children = at === 'first' ? [sidebar, docked] : [docked, sidebar], sizes = at === 'first' ? [sidebarSize, 1 - sidebarSize] : [1 - sidebarSize, sidebarSize];
  return normalize({ type: 'split', direction: 'row', sizes, children })!;
}
/** Put a new panel at one edge of the content area, in a group of its own. */
export function insertDocked(node: LayoutNode | null, panel: Panel, side: DockSide, share = dockShare(panel.kind, side)): LayoutNode {
  return dockAt(node, groupFor(panel, groups(node).map(group => group.id)), side, share, panel.kind);
}
/** Move a docked panel to an edge of the content area, in a group of its own. The only panel stays put. */
export function dockPanel(node: LayoutNode | null, panelID: string, side: DockSide, share?: number): LayoutNode | null {
  const panel = panels(node).find(value => value.id === panelID), rest = removePanel(node, panelID);
  if (!panel || !rest) return node;
  return insertDocked(rest, panel, side, share);
}
/** Add a panel as a tab of an existing group (in front). */
export function addToGroup(page: WorkspacePage, groupId: string, panel: Panel): WorkspacePage {
  return mapPageGroups(page, group => group.id === groupId ? { ...group, panels: [...group.panels, panel], active: panel.id, minimized: false } : group);
}
/** Split beside a group: `panel` (already removed elsewhere) goes in a new group on `side` of it, sharing its space. */
export function splitBeside(node: LayoutNode | null, groupId: string, panel: Panel, side: DockSide): LayoutNode | null {
  const leaf = groupFor(panel, groups(node).map(group => group.id));
  const visit = (current: LayoutNode): LayoutNode => {
    if (current.type === 'group') return current.id === groupId ? edge(current, leaf, side, 0.5) : current;
    return { ...current, children: current.children.map(visit) };
  };
  return node ? normalize(visit(node)) : leaf;
}

const shape = (node: LayoutNode | null): unknown => !node ? null : node.type === 'group' ? node.panels.map(panel => panel.id) : [node.direction, node.children.map(shape)];
/** The edge a panel is already docked at, so the menu does not offer a move that changes nothing. */
export function dockedSide(node: LayoutNode | null, panelID: string): DockSide | undefined {
  const current = JSON.stringify(shape(node));
  if (panels(node).length < 2) return undefined;
  return dockSides.find(side => JSON.stringify(shape(dockPanel(node, panelID, side))) === current);
}

/** Show the page's panel of this kind (in front, restored) or dock a new one; never a second copy. */
export function showPanel(page: WorkspacePage, kind: string, side: DockSide, newID: () => string): { page: WorkspacePage; id: string; added: boolean } {
  const existing = shownPanels(page).find(panel => panel.kind === kind && !panel.detached);
  if (existing) return { page: activatePanel(page, existing.id), id: existing.id, added: false };
  const id = newID();
  return { page: { ...page, layout: insertDocked(page.layout, { id, kind, binding: { mode: 'follow' }, detached: false }, side) }, id, added: true };
}
/**
 * Files and the editor work as a pair: showing one while the other is docked
 * and alone in its group puts the new one beside it (Files on the left, the
 * editor on the right). Otherwise this is showPanel.
 */
export function showCodePanel(page: WorkspacePage, kind: 'files' | 'editor', side: DockSide, newID: () => string): { page: WorkspacePage; id: string; added: boolean } {
  if (shownPanels(page).some(panel => panel.kind === kind && !panel.detached)) return showPanel(page, kind, side, newID);
  const partner = groups(page.layout).find(group => group.panels.some(panel => panel.kind === (kind === 'files' ? 'editor' : 'files')));
  if (!partner) return showPanel(page, kind, side, newID);
  const id = newID(), panel: Panel = { id, kind, binding: { mode: 'follow' }, detached: false };
  const pair = (node: Group) => edge(node, groupFor(panel, groups(page.layout).map(group => group.id)), kind === 'files' ? 'left' : 'right', kind === 'files' ? 0.3 : 0.7);
  // The pair takes room enough for code: at least 62% of the split it is in.
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'group') return node.id === partner.id ? pair(node) : node;
    const index = node.children.findIndex(child => child.type === 'group' && child.id === partner.id), share = node.sizes[index];
    const sizes = index >= 0 && node.direction === 'row' && share < 0.55 ? node.sizes.map((size, at) => at === index ? 0.62 : size * 0.38 / (1 - share)) : node.sizes;
    return { ...node, sizes, children: node.children.map(visit) };
  };
  return { page: { ...page, layout: normalize(visit(page.layout!)) }, id, added: true };
}

// ---------------------------------------------------------------------------
// Conversations.

const visibleChats = (page: WorkspacePage) => shownPanels(page).filter(panel => panel.kind === 'chat' && !panel.detached);
/** One visible chat panel per conversation: a pinned panel showing what a following panel
 * (or an earlier pinned one) already shows is a duplicate and is dropped. Never drops the last chat. */
export function dedupeChats(page: WorkspacePage, selection: ViewTarget): WorkspacePage {
  const chats = visibleChats(page), shown = new Set<string>();
  let result = page;
  for (const panel of [...chats.filter(value => value.binding.mode === 'follow'), ...chats.filter(value => value.binding.mode === 'pinned')]) {
    const session = resolveTarget(panel, selection).sessionId;
    if (!shown.has(session)) { shown.add(session); continue; }
    result = removeFromPage(result, panel.id);
  }
  return result;
}
/** The chat panel that shows a selected conversation: the following panel, else one pinned to it,
 * else the first visible chat switched to follow the page. A chat is added only when the page has none. */
export function routeChat(page: WorkspacePage, selection: ViewTarget, newID: () => string): { page: WorkspacePage; id: string } {
  const chats = visibleChats(page);
  const chosen = chats.find(panel => panel.binding.mode === 'follow')
    || chats.find(panel => panel.binding.mode === 'pinned' && panel.binding.target.sessionId === selection.sessionId)
    || chats[0];
  if (!chosen) { const id = newID(); return { page: { ...page, layout: insertDocked(page.layout, { id, kind: 'chat', binding: { mode: 'follow' }, detached: false }, 'right', 0.5) }, id }; }
  const pinnedHere = chosen.binding.mode === 'pinned' && chosen.binding.target.sessionId === selection.sessionId;
  const next = mapPagePanels(activatePanel(page, chosen.id), panel => panel.id !== chosen.id ? panel : { ...panel, binding: chosen.binding.mode === 'follow' || pinnedHere ? panel.binding : { mode: 'follow' } });
  return { page: dedupeChats({ ...next, selection }, selection), id: chosen.id };
}
/** Content panels: what the page shows besides the workspace list and command output. */
const content = (panel: Panel) => !sidebarKinds.has(panel.kind) && panel.kind !== 'console';
/**
 * A chat moving to its own window: it leaves the page, unless it is the last
 * content panel, which stays as a card so the workspace list does not fill the page.
 */
export function detachChat(page: WorkspacePage, panelID: string, target: ViewTarget): WorkspacePage {
  const panel = shownPanels(page).find(value => value.id === panelID);
  if (!panel) return page;
  const moved: Panel = { ...panel, binding: { mode: 'pinned', target: { ...target } }, detached: true };
  const others = shownPanels(page).filter(value => value.id !== panelID && content(value) && !value.detached);
  if (!others.length) return mapPagePanels(page, value => value.id === panelID ? moved : value);
  return { ...removeFromPage(page, panelID), detached: [...page.detached, moved] };
}
/** A chat brought back from its window rejoins the page, unless another panel already shows that conversation. */
export function returnChat(page: WorkspacePage, panelID: string, selection: ViewTarget): WorkspacePage {
  const panel = allPanels(page).find(value => value.id === panelID);
  if (!panel) return page;
  const session = resolveTarget(panel, selection).sessionId;
  if (visibleChats(page).some(other => other.id !== panelID && resolveTarget(other, selection).sessionId === session)) return removeFromPage(page, panelID);
  const back = { ...panel, detached: false };
  if (!page.detached.some(value => value.id === panelID)) return mapPagePanels(page, value => value.id === panelID ? back : value);
  return { ...page, detached: page.detached.filter(value => value.id !== panelID), layout: insertDocked(page.layout, back, 'right', 0.5) };
}
/** A detached panel already showing this conversation, so selecting it focuses that window. */
export function detachedFor(page: WorkspacePage, selection: ViewTarget): Panel | undefined {
  return allPanels(page).find(panel => panel.detached && panel.kind === 'chat' && panel.binding.mode === 'pinned' && !!selection.sessionId && panel.binding.target.sessionId === selection.sessionId);
}

// ---------------------------------------------------------------------------
// Pages.

const leaf = (panel: Panel, minimized = false): Group => ({ type: 'group', id: groupID(panel.id), panels: [panel], active: panel.id, ...(minimized ? { minimized } : {}) });
const followPanel = (panelID: string, kind: string): Panel => ({ id: panelID, kind, binding: { mode: 'follow' }, detached: false });
export const emptyPage = (pageID: string, name: string, selection: ViewTarget, layout: LayoutNode | null): WorkspacePage => ({ id: pageID, name, selection: { ...selection }, layout, floating: [], popouts: [], detached: [] });
/** The Work page: the workspace list (with the agents list as a tab beside it), the conversation, and command output below it, minimized until a run starts. */
export function defaultLayout(selection = emptyTarget()): WorkspaceLayout {
  const panel = (panelID: string, kind: string) => followPanel(selection.collectionId ? `${selection.collectionId}-${panelID}` : panelID, kind);
  const workspaces = panel('work-collections', 'collections');
  const layout: LayoutNode = { type: 'split', direction: 'row', sizes: [0.2, 0.8], children: [
    { ...leaf(workspaces), panels: [workspaces, panel('work-agents', 'agents')] },
    { type: 'split', direction: 'column', sizes: [0.62, 0.38], children: [leaf(panel('work-chat', 'chat')), leaf(panel('work-console', 'console'), true)] },
  ] };
  return { version: 2, selectedPage: 'work', pages: [emptyPage('work', 'Work', selection, layout)] };
}
export function clonePage(page: WorkspacePage, newID: () => string): WorkspacePage {
  const ids = new Map<string, string>();
  const copy = (panel: Panel): Panel => { const next = newID(); ids.set(panel.id, next); return { ...panel, id: next, detached: false, binding: panel.binding.mode === 'follow' ? { mode: 'follow' } : { mode: 'pinned', target: { ...panel.binding.target } } }; };
  const group = (value: Group): Group => { const panelsCopy = value.panels.filter(panel => !page.detached.includes(panel)).map(copy); return { ...value, id: groupID(panelsCopy[0]?.id || newID()), panels: panelsCopy, active: ids.get(value.active) || panelsCopy[0]?.id }; };
  // A copy shows everything in place: nothing in another window.
  let layout = mapGroups(page.layout, group);
  for (const popped of page.popouts) layout = dockAt(layout, group(popped), 'right', 0.3);
  return { ...emptyPage(newID(), `${page.name.slice(0, 59)} copy`, page.selection, layout), floating: page.floating.map(value => ({ ...value, group: group(value.group) })) };
}
/** Remove the retired built-in Monitor page without resetting other saved pages. */
export function retireMonitor(layout: WorkspaceLayout): WorkspaceLayout {
  const pages = layout.pages.filter(page => !(page.id === 'monitor' && page.name === 'Monitor'));
  if (pages.length === layout.pages.length) return layout;
  if (!pages.length) return defaultLayout(layout.pages[0]?.selection);
  return { ...layout, pages, selectedPage: pages.some(page => page.id === layout.selectedPage) ? layout.selectedPage : pages[0].id };
}
/** Groups popped out into windows of a window that has since closed come back docked on the right. */
export function redockPopouts(page: WorkspacePage): WorkspacePage {
  if (!page.popouts.length) return page;
  let layout = page.layout;
  for (const group of page.popouts) layout = dockAt(layout, group, 'right', 0.3, group.panels[0]?.kind);
  return { ...page, layout, popouts: [] };
}
/** What loading a saved page fixes: windows that are gone, duplicate chats. */
export function repairLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const pages = layout.pages.map(page => { const next = dedupeChats(redockPopouts(page), page.selection); return next.layout === page.layout && next.floating === page.floating && next.popouts === page.popouts && next.detached === page.detached ? page : next; });
  return pages.every((page, index) => page === layout.pages[index]) ? layout : { ...layout, pages };
}

/**
 * Switching workspace never moves a divider: the target keeps its own pages
 * and panels, but takes the current shares wherever its arrangement has the
 * same shape (the sidebar has one fixed width everywhere).
 */
export function adoptGeometry(to: WorkspaceLayout, from: WorkspaceLayout): WorkspaceLayout {
  const same = (a: LayoutNode | null, b: LayoutNode | null): LayoutNode | null => {
    if (a?.type === 'split' && b?.type === 'split' && a.direction === b.direction && a.children.length === b.children.length) return { ...a, sizes: [...b.sizes], children: a.children.map((child, index) => same(child, b.children[index])!) };
    if (a?.type === 'group' && b?.type === 'group' && !!a.minimized !== !!b.minimized) return { ...a, minimized: b.minimized };
    return a;
  };
  return { ...to, pages: to.pages.map(page => {
    const match = from.pages.find(value => value.id === page.id) || (page.id === to.selectedPage ? from.pages.find(value => value.id === from.selectedPage) : undefined);
    return match ? { ...page, layout: same(page.layout, match.layout) } : page;
  }) };
}

// ---------------------------------------------------------------------------
// Saved form.

function parseGroup(value: unknown, panelIDs: Set<string>, groupIDs: Set<string>): Group {
  if (!object(value) || value.type !== 'group' || !keys(value, ['type', 'id', 'panels', 'active', 'minimized']) || !id(value.id) || groupIDs.has(value.id) || !Array.isArray(value.panels) || !value.panels.length || value.panels.length > PANEL_LIMIT || (value.minimized !== undefined && typeof value.minimized !== 'boolean')) throw new Error('Invalid panel group');
  groupIDs.add(value.id);
  const parsed = value.panels.map(panel => parsePanel(panel, panelIDs));
  if (typeof value.active !== 'string' || !parsed.some(panel => panel.id === value.active)) throw new Error('Invalid active panel');
  return { type: 'group', id: value.id, panels: parsed, active: value.active, ...(value.minimized ? { minimized: true } : {}) };
}
function parsePanel(p: unknown, panelIDs: Set<string>): Panel {
  if (!object(p) || !keys(p, ['id', 'kind', 'binding', 'detached']) || !id(p.id) || panelIDs.has(p.id) || typeof p.kind !== 'string' || !kindPattern.test(p.kind) || typeof p.detached !== 'boolean' || !object(p.binding)) throw new Error('Invalid panel');
  panelIDs.add(p.id);
  const bindingValid = p.binding.mode === 'follow' ? keys(p.binding, ['mode']) : p.binding.mode === 'pinned' && keys(p.binding, ['mode', 'target']) && validTarget(p.binding.target);
  if (!bindingValid) throw new Error('Invalid panel binding');
  if (p.detached && !(p.kind === 'chat' && p.binding.mode === 'pinned' && !!(p.binding.target as ViewTarget).sessionId)) throw new Error('Only a chat pinned to a conversation opens in its own window');
  return { id: p.id, kind: p.kind, binding: p.binding as Binding, detached: p.detached };
}
function parseNode(value: unknown, depth: number, panelIDs: Set<string>, groupIDs: Set<string>): LayoutNode {
  if (depth > DEPTH_LIMIT) throw new Error('Page layout is nested too deeply');
  if (object(value) && value.type === 'split') {
    if (!keys(value, ['type', 'direction', 'sizes', 'children']) || !['row', 'column'].includes(value.direction as string) || !Array.isArray(value.children) || !value.children.length || value.children.length > PANEL_LIMIT || !Array.isArray(value.sizes) || value.sizes.length !== value.children.length || !value.sizes.every(size => finite(size) && size > 0 && size <= 1)) throw new Error('Invalid split');
    return { type: 'split', direction: value.direction as 'row' | 'column', sizes: value.sizes as number[], children: value.children.map(child => parseNode(child, depth + 1, panelIDs, groupIDs)) };
  }
  return parseGroup(value, panelIDs, groupIDs);
}
function parseBox(value: unknown): Box {
  if (!object(value) || !keys(value, ['left', 'top', 'right', 'bottom', 'width', 'height']) || !finite(value.width) || !finite(value.height) || value.width < 40 || value.height < 40) throw new Error('Invalid floating position');
  for (const side of ['left', 'top', 'right', 'bottom']) if (value[side] !== undefined && !finite(value[side])) throw new Error('Invalid floating position');
  return value as Box;
}
function parsePage(page: unknown, pageIDs: Set<string>): WorkspacePage {
  if (!object(page) || !keys(page, ['id', 'name', 'selection', 'layout', 'floating', 'popouts', 'detached']) || !id(page.id) || pageIDs.has(page.id) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 64 || /[\u0000-\u001f]/.test(page.name) || !validTarget(page.selection)) throw new Error('Invalid page or panel configuration');
  pageIDs.add(page.id);
  const panelIDs = new Set<string>(), groupIDs = new Set<string>();
  const layout = page.layout === null ? null : parseNode(page.layout, 0, panelIDs, groupIDs);
  const list = (value: unknown) => value === undefined ? [] : Array.isArray(value) && value.length <= PANEL_LIMIT ? value : (() => { throw new Error('Invalid page or panel configuration'); })();
  const floating = list(page.floating).map(value => { if (!object(value) || !keys(value, ['group', 'box'])) throw new Error('Invalid floating group'); return { group: parseGroup(value.group, panelIDs, groupIDs), box: parseBox(value.box) }; });
  const popouts = list(page.popouts).map(value => parseGroup(value, panelIDs, groupIDs));
  const detached = list(page.detached).map(value => { const panel = parsePanel(value, panelIDs); if (!panel.detached) throw new Error('A panel kept for its own window must be detached'); return panel; });
  if (panelIDs.size > PANEL_LIMIT) throw new Error(`At most ${PANEL_LIMIT} panels per page`);
  return { id: page.id, name: page.name, selection: page.selection, layout: normalize(layout), floating, popouts, detached };
}

/** Reads saved pages in any version, migrating older ones; throws rather than guessing. */
export function parseLayout(text: string): WorkspaceLayout {
  if (text.length > SIZE_LIMIT) throw new Error('Page layout exceeds 192 KiB');
  const value: unknown = JSON.parse(text);
  if (object(value) && value.version === 1) return migrateV1(value);
  if (!object(value) || !keys(value, ['version', 'selectedPage', 'pages']) || value.version !== 2 || !id(value.selectedPage) || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > PAGE_LIMIT) throw new Error('Unsupported page layout');
  const pageIDs = new Set<string>();
  const pages = value.pages.map(page => parsePage(page, pageIDs));
  if (!pageIDs.has(value.selectedPage)) throw new Error('Selected page does not exist');
  return { version: 2, selectedPage: value.selectedPage, pages };
}

// ---------------------------------------------------------------------------
// Version 1: a binary tree of single panels, each optionally collapsed or in
// its own window. Validated as strictly as it always was, then converted.

type V1Panel = { id: string; kind: string; binding: Binding; detached: boolean; collapsed?: boolean };
type V1Node = { type: 'panel'; panel: V1Panel } | { type: 'split'; direction: 'row' | 'column'; ratio: number; children: [V1Node, V1Node] };
function validV1(value: Record<string, unknown>) {
  const pageIDs = new Set<string>(), panelIDs = new Set<string>();
  const node = (value: unknown, depth: number): boolean => {
    if (!object(value) || depth > 12) return false;
    if (value.type === 'split') return keys(value, ['type', 'direction', 'ratio', 'children']) && ['row', 'column'].includes(value.direction as string) && finite(value.ratio) && value.ratio >= 0.15 && value.ratio <= 0.85 && Array.isArray(value.children) && value.children.length === 2 && value.children.every(child => node(child, depth + 1));
    if (value.type !== 'panel' || !keys(value, ['type', 'panel']) || !object(value.panel)) return false;
    const p = value.panel;
    if (!keys(p, ['id', 'kind', 'binding', 'detached', 'collapsed']) || !id(p.id) || panelIDs.has(p.id) || typeof p.kind !== 'string' || !kindPattern.test(p.kind) || typeof p.detached !== 'boolean' || (p.collapsed !== undefined && typeof p.collapsed !== 'boolean') || !object(p.binding)) return false;
    panelIDs.add(p.id);
    const bindingValid = p.binding.mode === 'follow' ? keys(p.binding, ['mode']) : p.binding.mode === 'pinned' && keys(p.binding, ['mode', 'target']) && validTarget(p.binding.target);
    return bindingValid && (!p.detached || (p.kind === 'chat' && p.binding.mode === 'pinned' && validTarget(p.binding.target) && !!p.binding.target.sessionId));
  };
  const v1Panels = (n: V1Node): V1Panel[] => n.type === 'panel' ? [n.panel] : n.children.flatMap(v1Panels);
  if (!keys(value, ['version', 'selectedPage', 'pages']) || !id(value.selectedPage) || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > PAGE_LIMIT) throw new Error('Unsupported page layout');
  for (const page of value.pages) {
    if (!object(page) || !keys(page, ['id', 'name', 'selection', 'layout']) || !id(page.id) || pageIDs.has(page.id) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 64 || /[\u0000-\u001f]/.test(page.name) || !validTarget(page.selection) || !node(page.layout, 0)) throw new Error('Invalid page or panel configuration');
    pageIDs.add(page.id);
    if (v1Panels(page.layout as V1Node).length > 12) throw new Error('At most 12 panels per page');
  }
  if (!pageIDs.has(value.selectedPage as string)) throw new Error('Selected page does not exist');
}
/** Converts a version 1 layout: every panel becomes a group of its own, in the same place and size. */
export function migrateV1(value: Record<string, unknown>): WorkspaceLayout {
  validV1(value);
  const old = value as { selectedPage: string; pages: { id: string; name: string; selection: ViewTarget; layout: V1Node }[] };
  return { version: 2, selectedPage: old.selectedPage, pages: old.pages.map(page => {
    const all: V1Panel[] = [];
    const collect = (n: V1Node) => { if (n.type === 'panel') all.push(n.panel); else n.children.forEach(collect); };
    collect(page.layout);
    // As before: chats in their own window leave no gap, unless every content panel is away (then the first stays as a card).
    const isContent = (panel: V1Panel) => panel.kind !== 'collections' && panel.kind !== 'console';
    const card = all.some(panel => !panel.detached && isContent(panel)) ? undefined : all.find(panel => panel.detached && isContent(panel));
    const away = all.filter(panel => panel.detached && panel !== card);
    const convert = (n: V1Node, parent?: 'row' | 'column'): LayoutNode | null => {
      if (n.type === 'panel') {
        if (away.includes(n.panel)) return null;
        const { collapsed, ...panel } = n.panel;
        return leaf(panel, !!collapsed && parent === 'column');
      }
      return { type: 'split', direction: n.direction, sizes: [n.ratio, 1 - n.ratio], children: [convert(n.children[0], n.direction), convert(n.children[1], n.direction)].filter(Boolean) as LayoutNode[] };
    };
    // Normalizing drops the gaps and merges splits that go the same way.
    let layout = normalize(convert(page.layout));
    // The workspace list gains the agents list as a tab, as new pages have it.
    const list = groups(layout).find(group => group.panels.length === 1 && group.panels[0].kind === 'collections');
    const agentsID = list ? `${list.panels[0].id}-agents`.slice(0, 128) : '';
    if (list && !all.some(panel => panel.id === agentsID || panel.kind === 'agents')) layout = mapGroups(layout, group => group === list ? { ...group, panels: [...group.panels, followPanel(agentsID, 'agents')] } : group);
    return { ...emptyPage(page.id, page.name, page.selection, layout), detached: away.map(({ collapsed: _, ...panel }) => panel) };
  }) };
}
