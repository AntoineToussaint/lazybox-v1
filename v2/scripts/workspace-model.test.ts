import { create } from '@bufbuild/protobuf';
import { SessionSchema } from '@lazybox/protocol';
import { mergeConversations } from '../packages/surfaces/src/conversation-model.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockPanel, dockedSide, insertDocked, showPanel, closable, defaultDock, routeChat, returnChat, repairLayout, type LayoutNode, retireMonitor, clonePage, defaultLayout, emptyTarget, mapPanels, movePanel, panels, parseLayout, removePanel, resolveTarget, visibleLayout, mainLayout, detachedFor } from '../packages/surfaces/src/workspace-model.ts';

test('one focused default page serializes without authentication or execution options', () => {
  const original = defaultLayout({ collectionId: 'alpha', sessionId: 'session', commandId: '' });
  const restored = parseLayout(JSON.stringify(original));
  assert.equal(restored.pages.length, 1);
  assert.equal(restored.pages[0].layout.type, 'split');
  assert.deepEqual(panels(restored.pages[0].layout).map(panel => panel.kind), ['collections', 'chat', 'console']);
  for (const forbidden of ['token', 'permission', 'profile', 'gateway', 'baseUrl']) assert.equal(JSON.stringify(restored).includes(forbidden), false);
});
test('pin, follow, reorder, removal, and clone preserve record references without sharing view identities', () => {
  const layout = defaultLayout(), page = layout.pages[0];
  const pinned = { collectionId: 'alpha', sessionId: 'session-a', commandId: '' };
  page.layout = mapPanels(page.layout, panel => panel.kind === 'chat' ? { ...panel, binding: { mode: 'pinned', target: pinned } } : panel);
  const chat = panels(page.layout)[1];
  assert.equal(resolveTarget(chat, { ...pinned, sessionId: 'other' }).sessionId, 'session-a');
  assert.equal(resolveTarget(panels(page.layout)[0], pinned), pinned);
  const moved = movePanel(page.layout, chat.id, -1);
  assert.equal(panels(moved)[0].id, chat.id);
  assert.equal(panels(removePanel(moved, chat.id)!).length, 2);
  let counter = 0;
  const copied = clonePage(page, () => `copy-${++counter}`);
  assert.notEqual(copied.id, page.id);
  assert.equal(panels(copied.layout).some(panel => panels(page.layout).some(original => original.id === panel.id)), false);
  assert.deepEqual(resolveTarget(panels(copied.layout)[1], emptyTarget()), pinned);
  assert.doesNotThrow(() => parseLayout(JSON.stringify({ ...layout, pages: [...layout.pages, copied] })));
});
test('invalid versions, oversized data, duplicate ids, unsupported properties, and detached launchers are rejected', () => {
  for (const mutate of [
    (layout: any) => { layout.version = 2; },
    (layout: any) => { layout.token = 'must-not-be-imported'; },
    (layout: any) => { layout.pages[0].selection.commandId = 'missing-session'; },
    (layout: any) => { layout.pages.push(structuredClone(layout.pages[0])); },
    (layout: any) => { layout.pages[0].layout.ratio = 1; },
    (layout: any) => { layout.pages[0].layout.children[0].panel.detached = true; },
  ]) { const layout = defaultLayout(); mutate(layout); assert.throws(() => parseLayout(JSON.stringify(layout))); }
  assert.throws(() => parseLayout('x'.repeat(129 << 10)));
});
test('unknown modules survive a round trip for a placeholder renderer', () => {
  const layout = defaultLayout();
  layout.pages[0].layout = mapPanels(layout.pages[0].layout, panel => ({ ...panel, kind: panel.kind === 'console' ? 'constructor' : panel.kind }));
  assert.equal(panels(parseLayout(JSON.stringify(layout)).pages[0].layout)[2].kind, 'constructor');
});

test('detached panes do not occupy space and docking preserves the saved arrangement', () => {
  const layout = defaultLayout().pages[0].layout;
  const detached = mapPanels(layout, panel => ({ ...panel, detached: panel.kind === 'chat' }));
  const saved = JSON.stringify(detached);
  assert.deepEqual(panels(visibleLayout(detached)!).map(panel => panel.kind), ['collections', 'console']);
  assert.equal(JSON.stringify(detached), saved, 'projection must not change persisted arrangement');
  assert.deepEqual(visibleLayout(mapPanels(detached, panel => ({ ...panel, detached: false }))), layout);
  assert.equal(visibleLayout(mapPanels(layout, panel => ({ ...panel, detached: true }))), null);
});

