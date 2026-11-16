/**
 * Tool calls as lines of the conversation: what each one did, in words
 * ("Read src/app.ts", "Ran pnpm test · exit 0 · 4.2s", "Edited 3 files +12 −4"),
 * folded from the Runner journal's normalized tool events. Pure, so the
 * transcript fold and any view (the chat, sub-agent cards) share it.
 *
 * What is kept per call is bounded: a long conversation holds hundreds of
 * calls, and the journal (and the Activity dialog) keep the full evidence.
 */

export type ToolStatus = 'running' | 'completed' | 'failed' | 'unknown';
export type DiffStat = { added: number; removed: number; files: string[] };
export type ToolEntry = {
  id: string;
  name: string;
  status: ToolStatus;
  /** The call's input, strings bounded. */
  input?: Record<string, unknown> | string;
  /** Output as text: its head and tail when long. */
  output?: string;
  /** Lines in the output the provider reported (before bounding). */
  outputLines?: number;
  outputImages?: number;
  exitCode?: number;
  /** Reported by the provider (Codex); otherwise taken from journal times. */
  durationMs?: number;
  cwd?: string;
  /** Codex's parse of a shell command: a read, a search, a listing. */
  actions?: { type: string; name?: string; path?: string | null; query?: string | null; command?: string }[];
  startedAt?: number;
  endedAt?: number;
  diff?: DiffStat;
  /** A unified diff of the change, when the input says what changed. */
  patch?: string;
};

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const STRING_LIMIT = 4000, OUTPUT_HEAD = 6000, OUTPUT_TAIL = 10000, PATCH_LIMIT = 12000;

function boundStrings(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > STRING_LIMIT ? value.slice(0, STRING_LIMIT) + '\n[…]' : value;
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 40).map(v => boundStrings(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, boundStrings(v, depth + 1)]));
  return value;
}

/** Tool output as text: Claude's content blocks, Codex's strings, anything else as JSON. */
export function outputText(value: unknown): { text: string; images: number } {
  if (value === undefined || value === null) return { text: '', images: 0 };
  if (typeof value === 'string') return { text: value, images: 0 };
  if (Array.isArray(value)) {
    let images = 0; const parts: string[] = [];
    for (const block of value) {
      const b = object(block);
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      else if (b.type === 'image') images++;
      else if (b.type === 'inputText' && typeof b.text === 'string') parts.push(b.text);
      else parts.push(JSON.stringify(block));
    }
    return { text: parts.join('\n'), images };
  }
  const o = object(value);
  if (Array.isArray(o.content)) return outputText(o.content);
  return { text: JSON.stringify(value, null, 2), images: 0 };
}

const countLines = (text: string) => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
function boundOutput(text: string): string {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text;
  const head = text.slice(0, OUTPUT_HEAD), tail = text.slice(-OUTPUT_TAIL);
  const omitted = countLines(text.slice(OUTPUT_HEAD, -OUTPUT_TAIL));
  return `${head}\n… ${omitted.toLocaleString()} lines not kept here …\n${tail}`;
}

/** Lines removed and added between two texts, outside their common start and end. */
export function lineChange(before: string, after: string): { removed: string[]; added: string[]; context: string[] } {
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : [];
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0; while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.slice(start, a.length - end), added: b.slice(start, b.length - end), context: a.slice(Math.max(0, start - 2), start) };
}

function editPatch(path: string, edits: { old: string; next: string }[]): { patch: string; added: number; removed: number } {
  let patch = `--- ${path}\n+++ ${path}\n`, added = 0, removed = 0;
  for (const { old, next } of edits) {
    const change = lineChange(old, next);
    added += change.added.length; removed += change.removed.length;
    patch += '@@\n' + [...change.context.map(l => ' ' + l), ...change.removed.map(l => '-' + l), ...change.added.map(l => '+' + l)].join('\n') + '\n';
  }
  return { patch: patch.length > PATCH_LIMIT ? patch.slice(0, PATCH_LIMIT) + '\n[…]' : patch, added, removed };
}

