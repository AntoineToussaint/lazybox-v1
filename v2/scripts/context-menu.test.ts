import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutePath, dedupeLabels, fencedCode, firstEnabled, joinSections, lastEnabled, normalizeMenu, placeMenu, placeSubmenu, quoteText, stepFocus, typeahead, type MenuItem } from '../packages/surfaces/src/context-menu-model.ts';

const labels = (items: MenuItem[]) => normalizeMenu(items).map(entry => entry.kind === 'separator' ? '—' : entry.action.label);

test('a menu drops empty items, empty submenus and stray separators', () => {
  const items: MenuItem[] = ['separator', { label: 'Open' }, false, null, '', 'separator', 'separator', { label: 'More', submenu: [false, 'separator'] }, { label: 'Copy' }, 'separator'];
  assert.deepEqual(labels(items), ['Open', '—', 'Copy']);
  const nested = normalizeMenu([{ label: 'Permissions', submenu: [{ label: 'Ask' }, 'separator', { label: 'YOLO' }] }]);
  assert.equal(nested[0].kind === 'action' && nested[0].submenu?.length, 3);
});

test('sections join innermost first with one line between non-empty ones, and a label shows once', () => {
  const joined = joinSections([[{ label: 'Copy' }], [], [false], [{ label: 'Copy code' }], [{ label: 'Copy' }, { label: 'Quote in reply' }]]);
  assert.deepEqual(labels(dedupeLabels(joined)), ['Copy', '—', 'Copy code', '—', 'Quote in reply']);
});

test('a menu opens down-right of the pointer and flips or pins to stay on screen', () => {
  const viewport = { width: 1000, height: 700 }, size = { width: 220, height: 300 };
  assert.deepEqual(placeMenu({ x: 100, y: 100 }, size, viewport), { left: 100, top: 100 });
  // Near the right and bottom edges: it opens left and up of the pointer.
  assert.deepEqual(placeMenu({ x: 950, y: 650 }, size, viewport), { left: 730, top: 350 });
  // Taller than the space either way: pinned inside the margin, never off screen.
  const tall = placeMenu({ x: 500, y: 350 }, { width: 220, height: 650 }, viewport);
  assert.equal(tall.top, 8 + (700 - 16 - 650));
  const huge = placeMenu({ x: 10, y: 10 }, { width: 1200, height: 900 }, viewport);
  assert.deepEqual(huge, { left: 8, top: 8 });
  for (const at of [{ x: 0, y: 0 }, { x: 999, y: 699 }, { x: 500, y: 699 }]) {
    const place = placeMenu(at, size, viewport);
    assert.ok(place.left >= 8 && place.left + size.width <= 992 && place.top >= 8 && place.top + size.height <= 692, JSON.stringify(at));
  }
});

test('a submenu opens beside its item, on the left when the right has no room', () => {
  const viewport = { width: 1000, height: 700 }, size = { width: 200, height: 120 };
  assert.deepEqual(placeSubmenu({ left: 100, right: 300, top: 50, bottom: 78 }, size, viewport), { left: 298, top: 45 });
  assert.deepEqual(placeSubmenu({ left: 700, right: 900, top: 50, bottom: 78 }, size, viewport), { left: 502, top: 45 });
  assert.equal(placeSubmenu({ left: 100, right: 300, top: 660, bottom: 688 }, size, viewport).top, 700 - 8 - 120);
});

test('arrows skip separators and disabled items and wrap around', () => {
  const entries = normalizeMenu([{ label: 'Open', disabled: true }, { label: 'Copy' }, 'separator', { label: 'Cut', disabled: 'Read only' }, { label: 'Close' }]);
  assert.equal(firstEnabled(entries), 1);
  assert.equal(lastEnabled(entries), 4);
  assert.equal(stepFocus(entries, 1, 1), 4);
  assert.equal(stepFocus(entries, 4, 1), 1);
  assert.equal(stepFocus(entries, 1, -1), 4);
  assert.equal(stepFocus(normalizeMenu([{ label: 'Only', disabled: true }]), -1, 1), -1);
});

test('typing jumps to the matching item; repeating a letter cycles', () => {
  const entries = normalizeMenu([{ label: 'Copy path' }, { label: 'Copy relative path' }, { label: 'Close' }, { label: 'Close others', disabled: true }, { label: 'Reveal in Files' }]);
  assert.equal(typeahead(entries, 'r', -1), 4);
  assert.equal(typeahead(entries, 'c', -1), 0);
  assert.equal(typeahead(entries, 'c', 0), 1);
  assert.equal(typeahead(entries, 'cc', 1), 2);
  assert.equal(typeahead(entries, 'copy r', 0), 1);
  assert.equal(typeahead(entries, 'close o', 0), -1, 'a disabled item is not chosen');
  assert.equal(typeahead(entries, 'x', 0), -1);
});

test('quoting, fencing and absolute paths', () => {
  assert.equal(quoteText('first\n\nsecond\n'), '> first\n>\n> second\n\n');
  assert.equal(fencedCode('a\n', 'ts'), '```ts\na\n```');
  assert.equal(fencedCode('x\n```\ny'), '````\nx\n```\ny\n````');
  assert.equal(absolutePath('/w/alpha/', 'api/src/main.go'), '/w/alpha/api/src/main.go');
  assert.equal(absolutePath('/w/alpha', '.'), '/w/alpha');
  assert.equal(absolutePath('', 'api/x'), 'api/x');
  assert.equal(absolutePath('/w', '/etc/hosts'), '/etc/hosts');
});
