import { create } from '@bufbuild/protobuf';
import { JournalEventSchema, type JournalEvent } from '@lazybox/protocol';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTranscript, foldTranscript, type Transcript } from '../packages/surfaces/src/transcript-model.ts';
import { describeGroup, describeTool } from '../packages/surfaces/src/tool-lines.ts';
import { actionLabel, agentElapsed, ancestry, backgroundCommands, commandTitle, currentAction, mergedStatus, resultPreview, stepRows, subagentLabel, subagentTree, tokenLabel, toolTotal, type Subagent } from '../packages/surfaces/src/subagent-model.ts';

let cursor = 0n;
const T0 = Date.parse('2026-11-16T10:00:00Z');
type Init = { type: string; agentId?: string; parentAgentId?: string; nativeId?: string; name?: string; agentKind?: string; status?: string; text?: string; turnId?: string; data?: unknown };
const record = (at: number, { data, ...event }: Init): JournalEvent => create(JournalEventSchema, {
  cursor: ++cursor, capturedAt: new Date(T0 + at).toISOString(),
  event: { ...event, providerDataJson: data === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(data)) },
});
const fold = (state: Transcript, ...records: JournalEvent[]) => foldTranscript(state, records);
const call = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({ type: 'tool_call', id, name, status, ...extra });

/** What the Claude worker journals for a main agent that delegates to one sub-agent. */
function claudeRun() {
  cursor = 0n;
  const child = 'claude-tool:toolu_1';
  let t = emptyTranscript();
  t = fold(t,
    record(0, { type: 'operation_accepted', text: 'Find the flaky test' }),
    record(10, { type: 'message_delta', text: 'I will ask an explorer.' }),
    record(20, { type: 'tool_activity', data: call('toolu_1', 'Task', 'running', { input: { description: 'Find flaky tests', prompt: 'Look through the test suite.\nReport the flaky ones.', subagent_type: 'Explore' } }) }),
    record(30, { type: 'agent_status', agentId: child, parentAgentId: 'root', nativeId: 'task-1', status: 'running', name: 'Find flaky tests', agentKind: 'local_agent', data: { toolUseId: 'toolu_1', subagentType: 'Explore', prompt: 'Look through the test suite.\nReport the flaky ones.' } }),
  );
  return { t, child };
}

test('a sub-agent card sits where its parent spawned it, with its task and type', () => {
  const { t, child } = claudeRun();
  assert.deepEqual(t.messages.map(m => m.type), ['operation_accepted', 'message_delta', 'subagent']);
  assert.equal(t.messages[2].agentId, child);
  const agent = t.subagents.byId[child];
  assert.equal(agent.name, 'Find flaky tests');
  assert.equal(agent.type, 'Explore');
  assert.equal(agent.nativeId, 'task-1');
  assert.equal(agent.status, 'running');
  assert.match(agent.prompt, /Report the flaky ones/);
  assert.equal(agent.anchor, `subagent:${child}`);
  // The main agent's next words come after the card, as a new message.
  const after = fold(t, record(40, { type: 'message_delta', text: 'Meanwhile…' }));
  assert.deepEqual(after.messages.map(m => m.type), ['operation_accepted', 'message_delta', 'subagent', 'message_delta']);
});

test('its own tool calls and prose are attributed to it, never to the main transcript', () => {
  let { t, child } = claudeRun();
  t = fold(t,
    record(1000, { type: 'tool_activity', agentId: child, data: call('c1', 'Read', 'running', { input: { file_path: 'platform/bin/devbox' } }) }),
  );
  assert.equal(currentAction(t.subagents.byId[child])?.text, 'Reading platform/bin/devbox');
  assert.equal(currentAction(t.subagents.byId[child])?.since, T0 + 1000);
  t = fold(t,
    record(1500, { type: 'tool_activity', agentId: child, data: call('c1', undefined as never, 'completed', { output: 'file body' }) }),
    record(1600, { type: 'message_delta', agentId: child, parentAgentId: 'root', text: 'Two tests ' }),
    record(1700, { type: 'message_delta', agentId: child, parentAgentId: 'root', text: 'look flaky.' }),
    record(1800, { type: 'tool_activity', agentId: child, data: call('c2', 'Bash', 'running', { input: { command: 'go test ./... -run TestLogin -count 20', description: 'Run the login test' } }) }),
  );
  const agent = t.subagents.byId[child];
  assert.deepEqual(agent.items.map(i => i.kind), ['tool', 'message', 'tool']);
  assert.equal(agent.items[1].kind === 'message' && agent.items[1].text, 'Two tests look flaky.');
  assert.equal(agent.items[0].kind === 'tool' && agent.items[0].call.status, 'Completed');
  assert.equal(agent.toolCount, 2);
  assert.equal(currentAction(agent)?.text, 'Running go test ./... -run TestLogin -count 20');
  assert.ok(!t.messages.some(m => m.text.includes('look flaky')), 'a sub-agent\'s prose stays out of the main transcript');
});