test('conversation order remains stable across response order and activity changes', () => {
  const a = create(SessionSchema, { id: 'a', createdAtUnixMillis: 100n, title: 'Saved title' });
  const b = create(SessionSchema, { id: 'b', createdAtUnixMillis: 200n });
  const c = create(SessionSchema, { id: 'c', createdAtUnixMillis: 200n });
  const snapshots = [a, b, c];
  assert.deepEqual(mergeConversations([], snapshots).map(s => s.id), ['b', 'c', 'a']);
  assert.deepEqual(mergeConversations([], [...snapshots].reverse()).map(s => s.id), ['b', 'c', 'a']);
  const updated = mergeConversations(snapshots, [create(SessionSchema, { id: 'a', status: 'running' })]);
  assert.deepEqual(updated.map(s => s.id), ['b', 'c', 'a']);
  assert.equal(updated[2].title, 'Saved title');
  assert.equal(updated[2].createdAtUnixMillis, 100n);
  assert.equal(updated[2].status, 'running');
  const legacy = ['z', 'a', 'm'].map(id => create(SessionSchema, { id }));
  assert.deepEqual(mergeConversations([], legacy).map(s => s.id), ['a', 'm', 'z']);
  assert.deepEqual(mergeConversations([], legacy.reverse()).map(s => s.id), ['a', 'm', 'z']);
});

test('continuations replace predecessor rows without changing conversation order', () => {
 const first=create(SessionSchema,{id:'first',conversationId:'first',createdAtUnixMillis:100n});
 const other=create(SessionSchema,{id:'other',conversationId:'other',createdAtUnixMillis:200n});
 const next=create(SessionSchema,{id:'next',conversationId:'first',previousExecutionId:'first',createdAtUnixMillis:100n});
 assert.deepEqual(mergeConversations([next,other],[first,next,other]).map(s=>s.id),['other','next']);
});

test('retiring Monitor preserves customized pages and their conversation references',()=>{
 const layout=defaultLayout({collectionId:'w',sessionId:'s',commandId:''});
 const monitor={...structuredClone(layout.pages[0]),id:'monitor',name:'Monitor'};
 layout.pages.push(monitor);layout.selectedPage='monitor';
 const migrated=retireMonitor(layout);assert.equal(migrated.pages.length,1);assert.equal(migrated.selectedPage,'work');assert.equal(migrated.pages[0].selection.sessionId,'s');
 monitor.name='My review';assert.equal(retireMonitor(layout).pages.length,2);
});

test('main window keeps a detached-chat card instead of stretching the workspace list', () => {
  const layout = defaultLayout({ collectionId: 'w', sessionId: 's', commandId: '' }).pages[0].layout;
  const pin = (panel: { kind: string; id: string }) => panel.kind === 'chat' ? { ...panel, detached: true, binding: { mode: 'pinned' as const, target: { collectionId: 'w', sessionId: 's', commandId: '' } } } : panel;
  const detached = mapPanels(layout, pin as never);
  assert.deepEqual(panels(mainLayout(detached)!).map(panel => panel.kind), ['collections', 'chat', 'console']);
  assert.equal(detachedFor(detached, { collectionId: 'w', sessionId: 's', commandId: '' })?.kind, 'chat');
  assert.equal(detachedFor(detached, { collectionId: 'w', sessionId: 'other', commandId: '' }), undefined);
  assert.deepEqual(mainLayout(mapPanels(detached, panel => ({ ...panel, detached: false }))), mapPanels(detached, panel => ({ ...panel, detached: false })));
});

