import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from './Icons';
import { RichContent } from './RichContent';
import { CallRow } from './ToolActivity';
import { useNow } from './LiveIndicator';
import { elapsedLabel } from './live-status';
import type { ToolCall } from './tool-activity';
import { activeSubagent, agentElapsed, currentAction, mergedStatus, resultPreview, statusWord, tokenLabel, toolTotal, type Subagent, type SubagentStatus } from './subagent-model';
import { usePresentation, useSubagent, useSubagentView, type SubagentView } from './subagent-view';
import './subagents.css';
import { contextMenu } from './ContextMenu';
import { subagentItems, type SubagentMenuDetail } from './subagent-context-menu';

const TIMELINE_STEP = 40;

/** A sub-agent's state at a glance: a turning ring while it works, a check, a cross, a square. */
export function SubagentMark({ status, size = 14 }: { status: SubagentStatus; size?: number }) {
  return <span className="subagent-mark" data-status={status} role="img" aria-label={statusWord[status]} style={{ ['--mark-size' as string]: `${size}px` }}>
    {status === 'done' ? <Icon name="check" size={size - 2}/> : status === 'failed' ? <Icon name="close" size={size - 3}/> : status === 'stopped' ? <span className="subagent-mark-square"/> : status === 'unknown' ? '?' : null}
  </span>;
}

/** The status a card shows: the journal's, unless the Runner knows it ended. */
export function useAgentStatus(view: SubagentView | null, agent: Subagent | undefined): SubagentStatus {
  usePresentation(view);
  return agent ? mergedStatus(agent, view?.runner) : 'unknown';
}

export const subagentTitle = (agent: Subagent, view?: SubagentView | null) => agent.name || view?.names[agent.runnerId] || view?.names[agent.id] || agent.prompt.split('\n').find(line => line.trim())?.trim().slice(0, 120) || 'Sub-agent';

/** "1m 12s · 14 tools · 48k tokens" */
export function SubagentStats({ agent, status, now }: { agent: Subagent; status: SubagentStatus; now: number }) {
  const elapsed = agentElapsed({ ...agent, status }, now), tools = toolTotal(agent);
  const parts = [
    elapsed !== undefined && <time key="time" title={activeSubagent(status) ? 'Running for' : 'Ran for'}>{elapsedLabel(elapsed)}</time>,
    tools > 0 && <span key="tools">{tools} {tools === 1 ? 'tool' : 'tools'}</span>,
    agent.tokens !== undefined && agent.tokens > 0 && <span key="tokens" title={`${agent.tokens.toLocaleString()} tokens`}>{tokenLabel(agent.tokens)}</span>,
  ].filter(Boolean);
  return <span className="subagent-stats">{parts.flatMap((part, i) => i ? [<span key={i} className="subagent-sep"> · </span>, part] : [part])}</span>;
}

/** Stop asks once more before it acts: a sub-agent's work is not undone by a resend. */
export function StopSubagent({ view, agent, status }: { view: SubagentView; agent: Subagent; status: SubagentStatus }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!confirming) return; const timer = setTimeout(() => setConfirming(false), 4000); return () => clearTimeout(timer); }, [confirming]);
  if (!view.canStop || !view.actions.stop || !activeSubagent(status)) return null;
  const stopping = view.stopping.has(agent.id), noun = agent.kind === 'command' ? 'background command' : 'sub-agent';
  return <button type="button" className={'subagent-stop' + (confirming ? ' confirming' : '')} disabled={stopping}
    aria-label={stopping ? `Stopping ${noun}` : confirming ? `Confirm: stop ${subagentTitle(agent, view)}` : `Stop ${noun} ${subagentTitle(agent, view)}`}
    title={confirming ? `Click again to stop this ${noun}. The main agent keeps working.` : `Stop this ${noun}`}
    onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); void view.stop(agent); }}>
    <Icon name="stop" size={12}/>{stopping ? <span>Stopping…</span> : confirming ? <span>Stop?</span> : null}
  </button>;
}

const ToolStep = memo(function ToolStep({ call, now }: { call: ToolCall; now: number }) { return <CallRow call={call} now={now} nested/>; });

/** Keeps a scroller at its end while the reader is there, as the main chat does. */
function useFollow(ref: RefObject<HTMLElement | null>, change: unknown) {
  const following = useRef(true);
  useLayoutEffect(() => { const node = ref.current; if (node && following.current) node.scrollTop = node.scrollHeight; }, [ref, change]);
  return () => { const node = ref.current; if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32; };
}

/**
 * A sub-agent's own messages and tool calls, with the components the main
 * chat uses. Only the latest steps are mounted; earlier ones on request, and
 * a tool's output only when its row is opened.
 */
export function SubagentTimeline({ agent, status, scroller }: { agent: Subagent; status: SubagentStatus; scroller?: RefObject<HTMLElement | null> }) {
  const view = useSubagentView();
  const [shown, setShown] = useState(TIMELINE_STEP);
  const active = activeSubagent(status);
  const now = useNow(active && !!agent.runningTool);
  const items = agent.items, hidden = Math.max(0, items.length - shown);
  const keepPlace = () => {
    // Earlier steps are added above what the reader is looking at: keep it in place.
    const node = scroller?.current, before = node?.scrollHeight ?? 0;
    setShown(count => count + TIMELINE_STEP * 2);
    if (node) requestAnimationFrame(() => { node.scrollTop += node.scrollHeight - before; });
  };
  return <ol className="subagent-timeline" aria-label={`Steps of ${subagentTitle(agent, view)}`}>
    {(hidden > 0 || agent.dropped > 0) && <li className="subagent-earlier">
      {hidden > 0 && <button type="button" className="show-earlier" onClick={keepPlace}>Show earlier steps <small>{hidden.toLocaleString()} more</small></button>}
      {agent.dropped > 0 && hidden === 0 && <small>{agent.dropped.toLocaleString()} earlier {agent.dropped === 1 ? 'step is' : 'steps are'} not kept here; the Activity panel lists every tool call.</small>}
    </li>}
    {items.slice(hidden).map(item => <li key={item.id} className={'subagent-step ' + item.kind}>
      {item.kind === 'message' ? <article className="message message_delta subagent-message"><RichContent text={item.text} onOpenFile={view?.actions.openFile}/></article>
        : item.kind === 'tool' ? <ToolStep call={item.call} now={item.call.status === 'Running' ? now : 0}/>
        : <SubagentCard id={item.agentId}/>}
    </li>)}
    {!items.length && <li className="subagent-empty">{active ? 'Waiting for its first step…' : 'It reported no steps.'}</li>}
  </ol>;
}

