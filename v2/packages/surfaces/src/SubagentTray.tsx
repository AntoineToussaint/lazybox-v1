import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icons';
import { LiveIndicator, useNow } from './LiveIndicator';
import { elapsedLabel, type LiveStatus } from './live-status';
import { activeSubagent, agentElapsed, backgroundCommands, currentAction, mergedStatus, statusWord, subagentTree, type Subagent, type SubagentStatus, type Subagents } from './subagent-model';
import { usePresentation, useSubagentIndex, useSubagentView, type SubagentView } from './subagent-view';
import { SubagentMark, SubagentName, subagentTitle } from './SubagentCard';
import './subagents.css';
import { contextMenu } from './ContextMenu';
import { subagentItems, type SubagentMenuDetail } from './subagent-context-menu';

const menuFor = (view: SubagentView, agent: Subagent, title: string) => contextMenu<SubagentMenuDetail>('subagent', () => subagentItems(view, agent, title), { agentId: agent.id, kind: agent.kind }, `${title} actions`);

const statusOf = (view: SubagentView, agent: Subagent): SubagentStatus => mergedStatus(agent, view.runner);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "34 sub-agents", "2 background commands", "36 sub-agents and commands". */
function workNoun(agents: number, commands: number): string {
  const noun = !commands ? (agents === 1 ? 'sub-agent' : 'sub-agents') : !agents ? (commands === 1 ? 'background command' : 'background commands') : 'sub-agents and commands';
  return `${agents + commands} ${noun}`;
}
/** " sub-agents" or " commands" after a count in a tight place; nothing for a mix of both. */
const shortNoun = (agents: number, commands: number) => !commands ? (agents === 1 ? ' sub-agent' : ' sub-agents') : !agents ? (commands === 1 ? ' command' : ' commands') : '';

/** Moves focus between the buttons of a row or list with the arrow keys. */
function roving(event: KeyboardEvent<HTMLElement>, selector: string, keys: [string, string]) {
  if (event.key !== keys[0] && event.key !== keys[1] && event.key !== 'Home' && event.key !== 'End') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === keys[1] ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/** What runs in the background of a conversation: sub-agents (as a tree) and background commands. */
function work(view: SubagentView, index: Subagents) {
  const tree = subagentTree(index), commands = backgroundCommands(index, view.runner);
  const agentsRunning = tree.filter(({ agent }) => activeSubagent(statusOf(view, agent)));
  const commandsRunning = commands.filter(agent => activeSubagent(statusOf(view, agent)));
  return { tree, commands, agentsRunning, commandsRunning };
}

/** How many sub-agents and background commands are at work now. */
export function useBackgroundRunning(): number {
  const view = useSubagentView();
  const index = useSubagentIndex(view);
  usePresentation(view);
  if (!view) return 0;
  const state = work(view, index);
  return state.agentsRunning.length + state.commandsRunning.length;
}

/** Takes the person to an item: a sub-agent's card, or a background command's panel. */
const show = (view: SubagentView, agent: Subagent) => agent.kind === 'command' ? view.open(agent.id) : view.reveal(agent.id);

/** Every sub-agent, nested under who started it, and every background command. */
function WorkList({ view, index, now, placement, onClose }: { view: SubagentView; index: Subagents; now: number; placement: 'above' | 'below'; onClose(focus?: boolean): void }) {
  const list = useRef<HTMLDivElement>(null);
  const { tree, commands, agentsRunning, commandsRunning } = work(view, index);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('.subagent-tree-row')?.focus();
    const away = (event: PointerEvent) => { const target = event.target as Element; if (!list.current?.contains(target) && !target.closest?.('[data-work-trigger]')) onClose(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  const row = (agent: Subagent, depth: number) => {
    const status = statusOf(view, agent), elapsed = agentElapsed({ ...agent, status }, now), title = subagentTitle(agent, view);
    return <li key={agent.id} data-depth={depth} data-kind={agent.kind} style={{ ['--depth' as string]: depth }} onContextMenu={menuFor(view, agent, title)}>
      <button type="button" className="subagent-tree-row" title={agent.kind === 'command' ? agent.command : undefined} onClick={() => { onClose(false); show(view, agent); }}>
        <SubagentMark status={status} size={12}/>
        {agent.kind === 'command' ? <span className="subagent-tree-name"><code>{title}</code></span> : <SubagentName agent={agent} view={view} className="subagent-tree-name"/>}
        <small>{statusWord[status]}{elapsed !== undefined ? ` · ${elapsedLabel(elapsed)}` : ''}</small>
      </button>
      {agent.kind === 'agent' && <button type="button" className="icon-button" aria-label={`Open ${title} in a panel`} title="Open in a panel" onClick={() => { onClose(false); view.open(agent.id); }}><Icon name="dock-right" size={13}/></button>}
    </li>;
  };
  return <div ref={list} className="subagent-tree" data-placement={placement} role="dialog" aria-label="Background work" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(true); } else roving(event, '.subagent-tree-row', ['ArrowUp', 'ArrowDown']); }}>
    <header><strong>Background work</strong><small>{agentsRunning.length + commandsRunning.length} running · {workNoun(tree.length, commands.length)} in all</small><button type="button" className="icon-button" aria-label="Close background work" onClick={() => onClose(true)}><Icon name="close" size={13}/></button></header>
    <div className="subagent-tree-body">
      {tree.length > 0 && <section aria-label="Sub-agents"><h4>Sub-agents</h4><ul>{tree.map(({ agent, depth }) => row(agent, depth))}</ul></section>}
      {commands.length > 0 && <section aria-label="Background commands"><h4>Background commands</h4><ul>{commands.map(agent => row(agent, 0))}</ul></section>}
      {!tree.length && !commands.length && <p className="subagent-empty">Nothing has run in the background yet.</p>}
    </div>
  </div>;
}

