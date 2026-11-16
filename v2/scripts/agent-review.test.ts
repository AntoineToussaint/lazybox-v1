import { create } from '@bufbuild/protobuf';
import { JournalEventSchema, ReviewCommentSchema, ReviewRunSchema } from '@lazybox/protocol';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopLine, loopNeedsYou, loopActive } from '../packages/surfaces/src/review-model.ts';
import { authorLabel, countsSummary, dispositionLabel, isPending, matchesFilter, matchesQuery, parseSeverity, reviewAuthors, reviewerChoices, reviewMessage, runSummary, severityRank } from '../packages/surfaces/src/review-model.ts';
import { appendTranscript, emptyTranscript } from '../packages/surfaces/src/transcript-model.ts';
import { reviewerFor } from '../packages/surfaces/src/slash-commands.ts';

const comment = (fields: Record<string, unknown> = {}) => create(ReviewCommentSchema, { id: 'rc-1', member: 'api', path: 'src/handler.go', side: 'new', startLine: 3, endLine: 4, snippet: ['func Handle() error {', '\tlog.Print("handle")'], body: 'Return the error.', head: 'a'.repeat(40), view: 'uncommitted', disposition: 'open', freshness: 'current', currentStartLine: 3, currentEndLine: 4, ...fields });
const finding = (fields: Record<string, unknown> = {}) => comment({ id: 'rc-f', author: 'agent', authorLabel: 'Codex', authorSessionId: 'review-1', severity: 'blocker', title: 'The error is logged, not returned', reviewId: 'rv-1', disposition: 'proposed', body: 'Return it so callers can retry.', ...fields });

test('severity words are the Runner\'s: a typo is refused, never demoted', () => {
  for (const [word, want] of [['blocker', 'blocker'], [' Critical ', 'blocker'], ['HIGH', 'blocker'], ['medium', 'major'], ['low', 'minor'], ['nitpick', 'nit'], ['info', 'nit']] as const) assert.equal(parseSeverity(word), want, word);
  for (const word of ['', 'blokker', 'urgent', 'constructor', 'toString']) assert.equal(parseSeverity(word), undefined, word);
  assert.ok(severityRank('blocker') < severityRank('major') && severityRank('nit') < severityRank(''));
});

test('a finding is triaged before it is pending, and dismissed is done', () => {
  assert.equal(dispositionLabel(finding()), 'To triage');
  assert.equal(isPending(finding()), false);
  assert.ok(matchesFilter(finding(), 'proposed') && !matchesFilter(finding(), 'pending'));
  assert.equal(dispositionLabel(finding({ disposition: 'open' })), 'Accepted');
  assert.equal(dispositionLabel(comment()), 'Pending');
  assert.ok(matchesFilter(finding({ disposition: 'dismissed' }), 'settled'));
  assert.equal(authorLabel(finding()), 'from Codex');
  assert.equal(authorLabel(comment()), '');
});

test('the tray filters by state, author and severity together', () => {
  const mine = comment(), codex = finding(), claude = finding({ id: 'rc-g', authorLabel: 'Claude', severity: 'minor' });
  assert.deepEqual(reviewAuthors([codex, mine, claude]).map(a => a.label), ['Everyone', 'You', 'Claude', 'Codex']);
  assert.deepEqual(reviewAuthors([codex]).map(a => a.value), ['', 'Codex']);
  const all = [mine, codex, claude];
  const shown = (author: string, severity = '') => all.filter(c => matchesQuery(c, { filter: 'all', author, severity })).map(c => c.id);
  assert.deepEqual(shown(''), ['rc-1', 'rc-f', 'rc-g']);
  assert.deepEqual(shown('you'), ['rc-1']);
  assert.deepEqual(shown('Codex'), ['rc-f']);
  assert.deepEqual(shown('', 'minor'), ['rc-g']);
  assert.deepEqual(all.filter(c => matchesQuery(c, { filter: 'proposed', author: '', severity: '' })).map(c => c.id), ['rc-f', 'rc-g']);
});

