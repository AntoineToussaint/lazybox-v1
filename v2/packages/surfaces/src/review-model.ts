import type { ReviewComment, ReviewRun } from '@lazybox/protocol';

/** Inline review comments: the pure half. Parsing a diff into commentable
 * lines, turning a selection into an anchor, placing saved comments back in
 * a diff, and the one message handed to an agent. Rendering lives in
 * ReviewDiff.tsx and ReviewTray.tsx; the Runner stores and anchors. */

export type Side = 'new' | 'old';
export type DiffLine = { kind: 'line'; type: 'add' | 'del' | 'context'; text: string; oldLine?: number; newLine?: number; hunk: number };
export type DiffRow = DiffLine | { kind: 'meta' | 'hunk' | 'note'; text: string; hunk: number };
/** Which diff a comment was read in, as the Changes page knows it. */
export type ReviewView = 'uncommitted' | 'staged' | 'branch';

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A unified diff (or the Runner's "New file:" preview of an untracked file)
 * as rows, each line numbered on the side(s) it exists on. */
export function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines[0]?.startsWith('New file: ')) {
    rows.push({ kind: 'meta', text: lines[0], hunk: 0 });
    // The Runner puts one blank line between the header and the content.
    lines.slice(2).forEach((line, index) => rows.push({ kind: 'line', type: 'add', text: line, newLine: index + 1, hunk: 1 }));
    return rows;
  }
  let oldLine = 0, newLine = 0, hunk = 0;
  for (const line of lines) {
    const header = HUNK.exec(line);
    if (header) { hunk++; oldLine = Number(header[1]); newLine = Number(header[2]); rows.push({ kind: 'hunk', text: line, hunk }); continue; }
    if (!hunk) { if (line) rows.push({ kind: 'meta', text: line, hunk }); continue; }
    if (line.startsWith('\\')) { rows.push({ kind: 'note', text: line, hunk }); continue; }
    const sign = line[0], body = line.slice(1);
    if (sign === '+') rows.push({ kind: 'line', type: 'add', text: body, newLine: newLine++, hunk });
    else if (sign === '-') rows.push({ kind: 'line', type: 'del', text: body, oldLine: oldLine++, hunk });
    else if (sign === ' ' || line === '') rows.push({ kind: 'line', type: 'context', text: body, oldLine: oldLine++, newLine: newLine++, hunk });
    else { hunk = 0; rows.push({ kind: 'meta', text: line, hunk }); }
  }
  return rows;
}

export const isLine = (row: DiffRow | undefined): row is DiffLine => row?.kind === 'line';

/** What a comment on rows from..to (inclusive, any order) anchors to. A range
 * of removed lines only is on the old side; anything else is on the new side
 * and quotes the new-side lines in it. Ranges stay within one hunk. */
export type Target = { side: Side; startLine: number; endLine: number; snippet: string[]; lastRow: number };
export function selectionTarget(rows: DiffRow[], from: number, to: number): Target | undefined {
  let start = Math.min(from, to), end = Math.max(from, to);
  const first = rows[start], last = rows[end];
  if (!isLine(first) || !isLine(last)) return;
  // Clamp to the hunk the selection started in.
  const anchorHunk = rows[from]?.hunk;
  while (rows[start]?.hunk !== anchorHunk) start++;
  while (rows[end]?.hunk !== anchorHunk) end--;
  const chosen = rows.slice(start, end + 1).filter(isLine);
  if (!chosen.length) return;
  const side: Side = chosen.every(row => row.type === 'del') ? 'old' : 'new';
  const lines = chosen.filter(row => side === 'old' ? row.type === 'del' : row.type !== 'del');
  const number = (row: DiffLine) => (side === 'old' ? row.oldLine : row.newLine) as number;
  return { side, startLine: number(lines[0]), endLine: number(lines.at(-1)!), snippet: lines.map(row => row.text), lastRow: end };
}

const normalize = (line: string) => line.replace(/[ \t\r]+$/, '');

/** Where a saved comment sits in this diff: the row of its last line, found
 * by its quoted lines (the diff's new side may be the commit, the index or
 * the working tree, so numbers alone do not place it). Nearest to the line
 * the Runner reports, else to where it was made. Undefined: not in this diff. */