/** Counts + and − lines of a unified diff, skipping its file headers. */
export function patchStat(patch: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++; else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** What a file change does, from the call's input, before its strings are bounded. */
export function changeOf(name: string, input: unknown): { diff: DiffStat; patch?: string } | undefined {
  const i = object(input);
  const path = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
  if (name === 'Edit' && path && typeof i.old_string === 'string' && typeof i.new_string === 'string') {
    const p = editPatch(path, [{ old: i.old_string, next: i.new_string }]);
    return { diff: { added: p.added, removed: p.removed, files: [path] }, patch: p.patch };
  }
  if (name === 'MultiEdit' && path && Array.isArray(i.edits)) {
    const p = editPatch(path, i.edits.map((e: any) => ({ old: String(e?.old_string ?? ''), next: String(e?.new_string ?? '') })));
    return { diff: { added: p.added, removed: p.removed, files: [path] }, patch: p.patch };
  }
  if (name === 'Write' && path && typeof i.content === 'string') {
    const p = editPatch(path, [{ old: '', next: i.content }]);
    return { diff: { added: p.added, removed: 0, files: [path] }, patch: p.patch };
  }
  // Codex: a list of { path, kind, diff }.
  const changes = Array.isArray(input) ? input : Array.isArray(i.changes) ? i.changes : undefined;
  if (changes && changes.every(c => typeof object(c).path === 'string')) {
    let added = 0, removed = 0, patch = '';
    for (const c of changes) {
      const diff = typeof c.diff === 'string' ? c.diff : '';
      const kind = object(c.kind).type || c.kind;
      const stat = patchStat(diff);
      // An added file's diff is its content.
      if (kind === 'add' && !/^[+-]/m.test(diff)) stat.added = countLines(diff);
      added += stat.added; removed += stat.removed;
      patch += `--- ${c.path}\n+++ ${c.path}\n${diff}\n`;
    }
    return { diff: { added, removed, files: changes.map(c => c.path) }, patch: patch.length > PATCH_LIMIT ? patch.slice(0, PATCH_LIMIT) + '\n[…]' : patch };
  }
  return undefined;
}

const STATUS: Record<string, ToolStatus> = { running: 'running', completed: 'completed', failed: 'failed' };

/**
 * One journal tool event applied to the call it is about (or a new one).
 * Returns undefined when the payload is not a tool call.
 */
export function applyToolPayload(previous: ToolEntry | undefined, payload: Record<string, any>, at: number | undefined): ToolEntry | undefined {
  let id: string | undefined, name: string | undefined, status: ToolStatus | undefined, input: unknown, output: unknown, error = false;
  if (payload.type === 'tool_call') {
    id = payload.id; name = payload.name; status = STATUS[payload.status] || 'unknown'; input = payload.input; output = payload.output;
  } else if (payload.type === 'tool_use') { // Journals written before normalized tool calls.
    id = payload.id; name = payload.name; status = 'running'; input = payload.input;
  } else if (payload.type === 'tool_result') {
    id = payload.tool_use_id; status = payload.is_error ? 'failed' : 'completed'; output = payload.content; error = !!payload.is_error;
  }
  if (typeof id !== 'string' || !id) return;
  const next: ToolEntry = previous ? { ...previous } : { id, name: name || 'Tool', status: status || 'running' };
  if (name) next.name = name;
  // A result never goes back to running.
  if (status && !(previous && (previous.status === 'completed' || previous.status === 'failed') && status === 'running')) next.status = status;
  if (input !== undefined && input !== null) {
    const change = changeOf(next.name, input);
    if (change) { next.diff = change.diff; next.patch = change.patch; }
    next.input = boundStrings(typeof input === 'string' ? input : object(input)) as ToolEntry['input'];
    if (Array.isArray(input)) next.input = { changes: boundStrings(input) } as Record<string, unknown>;
  }
  if (output !== undefined && output !== null) {
    const { text, images } = outputText(output);
    next.output = boundOutput(text); next.outputLines = countLines(text); next.outputImages = images || undefined;
    // Claude reports a failed command as "Exit code N" on the first line.
    const exit = /^Exit code (\d+)/.exec(text);
    if (exit) next.exitCode = Number(exit[1]);
  }
  if (typeof payload.exitCode === 'number') next.exitCode = payload.exitCode;
  if (typeof payload.durationMs === 'number') next.durationMs = payload.durationMs;
  if (typeof payload.cwd === 'string') next.cwd = payload.cwd;
  if (Array.isArray(payload.actions)) next.actions = payload.actions.slice(0, 20);
  if (error && next.status !== 'failed') next.status = 'failed';
  if (next.startedAt === undefined && at !== undefined) next.startedAt = at;
  if (next.endedAt === undefined && at !== undefined && (next.status === 'completed' || next.status === 'failed')) next.endedAt = at;
  // A shell command that ended without an error exited 0 (Claude says so only on failure).
  if (next.status === 'completed' && next.exitCode === undefined && kindOf(next) === 'command' && next.output !== undefined) next.exitCode = 0;
  return next;
}

/**
 * Calls the conversation shows in another form: an answered question's line,
 * a sub-agent's card (SubagentCard, from the spawning call).
 */
const HIDDEN = new Set(['AskUserQuestion', 'Task', 'Agent', 'Sub-agent']);
export const hiddenTool = (name: string) => HIDDEN.has(name);

export type ToolKind = 'read' | 'search' | 'list' | 'edit' | 'command' | 'web' | 'agent' | 'plan' | 'thinking' | 'mcp' | 'other';
/** The name of the line that stands for the agent thinking (its reasoning stays private). */
export const THINKING = 'Thinking';
const KINDS: Record<string, ToolKind> = {
  Read: 'read', NotebookRead: 'read', 'View image': 'read', Grep: 'search', Glob: 'list', LS: 'list',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit', 'File changes': 'edit', apply_patch: 'edit',
  Bash: 'command', 'Shell command': 'command', exec_command: 'command', local_shell: 'command', mcp__lazybox__command: 'command', lazybox_command: 'command',
  WebFetch: 'web', WebSearch: 'web', 'Web search': 'web', Task: 'agent', Agent: 'agent', 'Sub-agent': 'agent', TodoWrite: 'plan', update_plan: 'plan', [THINKING]: 'thinking',
};
export function kindOf(entry: Pick<ToolEntry, 'name' | 'actions' | 'input'>): ToolKind {
  const kind = KINDS[entry.name];
  if (kind === 'command') {
    // Codex parses what a command does: all reads is a read, all searches a search.
    const types = new Set((entry.actions || []).map(a => a.type));
    if (types.size === 1 && types.has('read')) return 'read';
    if (types.size === 1 && types.has('search')) return 'search';
    if (types.size === 1 && types.has('listFiles')) return 'list';
    // The managed command tool reads output too; only a start runs something.
    const input = object(entry.input);
    if ((entry.name === 'mcp__lazybox__command' || entry.name === 'lazybox_command') && input.action && input.action !== 'start' && input.action !== 'start_action') return 'other';
  }
  if (kind) return kind;
  return entry.name.startsWith('mcp__') ? 'mcp' : 'other';
}

/** A path as short as it stays unambiguous: relative to the workspace when inside it. */
export function shortPath(path: string, root = ''): string {
  if (root && path.startsWith(root.endsWith('/') ? root : root + '/')) return path.slice(root.length).replace(/^\/+/, '');
  if (root && path === root) return '.';
  return path.replace(/^\/(?:Users|home)\/[^/]+\//, '~/');
}

export function durationOf(entry: ToolEntry): number | undefined {
  if (entry.durationMs !== undefined) return entry.durationMs;
  if (entry.startedAt === undefined || entry.endedAt === undefined || entry.endedAt < entry.startedAt) return;
  return entry.endedAt - entry.startedAt;
}
export function shortDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) / 10) || '0.1'}s`.replace(/^0s$/, '<0.1s');
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace(/\.0$/, '')}s`;
  const m = Math.floor(ms / 60000); return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** The command a call runs, as one line. */