test('progress, tokens and the result it hands back', () => {
  let { t, child } = claudeRun();
  t = fold(t, record(5000, { type: 'agent_status', agentId: child, status: 'running', data: { toolUseId: 'toolu_1', usage: { totalTokens: 48_200, toolUses: 14, durationMs: 4900 }, summary: 'Analyzing the login test' } }));
  let agent = t.subagents.byId[child];
  assert.equal(agent.tokens, 48_200);
  assert.equal(toolTotal(agent), 14);
  assert.equal(agent.progress, 'Analyzing the login test');
  assert.equal(agentElapsed(agent, T0 + 65_020), 65_000, 'it runs from the call that spawned it');
  t = fold(t,
    record(70_000, { type: 'tool_activity', data: { type: 'tool_call', id: 'toolu_1', status: 'completed', output: [{ type: 'text', text: '## Findings\n- TestLogin races on the clock.' }, { type: 'text', text: 'agentId: a1b2c3 (use to resume)' }] } }),
    record(70_010, { type: 'agent_status', agentId: child, status: 'done', data: { toolUseId: 'toolu_1', summary: 'Found one flaky test', usage: { totalTokens: 61_000, toolUses: 23, durationMs: 69_900 } } }),
  );
  agent = t.subagents.byId[child];
  assert.equal(agent.status, 'done');
  assert.equal(agent.result, '## Findings\n- TestLogin races on the clock.');
  assert.equal(resultPreview(agent.result), 'Findings · TestLogin races on the clock.');
  assert.equal(agent.summary, 'Found one flaky test');
  assert.equal(agent.progress, '');
  assert.equal(agentElapsed(agent, T0 + 999_999), 69_900, 'a finished sub-agent reports the provider\'s duration');
  assert.equal(currentAction(agent), undefined);
});

test('a nested sub-agent lives in its parent\'s timeline, not as a second card', () => {
  let { t, child } = claudeRun();
  const grandchild = 'claude-tool:toolu_2';
  t = fold(t,
    record(2000, { type: 'tool_activity', agentId: child, data: call('toolu_2', 'Task', 'running', { input: { description: 'Read CI logs', prompt: 'Read the logs', subagent_type: 'general-purpose' } }) }),
    record(2100, { type: 'agent_status', agentId: grandchild, parentAgentId: child, nativeId: 'task-2', status: 'running', name: 'Read CI logs', data: { toolUseId: 'toolu_2' } }),
    record(2200, { type: 'tool_activity', agentId: grandchild, data: call('g1', 'WebFetch', 'running', { input: { url: 'https://ci.example.com/run/42' } }) }),
  );
  assert.equal(t.messages.filter(m => m.type === 'subagent').length, 1);
  const parent = t.subagents.byId[child], nested = t.subagents.byId[grandchild];
  assert.deepEqual(parent.children, [grandchild]);
  assert.equal(parent.items.at(-1)?.kind, 'agent');
  assert.equal(nested.depth, 1);
  assert.equal(nested.anchor, '');
  assert.equal(currentAction(nested)?.text, 'Fetching ci.example.com/run/42');
  assert.deepEqual(subagentTree(t.subagents).map(n => [n.agent.id, n.depth]), [[child, 0], [grandchild, 1]]);
  assert.deepEqual(ancestry(t.subagents, grandchild), [child, grandchild]);
});

