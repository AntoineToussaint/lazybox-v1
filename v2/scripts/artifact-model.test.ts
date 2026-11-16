import test from 'node:test';
import assert from 'node:assert/strict';
import { agentReference, ago, diffStats, guessKind, hunks, lineDiff, slug, suggestedPath, titleFromMarkdown, updatedLine } from '../packages/surfaces/src/artifact-model.ts';

test('the title is the first heading outside code, else the first prose line', () => {
  assert.equal(titleFromMarkdown('Some intro\n\n# Migration **plan**\n\n## Steps'), 'Migration plan');
  assert.equal(titleFromMarkdown('```md\n# Not this\n```\n## Real [title](http://x)'), 'Real title');
  assert.equal(titleFromMarkdown('Datasource rollout\n===\nbody'), 'Datasource rollout');
  assert.equal(titleFromMarkdown('- Here is the plan:\n- step'), 'Here is the plan');
  assert.equal(titleFromMarkdown('   \n'), 'Untitled');
  assert.equal(titleFromMarkdown('# ' + 'x'.repeat(200)).length, 120);
});

test('a kind is suggested from the title and the shape of the text', () => {
  assert.equal(guessKind('Migration plan'), 'plan');
  assert.equal(guessKind('Security review findings'), 'report');
  assert.equal(guessKind('API design spec'), 'spec');
  assert.equal(guessKind('Meeting notes'), 'notes');
  assert.equal(guessKind('Datasource', '1. Phase one\n2. Phase two'), 'plan');
  assert.equal(guessKind('Hello'), 'other');
});

test('a line diff keeps unchanged lines and numbers both sides', () => {
  const lines = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(lines.map(l => `${l.kind[0]}${l.text}`), ['sa', 'rb', 'aB', 'sc', 'sd', 'ae']);
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
  assert.deepEqual(lines.map(l => [l.before, l.after]), [[1, 1], [2, undefined], [undefined, 2], [3, 3], [4, 4], [undefined, 5]]);
  assert.deepEqual(lineDiff('', 'x').map(l => l.kind), ['add']);
  assert.deepEqual(lineDiff('x', '').map(l => l.kind), ['remove']);
  assert.deepEqual(lineDiff('same', 'same').map(l => l.kind), ['same']);
});

test('a line diff is minimal on interleaved edits and survives its step limit', () => {
  const before = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const after = before.map((line, i) => i % 10 === 0 ? line + ' changed' : line);
  const lines = lineDiff(before.join('\n'), after.join('\n'));
  assert.deepEqual(diffStats(lines), { added: 5, removed: 5 });
  // Rebuilding both sides from the diff gives the inputs back.
  assert.equal(lines.filter(l => l.kind !== 'add').map(l => l.text).join('\n'), before.join('\n'));
  assert.equal(lines.filter(l => l.kind !== 'remove').map(l => l.text).join('\n'), after.join('\n'));
  const fallback = lineDiff('a\nb\nc', 'x\ny\nz', 1);
  assert.equal(fallback.filter(l => l.kind !== 'add').map(l => l.text).join('\n'), 'a\nb\nc');
  assert.equal(fallback.filter(l => l.kind !== 'remove').map(l => l.text).join('\n'), 'x\ny\nz');
});

test('hunks fold long unchanged runs', () => {
  const before = Array.from({ length: 30 }, (_, i) => String(i)).join('\n');
  const after = before.replace(/^15$/m, 'fifteen');
  const folded = hunks(lineDiff(before, after), 2);
  assert.equal(folded.length, 2);
  assert.equal(folded[0].hiddenBefore, 13);
  assert.deepEqual(folded[0].lines.map(l => l.text), ['13', '14', '15', 'fifteen', '16', '17']);
  assert.equal(folded[1].hiddenBefore, 12);
});

test('times, slugs and paths read naturally', () => {
  const now = Date.UTC(2026, 10, 16, 12);
  assert.equal(ago(now - 10_000, now), 'just now');
  assert.equal(ago(now - 120_000, now), '2 min ago');
  assert.equal(ago(BigInt(now - 3 * 3600_000), now), '3 h ago');
  assert.equal(ago(now - 86400_000, now), '1 day ago');
  assert.equal(ago(0, now), '');
  assert.equal(slug('Datasource: Migration Plan (v2)!'), 'datasource-migration-plan-v2');
  assert.equal(slug('§§§'), 'artifact');
  assert.equal(suggestedPath('api', 'Rollout plan'), 'api/docs/rollout-plan.md');
});

test('the list line says who changed it last', () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const artifact = { versions: [{ number: 1 }, { number: 2, author: { kind: 'file' }, source: { kind: 'file' } }], updatedAtUnixMillis: BigInt(now - 120_000) } as never;
  assert.equal(updatedLine(artifact, now), 'v2 · file changed on disk · 2 min ago');
});

test('send to agent gives a fetchable reference and an outline, not the whole text', () => {
  const content = '# Plan\n\nIntro\n\n## Step one\n```\n# not a heading\n```\n## Step two\n' + 'filler\n'.repeat(500);
  const text = agentReference({ id: 'ART1', title: 'Plan', kind: 'plan', versions: [{ number: 3 }] as never }, content);
  assert.match(text, /^Artifact “Plan” \(plan, v3\)\. Read it in full with `lazybox artifact get ART1`\./);
  assert.match(text, /Outline:\n- Plan\n {2}- Step one\n {2}- Step two\n/);
  assert.doesNotMatch(text, /not a heading|filler/);
});