export function commandText(entry: Pick<ToolEntry, 'name' | 'input'>): string {
  const input = entry.input;
  if (typeof input === 'string') return input;
  const i = object(input);
  if (typeof i.command === 'string') return i.command;
  if (Array.isArray(i.command)) return i.command.join(' ');
  if (Array.isArray(i.argv)) return i.argv.join(' ');
  if (typeof i.cmd === 'string') return i.cmd;
  return '';
}

export type ToolTitle = {
  /** The verb, in the tense of the call's state: "Read", "Running". */
  verb: string;
  /** What it acted on: a path, a command, a query. */
  target: string;
  /** Shown monospaced: paths and commands. */
  code: boolean;
  /** A file to open from the line. */
  file?: string;
  /** Short facts after the title: "exit 0", "4.2s", "+12 −4". */
  meta: string[];
  /** One line saying what went wrong. */
  problem?: string;
};

const firstLine = (text: string) => text.split('\n').find(l => l.trim())?.trim() || '';
const hostOf = (url: string) => { try { const u = new URL(url); return u.host + (u.pathname === '/' ? '' : u.pathname); } catch { return url; } };

/** A call as a person would say it. */
export function describeTool(entry: ToolEntry, root = ''): ToolTitle {
  const i = object(entry.input), running = entry.status === 'running', failed = entry.status === 'failed';
  const path = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : typeof i.path === 'string' ? i.path : '';
  const kind = kindOf(entry);
  const meta: string[] = [];
  const problem = failed ? firstLine(entry.output || '') || 'Failed' : undefined;
  const tense = (past: string, present: string) => running ? present : past;
  switch (kind) {
    case 'read': {
      const action = entry.actions?.find(a => a.type === 'read');
      const file = path || action?.path || action?.name || '';
      if (typeof i.offset === 'number' || typeof i.limit === 'number') meta.push(`lines ${(i.offset || 0) + 1}–${(i.offset || 0) + (i.limit || 0) || '…'}`);
      else if (entry.outputLines && !running && entry.name !== 'View image') meta.push(`${entry.outputLines} lines`);
      return { verb: tense('Read', 'Reading'), target: file ? shortPath(file, root) : commandText(entry), code: true, file: file || undefined, meta, problem };
    }
    case 'search': {
      const action = entry.actions?.find(a => a.type === 'search');
      const pattern = typeof i.pattern === 'string' ? i.pattern : action?.query || commandText(entry);
      const where = typeof i.path === 'string' ? i.path : action?.path || '';
      return { verb: tense('Searched for', 'Searching for'), target: pattern + (where ? ` in ${shortPath(where, root)}` : ''), code: true, meta, problem };
    }
    case 'list': {
      const action = entry.actions?.find(a => a.type === 'listFiles');
      const target = typeof i.pattern === 'string' ? i.pattern : shortPath(path || action?.path || '', root) || commandText(entry) || '.';
      if (entry.outputLines && !running) meta.push(`${entry.outputLines} found`);
      return { verb: tense('Listed', 'Listing'), target, code: true, meta, problem };
    }
    case 'edit': {
      const files = entry.diff?.files || (path ? [path] : []);
      if (entry.diff) meta.push(`+${entry.diff.added} −${entry.diff.removed}`);
      const verb = entry.name === 'Write' ? tense('Wrote', 'Writing') : tense('Edited', 'Editing');
      return { verb, target: files.length === 1 ? shortPath(files[0], root) : `${files.length} files`, code: files.length === 1, file: files.length === 1 ? files[0] : undefined, meta, problem };
    }
    case 'command': {
      const command = commandText(entry);
      if (!running) {
        if (entry.exitCode !== undefined) meta.push(`exit ${entry.exitCode}`);
        const took = shortDuration(durationOf(entry));
        if (took) meta.push(took);
      }
      if (i.run_in_background === true) return { verb: tense('Started', 'Starting'), target: command, code: true, meta: ['in the background'], problem };
      const why = failed && entry.exitCode !== undefined && entry.exitCode !== 0 ? firstLine((entry.output || '').replace(/^Exit code \d+\n?/, '')) || `Exited with ${entry.exitCode}` : problem;
      return { verb: tense('Ran', 'Running'), target: command || entry.name, code: !!command, meta, problem: why };
    }
    case 'web': {
      if (typeof i.url === 'string') return { verb: tense('Fetched', 'Fetching'), target: hostOf(i.url), code: false, meta, problem };
      const query = typeof i.query === 'string' ? i.query : typeof entry.input === 'string' ? entry.input : '';
      return { verb: tense('Searched the web for', 'Searching the web for'), target: query ? `“${query}”` : '', code: false, meta, problem };
    }
    case 'agent': {
      const what = typeof i.description === 'string' ? i.description : typeof i.prompt === 'string' ? firstLine(i.prompt) : '';
      return { verb: tense('Delegated', 'Delegating'), target: what || 'a task to a sub-agent', code: false, meta, problem };
    }
    case 'thinking': {
      const took = shortDuration(durationOf(entry));
      return { verb: running ? 'Thinking…' : took ? `Thought for ${took}` : 'Thought', target: '', code: false, meta, problem: undefined };
    }
    case 'plan': {
      const todos = Array.isArray(i.todos) ? i.todos : Array.isArray(i.plan) ? i.plan : [];
      const done = todos.filter((t: any) => t?.status === 'completed').length;
      if (todos.length) meta.push(`${done}/${todos.length} done`);
      return { verb: tense('Updated the plan', 'Updating the plan'), target: '', code: false, meta, problem };
    }
    case 'mcp': {
      const [, server = '', tool = entry.name] = /^mcp__(.+?)__(.+)$/.exec(entry.name) || [];
      return { verb: tense('Used', 'Using'), target: `${server.replace(/_/g, ' ')} · ${tool.replace(/_/g, ' ')}`, code: false, meta, problem };
    }
    default: {
      if (entry.name === 'BashOutput' || entry.name === 'TaskOutput') return { verb: tense('Checked', 'Checking'), target: 'background output', code: false, meta, problem };
      const detail = [i.description, i.title, i.query, path, i.action].find(v => typeof v === 'string' && v.trim());
      return { verb: tense('Used', 'Using'), target: entry.name.replace(/_/g, ' ') + (detail ? ` · ${String(detail).slice(0, 120)}` : ''), code: false, meta, problem };
    }
  }
}