test('a failed sub-agent says why; an ended session stops the rest', () => {
  let { t, child } = claudeRun();
  t = fold(t,
    record(3000, { type: 'tool_activity', agentId: child, data: call('c9', 'Bash', 'running', { input: { command: 'make test' } }) }),
    record(3100, { type: 'agent_status', agentId: child, status: 'failed', data: { toolUseId: 'toolu_1', error: 'Tool budget exceeded' } }),
  );
  const failed = t.subagents.byId[child];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Tool budget exceeded');
  assert.equal(failed.items[0].kind === 'tool' && failed.items[0].call.status, 'Result not reported', 'a missing result is never inferred to be success');
  const other = 'claude-tool:toolu_3';
  t = fold(t,
    record(4000, { type: 'agent_status', agentId: other, status: 'running', name: 'Second' }),
    record(5000, { type: 'session_closed' }),
  );
  assert.equal(t.subagents.byId[other].status, 'stopped');
  assert.equal(t.subagents.byId[child].status, 'failed');
});

test('the Runner\'s word that a sub-agent ended wins over a journal that still says running', () => {
  const { t, child } = claudeRun();
  const agent = t.subagents.byId[child];
  assert.equal(mergedStatus(agent, { [child]: 'stopped' }), 'stopped');
  assert.equal(mergedStatus(agent, { [child]: 'running' }), 'running');
  assert.equal(mergedStatus(agent, {}), 'running');
});

test('Codex sub-threads get a card from their status and keep their own messages', () => {
  cursor = 0n;
  const thread = 'codex:thread-b';
  let t = fold(emptyTranscript(),
    record(0, { type: 'operation_accepted', text: 'Review the change' }),
    record(10, { type: 'agent_status', agentId: thread, parentAgentId: 'root', nativeId: 'thread-b', agentKind: 'agent', status: 'running', name: 'Review the Go side', data: { toolUseId: 'item-7', prompt: 'Review the Go side' } }),
    record(20, { type: 'turn_started', agentId: thread, parentAgentId: 'root', turnId: 'tb1' }),
    record(30, { type: 'tool_activity', agentId: thread, data: call('cmd-1', 'Shell command', 'running', { input: ['go', 'vet', './...'] }) }),
    record(40, { type: 'message_delta', agentId: thread, text: 'Looks fine.' }),
  );
  const agent = t.subagents.byId[thread];
  assert.equal(t.messages.at(-1)?.agentId, thread);
  assert.equal(agent.type, '', 'a generic agent kind is no type');
  assert.equal(agent.items.length, 2);
  t = fold(t, record(50, { type: 'turn_ended', agentId: thread, status: 'completed' }));
  assert.equal(t.subagents.byId[thread].status, 'done');
});

test('a fold only replaces the sub-agents it touched', () => {
  let { t, child } = claudeRun();
  t = fold(t, record(100, { type: 'agent_status', agentId: 'claude-tool:other', status: 'running', name: 'Other' }));
  const before = t.subagents.byId[child], otherBefore = t.subagents.byId['claude-tool:other'];
  const next = fold(t, record(200, { type: 'message_delta', agentId: 'claude-tool:other', text: 'hi' }));
  assert.equal(next.subagents.byId[child], before, 'an untouched card keeps its identity, so it does not re-render');
  assert.notEqual(next.subagents.byId['claude-tool:other'], otherBefore);
  assert.equal(otherBefore.items.length, 0, 'the previous state is never mutated');
  // Usage reports do not touch a card.
  const quiet = fold(next, record(300, { type: 'usage', agentId: child, data: { usage: { input_tokens: 1 } } }));
  assert.equal(quiet.subagents, next.subagents);
});

test('a long run keeps a bounded timeline', () => {
  let { t, child } = claudeRun();
  const records: JournalEvent[] = [];
  for (let i = 0; i < 450; i++) records.push(record(100 + i, { type: 'tool_activity', agentId: child, data: call(`r${i}`, 'Grep', 'completed', { input: { pattern: `p${i}` }, output: 'x'.repeat(20_000) }) }));
  t = foldTranscript(t, records);
  const agent = t.subagents.byId[child];
  assert.equal(agent.items.length, 400);
  assert.equal(agent.dropped, 50);
  assert.equal(agent.toolCount, 450);
  const output = agent.items[0].kind === 'tool' ? agent.items[0].call.output as string : '';
  assert.ok(output.length < 9000, 'large outputs keep a preview only');
});

