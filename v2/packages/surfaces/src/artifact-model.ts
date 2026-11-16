import type { Artifact, ArtifactVersion } from '@lazybox/protocol';

/** Pure helpers for artifacts: titles, kinds, line diffs, summaries. No React, no Runner. */

export const ARTIFACT_KINDS = ['plan', 'report', 'spec', 'notes', 'other'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const kindLabel: Record<ArtifactKind, string> = { plan: 'Plan', report: 'Report', spec: 'Spec', notes: 'Notes', other: 'Document' };
/** An icon name from Icons.tsx for each kind. */
export const kindIcon: Record<ArtifactKind, string> = { plan: 'checklist', report: 'report', spec: 'spec', notes: 'notes', other: 'file' };
export const asKind = (value: string): ArtifactKind => (ARTIFACT_KINDS as readonly string[]).includes(value) ? value as ArtifactKind : 'other';

const clean = (line: string) => line.replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, (_, text) => text ?? '').replace(/\s+/g, ' ').trim();

/** The first ATX or setext heading outside code fences, else the first prose line, at most 120 characters. */
export function titleFromMarkdown(text: string, fallback = 'Untitled'): string {
  const lines = text.split('\n');
  let fenced = false, firstLine = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const atx = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx && clean(atx[1])) return shorten(clean(atx[1]));
    if (line.trim() && /^\s*(=+|-+)\s*$/.test(lines[i + 1] || '') && !/^\s*[-*+]\s/.test(line)) return shorten(clean(line));
    if (!firstLine && line.trim() && !/^\s*([-*_]\s*){3,}$/.test(line)) firstLine = clean(line.replace(/^\s*([-*+>]|\d+\.)\s+/, ''));
  }
  return firstLine ? shorten(firstLine.replace(/[:.]$/, '')) : fallback;
}
const shorten = (value: string, limit = 120) => value.length <= limit ? value : value.slice(0, limit - 1).trimEnd() + '…';

/** A kind suggested by the title and the shape of the text; the person can change it. */
export function guessKind(title: string, text = ''): ArtifactKind {
  const t = title.toLowerCase();
  if (/\b(plan|roadmap|steps|migration|rollout|approach)\b/.test(t)) return 'plan';
  if (/\b(spec|specification|design|rfc|proposal|contract)\b/.test(t)) return 'spec';
  if (/\b(report|review|audit|findings|summary|analysis|investigation|postmortem|results)\b/.test(t)) return 'report';
  if (/\b(notes?|log|journal|memo)\b/.test(t)) return 'notes';
  if (/^\s*(- \[[ x]\]|\d+\.)\s/m.test(text) && /\b(step|phase|todo|milestone)/i.test(text)) return 'plan';
  return 'other';
}

/** A file name for downloads and the repository: lowercase words joined by dashes. */
export function slug(title: string): string {
  const value = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return value || 'artifact';
}

export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; before?: number; after?: number };
/**
 * A line diff (Myers, O((N+M)·D)), with a guard: past `limit` edit steps it
 * falls back to "everything removed, everything added", which is still correct.
 */
export function lineDiff(before: string, after: string, limit = 4000): DiffLine[] {
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  // Trim the common head and tail: most versions change a few lines.
  let head = 0; while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0; while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  const middle = myers(x, y, limit) ?? [...x.map(text => ({ kind: 'remove' as const, text })), ...y.map(text => ({ kind: 'add' as const, text }))];
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  const push = (kind: DiffLine['kind'], text: string) => {
    if (kind === 'same') out.push({ kind, text, before: ++i, after: ++j });
    else if (kind === 'remove') out.push({ kind, text, before: ++i });
    else out.push({ kind, text, after: ++j });
  };
  for (let k = 0; k < head; k++) push('same', a[k]);
  for (const line of middle) push(line.kind, line.text);
  for (let k = a.length - tail; k < a.length; k++) push('same', a[k]);
  return out;
}

