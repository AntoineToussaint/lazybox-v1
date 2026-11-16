import type { ReviewComment } from '@lazybox/protocol';

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

export type Disposition = 'open' | 'sent' | 'resolved' | 'wont_fix';
export function dispositionLabel(c: ReviewComment): string {
  switch (c.disposition) {
    case 'sent': return c.sentToTitle ? `Sent to “${c.sentToTitle}”` : 'Sent to the agent';
    case 'resolved': return c.resolvedBy ? `Resolved by ${short(c.resolvedBy)}` : 'Resolved';
    case 'wont_fix': return 'Won’t fix';
    default: return 'Pending';
  }
}
export const isPending = (c: ReviewComment) => c.disposition === 'open' || !c.disposition;
export const isSettled = (c: ReviewComment) => c.disposition === 'resolved' || c.disposition === 'wont_fix';

export type TrayFilter = 'pending' | 'sent' | 'settled' | 'all';
export const trayFilters: { value: TrayFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' }, { value: 'sent', label: 'Sent' }, { value: 'settled', label: 'Done' }, { value: 'all', label: 'All' },
];
export function matchesFilter(c: ReviewComment, filter: TrayFilter) {
  if (filter === 'pending') return isPending(c);
  if (filter === 'sent') return c.disposition === 'sent';
  if (filter === 'settled') return isSettled(c);
  return true;
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
    parts.push([`### ${index + 1}. ${where(c)}`, `_${facts.join(' · ')}_`, `${f}${languageOf(c.path)}\n${quoted}\n${f}`, c.body.trim()].join('\n\n'));
  });
  parts.push('When you are done, say which comments you addressed and how, and which you did not and why.');
  return parts.join('\n\n');
}
