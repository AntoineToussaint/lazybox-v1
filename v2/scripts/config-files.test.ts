import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyboardPreset } from '../packages/surfaces/src/keyboard';
import { builtinPresets, sameTemplate } from '../packages/surfaces/src/layout-presets';
import { cycleLayouts, defaultKeys, keysEdits, keysFromFile, layoutFileName, layoutNameOf, layoutsFromFiles, layoutYaml, looksLikeLayoutYaml, notificationsFromFile, settingsEdits, yamlString, type ConfigDoc, type KeysValue } from '../packages/surfaces/src/config-files';
import { defaultNotificationPreferences } from '../packages/surfaces/src/attention';
import { readLayout } from './fixtures/config-fake.mjs';

const file = (bindings: KeysValue['bindings'], extra: Partial<KeysValue> = {}): KeysValue => ({ preset: 'vim', bindings, menu: [], vim: { messageBox: false, fileEditor: false }, ...extra });

test('keys.yaml → keymap: the preset, the file over it, Mod+ resolved per platform', () => {
  const keys = file([{ action: 'palette.open', keys: ['Mod+y', '] ] p'], section: 'global', line: 3 }, { action: 'files.find', keys: [], section: 'global', line: 4 }], { vim: { messageBox: true, fileEditor: false }, menu: [{ key: 'f', label: 'Fix', snippet: 'fix', mode: 'insert', line: 9 }] });
  const mac = keysFromFile(keys, true), pc = keysFromFile(keys, false);
  assert.equal(mac.problem, '');
  assert.equal(mac.map['palette.open'], 'Meta+y or ] ] p');
  assert.equal(pc.map['palette.open'], 'Ctrl+y or ] ] p');
  assert.equal(mac.map['files.find'], '', '[] is no shortcut');
  assert.equal(mac.map['inbox.open'], keyboardPreset('vim', true)['inbox.open'], 'an action left out keeps its preset key');
  assert.deepEqual(mac.menu, [{ key: 'f', label: 'Fix', snippet: 'fix', mode: 'insert' }]);
  assert.deepEqual(mac.vim, { composer: true, editor: false });
  assert.equal(keysFromFile(file([], { preset: 'tmux' }), true).map['snippets.open'], 'Ctrl+b s');
  // The reset chord cannot be taken, whatever the file says.
  assert.equal(keysFromFile(file([{ action: 'layout.reset-all', keys: ['Mod+r'], section: 'global', line: 2 }]), true).map['layout.reset-all'], 'Ctrl+Alt+Shift+Escape');
});

test('keymap → keys.yaml edits: only what differs from the preset, ⌘ written Mod+, and back again', () => {
  const map = { ...keyboardPreset('vim', true), 'palette.open': 'Meta+y or ] ] p', 'inbox.open': '' };
  const edits = keysEdits({ map, menu: [], vim: { composer: true, editor: false } }, undefined, true);
  assert.deepEqual(edits, [
    { path: ['keys', 'global', 'palette.open'], json: JSON.stringify(['Mod+y', '] ] p']) },
    { path: ['keys', 'global', 'inbox.open'], json: '[]' },
    { path: ['vim', 'message-box'], json: 'true' },
  ]);
  // Round trip: the file those edits make gives the same keymap back, on either platform's reading.
  const written = file([{ action: 'palette.open', keys: ['Mod+y', '] ] p'], section: 'global', line: 1 }, { action: 'inbox.open', keys: [], section: 'global', line: 2 }], { vim: { messageBox: true, fileEditor: false } });
  assert.deepEqual(keysFromFile(written, true).map, { ...map });
  assert.deepEqual(keysEdits({ map, menu: [], vim: { composer: true, editor: false } }, written, true), [], 'nothing to write when the file already says it');
  // Back to the preset key: the line goes.
  assert.deepEqual(keysEdits({ map: keyboardPreset('vim', true), menu: [], vim: { composer: true, editor: false } }, written, true), [
    { path: ['keys', 'global', 'palette.open'], json: '' }, { path: ['keys', 'global', 'inbox.open'], json: '' },
  ]);
  // A binding filed under the wrong section is moved where it belongs.
  const misplaced = file([{ action: 'chat.send', keys: ['Mod+Enter'], section: 'navigation', line: 4 }]);
  assert.deepEqual(keysEdits({ map: { ...keyboardPreset('vim', true), 'chat.send': 'Meta+Enter' }, menu: [], vim: { composer: false, editor: false } }, misplaced, true), [
    { path: ['keys', 'navigation', 'chat.send'], json: '' }, { path: ['keys', 'agent', 'chat.send'], json: JSON.stringify('Mod+Enter') },
  ]);
  // A preset picked in Settings is recorded; the menu is written whole.
  const menu = [{ key: 'f', label: 'Fix', snippet: 'fix', mode: 'send' as const }];
  assert.deepEqual(keysEdits({ map: keyboardPreset('tmux', true), menu, vim: { composer: false, editor: false }, preset: 'tmux' }, file([]), true), [
    { path: ['preset'], json: '"tmux"' }, { path: ['leader-menu'], json: JSON.stringify(menu) },
  ]);
  assert.equal(defaultKeys({ map: keyboardPreset('vim', true), menu: [], vim: { composer: false, editor: false } }, true), true);
  assert.equal(defaultKeys({ map, menu: [], vim: { composer: false, editor: false } }, true), false);
});