test('accepted findings go to the author exactly as filed: severity, title, id and author', () => {
  const text = reviewMessage([finding({ disposition: 'open' }), comment({ id: 'rc-2', startLine: 9, endLine: 9, snippet: ['x'], body: 'Mine.' })]);
  assert.match(text, /^Please address these 2 review comments/);
  assert.match(text, /### 1\. api\/src\/handler\.go:3–4\n\n\*\*Blocker: The error is logged, not returned\*\* \(finding rc-f, from Codex\)\n\n_uncommitted changes on aaaaaaaa_\n\n```go\nfunc Handle\(\) error \{\n\tlog\.Print\("handle"\)\n```\n\nReturn it so callers can retry\./);
  // A person's own comment reads as before.
  assert.match(text, /### 2\. api\/src\/handler\.go:9\n\n_uncommitted changes on aaaaaaaa_\n\n```go\nx\n```\n\nMine\./);
});

test('the default reviewer is the setting\'s subscription, else the other provider than the author\'s', () => {
  const profiles = [{ id: 'claude-default', provider: 'claude' }, { id: 'codex-default', provider: 'codex' }, { id: 'codex-saved', provider: 'codex', label: 'Saved Codex' }];
  assert.deepEqual(reviewerChoices(profiles, 'claude').map(c => c.label), ['Codex', 'Claude', 'Codex · codex-default', 'Codex · Saved Codex']);
  assert.equal(reviewerChoices(profiles, 'codex')[0].label, 'Claude');
  const chosen = reviewerChoices(profiles, 'claude', 'codex-saved');
  assert.deepEqual([chosen[0].label, chosen[0].profileId, chosen.length], ['Codex · Saved Codex', 'codex-saved', 4]);
  // Only one provider signed in: it reviews (a fresh context of the same agent).
  assert.deepEqual(reviewerChoices([{ id: 'claude-default', provider: 'claude' }], 'claude').map(c => c.key), ['claude']);
  assert.deepEqual(reviewerChoices([], 'claude'), []);
  // A setting naming a subscription that is gone falls back to the other provider.
  assert.equal(reviewerChoices(profiles, 'claude', 'missing')[0].label, 'Codex');
});

test('a review in one line: running, done with its counts, failed with why', () => {
  const run = (fields: Record<string, unknown>) => create(ReviewRunSchema, { reviewerLabel: 'Codex', scopeLabel: 'Turn 3', state: 'done', ...fields });
  assert.equal(runSummary(run({ state: 'running' })), 'Codex is reviewing turn 3');
  assert.equal(runSummary(run({ state: 'running', blockers: 1 })), 'Codex is reviewing turn 3 · 1 blocker so far');
  assert.equal(runSummary(run({ blockers: 2, minors: 3 })), 'Codex reviewed turn 3 · 2 blockers, 3 minor');
  assert.equal(runSummary(run({ scopeLabel: 'PR #12' })), 'Codex reviewed PR #12 · no open findings');
  assert.equal(runSummary(run({ state: 'failed', detail: 'The reviewer conversation ended before it finished.' })), 'The reviewer conversation ended before it finished.');
  assert.equal(countsSummary({ blockers: 0, majors: 1, minors: 0, nits: 2 }), '1 major, 2 nits');
});

test('a review of the conversation is one card where it started, updated when it finishes', () => {
  let state = emptyTranscript();
  const data = (fields: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify({ review: 'rv-1', workspace: 'alpha', reviewerSession: 'review-1', reviewerLabel: 'Codex', scopeLabel: 'Turn 1', ...fields }));
  const add = (type: string, text: string, providerDataJson?: Uint8Array) => { state = appendTranscript(state, create(JournalEventSchema, { cursor: state.cursor + 1n, event: { type, text, turnId: 't', ...(providerDataJson ? { providerDataJson } : {}) } })); };
  add('operation_accepted', 'Do it');
  add('review_started', 'Codex is reviewing turn 1', data({}));
  add('message_delta', 'later');
  add('review_finished', 'Codex reviewed turn 1 · 1 blocker', data({ blockers: 1 }));
  const cards = state.messages.filter(m => m.type === 'review');
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0].review?.finished, cards[0].review?.blockers, cards[0].review?.reviewerSession, state.messages.indexOf(cards[0])], [true, 1, 'review-1', 1]);
  // An event without the review's data is not a card.
  add('review_started', 'malformed', new TextEncoder().encode('{}'));
  assert.equal(state.messages.filter(m => m.type === 'review').length, 1);
});

