import { useEffect, useState } from 'react';
import type { CommandStatus } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { Console } from './session-parts';
import { useRunner } from './RunnerContext';
import type { ViewTarget } from './workspace-model';
import { offerToComposer, runOrigin } from './command-runs';

export function CommandPanel({ target, onTarget, viewState, onOpenViewer }: { target: ViewTarget; onTarget(target: ViewTarget): void; viewState?: ViewStateStore; onOpenViewer?(sessionId: string, commandId: string): Promise<void> }) {
  const { api } = useRunner();
  const [commands, setCommands] = useState<CommandStatus[]>([]), [error, setError] = useState('');
  useEffect(() => {
    setCommands([]); setError(''); if (!target.sessionId) return;
    const control = new AbortController(); let updating = false;
    const update = async () => {
      if (updating) return; updating = true;
      try { const result = await api.listCommands({ sessionId: target.sessionId }, { signal: control.signal }); if (!control.signal.aborted) { setCommands(result.commands); setError(''); } }
      catch (error) { if (!control.signal.aborted) setError(String(error)); }
      finally { updating = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, target.sessionId]);
  // A command still running is what you want to see, even when a later one already finished.
  const selected = target.commandId || [...commands].reverse().find(command => !command.done)?.id || commands.at(-1)?.id || '';
  const mark = (command: CommandStatus) => command.done ? (command.exitCode === 0 || (command.exitCode === undefined && command.report?.exitCode === 0) ? '✓ ' : command.signal ? '■ ' : '✗ ') : '● ';
  // The run to read: the newest first, as people look for what just happened.
  const picker = <label className="command-picker"><select aria-label="Command" title="Choose which command’s output to read" value={commands.some(command => command.id === selected) ? selected : ''} onChange={event => onTarget({ ...target, commandId: event.target.value })}><option value="" disabled>Choose a command…</option>{[...commands].reverse().map(command => <option key={command.id} value={command.id}>{mark(command)}{command.title} · {runOrigin(command)}{command.done ? 'completed' : 'running'}</option>)}</select></label>;
  return <section className="command-panel">{error && <div className="error" role="alert">{error}</div>}
    {!target.sessionId ? <p className="module-empty">Open a conversation to see the output of the commands it runs.</p> : <>
      {selected && commands.some(command => command.id === selected) ? <Console key={selected} api={api} command={selected} viewState={viewState} onError={setError} toolbar={picker} onSendToAgent={text => offerToComposer(target.sessionId, text) ? '' : 'Show this conversation’s chat on the page to add the output to your message.'} onOpenViewer={onOpenViewer ? async () => { try { await onOpenViewer(target.sessionId, selected); } catch (error) { setError(String(error)); } } : undefined}/> : <>{commands.length > 0 && <div className="console-tools">{picker}</div>}<p className="module-empty">{selected ? 'That command’s output is no longer kept. Pick another one above.' : 'No command has run in this conversation yet. Output appears here when the agent, an action or `lazybox run` starts one.'}</p></>}
    </>}
  </section>;
}
