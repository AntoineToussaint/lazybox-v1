import { create } from '@bufbuild/protobuf';
import { CommandReportSchema } from '@lazybox/protocol';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker, formatBytes, reportSummary } from '../packages/surfaces/src/command-runs.ts';

test('a run is labelled with what its agent received, in the sizes the agent was shown', () => {
  assert.equal(reportSummary(create(CommandReportSchema, { exitCode: 1, agentBytes: 2150n, outputBytes: 1468006n, filter: 'go-test' })), 'exit 1 · agent saw 2.1 KiB of 1.4 MiB (go-test filter)');
  assert.equal(reportSummary(create(CommandReportSchema, { exitCode: 0, agentBytes: 40n, outputBytes: 12n, filter: 'passthrough' })), 'exit 0 · agent saw 40 B of 12 B (no filter)');
  assert.equal(reportSummary(create(CommandReportSchema, { exitCode: 0, agentBytes: 5000n, outputBytes: 4096n, filter: 'raw' })), 'exit 0 · agent saw 4.9 KiB of 4.0 KiB (raw output)');
  assert.equal(formatBytes(1023), '1023 B');
});

test('each command opens the console once, and commands that already existed never do', () => {
  const tracker = new RunTracker();
  assert.deepEqual(tracker.next(['old-build', 'old-server']), [], 'the first listing is the baseline');
  assert.deepEqual(tracker.next(['old-build', 'old-server']), []);
  assert.deepEqual(tracker.next(['old-build', 'run-1', 'old-server']), ['run-1']);
  assert.deepEqual(tracker.next(['old-build', 'run-1', 'old-server']), [], 'a run the user closed the console on stays closed');
  assert.deepEqual(tracker.next(['run-2', 'run-1', 'run-3']), ['run-2', 'run-3']);
});
