import { useEffect, useRef, useState } from 'react';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import type { ProcessInventory } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { useRunnerSettings } from './RunnerSettings';
import './runner-control.css';
import './processes.css';

/** The Runner's state in a word, restart first: it explains a dropped connection. */
function runnerState(runner: ReturnType<typeof useRunner>): { label: string; tone: 'ok' | 'busy' | 'bad' } {
  const { restart, connecting, error } = runner;
  if (restart.phase === 'restarting') return { label: 'Restarting…', tone: 'busy' };
  if (restart.phase === 'restarted') return { label: 'Restarted', tone: 'ok' };
  if (restart.phase === 'failed') return { label: 'Restart failed', tone: 'bad' };
  if (connecting) return { label: 'Connecting', tone: 'busy' };
  // Header says so when the Runner refuses this window's bearer, even while Info itself answered.
  if (error) return { label: runner.authFailed ? 'Not authorized' : 'Disconnected', tone: 'bad' };
  return { label: 'Connected', tone: 'ok' };
}

/** Header status. Opens the Runner settings when the window has them. */
export function RunnerIndicator({ onOpen }: { onOpen?(): void }) {
  const runner = useRunner();
  const { label, tone } = runnerState(runner);
  const detail = runner.restart.phase === 'failed' ? runner.restart.message : runner.error || (runner.connecting ? 'Connecting to Runner' : 'Runner connected');
  const className = `runner-indicator tone-${tone}${tone === 'bad' ? ' offline' : ''}`;
  if (!onOpen) return <span className={className} title={detail}><i/>{label}</span>;
  return <button type="button" className={className} title={`${detail}. Open Runner settings`} aria-label={`Runner status: ${label} (open Runner settings)`} onClick={onOpen}><i/>{label}</button>;
}

/** Workspace-wide notice for a restart the person asked for. */
export function RestartNotice() {
  const { restart, dismissRestart, restartRunner } = useRunner();
  if (restart.phase === 'restarting') return <div className="runner-notice tone-busy" role="status"><strong>Restarting the Runner…</strong> Agents, commands and terminals keep running. This window reconnects by itself.</div>;
  if (restart.phase === 'restarted') return <div className="runner-notice tone-ok" role="status"><strong>Runner restarted.</strong> Agents, commands and terminals kept running and are connected again.<button onClick={dismissRestart}>Dismiss</button></div>;
  if (restart.phase === 'failed') return <div className="error runner-notice" role="alert"><strong>Could not restart the Runner.</strong> {restart.message}<button onClick={() => void restartRunner()}>Try again</button><button onClick={dismissRestart}>Dismiss</button></div>;
  return null;
}

/** Settings → Runner: status, and Restart Runner when a launcher will start it again. */
export function RunnerSection({ onShowProcesses }: { onShowProcesses?(): void } = {}) {
  const runner = useRunner();
  const { info, restart, restartRunner } = runner;
  const [confirming, setConfirming] = useState(false);
  const { label, tone } = runnerState(runner);
  const available = !!info?.restartAvailable && !!info.instanceId;
  const restarting = restart.phase === 'restarting';
  return <section className="runner-preferences runner-control" aria-labelledby="runner-heading">
    <h2 id="runner-heading">Runner</h2>
    <p>The Runner is the local service behind this window. It runs your agents, managed commands and terminals.</p>
    <p className="runner-status"><span className={`runner-indicator tone-${tone}${tone === 'bad' ? ' offline' : ''}`}><i/>{label}</span></p>
    {!info && !restarting ? <p role="status">Waiting for the Runner…</p> : available || restarting ? <>
      <p>Restarting loads the Runner again, with its current code and configuration. Agents, managed commands and terminals keep running; the new Runner re-attaches to them and this window reconnects by itself.</p>
      <div><button className="primary" disabled={restarting} onClick={() => setConfirming(true)}>{restarting ? 'Restarting…' : restart.phase === 'failed' ? 'Try restarting again…' : 'Restart Runner…'}</button></div>
    </> : <div className="runner-unavailable" role="note">
      <p><strong>Restart is not available for this Runner.</strong> Nothing would start it again once it stops.</p>
      <p>A Runner launched with <code>make -C v2 dev</code> or <code>make -C v2 working</code> can be restarted here. For the Codefly-managed Working service, run <code>make -C v2 runner-service-stop</code> and then <code>make -C v2 runner-service-start</code>. Agents keep running across either restart.</p>
    </div>}
    <ProcessHostingSettings onShowProcesses={onShowProcesses}/>
    {confirming && <RestartRunnerDialog onClose={() => setConfirming(false)} onConfirm={() => { setConfirming(false); void restartRunner(); }}/>}
  </section>;
}