/**
 * What runs in the background, beside the composer: one chip each for the
 * sub-agents and background commands at work, side by side, with state and
 * how long it has run. A sub-agent's chip takes you to its card; a command's
 * opens its output. The list shows everything, sub-agents as a tree.
 */
export function SubagentTray({ live, rootBusy, fallback = null }: { live: LiveStatus; rootBusy: boolean; /** Shown when nothing runs in the background. */ fallback?: ReactNode }) {
  const view = useSubagentView();
  const index = useSubagentIndex(view);
  usePresentation(view);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const state = view ? work(view, index) : undefined;
  const busy = !!state && (state.agentsRunning.length + state.commandsRunning.length) > 0;
  const now = useNow(busy);
  if (!view || !state || !busy) return <>{fallback}</>;
  const { tree, commands, agentsRunning, commandsRunning } = state;
  // Chips are for the sub-agents the main agent started; a nested one shows on its top-level chip.
  const top = agentsRunning.filter(({ agent }) => agent.parentId === 'root' || !index.byId[agent.parentId]);
  const nestedRunning = (agent: Subagent): number => agent.children.reduce((sum, id) => { const child = index.byId[id]; return child ? sum + (activeSubagent(statusOf(view, child)) ? 1 : 0) + nestedRunning(child) : sum; }, 0);
  const counts = [agentsRunning.length && plural(agentsRunning.length, 'sub-agent', 'sub-agents'), commandsRunning.length && plural(commandsRunning.length, 'command', 'commands')].filter(Boolean).join(' · ');
  return <div className="subagent-tray" role="group" aria-label="Background work">
    {rootBusy && <span className="subagent-tray-root" aria-hidden="true"><LiveIndicator tone={live.tone}/>{live.text}</span>}
    <span className="subagent-tray-count" role="status">{counts} running</span>
    <div className="subagent-chips" role="toolbar" aria-label="Running in the background" onKeyDown={event => roving(event, '.subagent-chip', ['ArrowLeft', 'ArrowRight'])}>
      {(top.length ? top : agentsRunning).map(({ agent }) => {
        const status = statusOf(view, agent), elapsed = agentElapsed(agent, now), action = currentAction({ ...agent, status }), nested = nestedRunning(agent), title = subagentTitle(agent, view);
        return <button key={agent.id} type="button" className="subagent-chip" data-status={status}
          title={`${title}${action ? ` — ${action.text}` : ''}`} aria-label={`${title}, ${statusWord[status]}${elapsed !== undefined ? `, ${elapsedLabel(elapsed)}` : ''}. Show its card.`}
          onClick={() => view.reveal(agent.id)} onContextMenu={menuFor(view, agent, title)}>
          <LiveIndicator tone={status === 'waiting' ? 'waiting' : 'busy'}/>
          <SubagentName agent={agent} view={view} className="subagent-chip-name"/>
          {nested > 0 && <span className="subagent-chip-nested" title={`${plural(nested, 'nested sub-agent', 'nested sub-agents')} running`}>+{nested}</span>}
          {elapsed !== undefined && <time>{elapsedLabel(elapsed)}</time>}
        </button>;
      })}
      {commandsRunning.map(agent => {
        const elapsed = agentElapsed(agent, now), title = subagentTitle(agent, view);
        return <button key={agent.id} type="button" className="subagent-chip command" data-status={statusOf(view, agent)} title={agent.command || title}
          aria-label={`Background command ${title}, running${elapsed !== undefined ? `, ${elapsedLabel(elapsed)}` : ''}. Show its output.`} onClick={() => view.open(agent.id)} onContextMenu={menuFor(view, agent, title)}>
          <Icon name="terminal" size={12}/>
          <code className="subagent-chip-name">{title}</code>
          {elapsed !== undefined && <time>{elapsedLabel(elapsed)}</time>}
        </button>;
      })}
    </div>
    <button ref={trigger} type="button" className="subagent-tray-all" data-work-trigger aria-haspopup="dialog" aria-expanded={open} title="Every sub-agent and background command of this conversation, running or ended" onClick={() => setOpen(value => !value)}>
      <Icon name="subagent" size={13}/><span>All {tree.length + commands.length}<span className="subagent-tray-noun">{shortNoun(tree.length, commands.length) || ' in background'}</span></span>
    </button>
    {open && <WorkList view={view} index={index} now={now} placement="above" onClose={focus => { setOpen(false); if (focus) trigger.current?.focus(); }}/>}
  </div>;
}