test('settings.yaml ↔ notification preferences', () => {
  assert.deepEqual(notificationsFromFile({ notifications: { review: true } }), { ...defaultNotificationPreferences, review: true });
  assert.deepEqual(settingsEdits({ ...defaultNotificationPreferences, review: true, soundNeedsYou: false }, undefined), [
    { path: ['notifications', 'review'], json: 'true' }, { path: ['notifications', 'sound-needs-you'], json: 'false' },
  ]);
  assert.deepEqual(settingsEdits({ ...defaultNotificationPreferences, review: true }, { notifications: { review: true } }), []);
});

test('a layout as YAML reads back as the same layout, for every preset', () => {
  for (const preset of builtinPresets) {
    const text = layoutYaml(preset);
    assert.ok(text.startsWith('# yaml-language-server: $schema=../layout.schema.json\n'), preset.id);
    const { value, issues } = readLayout(text) as { value?: { name: string; layout: never }; issues: unknown[] };
    assert.deepEqual(issues, [], preset.id);
    assert.equal(value!.name, preset.name);
    assert.ok(sameTemplate(value!.layout, preset.layout), preset.id);
  }
  // The exact text the Runner's parser is tested against (internal/power: TestLayoutTheAppWrites).
  const review = builtinPresets.find(p => p.id === 'review')!;
  assert.equal(layoutYaml(review), readFileSync(new URL('../services/runner/code/internal/power/testdata/review-layout.yaml', import.meta.url), 'utf8'));
  assert.equal(yamlString('Chat + Changes'), 'Chat + Changes');
  assert.equal(yamlString('true'), '"true"');
  assert.equal(yamlString('a: b'), '"a: b"');
});

test('layout files: names, the cycle, the palette paste', () => {
  assert.equal(layoutFileName('Review wide!', ['layouts/review-wide']), 'layouts/review-wide-2');
  assert.equal(layoutFileName('   ', []), 'layouts/layout');
  const docs: ConfigDoc[] = [
    { name: 'layouts/wide', kind: 'layout', path: '/c/layouts/wide.yaml', exists: true, error: '', stale: false, schemaPath: '', issues: [], revision: 1, loadedAt: 0, value: { name: 'Wide', description: '', layout: { type: 'group', kinds: ['chat'] } } },
    { name: 'layouts/broken', kind: 'layout', path: '/c/layouts/broken.yaml', exists: true, error: 'the layout has errors', stale: false, schemaPath: '', issues: [{ path: 'layout', line: 3, message: 'no panel', severity: 'error' }], revision: 1, loadedAt: 0 },
  ];
  const files = layoutsFromFiles(docs);
  assert.deepEqual(files.map(f => [f.id, f.name, f.file]), [['file:wide', 'Wide', 'layouts/wide']]);
  assert.deepEqual(cycleLayouts(files).map(l => l.id), [...builtinPresets.map(p => p.id), 'file:wide']);
  assert.equal(looksLikeLayoutYaml(layoutYaml(builtinPresets[0])), true);
  assert.equal(looksLikeLayoutYaml('layout panels'), false);
  assert.equal(layoutNameOf('# x\nname: "Review wide"\nlayout:\n'), 'Review wide');
});