function RestartRunnerDialog({ onClose, onConfirm }: { onClose(): void; onConfirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), confirm = useRef<HTMLButtonElement>(null);
  // Restarting is the reason the dialog opened and it is not destructive: Enter confirms, Escape cancels.
  useEffect(() => { dialog.current?.showModal(); confirm.current?.focus(); }, []);
  return <DraggableDialog ref={dialog} className="restart-runner-dialog" aria-labelledby="restart-runner-title" aria-describedby="restart-runner-description" onCancel={onClose} onClose={onClose}>
    <DialogHeader><h2 id="restart-runner-title">Restart the Runner?</h2><button type="button" aria-label="Cancel restart" onClick={onClose}>×</button></DialogHeader>
    <p id="restart-runner-description">Agents, managed commands and terminals keep running. The new Runner re-attaches to them and this window reconnects by itself.</p>
    <p className="restart-note">Usually a few seconds; longer in Dev while the Runner is rebuilt. Something you send while it restarts may need to be sent again.</p>
    <footer>
      <button type="button" onClick={onClose}>Cancel</button>
      <button ref={confirm} type="button" className="primary" autoFocus data-autofocus onClick={onConfirm}>Restart Runner</button>
    </footer>
  </DraggableDialog>;
}

/** Settings → Runner: how new agents, commands and terminals are hosted. Applies to the
 * next process, without a restart; running processes keep the backend they started with. */
function ProcessHostingSettings({ onShowProcesses }: { onShowProcesses?(): void }) {
  const { api } = useRunner();
  const { settings, setSettings, error, setError } = useRunnerSettings();
  const [inventory, setInventory] = useState<ProcessInventory>();
  const [saving, setSaving] = useState(''), [saved, setSaved] = useState('');
  useEffect(() => {
    const control = new AbortController();
    const load = () => void api.listProcesses({}, { signal: control.signal, timeoutMs: 8000 }).then(value => { if (!control.signal.aborted) setInventory(value); }, () => { /* the section still works without it */ });
    load(); const timer = setInterval(load, 5000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api]);
  const hosting = inventory?.hosting, configured = hosting?.configured || 'sessionhost';
  // The choice shows at once; the radio settles on what the Runner saved.
  const chosen = saving || settings?.processBackend || configured;
  const running = inventory?.processes.filter(p => p.attached).length ?? 0;
  const tmuxReady = !!hosting?.tmuxVersion;
  const choose = async (backend: string) => {
    if (!settings || backend === chosen) return;
    setSaving(backend); setSaved(''); setError('');
    try {
      // Choosing the configured backend follows the Runner configuration again.
      setSettings(await api.saveRunnerSettings({ ...settings, processBackend: backend === configured ? '' : backend }));
      window.dispatchEvent(new Event('lazybox-settings-saved'));
      setSaved(backend === 'tmux' ? 'New processes will run in tmux. Running processes keep their hosts.' : 'New processes will run in session hosts. Running processes keep their hosts.');
      setInventory(await api.listProcesses({}));
    } catch (e) { setError(String(e)); }
    finally { setSaving(''); }
  };
  return <section className="runner-hosting" aria-labelledby="hosting-heading">
    <h3 id="hosting-heading">Process hosting</h3>
    <p>Agents, managed commands and terminals each run in a host that outlives the Runner, so a restart never stops them.</p>
    <fieldset disabled={!!saving || !settings}>
      <legend>Host new processes in</legend>
      <label className="hosting-choice"><input type="radio" name="process-backend" value="sessionhost" checked={chosen === 'sessionhost'} onChange={() => void choose('sessionhost')}/>
        <strong>Session hosts{configured === 'sessionhost' ? ' (default)' : ''}</strong>
        <span>Each process runs in a detached host of its own. Nothing to install.</span></label>
      <label className="hosting-choice"><input type="radio" name="process-backend" value="tmux" checked={chosen === 'tmux'} disabled={!tmuxReady && chosen !== 'tmux'} onChange={() => void choose('tmux')}/>
        <strong>tmux{configured === 'tmux' ? ' (default)' : ''}</strong>
        <span>Each process also gets a window in a private tmux server: watch it from any terminal with the attach command the Processes panel copies. Closing a window stops its process, and stopping that tmux server stops them all.{' '}
          {!hosting ? '' : tmuxReady ? `Found ${hosting.tmuxVersion}.` : `Unavailable: ${hosting.tmuxProblem}.`}</span></label>
    </fieldset>
    <p>A change applies to processes started from now on. Running processes keep the host they started in, and a Runner set either way re-attaches both.</p>
    {chosen === 'tmux' && hosting?.fallback && <p className="processes-notice tone-warn" role="status">{hosting.fallback}</p>}
    {error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    <div className="runner-processes-summary"><span>{inventory ? `${running} ${running === 1 ? 'process' : 'processes'} running.` : ''}</span>{onShowProcesses && <button type="button" onClick={onShowProcesses}>Show processes</button>}</div>
  </section>;
}
