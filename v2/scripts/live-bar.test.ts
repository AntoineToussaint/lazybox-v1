import { create } from '@bufbuild/protobuf';
import { CommandStatusSchema, JournalEventSchema, type JournalEvent } from '@lazybox/protocol';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandParts, outputLines, rootStep, runningCommand, stepDetail } from '../packages/surfaces/src/live-step.ts';

let cursor = 0n;
const record = (type: string, data?: unknown, extra: Record<string, string> = {}): JournalEvent => create(JournalEventSchema, {
  cursor: ++cursor, capturedAt: new Date(1_000_000 + Number(cursor)).toISOString(),
  event: { type, ...extra, providerDataJson: data === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(data)) },
});
const call = (id: string, name: string, status: string, input?: unknown) => record('tool_activity', { type: 'tool_call', id, name, status, input });

test('the step is the main agent\'s call in progress, not a finished one, a sub-agent\'s, or a spawn', () => {
  const events = [record('turn_started'), call('a', 'Read', 'running', { file_path: 'x' }), call('a', 'Read', 'completed'), call('b', 'Bash', 'running', { command: 'cd services/front-door && pnpm run check' }),
    call('t', 'Task', 'running', { description: 'Review' }), record('tool_activity', { type: 'tool_call', id: 'c', name: 'Grep', status: 'running' }, { agentId: 'claude-tool:t' })];
  const step = rootStep(events);
  assert.equal(step?.id, 'b');
  assert.deepEqual(stepDetail(step!), { code: 'pnpm run check', where: 'services/front-door', full: 'cd services/front-door && pnpm run check' });
  assert.equal(rootStep([...events, call('b', 'Bash', 'completed')]), undefined, 'a recorded result ends the step');
  assert.equal(rootStep([...events, record('activity', undefined, { status: 'thinking' })]), undefined, 'thinking is not a step');
  assert.equal(rootStep([...events, record('turn_ended')]), undefined);
});

test('a step says its command, or what it does in words', () => {
  assert.deepEqual(stepDetail({ id: 'x', name: 'mcp__lazybox__command', input: { action: 'start', argv: ['go', 'test', './...'] } }), { code: 'go test ./...', full: 'go test ./...', where: undefined });
  assert.deepEqual(stepDetail({ id: 'x', name: 'mcp__lazybox__command', input: { action: 'wait', id: 'c1' } }), { words: 'Waiting for its command' });
  assert.deepEqual(stepDetail({ id: 'x', name: 'Read', input: { file_path: 'src/app.ts' } }), { words: 'Reading src/app.ts' });
  assert.deepEqual(commandParts('export A=1\nmake test'), { code: 'export A=1 …', where: undefined });
  assert.deepEqual(commandParts('cd "my dir"; npm test'), { code: 'npm test', where: 'my dir' });
});

test('the running managed command is this conversation\'s own, newest first', () => {
  const command = (id: string, done: boolean, sessionId = 's', origin = '') => create(CommandStatusSchema, { id, done, sessionId, origin });
  assert.equal(runningCommand([command('a', false), command('b', true), command('c', false)], 's')?.id, 'c');
  assert.equal(runningCommand([command('a', false, 'other'), command('w', false, 's', 'action')], 's'), undefined, 'workspace runs and other conversations are not this turn\'s');
});

test('output reads as lines: colour codes gone, redraws resolved', () => {
  assert.deepEqual(outputLines('\x1b[32mok\x1b[0m one\nprogress 10%\rprogress 100%\nlast\n\n', 2), ['progress 100%', 'last']);
});