test('/review names its reviewer: none is the default, a provider, a subscription, or the tray', () => {
  const reviewers = [{ key: 'codex', label: 'Codex' }, { key: 'claude', label: 'Claude' }, { key: 'profile:codex-saved', label: 'Codex · Saved Codex' }];
  assert.equal(reviewerFor(reviewers, ''), reviewers[0]);
  assert.equal(reviewerFor(reviewers, ' Claude '), reviewers[1]);
  assert.equal(reviewerFor(reviewers, 'cl'), reviewers[1]);
  assert.equal(reviewerFor(reviewers, 'codex-saved'), reviewers[2]);
  assert.equal(reviewerFor(reviewers, 'tray'), 'tray');
  assert.equal(reviewerFor(reviewers, 'gemini'), undefined);
  assert.equal(reviewerFor([], ''), undefined);
});

test('a loop in one line: its round, who it waits for, and why it stopped', () => {
  const run = (fields: Record<string, unknown>) => create(ReviewRunSchema, { reviewerLabel: 'Codex', sourceLabel: 'Claude', scopeLabel: 'Turn 3', loop: 'ask', round: 1, maxRounds: 3, phase: 'reviewing', ...fields });
  assert.equal(loopLine(run({})), 'Round 1 of 3 · reviewing');
  assert.equal(loopLine(run({ round: 2 })), 'Round 2 of 3 · re-reviewing the fix');
  assert.equal(loopLine(run({ phase: 'triage' })), 'Round 1 of 3 · waiting for you to send findings');
  assert.equal(loopLine(run({ phase: 'triage', loop: 'auto' })), 'Round 1 of 3 · sending findings');
  assert.equal(loopLine(run({ phase: 'fixing', paused: true })), 'Round 1 of 3 · Claude is fixing · paused');
  assert.equal(loopLine(run({ stopReason: 'clean', round: 2, phase: 'done' })), 'Clean ✓ after 2 rounds');
  assert.equal(loopLine(run({ stopReason: 'stuck', phase: 'done' })), 'Stuck: the same blocker is still open after two fixes · needs you');
  assert.equal(loopLine(run({ stopReason: 'max_rounds', phase: 'done' })), 'Stopped at its 3 rounds with a blocker open · needs you');
  assert.equal(loopLine(run({ loop: 'off', phase: 'done' })), '');
  assert.ok(loopNeedsYou(run({ phase: 'triage' })) && loopNeedsYou(run({ stopReason: 'stuck' })) && !loopNeedsYou(run({ phase: 'triage', loop: 'auto' })) && !loopNeedsYou(run({ stopReason: 'clean' })));
  assert.ok(loopActive(run({ phase: 'fixing' })) && !loopActive(run({ stopReason: 'stopped' })) && !loopActive(run({ loop: 'off' })));
});

test('the agents asking each other, and a loop asking you, are labelled lines', () => {
  let state = emptyTranscript();
  const data = new TextEncoder().encode(JSON.stringify({ review: 'rv-1', workspace: 'alpha', reviewerSession: 'review-1' }));
  const add = (type: string, text: string) => { state = appendTranscript(state, create(JournalEventSchema, { cursor: state.cursor + 1n, event: { type, text, turnId: 't', providerDataJson: data } })); };
  add('review_exchange', 'Codex asked Claude: Should Handle log?');
  add('review_escalated', 'The blocker is still open after two fixes: decide how to proceed.');
  assert.deepEqual(state.messages.map(m => [m.type, m.text, m.review?.review]), [['exchange', 'Codex asked Claude: Should Handle log?', 'rv-1'], ['review-alert', 'The blocker is still open after two fixes: decide how to proceed.', 'rv-1']]);
});
