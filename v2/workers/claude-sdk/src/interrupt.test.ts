import assert from 'node:assert/strict';
import test from 'node:test';
import { droppedOnInterrupt } from './interrupt.ts';

test('an interrupted turn does not report its diagnostic as a provider error', () => {
  assert.equal(droppedOnInterrupt({ type: 'failure', status: 'provider_error' }), true);
  assert.equal(droppedOnInterrupt({ type: 'failure', status: 'unknown' }), true);
});

test('limits, sign-in and other events survive an interrupt', () => {
  for (const status of ['exhausted', 'throttled', 'auth_required', 'billing_error']) assert.equal(droppedOnInterrupt({ type: 'failure', status }), false, status);
  assert.equal(droppedOnInterrupt({ type: 'turn_ended', status: 'failed' }), false);
  assert.equal(droppedOnInterrupt({ type: 'tool_activity' }), false);
});
