import { create } from '@bufbuild/protobuf';
import { JournalEventSchema, ProfileSchema, SessionSchema, type Profile, type Session } from '@lazybox/protocol';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestChoice, failureSentence, faultSentence, limitHeadline, limitStatus, resetTime, sessionLimit, subscriptionChoices, subscriptionName, switchedLine, switchNote } from '../packages/surfaces/src/subscription-model.ts';
import { foldTranscript, emptyTranscript } from '../packages/surfaces/src/transcript-model.ts';
import { liveStatus } from '../packages/surfaces/src/live-status.ts';
import { deriveAttention } from '../packages/surfaces/src/attention.ts';

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
// 2026-11-16 12:00 local time: resets later today read as a time of day.
const noon = new Date(2026, 10, 16, 12, 0, 0).getTime();
const at = (hours: number, minutes = 0) => new Date(2026, 10, 16, hours, minutes).getTime() / 1000;
const time = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const session = (init: Partial<Session> = {}): Session => create(SessionSchema, { id: 's', status: 'failed', provider: 'claude', profileId: 'obin-2', ...init });
const profile = (id: string, label: string, availability?: Record<string, unknown>, isolation = 'environment'): Profile => create(ProfileSchema, { id, label, provider: 'claude', isolation, managed: true, availability: availability as any });
const profiles = [
  profile('obin-1', 'Obin Subscription 1', { state: 'available', windows: [{ name: 'five_hour', usedPercent: 37 }] }),
  profile('obin-2', 'Obin Subscription 2', { state: 'exhausted', resetAt: BigInt(at(18)) }),
  profile('obin-3', 'Obin Subscription 3', { state: 'exhausted', resetAt: BigInt(at(15)) }),
  profile('claude-default', '', { state: 'unknown' }, 'inherited'),
];

test('reset times read as a person says them', () => {
  assert.equal(resetTime(BigInt(at(18)), noon), time(at(18)));
  assert.equal(resetTime(at(9) + 86400, noon), `tomorrow ${time(at(9))}`);
  assert.equal(resetTime(0n, noon), '');
  assert.equal(resetTime(at(11), noon), '', 'a reset in the past is not news');
});

test('a limit is one plain sentence, never a provider token', () => {
  assert.equal(limitHeadline('Obin Subscription 2', 'exhausted', BigInt(at(18)), noon), `Obin Subscription 2 reached its limit (resets ${time(at(18))})`);
  assert.equal(limitHeadline('Obin Subscription 2', 'exhausted', 0n, noon), 'Obin Subscription 2 reached its limit');
  assert.equal(limitHeadline('Work', 'throttled', BigInt(at(12, 2)), noon), `Work is rate limited (try again at ${time(at(12, 2))})`);
  assert.equal(limitHeadline('Work', 'auth_required', 0n, noon), 'Work needs you to sign in again');
  for (const [status, text] of [['throttled', 'rate_limit'], ['provider_error', ''], ['sdk_error', 'unknown_error'], ['context_full', 'context_length_exceeded']]) {
    const sentence = failureSentence(status, text);
    assert.doesNotMatch(sentence, /^[a-z_]+$|rate_limit|provider_error|exhausted/i, `${status}/${text} → ${sentence}`);
  }
  assert.equal(failureSentence('provider_error', 'The model refused the request.'), 'The model refused the request.', 'provider prose is kept');
  assert.equal(faultSentence('provider delivery failed; reconcile before continuing'), 'A message could not be delivered to the agent. Check the conversation before sending again.');
  assert.doesNotMatch(faultSentence('provider_failure'), /provider_failure/);
});

test('only a running conversation stopped at an account limit gets the card', () => {
  assert.equal(sessionLimit(session({ fault: 'exhausted' })), 'exhausted');
  assert.equal(sessionLimit(session({ fault: 'throttled' })), 'throttled');
  assert.equal(sessionLimit(session({ fault: 'exhausted', closed: true })), '');
  assert.equal(sessionLimit(session({ fault: 'context_full' })), '', 'a full context is not fixed by another subscription');
  assert.equal(sessionLimit(session({ fault: 'provider delivery failed; reconcile before continuing' })), '');
});