export function placeComment(rows: DiffRow[], comment: ReviewComment): number | undefined {
  const side: Side = comment.side === 'old' ? 'old' : 'new';
  const want = comment.snippet.map(normalize);
  if (!want.length) return;
  const hint = side === 'new' && comment.currentStartLine ? comment.currentStartLine : comment.startLine;
  const sideRows: { row: number; line: number; text: string }[] = [];
  rows.forEach((row, index) => {
    if (!isLine(row)) return;
    if (side === 'new' && row.type !== 'del') sideRows.push({ row: index, line: row.newLine!, text: normalize(row.text) });
    if (side === 'old' && row.type !== 'add') sideRows.push({ row: index, line: row.oldLine!, text: normalize(row.text) });
  });
  let best: number | undefined, distance = Infinity;
  for (let i = 0; i + want.length <= sideRows.length; i++) {
    let match = true;
    for (let k = 0; k < want.length; k++) {
      const here = sideRows[i + k];
      // Consecutive in the file, not merely adjacent in the diff.
      if (here.text !== want[k] || (k > 0 && here.line !== sideRows[i + k - 1].line + 1)) { match = false; break; }
    }
    if (!match) continue;
    const d = Math.abs(sideRows[i].line - hint);
    if (d < distance) { distance = d; best = sideRows[i + want.length - 1].row; }
  }
  return best;
}

export const short = (commit: string) => /^[0-9a-f]{12,}$/i.test(commit) ? commit.slice(0, 8) : commit;
export const lineRange = (start: number, end: number) => start === end ? `${start}` : `${start}–${end}`;
export const linesLabel = (side: string, start: number, end: number) => `${side === 'old' ? 'Removed line' : 'Line'}${start === end ? '' : 's'} ${lineRange(start, end)}`;
export const location = (c: Pick<ReviewComment, 'member' | 'path'>) => `${c.member}/${c.path}`;

/** The diff a comment was read in, in words. */
export function diffLabel(c: Pick<ReviewComment, 'view' | 'base' | 'head'>): string {
  const head = c.head ? short(c.head) : 'no commit';
  if (c.view === 'staged') return `staged changes on ${head}`;
  if (c.view === 'branch') return `branch diff ${c.base ? short(c.base) : 'workspace start'}…${head}`;
  return `uncommitted changes on ${head}`;
}

export type Freshness = 'current' | 'moved' | 'outdated' | 'unknown';
export function freshnessLabel(c: ReviewComment): string {
  switch (c.freshness) {
    case 'moved': return `Moved to line${c.currentStartLine === c.currentEndLine ? '' : 's'} ${lineRange(c.currentStartLine, c.currentEndLine)}`;
    case 'outdated': return 'Outdated';
    case 'unknown': return 'Not checked';
    default: return '';
  }
}

/** proposed: a reviewer agent's finding not triaged yet; accepting it makes
 * it open (pending, to send). dismissed: turned down, with the reason as note. */
export type Disposition = 'open' | 'sent' | 'resolved' | 'wont_fix' | 'proposed' | 'dismissed';
export function dispositionLabel(c: ReviewComment): string {
  switch (c.disposition) {
    case 'sent': return c.sentToTitle ? `Sent to “${c.sentToTitle}”` : 'Sent to the agent';
    case 'resolved': return c.resolvedBy ? `Resolved by ${short(c.resolvedBy)}` : 'Resolved';
    case 'wont_fix': return 'Won’t fix';
    case 'proposed': return 'To triage';
    case 'dismissed': return 'Dismissed';
    default: return isFinding(c) ? 'Accepted' : 'Pending';
  }
}
export const isPending = (c: ReviewComment) => c.disposition === 'open' || !c.disposition;
export const isProposed = (c: ReviewComment) => c.disposition === 'proposed';
export const isSettled = (c: ReviewComment) => c.disposition === 'resolved' || c.disposition === 'wont_fix' || c.disposition === 'dismissed';

export type TrayFilter = 'proposed' | 'pending' | 'sent' | 'settled' | 'all';
export const trayFilters: { value: TrayFilter; label: string }[] = [
  { value: 'proposed', label: 'To triage' }, { value: 'pending', label: 'Pending' }, { value: 'sent', label: 'Sent' }, { value: 'settled', label: 'Done' }, { value: 'all', label: 'All' },
];
export function matchesFilter(c: ReviewComment, filter: TrayFilter) {
  if (filter === 'proposed') return isProposed(c);
  if (filter === 'pending') return isPending(c);
  if (filter === 'sent') return c.disposition === 'sent';
  if (filter === 'settled') return isSettled(c);
  return true;
}

