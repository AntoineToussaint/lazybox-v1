import test from 'node:test';
import assert from 'node:assert/strict';
import { ceilingLine, childState, defaultGrant, effectivePermission, grantOf, grantProblem, permissionChoices, profileLabel } from '../packages/surfaces/src/orchestration-model';
import { emptyTranscript, foldTranscript } from '../packages/surfaces/src/transcript-model';
import { systemEventView } from '../packages/surfaces/src/system-events';

test('a grant offers at most the conversation’s own permission; inherit counts as ask', () => {
  assert.equal(effectivePermission('inherit'), 'ask');
  assert.equal(effectivePermission(''), 'ask');
  assert.deepEqual(permissionChoices('read-only').map(c => !!c.disabled), [false, true, true]);
  assert.deepEqual(permissionChoices('yolo').map(c => !!c.disabled), [false, false, false]);
  assert.match(permissionChoices('ask')[2].disabled!, /runs at Ask; its agents cannot get more/);
});

test('a grant defaults to the conversation’s own subscriptions and says what is missing', () => {
  const draft = defaultGrant({ permission: 'yolo', profileId: 'claude-default', rotationProfileIds: ['claude-work', 'claude-default'] } as never);
  assert.deepEqual(draft, { permission: 'yolo', profileIds: ['claude-default', 'claude-work'], maxChildren: 3, budgetUsd: 0 });
  assert.equal(grantProblem(draft), undefined);
  assert.match(grantProblem({ ...draft, profileIds: [] })!, /at least one subscription/);
  assert.match(grantProblem({ ...draft, maxChildren: 40 })!, /Between 1 and 16/);
  assert.equal(ceilingLine({ ceiling: { permission: 'ask', profileIds: [], maxChildren: 3, depth: 1, budgetUsd: 20 } } as never), 'Up to 3 at once · Ask or narrower · $20 cap');
  assert.equal(profileLabel([{ id: 'codex-saved', provider: 'codex', label: 'Work' }], 'codex-saved'), 'Codex · Work');
});

test('the live grant a conversation holds, and how its agents read', () => {
  const grant = { id: 'gr', live: true, conversationId: 'orch' }, gone = { id: 'old', live: false, conversationId: 'orch' };
  const missions = [{ id: 'm', grants: [gone, grant] }] as never;
  assert.equal(grantOf(missions, 'orch')?.grant.id, 'gr');
  assert.equal(grantOf(missions, 'other'), undefined);
  const task = (status: string, gate = '') => ({ status, gate }) as never;
  const attempt = (live: string, ended = 0n, outcome = '') => ({ live, endedAtUnixMillis: ended, outcome }) as never;
  assert.deepEqual(childState(task('working'), attempt('running')), { label: 'Working', tone: 'run' });
  assert.deepEqual(childState(task('needs_you', 'reviewed'), attempt('idle')), { label: 'Reported · needs you', tone: 'wait' });
  assert.deepEqual(childState(task('needs_you'), attempt('waiting')), { label: 'Needs you', tone: 'wait' });
  assert.deepEqual(childState(task('ready'), attempt('closed', 5n, 'stopped')), { label: 'Stopped', tone: 'off' });
  assert.deepEqual(childState(task('done'), attempt('idle')), { label: 'Accepted', tone: 'done' });
});

test('the transcript shows another agent’s message as theirs, and the tree’s lines as lines', () => {
  const data = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const records = [
    { cursor: 1n, event: { type: 'operation_accepted', text: 'Do it', turnId: 't1', operationId: 'op1', providerDataJson: data({ files: [] }) } },
    { cursor: 2n, event: { type: 'operation_accepted', text: '[Lazybox] Your agent “Indexer” writes:\n\n> done', turnId: 't2', operationId: 'agent-msg_1', providerDataJson: data({ origin: { kind: 'agent_note', summary: 'Indexer: done', detail: 'your agent', from: 'Indexer', conversation: 'c1', session: 's1' } }) } },
    { cursor: 3n, event: { type: 'agent_spawned', text: 'Started “Indexer” · worker · ask · in this workspace', turnId: '', providerDataJson: data({ conversation: 'c1', session: 's1', mission: 'm' }) } },
  ] as never;
  const folded = foldTranscript(emptyTranscript(), records);
  assert.deepEqual(folded.messages.map(m => m.type), ['operation_accepted', 'operation_accepted', 'lineage']);
  assert.equal(folded.messages[0].origin, undefined, 'the person’s own message has no origin');
  assert.deepEqual(folded.messages[1].origin, { kind: 'agent_note', summary: 'Indexer: done', detail: 'your agent', copy: '', from: 'Indexer', conversation: 'c1', session: 's1' });
  const view = systemEventView(folded.messages[1].origin!, 'Claude');
  assert.equal(view.kind, 'Message from an agent');
  assert.equal(view.line, 'Indexer: done');
  assert.equal(view.sentBy, 'Indexer’s message, as Lazybox gave it to Claude');
  assert.deepEqual(folded.messages[2].lineage, { kind: 'agent_spawned', conversation: 'c1', session: 's1', mission: 'm', direction: '' });
});