test('actions read as a person says them', () => {
  assert.equal(actionLabel('Read', { file_path: 'src/main.go' }), 'Reading src/main.go');
  assert.equal(actionLabel('Grep', { pattern: 'appendTranscript', path: 'packages' }), 'Searching for “appendTranscript” in packages');
  assert.equal(actionLabel('Glob', { pattern: '**/*.test.ts' }), 'Finding **/*.test.ts');
  assert.equal(actionLabel('Edit', { file_path: 'a/very/long/path/that/goes/on/and/on/into/the/repository/tree/file.ts' }), 'Editing …/goes/on/and/on/into/the/repository/tree/file.ts');
  assert.equal(actionLabel('WebSearch', { query: 'claude agent sdk' }), 'Searching the web for “claude agent sdk”');
  assert.equal(actionLabel('Task', { description: 'Check CI' }), 'Delegating · Check CI');
  assert.equal(actionLabel('mcp__lazybox__command', { action: 'start', argv: ['make', 'test'] }), 'Running make test');
  assert.equal(actionLabel('mcp__github__get_issue', {}), 'Using github · get issue');
  assert.equal(tokenLabel(48_200), '48k tokens');
  assert.equal(tokenLabel(1_500), '1.5k tokens');
});

test('the Runner\'s attempt prefix joins the card made from the spawning call', () => {
  cursor = 0n;
  const real = 'attempt-2:claude-tool:toolu_9';
  const t = fold(emptyTranscript(),
    record(0, { type: 'tool_activity', data: call('toolu_9', 'Agent', 'running', { input: { description: 'Check docs', prompt: 'Check the docs' } }) }),
    record(10, { type: 'tool_activity', agentId: real, parentAgentId: 'root', data: call('x1', 'Read', 'running', { input: { file_path: 'README.md' } }) }),
    record(20, { type: 'agent_status', agentId: real, parentAgentId: 'root', nativeId: 'task-9', status: 'running', name: 'Check docs', data: { toolUseId: 'toolu_9' } }),
  );
  assert.equal(t.messages.filter(m => m.type === 'subagent').length, 1);
  const agent = t.subagents.byId['claude-tool:toolu_9'];
  assert.equal(agent.runnerId, real, 'stopping names the id the Runner knows');
  assert.equal(agent.toolCount, 1);
  assert.equal(agent.nativeId, 'task-9');
  assert.equal(mergedStatus(agent, { [real]: 'stopped' }), 'stopped');
});

test('a background command is not a sub-agent: no card, a short name, the output the agent read', () => {
  cursor = 0n;
  const script = 'cd /work/repo && source .venv/bin/activate\n# run the MCP tests\nPYTHONPATH=src uv run pytest tests/test_mcp.py -x -q 2>&1 | tail -50';
  let t = fold(emptyTranscript(),
    record(0, { type: 'tool_activity', data: call('toolu_bg', 'Bash', 'running', { input: { command: script, run_in_background: true } }) }),
    record(10, { type: 'agent_status', agentId: 'claude-tool:toolu_bg', parentAgentId: 'root', nativeId: 'bash_7', status: 'running', name: script, agentKind: 'local_bash', data: { toolUseId: 'toolu_bg', taskType: 'local_bash' } }),
    record(20, { type: 'tool_activity', data: call('toolu_read', 'BashOutput', 'running', { input: { bash_id: 'bash_7' } }) }),
    record(30, { type: 'tool_activity', data: { type: 'tool_call', id: 'toolu_read', status: 'completed', output: '12 passed, 1 failed' } }),
  );
  assert.deepEqual(t.messages.filter(m => m.type === 'subagent'), [], 'no card in the conversation');
  const command = t.subagents.byId['claude-tool:toolu_bg'];
  assert.equal(command.kind, 'command');
  assert.equal(command.name, 'pytest tests/test_mcp.py');
  assert.equal(command.command, script);
  assert.equal(command.output, '12 passed, 1 failed');
  assert.deepEqual(subagentTree(t.subagents), []);
  assert.deepEqual(backgroundCommands(t.subagents).map(c => c.id), ['claude-tool:toolu_bg']);
  t = fold(t, record(40, { type: 'agent_status', agentId: 'claude-tool:toolu_bg', status: 'failed', data: { toolUseId: 'toolu_bg', outputFile: '/tmp/tasks/bash_7.output' } }));
  assert.equal(t.subagents.byId['claude-tool:toolu_bg'].status, 'failed');
  assert.equal(t.subagents.byId['claude-tool:toolu_bg'].outputFile, '/tmp/tasks/bash_7.output');
  assert.equal(t.subagents.byId['claude-tool:toolu_bg'].name, 'pytest tests/test_mcp.py', 'a status without a name keeps it');
});