// ---- Agent findings ------------------------------------------------------

/** A reviewer agent's finding, as opposed to a person's comment. */
export const isFinding = (c: Pick<ReviewComment, 'author'>) => c.author === 'agent';
export type Severity = 'blocker' | 'major' | 'minor' | 'nit';
export const severities: { value: Severity; label: string }[] = [
  { value: 'blocker', label: 'Blocker' }, { value: 'major', label: 'Major' }, { value: 'minor', label: 'Minor' }, { value: 'nit', label: 'Nit' },
];
const severityWords: Record<string, Severity> = { blocker: 'blocker', blocking: 'blocker', critical: 'blocker', high: 'blocker', p0: 'blocker', major: 'major', medium: 'major', important: 'major', p1: 'major', minor: 'minor', low: 'minor', p2: 'minor', nit: 'nit', nitpick: 'nit', trivial: 'nit', info: 'nit', style: 'nit' };
/** The Runner's severity words (reviews.ParseSeverity); undefined for a word it refuses. */
export function parseSeverity(text: string): Severity | undefined { return Object.hasOwn(severityWords, text.trim().toLowerCase()) ? severityWords[text.trim().toLowerCase()] : undefined; }
export const severityLabel = (severity: string) => severities.find(s => s.value === severity)?.label || '';
export const severityRank = (severity: string) => { const i = severities.findIndex(s => s.value === severity); return i < 0 ? severities.length : i; };
/** Who wrote it, for a chip: "from Codex", or nothing for the person's own. */
export const authorLabel = (c: Pick<ReviewComment, 'author' | 'authorLabel'>) => isFinding(c) ? `from ${c.authorLabel || 'the reviewer'}` : c.author === 'github' ? `from ${c.authorLabel || 'GitHub'}` : '';

/** Authors present in a review, the person first: filter choices. */
export function reviewAuthors(comments: readonly ReviewComment[]): { value: string; label: string }[] {
  const agents = [...new Set(comments.filter(isFinding).map(c => c.authorLabel || 'Reviewer'))].sort();
  return [{ value: '', label: 'Everyone' }, ...(comments.some(c => !isFinding(c)) ? [{ value: 'you', label: 'You' }] : []), ...agents.map(label => ({ value: label, label }))];
}
export type ReviewQuery = { filter: TrayFilter; author: string; severity: string };
/** The tray's three filters together: state, who wrote it, how severe. */
export function matchesQuery(c: ReviewComment, query: ReviewQuery) {
  if (!matchesFilter(c, query.filter)) return false;
  if (query.author === 'you' && isFinding(c)) return false;
  if (query.author && query.author !== 'you' && (!isFinding(c) || (c.authorLabel || 'Reviewer') !== query.author)) return false;
  if (query.severity && c.severity !== query.severity) return false;
  return true;
}

/** Live findings of a review by severity, in words: "2 blockers, 3 minor". */
export function countsSummary(run: Pick<ReviewRun, 'blockers' | 'majors' | 'minors' | 'nits'>): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n === 1) parts.push(`1 ${one}`); else if (n > 1) parts.push(`${n} ${many}`); };
  add(run.blockers, 'blocker', 'blockers'); add(run.majors, 'major', 'major'); add(run.minors, 'minor', 'minor'); add(run.nits, 'nit', 'nits');
  return parts.length ? parts.join(', ') : 'no open findings';
}
const lowerFirst = (text: string) => text.startsWith('PR ') ? text : text.charAt(0).toLowerCase() + text.slice(1);
/** What a review did, in one line for its card: "Codex reviewed turn 3 · 2 blockers, 3 minor". */
export function runSummary(run: Pick<ReviewRun, 'state' | 'reviewerLabel' | 'scopeLabel' | 'blockers' | 'majors' | 'minors' | 'nits' | 'detail'>): string {
  const scope = lowerFirst(run.scopeLabel || 'the changes');
  if (run.state === 'running') return `${run.reviewerLabel} is reviewing ${scope}${run.blockers + run.majors + run.minors + run.nits ? ` · ${countsSummary(run)} so far` : ''}`;
  if (run.state === 'failed') return run.detail || `${run.reviewerLabel} could not review ${scope}`;
  return `${run.reviewerLabel} reviewed ${scope} · ${countsSummary(run)}`;
}