function myers(a: string[], b: string[], limit: number): { kind: DiffLine['kind']; text: string }[] | undefined {
  const n = a.length, m = b.length, max = n + m;
  if (!n) return b.map(text => ({ kind: 'add', text }));
  if (!m) return a.map(text => ({ kind: 'remove', text }));
  const offset = max + 1, v = new Int32Array(2 * max + 3), trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    if (d > limit) return undefined;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let xi = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let yi = xi - k;
      while (xi < n && yi < m && a[xi] === b[yi]) { xi++; yi++; }
      v[offset + k] = xi;
      if (xi >= n && yi >= m) return backtrack(a, b, trace, offset, d);
    }
  }
  return undefined;
}
function backtrack(a: string[], b: string[], trace: Int32Array[], offset: number, depth: number) {
  const out: { kind: DiffLine['kind']; text: string }[] = [];
  let xi = a.length, yi = b.length;
  for (let d = depth; d > 0; d--) {
    const v = trace[d], k = xi - yi;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK], prevY = prevX - prevK;
    while (xi > prevX && yi > prevY) { out.push({ kind: 'same', text: a[--xi] }); yi--; }
    if (xi === prevX) out.push({ kind: 'add', text: b[--yi] }); else out.push({ kind: 'remove', text: a[--xi] });
  }
  while (xi > 0 && yi > 0) { out.push({ kind: 'same', text: a[--xi] }); yi--; }
  return out.reverse();
}

export const diffStats = (lines: DiffLine[]) => ({ added: lines.filter(l => l.kind === 'add').length, removed: lines.filter(l => l.kind === 'remove').length });

export type DiffHunk = { lines: DiffLine[]; hiddenBefore: number };
/** Changed lines with `context` lines around them; long unchanged runs fold into a count. */
export function hunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, i) => { if (line.kind !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true; });
  const out: DiffHunk[] = [];
  let hidden = 0, current: DiffHunk | undefined;
  lines.forEach((line, i) => {
    if (!keep[i]) { hidden++; current = undefined; return; }
    if (!current) { current = { lines: [], hiddenBefore: hidden }; out.push(current); hidden = 0; }
    current.lines.push(line);
  });
  if (hidden && out.length) out.push({ lines: [], hiddenBefore: hidden });
  return out;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago", then the date. */
export function ago(unixMillis: bigint | number, now = Date.now()): string {
  const millis = Number(unixMillis);
  if (!millis) return '';
  const seconds = Math.max(0, Math.round((now - millis) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(millis).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** Who made a version, in a few words: "you", "an agent", "the file on disk". */
export function versionOrigin(version: ArtifactVersion | undefined, agentName?: (sessionId: string) => string | undefined): string {
  if (!version) return '';
  const author = version.author?.kind, source = version.source?.kind;
  if (author === 'file' || (!author && source === 'file')) return 'file changed on disk';
  if (author === 'agent') return `published by ${agentName?.(version.author!.sessionId) || 'an agent'}`;
  if (source === 'message') return 'from a chat message';
  return 'edited by you';
}

/** The list line: "Updated from file · 2 min ago", "v3 · from a chat message · just now". */
export function updatedLine(artifact: Artifact, now = Date.now()): string {
  const latest = artifact.versions.at(-1);
  const when = ago(artifact.updatedAtUnixMillis, now);
  return [`v${latest?.number ?? 1}`, versionOrigin(latest), when].filter(Boolean).join(' · ');
}

/**
 * What "Send to agent" puts in a message box: the reference an agent can fetch
 * with the CLI, and a short outline so the person sees what they are sending.
 */
export function agentReference(artifact: Pick<Artifact, 'id' | 'title' | 'kind' | 'versions'>, content: string, budget = 1200): string {
  const version = artifact.versions.at(-1)?.number ?? 1;
  const outline: string[] = [];
  let fenced = false, used = 0;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^\s{0,3}(#{1,3})\s+(.*)$/.exec(line);
    const item = heading ? `${'  '.repeat(heading[1].length - 1)}- ${clean(heading[2])}` : '';
    if (!item || used + item.length > budget) continue;
    outline.push(item); used += item.length + 1;
  }
  const lines = [`Artifact “${artifact.title}” (${kindLabel[asKind(artifact.kind)].toLowerCase()}, v${version}). Read it in full with \`lazybox artifact get ${artifact.id}\`.`];
  if (outline.length) lines.push('', 'Outline:', ...outline);
  else if (content.trim()) lines.push('', shorten(content.trim().split('\n').slice(0, 6).join('\n'), budget));
  lines.push('', '');
  return lines.join('\n');
}

/** A workspace path for "Save to repository": `member/docs/<slug>.md`. */
export const suggestedPath = (member: string, title: string) => `${member ? member + '/' : ''}docs/${slug(title)}.md`;