/**
 * In the chat header, the way to everything that ran in the background, also
 * once nothing runs any more: hidden until something has.
 */
export function BackgroundWorkButton() {
  const view = useSubagentView();
  const index = useSubagentIndex(view);
  usePresentation(view);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const state = view ? work(view, index) : undefined;
  const running = state ? state.agentsRunning.length + state.commandsRunning.length : 0;
  const now = useNow(open && running > 0);
  if (!view || !state || !(state.tree.length + state.commands.length)) return null;
  const total = state.tree.length + state.commands.length;
  const failed = [...state.tree.map(n => n.agent), ...state.commands].filter(agent => statusOf(view, agent) === 'failed').length;
  return <span className="background-work">
    <button ref={trigger} type="button" className="icon-button background-work-button" data-work-trigger aria-haspopup="dialog" aria-expanded={open} data-running={running || undefined} data-failed={failed || undefined}
      aria-label={`Background work: ${total} in all${running ? `, ${running} running` : ''}${failed ? `, ${failed} failed` : ''}`}
      title={`${workNoun(state.tree.length, state.commands.length)}${running ? `, ${running} running` : ''}${failed ? `, ${failed} failed` : ''}. Show them all.`} onClick={() => setOpen(value => !value)}>
      <Icon name="subagent" size={14}/><span>{running ? <>{running}<span className="background-work-noun">{shortNoun(state.agentsRunning.length, state.commandsRunning.length)} running</span></> : <>{total}<span className="background-work-noun">{shortNoun(state.tree.length, state.commands.length) || ' in background'}</span></>}</span>
    </button>
    {open && <WorkList view={view} index={index} now={now} placement="below" onClose={focus => { setOpen(false); if (focus) trigger.current?.focus(); }}/>}
  </span>;
}

/**
 * A failed sub-agent or background command is news for its parent's status
 * line until the person has looked at it: one click takes them to it.
 */
export function SubagentAttention() {
  const view = useSubagentView();
  const index = useSubagentIndex(view);
  usePresentation(view);
  if (!view) return null;
  const failed = index.order.map(id => index.byId[id]).filter((agent): agent is Subagent => !!agent && statusOf(view, agent) === 'failed' && !view.seen.has(agent.id));
  if (!failed.length) return null;
  const agents = failed.filter(agent => agent.kind === 'agent').length, commands = failed.length - agents;
  const label = [agents && plural(agents, 'sub-agent', 'sub-agents'), commands && plural(commands, 'background command', 'background commands')].filter(Boolean).join(' and ') + ' failed';
  return <span className="subagent-attention">
    <button type="button" className="subagent-attention-show" aria-label={label} title={failed.map(agent => subagentTitle(agent, view)).join('\n')} onClick={() => { view.markSeen([failed[0].id]); show(view, failed[0]); }}><span className="live-indicator" data-tone="failed" aria-hidden="true"/><span className="subagent-attention-label" aria-hidden="true">{failed.length} failed</span></button>
    <button type="button" className="icon-button" aria-label={`Dismiss: ${label}`} title="Dismiss" onClick={() => view.markSeen(failed.map(agent => agent.id))}><Icon name="close" size={11}/></button>
  </span>;
}