// ---- The review loop -------------------------------------------------------

type LoopRun = Pick<ReviewRun, 'loop' | 'phase' | 'round' | 'maxRounds' | 'paused' | 'stopReason' | 'detail' | 'sourceLabel'>;
const rounds = (n: number) => `${n} round${n === 1 ? '' : 's'}`;
/** Where a review's loop is, in one line; '' for a one-pass review. */
export function loopLine(run: LoopRun): string {
  switch (run.stopReason) {
    case 'clean': return `Clean ✓ after ${rounds(run.round)}`;
    case 'max_rounds': return `Stopped at its ${rounds(run.maxRounds)} with a blocker open · needs you`;
    case 'stuck': return 'Stuck: the same blocker is still open after two fixes · needs you';
    case 'error': return `Stopped: ${run.detail || 'an error'} · needs you`;
    case 'stopped': return 'You stopped the loop';
    case 'taken_over': return 'You took over';
  }
  if (!run.loop || run.loop === 'off') return '';
  const of = `Round ${run.round} of ${run.maxRounds}`, paused = run.paused ? ' · paused' : '';
  switch (run.phase) {
    case 'reviewing': return `${of} · ${run.round > 1 ? 're-reviewing the fix' : 'reviewing'}${paused}`;
    case 'triage': return `${of} · ${run.loop === 'auto' && !run.paused ? 'sending findings' : 'waiting for you to send findings'}${paused}`;
    case 'fixing': return `${of} · ${run.sourceLabel || 'the author'} is fixing${paused}`;
  }
  return '';
}
/** The loop asks the person: findings to send, or it stopped and needs a decision. */
export const loopNeedsYou = (run: LoopRun) => ['max_rounds', 'stuck', 'error'].includes(run.stopReason) || (run.phase === 'triage' && !run.stopReason && (run.loop === 'ask' || run.paused));
/** Whether the person can still steer the loop. */
export const loopActive = (run: LoopRun) => !!run.loop && run.loop !== 'off' && !run.stopReason && run.phase !== 'done' && !!run.phase;
export const loopModes: { value: string; label: string }[] = [
  { value: 'ask', label: 'Ask me between rounds' }, { value: 'auto', label: 'Send findings automatically' }, { value: 'off', label: 'One pass, no re-review' },
];

/** A reviewer to pick: a provider (its default subscription) or one subscription. */
export type ReviewerChoice = { key: string; label: string; provider: string; profileId: string };
const providerName = (provider: string) => provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider;
/**
 * Who can review: each provider with a subscription, then each subscription
 * when a provider has more than one. The default comes first: the setting's
 * subscription, else the other provider than the author's.
 */
export function reviewerChoices(profiles: readonly { id: string; provider: string; label?: string }[], authorProvider: string, settingReviewer = ''): ReviewerChoice[] {
  const providers = (['codex', 'claude'] as const).filter(provider => profiles.some(p => p.provider === provider));
  const choices: ReviewerChoice[] = providers.map(provider => ({ key: provider, label: providerName(provider), provider, profileId: '' }));
  for (const provider of providers) {
    const own = profiles.filter(p => p.provider === provider);
    if (own.length > 1) choices.push(...own.map(p => ({ key: `profile:${p.id}`, label: `${providerName(provider)} · ${p.label || p.id}`, provider, profileId: p.id })));
  }
  const configured = profiles.find(p => p.id === settingReviewer && (p.provider === 'codex' || p.provider === 'claude'));
  const preferred = configured ? choices.find(c => c.profileId === configured.id) || { key: `profile:${configured.id}`, label: `${providerName(configured.provider)} · ${configured.label || configured.id}`, provider: configured.provider, profileId: configured.id }
    : choices.find(c => c.key === (authorProvider === 'codex' ? 'claude' : 'codex')) || choices[0];
  return preferred ? [preferred, ...choices.filter(c => c.key !== preferred.key)] : choices;
}