test('background commands are named by what runs, never by the whole script', () => {
  assert.equal(commandTitle('go test ./internal/... -run TestX -count 20'), 'go test ./internal/...');
  assert.equal(commandTitle('npm run build -- --watch'), 'npm run build');
  assert.equal(commandTitle('cd v2 && make test-real'), 'make test-real');
  assert.equal(commandTitle('python -m pytest tests/test_api.py -k slow'), 'pytest tests/test_api.py');
  assert.equal(commandTitle('npx playwright test e2e/login.spec.ts'), 'playwright test');
  assert.equal(commandTitle('export FOO=1\nset -e\ntimeout 600 ./scripts/long-job.sh --all > out.log'), 'long-job.sh');
  assert.equal(commandTitle('sleep 30; curl -s http://localhost:8080/health'), 'curl http://localhost:8080/health');
  assert.ok(!commandTitle('for f in *.go; do\n  gofmt -l $f\ndone').includes('\n'));
});

/** A sub-agent with only what a test names; the rest as the fold starts it. */
const bare = (fields: Partial<Subagent>): Subagent => ({ ...fold(emptyTranscript(), record(0, { type: 'agent_status', agentId: 'claude-tool:bare', status: 'running', name: 'x' })).subagents.byId['claude-tool:bare'], name: '', ...fields });

test('a sub-agent is called by its kind and task; a placeholder is never its title', () => {
  // Claude's Agent tool input: {description, prompt, subagent_type}.
  assert.deepEqual(subagentLabel(bare({ name: 'Review the datasource diff', type: 'Explore' })), { kind: 'Explore', title: 'Review the datasource diff' });
  // A kind that says nothing is no badge.
  assert.deepEqual(subagentLabel(bare({ name: 'Survey adapters', type: 'general-purpose' })), { kind: '', title: 'Survey adapters' });
  // No description: the first line of its instructions, never the Runner's "Sub-agent".
  assert.deepEqual(subagentLabel(bare({ prompt: '\n## Review the diff in /tmp/rev.diff\nLook for regressions.', type: 'Explore' }), 'Sub-agent'), { kind: 'Explore', title: 'Review the diff in /tmp/rev.diff' });
  assert.equal(subagentLabel(bare({}), 'Check the docs').title, 'Check the docs');
  assert.deepEqual(subagentLabel(bare({ type: 'Explore' }), 'Agent'), { kind: '', title: 'Explore sub-agent' });
  assert.deepEqual(subagentLabel(bare({}), 'Sub-agent'), { kind: '', title: 'Sub-agent' });
});

