import { createContext, memo, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnsiText } from './ansi';
import type { FileLink } from './file-reference';
import type { OpenModifiers } from './file-links';
import { Icon } from './Icons';
import { CodeBlock } from './RichContent';
import { commandText, describeGroup, describeTool, groupTools, kindOf, shortPath, type ToolEntry, type ToolItem, type ToolKind } from './tool-lines';
import { titleWhenTruncated } from './truncated-title';
import './tool-lines.css';

/**
 * Tool calls as quiet lines of a conversation, each expandable in place to
 * what went in and came out. Reused wherever calls are listed (the chat, a
 * sub-agent's card): give it the entries, and a scope for paths and files.
 */
export type ToolLineScope = {
  /** The workspace folder: paths inside it are shown relative to it. */
  root: string;
  onOpenFile?(reference: FileLink, how: OpenModifiers): void;
  /** The conversation's latest plan: shown as a live checklist, earlier ones folded. */
  latestPlan?: string;
};
export const ToolLineContext = createContext<ToolLineScope>({ root: '' });

/** Asks the Activity dialog showing this call to open on it. */
export const TOOL_DETAILS_EVENT = 'lazybox:tool-details';
export function openToolDetails(id: string) { window.dispatchEvent(new CustomEvent(TOOL_DETAILS_EVENT, { detail: { id } })); }

const ICONS: Record<ToolKind, string> = { read: 'file', search: 'search', list: 'folder', edit: 'pencil', command: 'terminal', web: 'external', agent: 'branch', plan: 'checklist', thinking: 'sparkle', mcp: 'activity', other: 'activity' };
const stateLabel = (entry: ToolEntry) => entry.status === 'running' ? 'Running' : entry.status === 'failed' ? 'Failed' : entry.status === 'unknown' ? 'No result reported' : 'Done';

/** A run of tool calls: reads and edits grouped, the rest one line each. */
export const ToolLines = memo(function ToolLines({ entries }: { entries: readonly ToolEntry[] }) {
  const items = useMemo(() => groupTools(entries), [entries]);
  if (!items.length) return null;
  return <div className="tool-lines" role="list" aria-label="Tool calls">{items.map(item => <ToolItemLine key={item.kind === 'call' ? item.entry.id : item.entries[0].id} item={item}/>)}</div>;
});

/** One line of a run: a call, or a group of reads or edits. */
export function ToolItemLine({ item }: { item: ToolItem }) {
  if (item.kind === 'call') return <ToolLine entry={item.entry}/>;
  return <ToolGroup item={item}/>;
}

const OPEN_EDITS = 4;
function ToolGroup({ item }: { item: Exclude<ToolItem, { kind: 'call' }> }) {
  // A few edits stay open, each with its diff; reads fold away.
  const [open, setOpen] = useState(item.kind === 'edits' && item.entries.length <= OPEN_EDITS);
  const { root } = useContext(ToolLineContext);
  const { text, meta, running } = describeGroup(item, root);
  return <div className="tool-line tool-group" role="listitem" data-state={running ? 'running' : 'completed'}>
    <button type="button" className="tool-line-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Chevron open={open}/><StateIcon kind={item.kind === 'edits' ? 'edit' : 'read'} state={running ? 'running' : 'completed'}/>
      <span className="tool-line-title" onPointerEnter={titleWhenTruncated(text)}><span className="tool-verb">{text}</span></span>
      <Meta meta={meta}/>
    </button>
    {open && <div className="tool-group-calls">{item.entries.map(entry => <ToolLine key={entry.id} entry={entry}/>)}</div>}
  </div>;
}

