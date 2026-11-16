import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { alwaysChoices, commandPrefix, covers, decide, describeUpdates, offered } from './permissions.js';

// What CLI 2.1.325 suggested for `npm run lint --silent` in default mode.
const npmRun: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run *' }], behavior: 'allow', destination: 'localSettings' }];

test("Claude's suggestions become conversation and workspace choices, sent back as its own permission updates", () => {
  const input = { command: 'npm run lint --silent' };
  const choices = alwaysChoices('Bash', input, { suggestions: npmRun });
  assert.deepEqual(offered(choices).map(c => [c.id, c.scope, c.label]), [
    ['conversation', 'conversation', 'commands starting with `npm run`'],
    ['workspace', 'workspace', 'commands starting with `npm run`'],
  ]);
  const session = decide('Bash', input, choices, { decision: 'accept', always: 'conversation' });
  assert.deepEqual(session.result, { behavior: 'allow', updatedInput: input, updatedPermissions: [{ ...npmRun[0], destination: 'session' }], decisionClassification: 'user_permanent' });
  assert.equal(session.grant, undefined, 'Claude enforces its own rules');
  const workspace = decide('Bash', input, choices, { decision: 'accept', always: 'workspace' });
  assert.deepEqual(workspace.result.behavior === 'allow' && workspace.result.updatedPermissions, [{ ...npmRun[0], destination: 'localSettings' }]);
  assert.throws(() => decide('Bash', input, choices, { decision: 'accept', always: 'everywhere' }), /does not offer/);
});

test('a mode suggestion is remembered for the conversation only, never written to settings', () => {
  const edits: PermissionUpdate[] = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
  const choices = alwaysChoices('Edit', { file_path: '/w/a.ts' }, { suggestions: edits });
  assert.deepEqual(offered(choices).map(c => [c.id, c.label]), [['conversation', 'file edits']]);
  assert.equal(describeUpdates([{ type: 'addDirectories', directories: ['/tmp/out'], destination: 'session' }]), 'access to /tmp/out');
  assert.equal(describeUpdates([{ type: 'addRules', rules: [{ toolName: 'WebFetch', ruleContent: 'domain:docs.rs' }], behavior: 'allow', destination: 'localSettings' }]), 'fetches from docs.rs');
});

test('no always for settings changes, when Claude suppresses it, or for a command tool without a safe rule', () => {
  assert.deepEqual(alwaysChoices('mcp__lazybox_settings__update_settings', {}, { settingsTool: true, suggestions: npmRun }), []);
  assert.deepEqual(alwaysChoices('Bash', { command: 'npm run lint' }, { suggestions: npmRun, suppressAlwaysAllowRule: true }), []);
  assert.deepEqual(alwaysChoices('Bash', {}, {}), []);
  // Another tool with no suggestion: Claude's own tool-wide session rule.
  const fetch = alwaysChoices('WebSearch', { query: 'x' }, {});
  assert.deepEqual(fetch.map(c => [c.id, c.label, c.updates]), [['conversation', 'every WebSearch request', [{ type: 'addRules', rules: [{ toolName: 'WebSearch' }], behavior: 'allow', destination: 'session' }]]]);
});

test("under Lazybox's ask rule the worker keeps exact and prefix grants, and only plain commands match a prefix", () => {
  const input = { command: 'npm run lint --silent' };
  const choices = alwaysChoices('Bash', input, {});
  assert.deepEqual(offered(choices).map(c => [c.id, c.scope, c.label]), [['prefix', 'prefix', 'commands starting with `npm run`'], ['command', 'conversation', '`npm run lint --silent`']]);
  const prefix = decide('Bash', input, choices, { decision: 'accept', always: 'prefix' });
  assert.deepEqual(prefix.grant, { tool: 'Bash', prefix: ['npm', 'run'] });
  assert.equal(prefix.result.behavior === 'allow' && prefix.result.updatedPermissions, undefined);
  assert.ok(covers(prefix.grant!, 'Bash', { command: 'npm run test -- --watch' }));
  for (const command of ['npm run lint && rm -rf /', 'npm run $(evil)', 'npm  test', 'npm run lint | tee x', 'npm run lint > out']) assert.ok(!covers(prefix.grant!, 'Bash', { command }), command);
  assert.ok(!covers(prefix.grant!, 'mcp__lazybox__command', { action: 'start', argv: ['npm', 'run', 'x'] }), 'a grant is for its tool');
  const exact = decide('Bash', input, choices, { decision: 'accept', always: 'command' }).grant!;
  assert.ok(covers(exact, 'Bash', { command: ' npm run lint --silent ' }) && !covers(exact, 'Bash', { command: 'npm run lint' }));
  const managed = alwaysChoices('mcp__lazybox__command', { action: 'start', argv: ['make', 'test', 'V=1'] }, {});
  assert.deepEqual(managed.map(c => c.id), ['prefix', 'command']);
  assert.deepEqual(commandPrefix('ls -la'), ['ls']);
  assert.deepEqual(commandPrefix('git status'), ['git', 'status']);
  assert.deepEqual(commandPrefix('cat a | wc'), []);
});

test('a decline carries the person’s reason to Claude; without one it is a plain decline', () => {
  assert.deepEqual(decide('Bash', {}, [], { decision: 'decline', reason: ' use the Makefile ' }).result, { behavior: 'deny', message: 'The user declined this Bash request and said: use the Makefile', decisionClassification: 'user_reject' });
  assert.deepEqual(decide('Bash', {}, [], { decision: 'decline' }).result, { behavior: 'deny', message: 'Declined by operator', decisionClassification: 'user_reject' });
  assert.deepEqual(decide('Bash', { command: 'x' }, [], { decision: 'accept' }).result, { behavior: 'allow', updatedInput: { command: 'x' }, decisionClassification: 'user_temporary' });
});
