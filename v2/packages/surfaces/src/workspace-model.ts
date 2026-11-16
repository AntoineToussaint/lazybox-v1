/** Persisted personal composition contains references, never credentials or operations. */
export type ViewTarget = { collectionId: string; sessionId: string; commandId: string };
export type Binding = { mode: 'follow' } | { mode: 'pinned'; target: ViewTarget };
export type Panel = { id: string; kind: string; binding: Binding; detached: boolean; collapsed?: boolean };
export type LayoutNode = { type: 'panel'; panel: Panel } | { type: 'split'; direction: 'row' | 'column'; ratio: number; children: [LayoutNode, LayoutNode] };
export type WorkspacePage = { id: string; name: string; selection: ViewTarget; layout: LayoutNode };
export type WorkspaceLayout = { version: 1; selectedPage: string; pages: WorkspacePage[] };
export const emptyTarget = (): ViewTarget => ({ collectionId: '', sessionId: '', commandId: '' });
export const moduleKinds = ['collections', 'chat', 'console', 'assistant', 'sessions'] as const;
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const kindPattern = /^[a-z][a-z0-9-]{0,63}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const id = (value: unknown, optional = false): value is string => typeof value === 'string' && ((optional && value === '') || idPattern.test(value));

export function validTarget(value: unknown): value is ViewTarget {
  return object(value) && keys(value, ['collectionId', 'sessionId', 'commandId']) && id(value.collectionId, true) && id(value.sessionId, true) && id(value.commandId, true) && (!value.commandId || !!value.sessionId);
}
export function panels(node: LayoutNode): Panel[] { return node.type === 'panel' ? [node.panel] : node.children.flatMap(panels); }
export function resolveTarget(panel: Panel, selection: ViewTarget): ViewTarget { return panel.binding.mode === 'pinned' ? panel.binding.target : selection; }

export function parseLayout(text: string): WorkspaceLayout {
  if (text.length > 128 << 10) throw new Error('Page layout exceeds 128 KiB');
  const value: unknown = JSON.parse(text);
  const pageIDs = new Set<string>(), panelIDs = new Set<string>();
  const node = (value: unknown, depth: number): boolean => {
    // A binary tree of at most 12 panels is at most 11 deep, however it was docked.
    if (!object(value) || depth > 12) return false;
    if (value.type === 'split') return keys(value, ['type', 'direction', 'ratio', 'children']) && ['row', 'column'].includes(value.direction as string) && typeof value.ratio === 'number' && Number.isFinite(value.ratio) && value.ratio >= 0.15 && value.ratio <= 0.85 && Array.isArray(value.children) && value.children.length === 2 && value.children.every(child => node(child, depth + 1));
    if (value.type !== 'panel' || !keys(value, ['type', 'panel']) || !object(value.panel)) return false;
    const p = value.panel;
    if (!keys(p, ['id', 'kind', 'binding', 'detached', 'collapsed']) || !id(p.id) || panelIDs.has(p.id) || typeof p.kind !== 'string' || !kindPattern.test(p.kind) || typeof p.detached !== 'boolean' || (p.collapsed !== undefined && typeof p.collapsed !== 'boolean') || !object(p.binding)) return false;
    panelIDs.add(p.id);
    const bindingValid = p.binding.mode === 'follow' ? keys(p.binding, ['mode']) : p.binding.mode === 'pinned' && keys(p.binding, ['mode', 'target']) && validTarget(p.binding.target);
    return bindingValid && (!p.detached || (p.kind === 'chat' && p.binding.mode === 'pinned' && validTarget(p.binding.target) && !!p.binding.target.sessionId));
  };
  if (!object(value) || !keys(value, ['version', 'selectedPage', 'pages']) || value.version !== 1 || !id(value.selectedPage) || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 8) throw new Error('Unsupported page layout');
  for (const page of value.pages) {
    if (!object(page) || !keys(page, ['id', 'name', 'selection', 'layout']) || !id(page.id) || pageIDs.has(page.id) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 64 || /[\u0000-\u001f]/.test(page.name) || !validTarget(page.selection) || !node(page.layout, 0)) throw new Error('Invalid page or panel configuration');
    pageIDs.add(page.id);
    if (panels(page.layout as LayoutNode).length > 12) throw new Error('At most 12 panels per page');
  }
  if (!pageIDs.has(value.selectedPage)) throw new Error('Selected page does not exist');
  return value as WorkspaceLayout;
}

