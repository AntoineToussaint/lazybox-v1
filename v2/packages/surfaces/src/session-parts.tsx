import { CodeBlock, RichContent } from './RichContent';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { follow, providerData, type RunnerClient } from '@lazybox/client-core';
import { Decision, type AgentEvent, type CommandStatus } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { readConsoleState, writeConsoleState } from './view-state';
import { composeRunMessage, formatBytes, isWorkspaceRun, reportSummary } from './command-runs';
import { isSettingsUpdate, SettingsProposal } from './SettingsProposal';
import { AnsiText, stripAnsi } from './ansi';
import { Icon } from './Icons';

export function RequestCard({ request, api, session, onError }: { request: AgentEvent; api: RunnerClient; session: string; onError: (s: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(false);
  const data = providerData(request.providerDataJson);
  const input = data.input || data.arguments || data;
  const description = typeof input.description === 'string' ? input.description : typeof data.reason === 'string' ? data.reason : '';
  const command = typeof input.command === 'string' ? input.command : Array.isArray(input.command) ? input.command.join(' ') : Array.isArray(input.argv) ? input.argv.join(' ') : '';
  const questions: any[] = data.questions || data.input?.questions || [];
  const decide = async (decision: Decision) => {
    setWaiting(true);
    try { await api.apply({ sessionId: session, operationId: crypto.randomUUID(), operation: { case: 'approval', value: { requestId: request.requestId, decision } } }); }
    catch (e) { onError(String(e)); setWaiting(false); }
  };
  const answer = async (event: FormEvent) => {
    event.preventDefault(); setWaiting(true);
    try { await api.apply({ sessionId: session, operationId: crypto.randomUUID(), operation: { case: 'answer', value: { requestId: request.requestId, answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { values: [value] }])) } } }); }
    catch (e) { onError(String(e)); setWaiting(false); }
  };
  const settings = request.type !== 'question' && isSettingsUpdate(data.tool);
  return <article className="request"><div className="eyebrow">{request.type === 'question' ? 'Agent question' : 'Approval required'}</div><h3>{settings ? 'Change Lazybox settings' : request.text || 'Your response is needed'}</h3>
    {description && <div className="approval-description"><RichContent text={description}/></div>}
    {settings ? <SettingsProposal input={input} api={api}/> : command ? <CodeBlock text={command} language="bash" label="Command"/> : request.type!=='question' && <CodeBlock text={JSON.stringify(input,null,2)} language="json" label="Requested input"/>}
    <details className="request-metadata"><summary>Request details</summary><CodeBlock text={JSON.stringify(data,null,2)} language="json"/><small className="mono">{request.requestId}</small></details>
    {request.type === 'question' ? <form onSubmit={answer}>{questions.map((q, i) => {
      const key = q.id || q.question; return <label key={key || i}>{q.question || q.header}
        {q.options?.length > 0 && <small>{q.options.map((o: any) => o.label).join(' / ')}</small>}
        <input required value={answers[key] || ''} onChange={e => setAnswers({ ...answers, [key]: e.target.value })}/></label>;
    })}<button disabled={waiting || !questions.length}>Send answer</button></form> : <div className="row"><button disabled={waiting} onClick={() => void decide(Decision.DECLINE)}>Decline</button><button className="primary" disabled={waiting || request.text === 'item/permissions/requestApproval'} onClick={() => void decide(Decision.ACCEPT)}>Allow once</button></div>}
  </article>;
}

/** onSendToAgent adds text to the viewed conversation's message and returns
 * "" or why it could not. Offered for runs from a workspace terminal. */