/** The instructions it was given: one line, the whole of it on request. */
export function SubagentPrompt({ agent, open = false }: { agent: Subagent; open?: boolean }) {
  if (!agent.prompt) return null;
  return <details className="subagent-prompt" open={open}>
    <summary><span>Instructions</span><small>{agent.prompt.replace(/\s+/g, ' ').slice(0, 160)}</small></summary>
    <div className="subagent-prompt-text"><RichContent text={agent.prompt}/></div>
  </details>;
}

/** How it ended, in a line, and what it handed back. */
export function SubagentOutcome({ view, agent, status }: { view: SubagentView; agent: Subagent; status: SubagentStatus }) {
  const full = view.results.has(agent.id);
  const preview = agent.result ? resultPreview(agent.result) : '';
  const word = status === 'stopped' ? 'Stopped' : status === 'failed' ? 'Failed' : status === 'unknown' ? 'Status unknown' : 'Done';
  const line = status === 'failed' ? agent.error || agent.summary || preview : preview || agent.summary;
  return <div className="subagent-outcome" data-status={status}>
    <p><strong>{word}</strong>{line && <span className="subagent-outcome-text">{line}</span>}</p>
    {agent.result && <button type="button" className="subagent-link" aria-expanded={full} onClick={() => view.toggleResult(agent.id)}>{full ? 'Hide full result' : 'Show full result'}</button>}
    {full && agent.result && <div className="subagent-result"><RichContent text={agent.result} onOpenFile={view.actions.openFile}/></div>}
  </div>;
}

/**
 * A sub-agent where its parent started it: what it was asked, what it is
 * doing now and for how long, how it ended and what it found. Opening it
 * shows its own timeline.
 */
export const SubagentCard = memo(function SubagentCard({ id }: { id: string }) {
  const view = useSubagentView();
  const agent = useSubagent(view, id);
  const status = useAgentStatus(view, agent);
  const active = activeSubagent(status);
  const now = useNow(active);
  const bodyId = useId();
  const card = useRef<HTMLElement>(null), scroller = useRef<HTMLDivElement>(null);
  const flash = view?.flash?.agentId === id ? view.flash.nonce : 0;
  const follow = useFollow(scroller, agent?.items);
  useEffect(() => {
    if (!flash || !card.current) return;
    const node = card.current;
    requestAnimationFrame(() => { node.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); node.classList.remove('subagent-flash'); void node.offsetWidth; node.classList.add('subagent-flash'); });
  }, [flash]);
  if (!view || !agent) return null;
  const expanded = view.expanded.has(id);
  const action = active ? currentAction({ ...agent, status }) : undefined;
  const title = subagentTitle(agent, view);
  const toggle = () => view.toggle(id);
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); view.toggle(id, false); } };
  return <section ref={card} className="subagent-card" data-status={status} data-nested={agent.depth > 0 || undefined} data-agent-id={id} aria-label={`Sub-agent: ${title}`} onKeyDown={keys}
    onContextMenu={contextMenu<SubagentMenuDetail>('subagent', () => subagentItems(view, agent, title), { agentId: id, kind: agent.kind }, `${title} actions`)}>
    <div className="subagent-head">
      <button type="button" className="subagent-toggle" aria-expanded={expanded} aria-controls={bodyId} title={expanded ? 'Hide its steps' : 'Show its steps'} onClick={toggle}>
        <SubagentMark status={status}/>
        <span className="subagent-who">
          <span className="subagent-type">{agent.type || 'Sub-agent'}</span>
          <span className="subagent-name">{title}</span>
        </span>
        <span className="subagent-chevron" aria-hidden="true"><Icon name="chevronRight" size={14}/></span>
      </button>
      <SubagentStats agent={agent} status={status} now={now}/>
      <span className="subagent-actions">
        <StopSubagent view={view} agent={agent} status={status}/>
        <button type="button" className="icon-button" aria-label={`Open ${title} in a panel`} title="Open in a panel" onClick={() => view.open(id)}><Icon name="dock-right" size={14}/></button>
      </span>
    </div>
    {action && <div className="subagent-now" aria-live="off">
      <span className="subagent-now-text" title={action.text}>{action.text}</span>
      {action.since !== undefined && now >= action.since && <span className="subagent-now-time">{elapsedLabel(now - action.since)}</span>}
    </div>}
    {active && agent.progress && <p className="subagent-progress" title="The provider's summary of its progress">{agent.progress}</p>}
    {!active && <SubagentOutcome view={view} agent={agent} status={status}/>}
    {expanded && <div id={bodyId} className="subagent-body" ref={scroller} onScroll={follow}>
      <SubagentPrompt agent={agent}/>
      <SubagentTimeline agent={agent} status={status} scroller={scroller}/>
    </div>}
  </section>;
});