const kinds = (node: LayoutNode): unknown => node.type === 'panel' ? node.panel.kind : [node.direction, node.ratio, node.children.map(kinds)];
test('docking moves a panel to an edge of the content area and keeps the workspace list at the page edge', () => {
  const layout = defaultLayout().pages[0].layout, console = panels(layout).find(panel => panel.kind === 'console')!;
  assert.equal(dockedSide(layout, console.id), 'bottom');
  assert.deepEqual(kinds(dockPanel(layout, console.id, 'right')), ['row', 0.22, ['collections', ['row', 0.7, ['chat', 'console']]]]);
  assert.deepEqual(kinds(dockPanel(layout, console.id, 'left')), ['row', 0.22, ['collections', ['row', 0.3, ['console', 'chat']]]]);
  assert.deepEqual(kinds(dockPanel(layout, console.id, 'top')), ['row', 0.22, ['collections', ['column', 0.3, ['console', 'chat']]]]);
  assert.deepEqual(kinds(dockPanel(layout, console.id, 'bottom')), ['row', 0.22, ['collections', ['column', 0.7, ['chat', 'console']]]]);
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const docked = dockPanel(layout, console.id, side);
    assert.equal(dockedSide(docked, console.id), side);
    assert.equal(panels(docked).find(panel => panel.id === console.id)!.collapsed, false, 'a docked panel is shown');
    assert.doesNotThrow(() => parseLayout(JSON.stringify({ ...defaultLayout(), pages: [{ ...defaultLayout().pages[0], layout: docked }] })));
  }
  // The workspace list itself docks against the whole page.
  const list = panels(layout).find(panel => panel.kind === 'collections')!;
  assert.deepEqual(kinds(dockPanel(layout, list.id, 'right')), ['row', 0.7, [['column', 0.72, ['chat', 'console']], 'collections']]);
  // The only panel has nowhere to go.
  const single: LayoutNode = { type: 'panel', panel: console };
  assert.equal(dockPanel(single, console.id, 'left'), single);
  assert.equal(dockPanel(layout, 'missing', 'left'), layout);
});
test('a terminal opens docked right beside the work, once, and closing removes it', () => {
  const layout = defaultLayout().pages[0].layout;
  let counter = 0; const id = () => `terminal-${++counter}`;
  assert.equal(defaultDock('terminal'), 'right'); assert.equal(defaultDock('console'), 'bottom');
  const opened = showPanel(layout, 'terminal', defaultDock('terminal'), id);
  assert.equal(opened.added, true);
  assert.deepEqual(kinds(opened.layout), ['row', 0.22, ['collections', ['row', 0.6, [['column', 0.72, ['chat', 'console']], 'terminal']]]]);
  const collapsed = mapPanels(opened.layout, panel => panel.id === opened.id ? { ...panel, collapsed: true } : panel);
  const again = showPanel(collapsed, 'terminal', 'left', id);
  assert.equal(again.added, false); assert.equal(again.id, opened.id);
  assert.equal(panels(again.layout).filter(panel => panel.kind === 'terminal').length, 1, 'showing again never adds a duplicate');
  assert.equal(panels(again.layout).find(panel => panel.id === opened.id)!.collapsed, false, 'showing again expands it');
  assert.equal(counter, 1);
  assert.deepEqual(removePanel(opened.layout, opened.id), layout, 'closing restores the arrangement it was added to');
  assert.equal(closable(panels(opened.layout).find(panel => panel.kind === 'terminal')!), true);
  assert.equal(closable(panels(layout).find(panel => panel.kind === 'chat')!), false);
  assert.equal(closable(panels(layout).find(panel => panel.kind === 'collections')!), false);
  // Insertion at a remembered side works for any kind.
  assert.deepEqual(kinds(insertDocked(layout, { id: 'x', kind: 'changes', binding: { mode: 'follow' }, detached: false }, 'left')), ['row', 0.22, ['collections', ['row', 0.3, ['changes', ['column', 0.72, ['chat', 'console']]]]]]);
});
test('layouts saved before docking still load, and docked pages up to the panel limit validate', () => {
  const saved = '{"version":1,"selectedPage":"work","pages":[{"id":"work","name":"Work","selection":{"collectionId":"alpha","sessionId":"","commandId":""},"layout":{"type":"split","direction":"column","ratio":0.6,"children":[{"type":"split","direction":"row","ratio":0.22,"children":[{"type":"panel","panel":{"id":"alpha-work-collections","kind":"collections","binding":{"mode":"follow"},"detached":false,"collapsed":false}},{"type":"split","direction":"column","ratio":0.72,"children":[{"type":"panel","panel":{"id":"alpha-work-chat","kind":"chat","binding":{"mode":"follow"},"detached":false,"collapsed":false}},{"type":"panel","panel":{"id":"alpha-work-console","kind":"console","binding":{"mode":"follow"},"detached":false,"collapsed":true}}]}]},{"type":"panel","panel":{"id":"t1","kind":"terminal","binding":{"mode":"follow"},"detached":false}}]}}]}';
  const layout = parseLayout(saved);
  assert.deepEqual(panels(layout.pages[0].layout).map(panel => panel.kind), ['collections', 'chat', 'console', 'terminal']);
  // An old full-width terminal row moves beside the work in one step.
  assert.equal(dockedSide(layout.pages[0].layout, 't1'), undefined);
  assert.deepEqual(kinds(dockPanel(layout.pages[0].layout, 't1', 'right')), ['row', 0.22, ['collections', ['row', 0.6, [['column', 0.72, ['chat', 'console']], 'terminal']]]]);
  // Docking eight more panels one after another nests deeper than the old limit of 8.
  let node = layout.pages[0].layout;
  for (let i = 0; i < 8; i++) node = insertDocked(node, { id: `extra-${i}`, kind: 'usage', binding: { mode: 'follow' }, detached: false }, i % 2 ? 'left' : 'bottom');
  assert.equal(panels(node).length, 12);
  assert.doesNotThrow(() => parseLayout(JSON.stringify({ ...layout, pages: [{ ...layout.pages[0], layout: node }] })));
});