/** Comments by file (workspace order: member, then path), each file's by line. */
export function groupByFile(comments: ReviewComment[]): { file: string; comments: ReviewComment[] }[] {
  const groups = new Map<string, ReviewComment[]>();
  for (const c of [...comments].sort((a, b) => location(a).localeCompare(location(b)) || a.startLine - b.startLine || Number(a.createdAtUnix - b.createdAtUnix))) {
    const key = location(c);
    groups.set(key, [...(groups.get(key) || []), c]);
  }
  return [...groups].map(([file, list]) => ({ file, comments: list }));
}

const languages: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', go: 'go', rs: 'rust', py: 'python', json: 'json', yaml: 'yaml', yml: 'yaml', sh: 'bash', md: 'markdown', css: 'css', html: 'html', toml: 'toml', sql: 'sql', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', c: 'c', h: 'c', cpp: 'cpp', proto: 'proto' };
export const languageOf = (path: string) => languages[path.split('.').pop()?.toLowerCase() || ''] || '';
/** A fence longer than any backtick run in the text, so quoted code cannot close it. */
const fence = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));

function where(c: ReviewComment): string {
  const file = location(c);
  const range = lineRange(c.startLine, c.endLine);
  if (c.side === 'old') return `${file} — removed line${c.startLine === c.endLine ? '' : 's'} ${range} (in the version before the change)`;
  if (c.freshness === 'moved') return `${file}:${lineRange(c.currentStartLine, c.currentEndLine)} (was line${c.startLine === c.endLine ? '' : 's'} ${range} when I commented)`;
  return `${file}:${range}`;
}

/** The single message a review becomes: every comment with its file and
 * lines, the lines quoted as they were, and the diff it was read in. The
 * person sends it; it is never sent for them. */
export function reviewMessage(comments: ReviewComment[]): string {
  const ordered = groupByFile(comments).flatMap(group => group.comments);
  const outdated = ordered.some(c => c.freshness === 'outdated');
  const parts = [
    ordered.length === 1
      ? 'Please address this review comment on the workspace’s changes. It names the file and lines, quotes them as they were when I commented, and says which diff I was reading.'
      : `Please address these ${ordered.length} review comments on the workspace’s changes. Each names the file and lines, quotes them as they were when I commented, and says which diff I was reading.`,
  ];
  if (outdated) parts.push('Comments marked outdated were made on lines that have changed since; find the same place in the current code, or tell me if it no longer applies.');
  ordered.forEach((c, index) => {
    const quoted = c.snippet.join('\n'), f = fence(quoted);
    const facts = [diffLabel(c)];
    if (c.freshness === 'outdated') facts.push('outdated: these lines have changed since');
    // A reviewer's finding goes as filed: its severity, title and id, never paraphrased.
    const finding = isFinding(c) ? [`**${severityLabel(c.severity) || 'Finding'}: ${c.title}** (finding ${c.id}, ${authorLabel(c)})`] : [];
    parts.push([`### ${index + 1}. ${where(c)}`, ...finding, `_${facts.join(' · ')}_`, `${f}${languageOf(c.path)}\n${quoted}\n${f}`, c.body.trim()].join('\n\n'));
  });
  // Findings: who filed them, and how to ask it (the Runner's FindingsMessage says the same).
  const labels = [...new Set(ordered.filter(isFinding).map(c => c.authorLabel).filter(Boolean))];
  if (labels.length) parts.push(`The findings are ${labels.join(' and ')}’s, reviewing your work. To ask about one, run \`lazybox ask reviewer "<your question>"\`; the reply comes back to you.`);
  parts.push('When you are done, say which comments you addressed and how, and which you did not and why.');
  return parts.join('\n\n');
}

/**
 * A comment as one plain line, for lists: Markdown's marks are dropped only
 * where they are marks. An underscore or asterisk inside a word is the word
 * (`CACHE_MAX_ENTRIES`, `a*b`), not emphasis.
 */
export function reviewExcerpt(body: string, limit = 140): string {
  const text = body
    .replace(/`/g, '')
    .replace(/^[ \t]{0,3}(?:>+|#{1,6})[ \t]?/gm, '')
    .replace(/(^|[^\w*_])(\*\*|__)(?=\S)([^\n]+?)(?<=\S)\2(?!\w|\.\w)/g, '$1$3')
    .replace(/(^|[^\w*])([*_])(?=[^\s*_])([^\n*_]+?)(?<=[^\s*_])\2(?![\w*]|\.\w)/g, '$1$3')
    .replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