export function Console({ api, command, onOpenViewer, viewState, onError, onSendToAgent }: { api: RunnerClient; command: string; onOpenViewer?: () => void; viewState?: ViewStateStore; onError?: (error: string) => void; onSendToAgent?: (text: string) => string }) {
  const [text, setText] = useState('');
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
    : running ? { tone: 'running', text: 'Running' }
    : metadata.captureError ? { tone: 'failed', text: 'Output incomplete' }
    : metadata.signal ? { tone: 'stopped', text: `Stopped (${metadata.signal})` }
    : metadata.exitCode === undefined ? (report && !report.piped ? (report.exitCode === 0 ? { tone: 'ok', text: 'Finished' } : { tone: 'failed', text: `Failed · exit ${report.exitCode}` }) : { tone: 'idle', text: 'Ended' })
    : metadata.exitCode === 0 ? { tone: 'ok', text: 'Finished' } : { tone: 'failed', text: `Failed · exit ${metadata.exitCode}` };
  const fromTerminal = !!metadata && isWorkspaceRun(metadata);
  const [handed, setHanded] = useState<{ ok: boolean; text: string }>();
  useEffect(() => setHanded(undefined), [command]);
  const view = report?.agentView || '';
  const sendToAgent = () => {
    if (!metadata || !view || !onSendToAgent) return;
    const problem = onSendToAgent(composeRunMessage(metadata, view));
    setHanded(problem ? { ok: false, text: problem } : { ok: true, text: `Added ${formatBytes(report!.agentBytes)} to your message. Review it and send when ready.` });
  };
  const shareTitle = !metadata?.done ? 'Available when the output ends.' : !view ? 'This run has no compact view: its output did not end cleanly.' : `Adds the compact view (${formatBytes(report!.agentBytes)}: outcome and failures first, plus the full-output path) to your message. You decide when to send it.`;
  return <section className="console"><div className="panel-title"><div><span className="eyebrow">{fromTerminal ? 'From your terminal' : 'Shared console'}</span><h2>{metadata?.title || 'Command output'}</h2></div><span className="console-state">{running && <button className="console-stop" title="Stop this command (its process group gets SIGTERM, then SIGKILL)" onClick={() => void api.cancelCommand({ commandId: command }).catch(error => onError?.(`Could not stop the command: ${String(error)}`))}><Icon name="close" size={12}/>Stop</button>}<span className={`pill run-${outcome.tone}`} role="status">{outcome.text}</span></span></div>
    {/* Shown in every console, including the workspace's (which hides the title): what an agent gets, and the hand-over. */}
    {(report || (fromTerminal && onSendToAgent)) && <div className="command-meta">{fromTerminal && <span className="command-origin">From your terminal</span>}
      {report && <p className="command-report" data-testid="command-report"><span>{reportSummary(report, fromTerminal)}</span>{report.outputPath && <button title={report.outputPath} onClick={() => navigator.clipboard.writeText(report.outputPath).catch(error => onError?.(String(error)))}>Copy log path</button>}</p>}
      {fromTerminal && onSendToAgent && <p className="command-share"><button className="primary" disabled={!metadata.done || !view} title={shareTitle} onClick={sendToAgent}>Send to agent</button>{handed ? <small role={handed.ok ? 'status' : 'alert'} className={handed.ok ? '' : 'error-text'}>{handed.text}</small> : <small>{metadata.done ? view ? `The agent gets ${formatBytes(report!.agentBytes)}, not the ${formatBytes(report!.outputBytes)} above.` : '' : 'You can send it to an agent when the output ends.'}</small>}</p>}</div>}
    <div className="console-tools"><input aria-label="Search output" placeholder="Find in output…" value={search} onChange={e => { setSearch(e.target.value); restoreScroll.current = null; saveView(e.target.value, followOutput); }}/><button onClick={() => navigator.clipboard.writeText(stripAnsi(text)).catch(error => onError?.(String(error)))}>Copy</button>{onOpenViewer && <button onClick={onOpenViewer}>Open viewer ↗</button>}</div>
    <pre ref={pane} tabIndex={0} className="output" data-testid="console-output" onWheel={() => { restoreScroll.current = null; }} onScroll={event => { const node = event.currentTarget; const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 24; if (restoreScroll.current !== null) return; if (atEnd !== followOutput) setFollowOutput(atEnd); saveView(search, atEnd); }}>{text ? <AnsiText text={text} filter={search}/> : 'Waiting for output…'}</pre>
    {!followOutput && text && <button className="console-jump" onClick={() => { setFollowOutput(true); restoreScroll.current = null; pane.current?.scrollTo({ top: pane.current.scrollHeight }); saveView(search, true); }}>↓ Latest output</button>}
    <footer><span className="mono">{command.slice(0, 12)} · {offset.toString()} bytes</span><span>{metadata?.captureError || (metadata?.done ? metadata.exitCode === undefined ? report && !report.piped ? `Exit ${report.exitCode}` : 'Capture EOF · upstream exit unknown' : `Exit ${metadata.exitCode}${metadata.signal ? ' · ' + metadata.signal : ''}` : 'Running')}</span></footer>
    <small className="retention">Showing up to the last 512 KiB. Full retained output is available through command reads until the configured spool budget is exhausted.</small>
  </section>;
}