test('the header says what the conversation waits for, not "Needs attention"', () => {
  const limited = session({ fault: 'exhausted', account: { state: 'exhausted', resetAt: BigInt(at(18)) } as any });
  assert.equal(limitStatus(limited, noon), `Waiting for reset ${time(at(18))}`);
  assert.deepEqual(liveStatus(limited, noon), { tone: 'waiting', label: `Waiting for reset ${time(at(18))}`, text: `Waiting for reset ${time(at(18))}` });
  assert.equal(limitStatus(session({ fault: 'exhausted', account: { state: 'exhausted' } as any }), noon), 'Limit reached');
  const switching = session({ fault: 'exhausted', status: 'switching_profile', account: { state: 'exhausted' } as any, agents: [{ id: 'root', status: 'switching_profile', phaseSinceUnixMillis: BigInt(noon - 3000) } as any] });
  assert.equal(liveStatus(switching, noon).text, 'Limit reached · switching · 3s');
  assert.equal(liveStatus(session({ status: 'switching_profile', account: { state: 'available' } as any }), noon).label, 'Switching subscription', 'a switch the person asked for is not a limit');
  assert.equal(liveStatus(session({ fault: 'provider_failure' }), noon).label, 'Needs attention');
  const inbox = deriveAttention(limited);
  assert.equal(inbox.reason, 'Limit reached');
});

test('the best other subscription is the ready one; a picker lists the rest by reset', () => {
  const choices = subscriptionChoices(profiles, 'claude', 'obin-2', noon);
  assert.deepEqual(choices.map(c => c.id), ['obin-1', 'claude-default', 'obin-3', 'obin-2']);
  assert.equal(bestChoice(choices)?.id, 'obin-1', 'known to be available first');
  assert.equal(choices.find(c => c.id === 'obin-1')?.detail, 'Available · 37% used');
  assert.equal(choices.find(c => c.id === 'obin-3')?.detail, `Limit reached · resets ${time(at(15))}`);
  assert.equal(choices.at(-1)?.current, true);
  assert.equal(subscriptionName(profiles[3], 'claude-default'), 'Claude CLI sign-in');
  const onlyLimited = subscriptionChoices(profiles.slice(1, 3), 'claude', 'obin-2', noon);
  assert.equal(bestChoice(onlyLimited), undefined, 'nothing ready: no automatic best');
  // A reset that passed makes a subscription ready again.
  assert.equal(subscriptionChoices(profiles.slice(1, 3), 'claude', 'obin-2', at(16) * 1000)[0].ready, true);
});

test('an automatic switch is one quiet line; the limit itself adds nothing to the conversation', () => {
  const names = (id: string) => subscriptionName(profiles.find(p => p.id === id), id);
  const records = [
    { cursor: 1n, event: { type: 'operation_accepted', text: 'Fix the flaky login test' } },
    { cursor: 2n, event: { type: 'failure', status: 'exhausted', text: 'rate_limit', account: { state: 'exhausted', resetAt: BigInt(at(18)) } } },
    { cursor: 3n, event: { type: 'capacity_observation', status: 'exhausted' } },
    { cursor: 4n, event: { type: 'profile_switching', status: 'exhausted' } },
    { cursor: 5n, event: { type: 'profile_changed', text: 'obin-1', status: 'checkpoint_handoff', providerDataJson: json({ from: 'obin-2', fromState: 'exhausted', resetAt: at(18), requested: false }) } },
    { cursor: 6n, event: { type: 'message_delta', text: 'Picking up where I stopped.' } },
    { cursor: 7n, event: { type: 'failure', status: 'provider_error', text: 'sdk_error' } },
  ].map(r => create(JournalEventSchema, r as any));
  const folded = foldTranscript(emptyTranscript(), records);
  assert.deepEqual(folded.messages.map(m => m.type), ['operation_accepted', 'switched', 'message_delta', 'failure']);
  const line = folded.messages[1];
  assert.equal(switchedLine(line.switched!, names, noon), `Switched to Obin Subscription 1 · Obin Subscription 2 resets at ${time(at(18))}`);
  assert.doesNotMatch(folded.messages[3].text, /sdk_error/);
  // A switch the person asked for while nothing was limited, and a retry after the reset.
  assert.equal(switchedLine(switchNote('obin-3', 'checkpoint_next_message', { from: 'obin-1', fromState: 'available' }), names, noon), 'Switched to Obin Subscription 3');
  assert.equal(switchedLine(switchNote('obin-2', 'retry_same_profile', { from: 'obin-2' }), names, noon), 'Continued on Obin Subscription 2');
  // A journal written before switches carried their origin still reads.
  assert.equal(switchedLine(switchNote('obin-1', 'checkpoint_handoff', {}), names, noon), 'Switched to Obin Subscription 1');
});