const leaf = (id: string, kind: string, collapsed = false): LayoutNode => ({ type: 'panel', panel: { id, kind, binding: { mode: 'follow' }, detached: false, collapsed } });
export function defaultLayout(selection = emptyTarget()): WorkspaceLayout {
  const panel=(id:string,kind:string,collapsed=false)=>leaf(selection.collectionId ? `${selection.collectionId}-${id}` : id,kind,collapsed);
  return { version: 1, selectedPage: 'work', pages: [
    { id: 'work', name: 'Work', selection: { ...selection }, layout: { type: 'split', direction: 'row', ratio: 0.22, children: [panel('work-collections', 'collections'), { type: 'split', direction: 'column', ratio: 0.72, children: [panel('work-chat', 'chat'), panel('work-console', 'console', true)] }] } },
  ] };
}
export function mapPanels(node: LayoutNode, change: (panel: Panel) => Panel): LayoutNode {
  return node.type === 'panel' ? { ...node, panel: change(node.panel) } : { ...node, children: [mapPanels(node.children[0], change), mapPanels(node.children[1], change)] };
}
export function removePanel(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'panel') return node.panel.id === id ? null : node;
  const first = removePanel(node.children[0], id), second = removePanel(node.children[1], id);
  return first && second ? { ...node, children: [first, second] } : first || second;
}
export function movePanel(node: LayoutNode, id: string, step: -1 | 1): LayoutNode {
  const items = panels(node), index = items.findIndex(panel => panel.id === id), other = items[index + step];
  if (index < 0 || !other) return node;
  const current = items[index];
  return mapPanels(node, panel => panel.id === id ? other : panel.id === other.id ? current : panel);
}
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export const dockSides: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];
export const isDockSide = (value: unknown): value is DockSide => dockSides.includes(value as DockSide);
/** The workspace list and the conversation are what a page is for: they never close; other panels dock around them. */
export const closable = (panel: Panel) => panel.kind !== 'collections' && panel.kind !== 'chat' && !panel.detached;
/** Where a panel of this kind goes the first time it is shown: a terminal beside the work, output below it. */
export const defaultDock = (kind: string): DockSide => kind === 'console' ? 'bottom' : kind === 'sessions' ? 'left' : 'right';
/** The share of the content area a docked panel takes: a terminal wants columns, the rest stay secondary. */
export const dockShare = (kind: string, side: DockSide) => kind === 'terminal' && (side === 'left' || side === 'right') ? 0.4 : 0.3;
const round = (value: number) => Math.round(Math.min(0.85, Math.max(0.15, value)) * 100) / 100;
/** The page's content area: a lone workspace list beside everything else stays at the page edge. */
export function contentIndex(node: LayoutNode, moving: Pick<Panel, 'kind'>): 0 | 1 | -1 {
  if (node.type !== 'split' || moving.kind === 'collections') return -1;
  const list = (child: LayoutNode) => child.type === 'panel' && child.panel.kind === 'collections';
  return list(node.children[0]) && !list(node.children[1]) ? 1 : list(node.children[1]) && !list(node.children[0]) ? 0 : -1;
}
/** Put a panel at one edge of the page's content area, taking `share` of it. */
export function insertDocked(node: LayoutNode, panel: Panel, side: DockSide, share = dockShare(panel.kind, side)): LayoutNode {
  const index = contentIndex(node, panel);
  if (index !== -1 && node.type === 'split') {
    const [first, second] = node.children;
    return { ...node, children: index === 0 ? [insertDocked(first, panel, side, share), second] : [first, insertDocked(second, panel, side, share)] };
  }
  const leaf: LayoutNode = { type: 'panel', panel }, first = side === 'left' || side === 'top';
  return { type: 'split', direction: side === 'left' || side === 'right' ? 'row' : 'column', ratio: round(first ? share : 1 - share), children: first ? [leaf, node] : [node, leaf] };
}
/** Move an existing panel to an edge of the content area, shown; the only panel stays put. */
export function dockPanel(node: LayoutNode, id: string, side: DockSide, share?: number): LayoutNode {
  const panel = panels(node).find(value => value.id === id), rest = removePanel(node, id);
  if (!panel || !rest) return node;
  return insertDocked(rest, { ...panel, collapsed: false }, side, share);
}
const shape = (node: LayoutNode): unknown => node.type === 'panel' ? node.panel.id : [node.direction, node.children.map(shape)];
/** The edge a panel is already docked at, so the menu does not offer a move that changes nothing. */
export function dockedSide(node: LayoutNode, id: string): DockSide | undefined {
  const current = JSON.stringify(shape(node));
  return dockSides.find(side => JSON.stringify(shape(dockPanel(node, id, side))) === current);
}
/** Show the page's panel of this kind (expanded) or dock a new one; never a second copy. */
export function showPanel(node: LayoutNode, kind: string, side: DockSide, newID: () => string): { layout: LayoutNode; id: string; added: boolean } {
  const existing = panels(node).find(panel => panel.kind === kind && !panel.detached);
  if (existing) return { layout: mapPanels(node, panel => panel.id === existing.id ? { ...panel, collapsed: false } : panel), id: existing.id, added: false };
  const id = newID();
  return { layout: insertDocked(node, { id, kind, binding: { mode: 'follow' }, detached: false }, side), id, added: true };
}
const visibleChats = (node: LayoutNode) => panels(node).filter(panel => panel.kind === 'chat' && !panel.detached);
/** One visible chat panel per conversation: a pinned panel showing what a following panel
 * (or an earlier pinned one) already shows is a duplicate and is dropped. Never drops the last chat. */
