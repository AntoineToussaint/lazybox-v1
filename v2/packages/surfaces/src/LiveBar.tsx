import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { follow, type RunnerClient } from '@lazybox/client-core';
import type { CommandStatus, JournalEvent, Session } from '@lazybox/protocol';
import { Icon } from './Icons';
import { LiveIndicator, useNow } from './LiveIndicator';
import { elapsedLabel, type LiveStatus } from './live-status';
import { isManagedCommandTool, outputLines, rootStep, runningCommand, stepDetail, commandParts } from './live-step';
import { LiveActivity } from './SessionNotices';
import { SubagentTray, useBackgroundRunning } from './SubagentTray';
import './live-bar.css';
import { contextMenu, copyText } from './ContextMenu';
import { stripAnsi } from './ansi';

const TAIL_BYTES = 32768;

/** The newest output of a Lazybox-managed command, as it streams. */
function useCommandTail(api: RunnerClient, commandId: string): string {
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (!commandId) return;
    const control = new AbortController(), decoders = new Map<string, TextDecoder>();
    void follow((after, signal) => api.watchOutput({ commandId, after }, { signal }), control.signal, event => {
      if (!event.data.length) return;
      let decoder = decoders.get(event.channel); if (!decoder) { decoder = new TextDecoder(); decoders.set(event.channel, decoder); }
      const chunk = decoder.decode(event.data, { stream: true });
      setText(value => (value + chunk).slice(-TAIL_BYTES));
    }, () => {}, () => {});
    return () => control.abort();
  }, [api, commandId]);
  return text;
}

/** This conversation's commands, while it works: the Runner owns their output. */
function useSessionCommands(api: RunnerClient, sessionId: string, active: boolean): CommandStatus[] {
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  useEffect(() => {
    if (!active || !sessionId) { setCommands([]); return; }
    const control = new AbortController();
    const update = () => api.listCommands({ sessionId }, { signal: control.signal }).then(result => { if (!control.signal.aborted) setCommands(result.commands); }, () => {});
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, sessionId, active]);
  return commands;
}

/**
 * What the running turn is doing, in one calm bar above the composer: the
 * step in words with its actual command and where it runs, how long it has
 * taken, the live output of a Lazybox-managed command (the last lines, more
 * on request, or the whole of it in the console), the right Stop, and the
 * sub-agents and background commands at work.
 */
