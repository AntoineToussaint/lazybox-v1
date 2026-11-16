import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentRequestCard, type RequestCardProps } from './RequestCards';
import { follow, type RunnerClient } from '@lazybox/client-core';
import type { CommandStatus } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { readConsoleState, writeConsoleState } from './view-state';
import { composeRunMessage, formatBytes, isRuntimeRun, isWorkspaceRun, reportSummary, runningLabel } from './command-runs';
import { AnsiText, stripAnsi } from './ansi';
import { Icon } from './Icons';
import { contextMenu, copyText, showMenuNotice } from './ContextMenu';

/** A question or approval the agent waits on (RequestCards.tsx). */
export function RequestCard(props: RequestCardProps) {
  return <AgentRequestCard {...props}/>;
}

/** onSendToAgent adds text to the viewed conversation's message and returns
 * "" or why it could not. Offered for runs from a workspace terminal. */
/**
 * One command's output. `toolbar` makes it the compact, docked form: what the
 * host passes (the command picker) leads a single row with the outcome, Stop,
 * find and copy, so a short panel is output, not chrome.
 */
export function Console({ api, command, onOpenViewer, viewState, onError, onSendToAgent, toolbar }: { api: RunnerClient; command: string; onOpenViewer?: () => void; viewState?: ViewStateStore; onError?: (error: string) => void; onSendToAgent?: (text: string) => string; toolbar?: ReactNode }) {
  const [text, setText] = useState('');
  // The output's text size: one choice for every console, remembered (A− / A+, ⌘− / ⌘+ in the output).
  const [fontSize, setFontSizeState] = useState(() => { try { const n = Number(localStorage.getItem('lazybox:console.font-size')); return n >= 9 && n <= 16 ? n : 11; } catch { return 11; } });
  const setFontSize = (n: number) => { const next = Math.min(16, Math.max(9, n)); setFontSizeState(next); try { localStorage.setItem('lazybox:console.font-size', String(next)); } catch { /* a convenience */ } };
  const [status, setStatus] = useState('Connecting');
  const [metadata, setMetadata] = useState<CommandStatus>();
  const [followOutput, setFollowOutput] = useState(true);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0n);
  const pane = useRef<HTMLPreElement>(null);
  const restoreScroll = useRef<number | null>(null);
  const saveView = (search: string, follow: boolean) => {
    try { writeConsoleState(viewState, command, { search, follow, scrollTop: pane.current?.scrollTop || 0 }); }
    catch (error) { onError?.(`Could not save console view: ${String(error)}`); }
  };
  useEffect(() => {
    setText(''); setMetadata(undefined); setOffset(0n);
    try { const saved = readConsoleState(viewState, command); setSearch(saved.search); setFollowOutput(saved.follow); restoreScroll.current = saved.scrollTop; }
    catch (error) { onError?.(`Could not restore console view: ${String(error)}`); }
    const control = new AbortController(); const decoders = new Map<string, TextDecoder>();
    void follow((after, signal) => api.watchOutput({ commandId: command, after }, { signal }), control.signal, event => {
      if (event.data.length) {
        let decoder = decoders.get(event.channel); if (!decoder) { decoder = new TextDecoder(); decoders.set(event.channel, decoder); }
        const chunk = decoder.decode(event.data, { stream: true });
        setText(value => (value + chunk).slice(-524288)); setOffset(event.offset + BigInt(event.data.length));
      }
      if (event.status) setMetadata(event.status);
    }, setStatus);
    return () => control.abort();
  }, [api, command, viewState]);
  useEffect(() => {
    const element = pane.current; if (!element) return;
    if (followOutput) element.scrollTo({ top: element.scrollHeight });
    else if (restoreScroll.current !== null && (element.scrollHeight - element.clientHeight >= restoreScroll.current || status === 'Complete')) {
      element.scrollTo({ top: restoreScroll.current }); restoreScroll.current = null;
    }
  }, [text, followOutput, status]);
  const report = metadata?.report;
  const running = !!metadata && !metadata.done;
  // What happened, in words: never a stale "exit 0" for a command still running.
  const outcome = !metadata ? { tone: 'idle', text: status === 'Connecting' ? 'Connecting…' : status }
    : running ? { tone: 'running', text: runningLabel(metadata) }
    : metadata.captureError ? { tone: 'failed', text: 'Output incomplete' }
    : metadata.signal ? { tone: 'stopped', text: `Stopped (${metadata.signal})` }
    : metadata.exitCode === undefined ? (report && !report.piped ? (report.exitCode === 0 ? { tone: 'ok', text: 'Finished' } : { tone: 'failed', text: `Failed · exit ${report.exitCode}` }) : { tone: 'idle', text: 'Ended' })
    : metadata.exitCode === 0 ? { tone: 'ok', text: 'Finished' } : { tone: 'failed', text: `Failed · exit ${metadata.exitCode}` };
  const fromTerminal = !!metadata && isWorkspaceRun(metadata) && !isRuntimeRun(metadata);
  const runtimeEyebrow = metadata && isRuntimeRun(metadata) ? ({ action: 'Workspace action', setup: 'Setup script', archive: 'Archive script' } as Record<string, string>)[metadata.origin] : '';
  const [handed, setHanded] = useState<{ ok: boolean; text: string }>();
  useEffect(() => setHanded(undefined), [command]);
  const view = report?.agentView || '';
  const sendToAgent = () => {
    if (!metadata || !view || !onSendToAgent) return;
    const problem = onSendToAgent(composeRunMessage(metadata, view));
    setHanded(problem ? { ok: false, text: problem } : { ok: true, text: `Added ${formatBytes(report!.agentBytes)} to your message. Review it and send when ready.` });
  };
  const shareTitle = !metadata?.done ? 'Available when the output ends.' : !view ? 'This run has no compact view: its output did not end cleanly.' : `Adds the compact view (${formatBytes(report!.agentBytes)}: outcome and failures first, plus the full-output path) to your message. You decide when to send it.`;
  // The command as typed: a shell line is its script, anything else its words.
  const commandLine = metadata ? (metadata.argv.length === 3 && /(^|\/)(ba|z)?sh$/.test(metadata.argv[0]) && /^-l?c$/.test(metadata.argv[1]) ? metadata.argv[2] : metadata.argv.join(' ')) : '';
  const menu = contextMenu('command', () => [
    running && { label: 'Stop', icon: 'stop', danger: true, run: () => api.cancelCommand({ commandId: command }).then(() => showMenuNotice('Stopping…')) },
    metadata?.done && !fromTerminal && metadata.sessionId && metadata.argv.length > 0 && { label: 'Run again', icon: 'play', run: () => api.startCommand({ sessionId: metadata.sessionId, title: metadata.title, argv: metadata.argv, cwd: metadata.cwd }).then(() => showMenuNotice(`Started “${metadata.title}” again`)) },
    'separator',
    { label: 'Copy output', icon: 'copy', disabled: !text && 'No output yet', run: () => copyText(stripAnsi(text), 'Copied output') },
    commandLine && { label: 'Copy command', icon: 'copy', run: () => copyText(commandLine, 'Copied command') },
    report?.outputPath && { label: 'Copy log path', icon: 'copy', run: () => copyText(report.outputPath, 'Copied log path') },
    'separator',
    onOpenViewer && { label: 'Open output in a window', icon: 'external', run: onOpenViewer },
    fromTerminal && onSendToAgent && { label: 'Send to agent', icon: 'send', disabled: !metadata?.done ? 'Available when the output ends' : !view && 'This run has no compact view', run: sendToAgent },
  ], { commandId: command });
  const size = formatBytes(offset);
  const state = <span className="console-state">{running && <button className="console-stop" title="Stop this command (its process group gets SIGTERM, then SIGKILL)" onClick={() => void api.cancelCommand({ commandId: command }).catch(error => onError?.(`Could not stop the command: ${String(error)}`))}><Icon name="stop" size={11}/>Stop</button>}<span className={`pill run-${outcome.tone}`} role="status" title={`${size} of output so far`}>{outcome.text}</span></span>;
  return <section className={`console${toolbar ? ' console-docked' : ''}`} onContextMenu={menu}>{!toolbar && <div className="panel-title"><div><span className="eyebrow">{runtimeEyebrow || (fromTerminal ? 'From your terminal' : 'Shared console')}</span><h2>{metadata?.title || 'Command output'}</h2></div>{state}</div>}
    {/* Shown in every console, including the workspace's (which hides the title): what an agent gets, and the hand-over. */}
    {(report || (fromTerminal && onSendToAgent)) && <div className="command-meta">{fromTerminal && <span className="command-origin">From your terminal</span>}
      {report && <p className="command-report" data-testid="command-report"><span>{reportSummary(report, fromTerminal)}</span>{report.outputPath && <button title={report.outputPath} onClick={() => navigator.clipboard.writeText(report.outputPath).catch(error => onError?.(String(error)))}>Copy log path</button>}</p>}
      {fromTerminal && onSendToAgent && <p className="command-share"><button className="primary" disabled={!metadata.done || !view} title={shareTitle} onClick={sendToAgent}>Send to agent</button>{handed ? <small role={handed.ok ? 'status' : 'alert'} className={handed.ok ? '' : 'error-text'}>{handed.text}</small> : <small>{metadata.done ? view ? `The agent gets ${formatBytes(report!.agentBytes)}, not the ${formatBytes(report!.outputBytes)} above.` : '' : 'You can send it to an agent when the output ends.'}</small>}</p>}</div>}
    <div className="console-tools">{toolbar}{toolbar && state}<input aria-label="Search output" placeholder="Find in output…" value={search}
      onKeyDown={e => { if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch(''); restoreScroll.current = null; saveView('', followOutput); } }}
      onChange={e => { setSearch(e.target.value); restoreScroll.current = null; saveView(e.target.value, followOutput); }}/><span className="console-size" role="group" aria-label="Output text size"><button type="button" className="icon-button" aria-label="Smaller output text" title={`Smaller text (${fontSize}px)`} disabled={fontSize <= 9} onClick={() => setFontSize(fontSize - 1)}>A−</button><button type="button" className="icon-button" aria-label="Larger output text" title={`Larger text (${fontSize}px)`} disabled={fontSize >= 16} onClick={() => setFontSize(fontSize + 1)}>A+</button></span>{toolbar
        ? <><button className="icon-button" aria-label="Copy output" title="Copy the output" disabled={!text} onClick={() => copyText(stripAnsi(text), 'Copied output')}><Icon name="copy" size={14}/></button>{onOpenViewer && <button className="icon-button" aria-label="Open output in a window" title="Open this output in its own window" onClick={onOpenViewer}><Icon name="external" size={14}/></button>}</>
        : <><button onClick={() => navigator.clipboard.writeText(stripAnsi(text)).catch(error => onError?.(String(error)))}>Copy</button>{onOpenViewer && <button onClick={onOpenViewer}>Open viewer ↗</button>}</>}</div>
    <pre ref={pane} tabIndex={0} className="output" data-testid="console-output" style={{ fontSize: `calc(${fontSize}px * var(--code-scale, 1))` }} onKeyDown={event => { if (!(event.metaKey || event.ctrlKey)) return; const step = event.key === '=' || event.key === '+' ? 1 : event.key === '-' ? -1 : 0; if (step) { event.preventDefault(); event.stopPropagation(); setFontSize(fontSize + step); } }} onWheel={() => { restoreScroll.current = null; }} onScroll={event => { const node = event.currentTarget; const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 24; if (restoreScroll.current !== null) return; if (atEnd !== followOutput) setFollowOutput(atEnd); saveView(search, atEnd); }}>{text ? <AnsiText text={text} filter={search}/> : 'Waiting for output…'}</pre>
    {!followOutput && text && <button className="console-jump" onClick={() => { setFollowOutput(true); restoreScroll.current = null; pane.current?.scrollTo({ top: pane.current.scrollHeight }); saveView(search, true); }}>↓ Latest output</button>}
    <footer><span className="mono" title={`Command ${command}`}>{size} of output</span><span>{metadata?.captureError || (metadata?.done ? metadata.exitCode === undefined ? report && !report.piped ? `Exit ${report.exitCode}` : 'Capture EOF · upstream exit unknown' : `Exit ${metadata.exitCode}${metadata.signal ? ' · ' + metadata.signal : ''}` : 'Running')}</span></footer>
    <small className="retention">Showing up to the last 512 KiB. Full retained output is available through command reads until the configured spool budget is exhausted.</small>
  </section>;
}