export function dedupeChats(node: LayoutNode, selection: ViewTarget): LayoutNode {
  const chats = visibleChats(node), shown = new Set<string>();
  let result = node;
  for (const panel of [...chats.filter(value => value.binding.mode === 'follow'), ...chats.filter(value => value.binding.mode === 'pinned')]) {
    const session = resolveTarget(panel, selection).sessionId;
    if (!shown.has(session)) { shown.add(session); continue; }
    result = removePanel(result, panel.id) || result;
  }
  return result;
}
/** Saved pages from before duplicates were prevented show each conversation once. */
export function repairLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const pages = layout.pages.map(page => { const next = dedupeChats(page.layout, page.selection); return next === page.layout ? page : { ...page, layout: next }; });
  return pages.every((page, index) => page === layout.pages[index]) ? layout : { ...layout, pages };
}
/** The chat panel that shows a selected conversation: the following panel, else one pinned to it,
 * else the first visible chat switched to follow the page. A chat is added only when the page has none. */
export function routeChat(node: LayoutNode, selection: ViewTarget, newID: () => string): { layout: LayoutNode; id: string } {
  const chats = visibleChats(node);
  const chosen = chats.find(panel => panel.binding.mode === 'follow')
    || chats.find(panel => panel.binding.mode === 'pinned' && panel.binding.target.sessionId === selection.sessionId)
    || chats[0];
  if (!chosen) { const id = newID(); return { layout: insertDocked(node, { id, kind: 'chat', binding: { mode: 'follow' }, detached: false }, 'right', 0.5), id }; }
  const pinnedHere = chosen.binding.mode === 'pinned' && chosen.binding.target.sessionId === selection.sessionId;
  const layout = mapPanels(node, panel => panel.id !== chosen.id ? panel : { ...panel, collapsed: false, binding: chosen.binding.mode === 'follow' || pinnedHere ? panel.binding : { mode: 'follow' } });
  return { layout: dedupeChats(layout, selection), id: chosen.id };
}
/** A chat brought back from its window rejoins the page, unless another panel already shows that conversation. */
export function returnChat(node: LayoutNode, id: string, selection: ViewTarget): LayoutNode {
  const panel = panels(node).find(value => value.id === id);
  if (!panel) return node;
  const session = resolveTarget(panel, selection).sessionId;
  if (visibleChats(node).some(other => other.id !== id && resolveTarget(other, selection).sessionId === session)) return removePanel(node, id) || node;
  return mapPanels(node, value => value.id === id ? { ...value, detached: false } : value);
}
export function clonePage(page: WorkspacePage, newID: () => string): WorkspacePage {
  return { ...page, id: newID(), name: `${page.name.slice(0, 59)} copy`, selection: { ...page.selection }, layout: mapPanels(page.layout, panel => ({ ...panel, id: newID(), detached: false, binding: panel.binding.mode === 'follow' ? { mode: 'follow' } : { mode: 'pinned', target: { ...panel.binding.target } } })) };
}

/** Detached windows remain in saved layout, but do not reserve an empty pane. */
export function visibleLayout(node:LayoutNode,keep=''):LayoutNode|null{
 if(node.type==='panel')return node.panel.detached&&node.panel.id!==keep?null:node;
 const first=visibleLayout(node.children[0],keep),second=visibleLayout(node.children[1],keep);
 return first&&second?{...node,children:[first,second]}:first||second;
}
const chrome=(panel:Panel)=>panel.kind==='collections'||panel.kind==='console';
/** The main window's layout: when every content panel is detached, the first one stays
 * in place as a "in its own window" card so the workspace list does not fill the page. */
export function mainLayout(node:LayoutNode):LayoutNode|null{
 const shown=visibleLayout(node);
 if(shown&&!panels(shown).every(chrome))return shown;
 const placeholder=panels(node).find(panel=>panel.detached&&!chrome(panel));
 return placeholder?visibleLayout(node,placeholder.id):shown;
}
export function pinnedTarget(panel:Panel):{collectionId:string;sessionId:string}{
 return panel.binding.mode==='pinned'?{collectionId:panel.binding.target.collectionId,sessionId:panel.binding.target.sessionId}:{collectionId:'',sessionId:''};
}
/** A detached panel already showing this conversation, so selecting it focuses that window. */
export function detachedFor(node:LayoutNode,selection:ViewTarget):Panel|undefined{
 return panels(node).find(panel=>panel.detached&&panel.kind==='chat'&&panel.binding.mode==='pinned'&&!!selection.sessionId&&panel.binding.target.sessionId===selection.sessionId);
}

/** Remove the retired built-in Monitor page without resetting other saved pages. */
export function retireMonitor(layout: WorkspaceLayout): WorkspaceLayout {
 const pages=layout.pages.filter(page=>!(page.id==='monitor'&&page.name==='Monitor'));
 if(pages.length===layout.pages.length)return layout;
 if(!pages.length)return defaultLayout(layout.pages[0]?.selection);
 return {...layout,pages,selectedPage:pages.some(page=>page.id===layout.selectedPage)?layout.selectedPage:pages[0].id};
}