export function LiveBar({ api, session, sessionID, live, disconnected, activity, onInterrupt, onOpenCommand }: {
  api: RunnerClient;
  session?: Session;
  sessionID: string;
  live: LiveStatus;
  disconnected: boolean;
  /** The conversation's retained activity events (tool calls). */
  activity: readonly JournalEvent[];
  onInterrupt(): void;
  /** Shows a managed command in the console. */
  onOpenCommand?(commandId: string): void;
}) {
  const rootBusy = !!session?.busy && !session.closed && live.tone === 'busy';
  const background = useBackgroundRunning();
  const step = useMemo(() => rootBusy ? rootStep(activity) : undefined, [rootBusy, activity]);
  const commands = useSessionCommands(api, sessionID, rootBusy);
  const managed = rootBusy ? runningCommand(commands, sessionID) : undefined;
  const tail = useCommandTail(api, managed?.id || '');
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState('');
  const [error, setError] = useState('');
  const outputId = useId();
  // When a command was first seen running, for one the journal gives no start of.
  const seen = useRef(new Map<string, number>());
  if (managed && !seen.current.has(managed.id)) seen.current.set(managed.id, Date.now());
  const now = useNow(rootBusy);
  useEffect(() => { setExpanded(false); setStopping(''); setError(''); }, [managed?.id]);
  if (disconnected || !session || session.closed) return <LiveActivity disconnected={disconnected} live={live} session={session}/>;
  // Working without a turn the Runner holds (a status between turns): the plain line, as before.
  if (!rootBusy && !background) return <LiveActivity disconnected={false} live={live} session={session}/>;
  if (!rootBusy) return <div className="live-bar" data-only="background"><SubagentTray live={live} rootBusy={false}/></div>;

  const detail = managed && (!step || isManagedCommandTool(step.name) || !stepDetail(step).code)
    ? { ...commandParts(managed.argv.length ? managed.argv.join(' ') : managed.title), full: managed.argv.join(' ') || managed.title }
    : step ? stepDetail(step) : {};
  const startedAt = step?.startedAt ?? (managed ? seen.current.get(managed.id) : undefined);
  const lines = managed ? outputLines(tail, expanded ? 40 : 3) : [];
  const stop = async () => {
    if (!managed) { onInterrupt(); return; }
    setStopping(managed.id); setError('');
    try { await api.cancelCommand({ commandId: managed.id }); }
    catch (e) { setError(`Could not stop the command: ${String(e)}`); setStopping(''); }
  };
  // The bar's buttons, and copying what runs, on a right-click.
  const menu = contextMenu('live-bar', () => [
    { label: managed ? 'Stop command' : 'Interrupt', icon: 'stop', danger: true, disabled: !!managed && stopping === managed.id && 'Stopping…', run: () => stop() },
    managed && onOpenCommand && { label: 'Open in console', icon: 'output', run: () => onOpenCommand(managed.id) },
    managed && { label: expanded ? 'Less output' : 'More output', icon: expanded ? 'collapse' : 'expand', run: () => setExpanded(value => !value) },
    'separator',
    // The command Stop and the console are about, else the step's own.
    !!(managed ? managed.argv.join(' ') || managed.title : detail.full) && { label: 'Copy command', icon: 'copy', run: () => copyText(managed ? managed.argv.join(' ') || managed.title : detail.full!, 'Copied command') },
    managed && !!tail && { label: 'Copy output', icon: 'copy', run: () => copyText(stripAnsi(tail), 'Copied output') },
  ], { sessionId: sessionID, commandId: managed?.id || '' }, 'Running turn actions');
  return <section className="live-bar" aria-label="What the agent is doing" onContextMenu={menu}>
    <div className="live-bar-row">
      <LiveIndicator tone="busy"/>
      {/* The step and its time, as the status line says them. */}
      <span className="live-activity" data-tone="busy" aria-hidden="true">{detail.code ? live.label : detail.words || live.label}{startedAt !== undefined && now >= startedAt ? ` · ${elapsedLabel(now - startedAt)}` : live.text.slice(live.label.length) || '…'}</span>
      {detail.code && <code className="live-bar-code" title={detail.full}>{detail.code}</code>}
      {detail.where && <span className="live-bar-where" title={detail.where}>in <code>{detail.where}</code></span>}
      <span className="live-bar-actions">
        {managed && <button type="button" className="live-bar-button" aria-expanded={expanded} aria-controls={outputId} onClick={() => setExpanded(value => !value)}><Icon name={expanded ? 'collapse' : 'expand'} size={12}/><span>{expanded ? 'Less output' : 'More output'}</span></button>}
        {managed && onOpenCommand && <button type="button" className="live-bar-button" onClick={() => onOpenCommand(managed.id)} title="The whole output, with search, in the command console"><Icon name="output" size={12}/><span>Open in console</span></button>}
        <button type="button" className="live-bar-button live-bar-stop" disabled={!!managed && stopping === managed.id}
          title={managed ? 'Stop this command: its process group gets SIGTERM, then SIGKILL. The agent sees it ended.' : 'Interrupt the agent’s turn. The conversation continues with your next message.'}
          onClick={() => void stop()}>
          <Icon name="stop" size={11}/><span>{managed ? stopping === managed.id ? 'Stopping…' : 'Stop command' : 'Interrupt'}</span>
        </button>
      </span>
    </div>
    {managed && <pre id={outputId} className="live-bar-output" data-expanded={expanded || undefined} aria-label={`Latest output of ${managed.title || 'the command'}`} tabIndex={expanded ? 0 : -1}>{lines.length ? lines.join('\n') : <span className="live-bar-quiet">No output yet.</span>}</pre>}
    {error && <p className="live-bar-error" role="alert">{error}</p>}
    {background > 0 && <SubagentTray live={live} rootBusy={false}/>}
  </section>;
}