test('real Claude event orders all name the card from the spawning call', () => {
  // A placeholder name in a status update does not replace the task.
  cursor = 0n;
  let t = fold(emptyTranscript(),
    record(0, { type: 'tool_activity', data: call('toolu_r', 'Agent', 'running', { input: { description: 'Review the datasource diff', prompt: 'Review /tmp/rev.diff.', subagent_type: 'Explore' } }) }),
    record(10, { type: 'agent_status', agentId: 'claude-tool:toolu_r', status: 'running', name: 'Sub-agent', data: { toolUseId: 'toolu_r' } }),
  );
  assert.equal(t.subagents.byId['claude-tool:toolu_r'].name, 'Review the datasource diff');

  // Its own events first, under the Runner's attempt prefix, then the spawning call: one card, named.
  cursor = 0n;
  const real = 'attempt-2:claude-tool:toolu_e';
  t = fold(emptyTranscript(),
    record(0, { type: 'activity', agentId: real, parentAgentId: 'root', status: 'working' }),
    record(5, { type: 'tool_activity', agentId: real, data: call('e1', 'Bash', 'running', { input: { command: 'git diff --stat', description: 'Gather diff stats' } }) }),
    record(10, { type: 'tool_activity', data: call('toolu_e', 'Agent', 'running', { input: { description: 'Review the datasource diff', prompt: 'Review it.', subagent_type: 'Explore' } }) }),
    record(20, { type: 'agent_status', agentId: real, status: 'running', data: { toolUseId: 'toolu_e' } }),
  );
  assert.equal(t.messages.filter(m => m.type === 'subagent').length, 1, 'one card');
  const agent = t.subagents.byId[real];
  assert.deepEqual(subagentLabel(agent), { kind: 'Explore', title: 'Review the datasource diff' });
  assert.equal(agent.toolCount, 1);

  // The first report of the call lacks its input (a provider that streams it); a later one carries it.
  cursor = 0n;
  t = fold(emptyTranscript(),
    record(0, { type: 'tool_activity', data: call('toolu_s', 'Task', 'running') }),
    record(5, { type: 'tool_activity', data: call('toolu_s', 'Task', 'running', { input: { description: 'Map the pipeline', prompt: 'Trace it.', subagent_type: 'Explore' } }) }),
  );
  assert.deepEqual(subagentLabel(t.subagents.byId['claude-tool:toolu_s']), { kind: 'Explore', title: 'Map the pipeline' });

  // A journal written with spaces after colons still names its spawns.
  cursor = 0n;
  const spaced = create(JournalEventSchema, { cursor: ++cursor, capturedAt: new Date(T0).toISOString(), event: { type: 'tool_activity', providerDataJson: new TextEncoder().encode(JSON.stringify(call('toolu_p', 'Agent', 'running', { input: { description: 'Spaced', prompt: 'p' } }), null, 1)) } });
  assert.equal(foldTranscript(emptyTranscript(), [spaced]).subagents.byId['claude-tool:toolu_p']?.name, 'Spaced');
});

test('a timeline reads as the chat\'s tool lines: reads grouped, a file read again counted, a failure on its own line', () => {
  cursor = 0n;
  const child = 'claude-tool:toolu_g';
  const read = (id: string, at: number, status = 'completed') => [
    record(at, { type: 'tool_activity', agentId: child, data: call(id, 'Read', 'running', { input: { file_path: '/tmp/rev.diff' } }) }),
    record(at + 1, { type: 'tool_activity', agentId: child, data: call(id, undefined as never, status) }),
  ];
  const t = fold(emptyTranscript(),
    record(0, { type: 'tool_activity', data: call('toolu_g', 'Agent', 'running', { input: { description: 'Review', prompt: 'p' } }) }),
    ...read('r1', 10), ...read('r2', 20), ...read('r3', 30),
    ...read('r4', 40, 'failed'), ...read('r5', 50, 'failed'),
    record(60, { type: 'message_delta', agentId: child, text: 'Found it.' }),
    ...read('r6', 70),
    record(80, { type: 'tool_activity', agentId: child, data: call('r7', 'Read', 'running', { input: { file_path: '/tmp/rev.diff' } }) }),
    record(90, { type: 'tool_activity', agentId: child, data: call('b1', 'Bash', 'running', { input: { command: 'git diff --stat', description: 'Gather diff stats' } }) }),
    record(91, { type: 'tool_activity', agentId: child, data: call('b1', undefined as never, 'completed', { output: ' 2 files changed' }) }),
  );
  const rows = stepRows(t.subagents.byId[child].items);
  const shape = rows.map(row => row.kind !== 'tool' ? row.kind : row.item.kind === 'call' ? `call:${row.item.entry.status}` : `${row.item.kind}:${row.item.entries.length}`);
  assert.deepEqual(shape, ['explore:3', 'call:failed', 'call:failed', 'message', 'explore:2', 'call:completed']);
  const [reads, , , , rereads, bash] = rows as Extract<typeof rows[number], { kind: 'tool' }>[];
  assert.equal(describeGroup(reads.item as never).text, 'Read /tmp/rev.diff ×3');
  assert.equal(describeGroup(rereads.item as never).text, 'Reading /tmp/rev.diff ×2', 'a run with the running call says so');
  assert.deepEqual(rereads.ids, ['r6', 'r7'], 'the running call is found in its row');
  // Under a second says nothing.
  assert.deepEqual(describeTool((bash.item as { entry: never }).entry).meta, ['exit 0']);
  assert.equal(stepRows(t.subagents.byId[child].items), rows, 'rows are computed once per timeline');
});