// A chat brought back from its own window stays pinned to its conversation.
const pinnedChat = (id: string, sessionId: string, detached = false) => ({ id, kind: 'chat', binding: { mode: 'pinned' as const, target: { collectionId: 'w', sessionId, commandId: '' } }, detached });
const target = (sessionId: string) => ({ collectionId: 'w', sessionId, commandId: '' });
const chatsOf = (node: LayoutNode) => panels(node).filter(panel => panel.kind === 'chat' && !panel.detached);
test('selecting a conversation reuses the page chat panel and never adds a second one', () => {
  const base = defaultLayout(target('s')).pages[0].layout;
  // Only pinned chats (brought back from windows): the first one is reused and follows the page.
  const pinnedOnly = mapPanels(base, panel => panel.kind === 'chat' ? pinnedChat(panel.id, 's') : panel);
  let counter = 0; const id = () => `new-${++counter}`;
  for (const session of ['s', 's', 'other', 's', 'other']) {
    const routed = routeChat(pinnedOnly, target(session), id);
    assert.equal(chatsOf(routed.layout).length, 1, `one chat for ${session}`);
    assert.equal(routed.id, 'w-work-chat');
  }
  assert.equal(counter, 0, 'no chat panel is ever added while one is visible');
  assert.equal(chatsOf(routeChat(pinnedOnly, target('other'), id).layout)[0].binding.mode, 'follow', 'a pinned chat on another conversation switches to follow the page');
  assert.equal(chatsOf(routeChat(pinnedOnly, target('s'), id).layout)[0].binding.mode, 'pinned', 'a chat already pinned to it stays as it is');
  // A follow panel and a pinned panel on the selected conversation: the duplicate goes.
  const both = insertDocked(base, pinnedChat('pinned-s', 's'), 'right');
  const routed = routeChat(both, target('s'), id);
  assert.deepEqual(chatsOf(routed.layout).map(panel => panel.id), ['w-work-chat']);
  // A pinned panel on a different conversation is not a duplicate and stays.
  assert.deepEqual(chatsOf(routeChat(both, target('t'), id).layout).map(panel => panel.id), ['w-work-chat', 'pinned-s']);
  // A page without a chat gets exactly one.
  const none = removePanel(base, 'w-work-chat')!;
  const added = routeChat(none, target('s'), id);
  assert.equal(chatsOf(added.layout).length, 1); assert.equal(counter, 1);
  assert.equal(chatsOf(routeChat(added.layout, target('s'), id).layout).length, 1); assert.equal(counter, 1);
});
test('bringing a chat back where its conversation already shows removes it instead of duplicating', () => {
  const base = defaultLayout(target('s')).pages[0].layout;
  const away = insertDocked(base, pinnedChat('away', 's', true), 'right');
  const back = returnChat(away, 'away', target('s'));
  assert.equal(panels(back).some(panel => panel.id === 'away'), false, 'the follow panel already shows s');
  assert.deepEqual(chatsOf(back).map(panel => panel.id), ['w-work-chat']);
  // Another conversation: it rejoins the page.
  const kept = returnChat(away, 'away', target('t'));
  assert.deepEqual(chatsOf(kept).map(panel => panel.id), ['w-work-chat', 'away']);
  // The only chat always rejoins.
  const alone = mapPanels(base, panel => panel.kind === 'chat' ? pinnedChat(panel.id, 's', true) : panel);
  assert.deepEqual(chatsOf(returnChat(alone, 'w-work-chat', target('s'))).map(panel => panel.id), ['w-work-chat']);
});
test('saved pages with duplicate chat panels are repaired on load, keeping one per conversation', () => {
  const layout = defaultLayout(target('s'));
  let node = mapPanels(layout.pages[0].layout, panel => panel.kind === 'chat' ? pinnedChat(panel.id, 's') : panel);
  node = insertDocked(node, pinnedChat('dup-1', 's'), 'right');
  node = insertDocked(node, pinnedChat('dup-2', 's'), 'right');
  node = insertDocked(node, pinnedChat('other', 't'), 'right');
  node = insertDocked(node, pinnedChat('window', 's', true), 'right');
  const saved = parseLayout(JSON.stringify({ ...layout, pages: [{ ...layout.pages[0], layout: node }] }));
  const repaired = repairLayout(saved).pages[0].layout;
  assert.deepEqual(chatsOf(repaired).map(panel => panel.id), ['w-work-chat', 'other'], 'pinned duplicates of one conversation collapse to the first');
  assert.ok(panels(repaired).some(panel => panel.id === 'window'), 'a chat in its own window is left alone');
  // A follow panel showing s makes a pinned panel on s redundant; a page with one chat is untouched.
  const follow = insertDocked(layout.pages[0].layout, pinnedChat('pinned', 's'), 'right');
  assert.deepEqual(chatsOf(repairLayout({ ...layout, pages: [{ ...layout.pages[0], layout: follow }] }).pages[0].layout).map(panel => panel.id), ['w-work-chat']);
  assert.equal(repairLayout(layout), layout);
});