/** One call: icon, what it did, short facts; click to see input and output. */
export const ToolLine = memo(function ToolLine({ entry }: { entry: ToolEntry }) {
  const { root, onOpenFile, latestPlan } = useContext(ToolLineContext);
  const [open, setOpen] = useState(false);
  const title = describeTool(entry, root);
  const kind = kindOf(entry);
  const label = `${title.verb} ${title.target}`.trim();
  // Thinking has nothing to open: what the agent thought stays private.
  if (kind === 'thinking') return <div className="tool-line tool-thinking" role="listitem" data-state={entry.status} data-kind={kind} data-tool-id={entry.id}>
    <span className="tool-line-row" role="status" aria-live="off"><span className="tool-chevron" aria-hidden="true"/><StateIcon kind={kind} state={entry.status === 'running' ? 'thinking' : entry.status}/><span className="tool-line-title"><span className="tool-verb">{title.verb}</span></span></span>
  </div>;
  return <div className="tool-line" role="listitem" data-state={entry.status} data-kind={kind} data-tool-id={entry.id}>
    {/* No tooltip repeating the line: it would cover the next one. The whole line on hover only when it is cut. */}
    <button type="button" className="tool-line-row" aria-expanded={open} aria-label={`${label}${title.meta.length ? ' · ' + title.meta.join(' · ') : ''} · ${stateLabel(entry)}`} onClick={() => setOpen(!open)}>
      <Chevron open={open}/><StateIcon kind={kind} state={entry.status}/>
      <span className="tool-line-title" onPointerEnter={titleWhenTruncated(label)}><span className="tool-verb">{title.verb}</span>{title.target && <> {title.code ? <code className="tool-target">{title.target}</code> : <span className="tool-target">{title.target}</span>}</>}</span>
      <Meta meta={title.meta} failed={entry.status === 'failed'}/>
    </button>
    {title.problem && !open && <p className="tool-line-problem" role="note">{title.problem}</p>}
    {!open && kind === 'plan' && entry.id === latestPlan && <div className="tool-inline"><PlanList input={entry.input && typeof entry.input === 'object' ? entry.input as Record<string, any> : undefined}/></div>}
    {!open && kind === 'edit' && entry.patch && entry.status !== 'failed' && <InlineDiff patch={entry.patch} onMore={() => setOpen(true)}/>}
    {open && <ToolDetails entry={entry} kind={kind} root={root} file={title.file} onOpenFile={onOpenFile}/>}
  </div>;
});