export type ToolItem = { kind: 'call'; entry: ToolEntry } | { kind: 'explore' | 'edits'; entries: ToolEntry[] };
const EXPLORE = new Set<ToolKind>(['read', 'search', 'list']);

/**
 * Consecutive reads and searches become one line ("Read 6 files, searched 2
 * patterns"), consecutive edits one ("Edited 3 files +12 −4"). Anything else,
 * and anything failed, stays its own line.
 */
export function groupTools(entries: readonly ToolEntry[]): ToolItem[] {
  const items: ToolItem[] = [];
  for (const entry of entries) {
    if (hiddenTool(entry.name)) continue;
    const kind = kindOf(entry);
    const group = EXPLORE.has(kind) ? 'explore' : kind === 'edit' ? 'edits' : undefined;
    const last = items.at(-1);
    if (group && entry.status !== 'failed' && last && last.kind === group) last.entries.push(entry);
    else if (group && entry.status !== 'failed') items.push({ kind: group, entries: [entry] });
    else items.push({ kind: 'call', entry });
  }
  // A group of one is just that call.
  return items.map(item => item.kind !== 'call' && item.entries.length === 1 ? { kind: 'call', entry: item.entries[0] } : item);
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** A group's line: "Read 6 files, searched 2 patterns", "Editing 3 files +12 −4". */
export function describeGroup(item: Exclude<ToolItem, { kind: 'call' }>): { text: string; meta: string[]; running: boolean } {
  const running = item.entries.some(e => e.status === 'running');
  if (item.kind === 'edits') {
    const files = new Set(item.entries.flatMap(e => e.diff?.files || [String(object(e.input).file_path || e.id)]));
    const added = item.entries.reduce((n, e) => n + (e.diff?.added || 0), 0), removed = item.entries.reduce((n, e) => n + (e.diff?.removed || 0), 0);
    return { text: `${running ? 'Editing' : 'Edited'} ${plural(files.size, 'file')}`, meta: [`+${added} −${removed}`], running };
  }
  const reads = new Set<string>(); let searches = 0, lists = 0;
  for (const e of item.entries) {
    const kind = kindOf(e), i = object(e.input);
    if (kind === 'read') reads.add(String(i.file_path || i.path || e.actions?.find(a => a.type === 'read')?.path || e.id));
    else if (kind === 'search') searches++;
    else lists++;
  }
  const parts: string[] = [];
  if (reads.size) parts.push(`${running ? 'reading' : 'read'} ${plural(reads.size, 'file')}`);
  if (searches) parts.push(`${running ? 'searching' : 'searched'} ${plural(searches, 'pattern')}`);
  if (lists) parts.push(`${running ? 'listing' : 'listed'} ${plural(lists, 'folder')}`);
  const text = parts.join(', ');
  return { text: text.charAt(0).toUpperCase() + text.slice(1), meta: [], running };
}

/** The id of the conversation's latest plan update (TodoWrite, update_plan), or ''. */
export function latestPlanId(messages: readonly { tools?: ToolEntry[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tools = messages[i].tools;
    if (!tools) continue;
    for (let j = tools.length - 1; j >= 0; j--) if (kindOf(tools[j]) === 'plan') return tools[j].id;
  }
  return '';
}