const INLINE_DIFF_LINES = 8;
/** An edit's changed lines under its line, the start of them: the rest on open. */
function InlineDiff({ patch, onMore }: { patch: string; onMore(): void }) {
  const lines = useMemo(() => patch.split('\n').filter(l => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')), [patch]);
  if (!lines.length) return null;
  const shown = lines.slice(0, INLINE_DIFF_LINES);
  return <div className="tool-inline tool-inline-diff" aria-label="Changed lines">
    <pre>{shown.map((l, i) => <span key={i} data-sign={l[0] === '+' ? 'add' : 'del'}>{l}{'\n'}</span>)}</pre>
    {lines.length > shown.length && <button type="button" className="tool-output-more" onClick={onMore}>{lines.length - shown.length} more changed lines</button>}
  </div>;
}

function Chevron({ open }: { open: boolean }) {
  return <span className="tool-chevron" data-open={open || undefined} aria-hidden="true"><Icon name="chevronRight" size={12}/></span>;
}
function StateIcon({ kind, state }: { kind: ToolKind; state: string }) {
  return <span className="tool-icon" data-state={state} aria-hidden="true">{state === 'running' ? <span className="tool-spinner"/> : state === 'thinking' ? <span className="tool-thinking-dot"><Icon name="sparkle" size={13}/></span> : <Icon name={state === 'failed' ? 'alert' : ICONS[kind]} size={13}/>}</span>;
}
function Meta({ meta, failed }: { meta: string[]; failed?: boolean }) {
  if (!meta.length) return null;
  return <span className="tool-meta">{meta.map(m => <span key={m} data-tone={/^exit [1-9]/.test(m) || (failed && m.startsWith('exit')) ? 'failed' : /^\+\d/.test(m) ? 'diff' : undefined}>{diffMeta(m)}</span>)}</span>;
}
/** "+12 −4" with each side coloured. */
function diffMeta(m: string): ReactNode {
  const match = /^\+(\d+) −(\d+)$/.exec(m);
  return match ? <>{match[1] !== '0' || match[2] === '0' ? <ins>+{match[1]}</ins> : null}{match[1] !== '0' && match[2] !== '0' ? ' ' : null}{match[2] !== '0' ? <del>−{match[2]}</del> : null}</> : m;
}

const OUTPUT_LINES = 14;
/** A diff's file headers, relative to the workspace. */
const relativePatch = (patch: string, root: string) => root ? patch.replace(/^(---|\+\+\+) (.+)$/gm, (_, mark, path) => `${mark} ${shortPath(path, root)}`) : patch;

function ToolDetails({ entry, kind, root, file, onOpenFile }: { entry: ToolEntry; kind: ToolKind; root: string; file?: string; onOpenFile?: ToolLineScope['onOpenFile'] }) {
  const command = kind === 'command' ? commandText(entry) : '';
  const input = entry.input && typeof entry.input === 'object' ? entry.input as Record<string, any> : undefined;
  const showInput = !command && !entry.patch && kind !== 'read' && kind !== 'plan' && input && Object.keys(input).length > 0;
  return <div className="tool-details">
    {command && <CodeBlock text={command} language="bash" label={entry.cwd ? `Command · in ${shortPath(entry.cwd, '')}` : 'Command'}/>}
    {entry.patch && <CodeBlock text={relativePatch(entry.patch, root)} language="diff" label="Changes"/>}
    {kind === 'plan' && <PlanList input={input}/>}
    {showInput && <CodeBlock text={JSON.stringify(input, null, 2)} language="json" label="Input"/>}
    {entry.output !== undefined && entry.output !== '' && kind !== 'plan' && !(kind === 'edit' && entry.status !== 'failed') && <ToolOutput text={entry.output} lines={entry.outputLines || 0} failed={entry.status === 'failed'}/>}
    {entry.outputImages ? <small className="tool-note">{entry.outputImages} image{entry.outputImages === 1 ? '' : 's'} returned</small> : null}
    {entry.output === undefined && entry.status === 'running' && <small className="tool-note">Waiting for the result…</small>}
    {entry.output === undefined && entry.status === 'unknown' && <small className="tool-note">The agent never reported a result for this call.</small>}
    <div className="tool-details-actions">
      {file && onOpenFile && <button type="button" onClick={event => onOpenFile({ path: file }, event)}><Icon name="file" size={12}/>Open {shortPath(file, root).split('/').pop()}</button>}
      <button type="button" onClick={() => openToolDetails(entry.id)}><Icon name="external" size={12}/>Open full details</button>
    </div>
  </div>;
}

/** Output with terminal colours, the last lines first shown, all on request. */
function ToolOutput({ text, lines, failed }: { text: string; lines: number; failed: boolean }) {
  const [all, setAll] = useState(false);
  const split = useMemo(() => text.split('\n'), [text]);
  // A failure's cause is usually at the end; a read's content at the start.
  const shown = all || split.length <= OUTPUT_LINES ? text : failed ? split.slice(-OUTPUT_LINES).join('\n') : split.slice(0, OUTPUT_LINES).join('\n');
  return <div className="tool-output" data-failed={failed || undefined}>
    <pre aria-label="Output"><AnsiText text={shown}/></pre>
    {split.length > OUTPUT_LINES && <button type="button" className="tool-output-more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${(lines || split.length).toLocaleString()} lines`}</button>}
  </div>;
}

function PlanList({ input }: { input?: Record<string, any> }) {
  const todos: any[] = Array.isArray(input?.todos) ? input!.todos : Array.isArray(input?.plan) ? input!.plan : [];
  if (!todos.length) return null;
  return <ul className="tool-plan" aria-label="Plan">{todos.map((t, i) => {
    const status = t?.status === 'completed' ? 'completed' : t?.status === 'in_progress' || t?.status === 'inProgress' ? 'in_progress' : 'pending';
    return <li key={i} data-status={status}><span aria-hidden="true">{status === 'completed' ? '✓' : status === 'in_progress' ? '◐' : '○'}</span>{String(t?.content ?? t?.step ?? t?.text ?? '')}</li>;
  })}</ul>;
}
