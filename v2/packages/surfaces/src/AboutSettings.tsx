import { useEffect, useRef, useState } from 'react';
import type { AppHost, AppInfo } from '@lazybox/platform';
import type { AgentCliCheck } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { SettingsGroup, SettingsHeader, SettingsRow } from './settings-parts';
import { checkForUpdate, installUpdate, progressText, useAppUpdate, dismissUpdate } from './app-update';
import { openOnboarding } from './Onboarding';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Icon } from './Icons';
import { agentCliStatus } from './lazybox-cli';
import './about.css';

/**
 * Settings → About: the one version the app, its Runner and its CLI share,
 * updates for an installed release, and the CLI on PATH.
 */
export function AboutSettings({ app }: { app?: AppHost }) {
  const { api, revision } = useRunner();
  const [info, setInfo] = useState<AppInfo>();
  const [runnerVersion, setRunnerVersion] = useState('');
  const [agentCli, setAgentCli] = useState<AgentCliCheck>();
  const [link, setLink] = useState<{ link: string; hints: string[] } | { error: string }>();
  const update = useAppUpdate(app);
  useEffect(() => { void app?.info().then(setInfo, () => {}); }, [app]);
  useEffect(() => {
    const control = new AbortController();
    void api.version({}, { signal: control.signal, timeoutMs: 5000 }).then(v => { setRunnerVersion(v.version); setAgentCli(v.agentCli); }, () => setRunnerVersion(''));
    return () => control.abort();
  }, [api, revision]);
  const release = info?.channel === 'release';
  const mismatch = release && runnerVersion && info && runnerVersion !== info.version;
  return <>
    <SettingsHeader title="About Lazybox" description={release ? 'This app, its Runner and the lazybox command are one release and update together.' : 'A development build: it updates through make -C v2 stage and promote, not by itself.'}
      actions={<button onClick={() => openOnboarding('whats-new')}><Icon name="notes" size={14}/> What's new</button>}/>
    <SettingsGroup title="Version">
      <SettingsRow label="Lazybox" description={release ? 'The installed app' : info ? `Build ${info.channel}` : 'In a browser, the app version is the Runner\'s'}>
        <span className="about-version">{info?.version || '—'}</span>
      </SettingsRow>
      <SettingsRow label="Runner" description={mismatch ? 'Different from the app: it moves to the app\'s version when the app next starts.' : 'The background service your agents run in'}>
        <span className={`about-version${mismatch ? ' is-warn' : ''}`}>{runnerVersion || 'not answering'}</span>
      </SettingsRow>
    </SettingsGroup>
    {info?.updater && <SettingsGroup title="Updates" description="Lazybox checks for a new version every few hours. Installing one restarts the app and the Runner; running agents keep working.">
      <SettingsRow label={update.available ? `Lazybox ${update.available.version} is available` : 'Up to date'}
        description={update.installing ? progressText(update.installing) : update.error ? update.error : update.checking ? 'Checking…' : update.checkedAt ? `Checked ${new Date(update.checkedAt).toLocaleTimeString()}` : 'Not checked yet'}>
        {update.available
          ? <button className="primary" disabled={!!update.installing} onClick={() => void installUpdate(app)}>{update.installing ? 'Updating…' : 'Restart to update'}</button>
          : <button disabled={update.checking} onClick={() => void checkForUpdate(app)}>{update.checking ? 'Checking…' : 'Check for updates'}</button>}
      </SettingsRow>
      {update.available?.notes && <pre className="about-notes" aria-label={`What's new in ${update.available.version}`}>{update.available.notes}</pre>}
    </SettingsGroup>}
    {agentCli && <AgentCliRow check={agentCli}/>}
    {app?.linkCli && release && <SettingsGroup title="Command line" description="The lazybox command does from a terminal what you do here: lazybox ls, lazybox send, lazybox doctor.">
      <SettingsRow label="lazybox on your PATH" description={info?.cli ? `Runs ${info.cli}` : undefined}>
        <button onClick={() => void app.linkCli!().then(setLink, error => setLink({ error: String(error) }))}><Icon name="terminal" size={14}/> Add to terminal</button>
      </SettingsRow>
      {link && ('error' in link ? <p className="settings-error" role="alert">{link.error}</p> : <div className="about-link" role="status">
        <p>Linked at <code>{link.link}</code>. Open a new terminal and run <code>lazybox doctor</code>.</p>
        {link.hints.map(h => <p key={h} className="about-hint">{h}</p>)}
      </div>)}
    </SettingsGroup>}
  </>;
}

/**
 * Which lazybox agents run: shell startup files can put another one (V1's)
 * first on PATH. Lazybox puts its own back first; this says so, and how to
 * fix what it cannot.
 */
export function AgentCliRow({ check }: { check: AgentCliCheck }) {
  const status = agentCliStatus(check);
  return <SettingsGroup title="Agents" description="Agents run every command in your shell, so its startup files decide which lazybox they reach.">
    <SettingsRow label="lazybox for agents" description={check.notice || (check.problem ? `Could not check ${check.shell}: ${check.problem}` : `Agents run ${check.cli}`)}>
      <span className={`about-version${status.tone === 'ok' ? '' : ' is-warn'}`} role="status" title={check.unfixed.join('\n') || check.shadowIn.join(', ') || undefined}>{status.label}</span>
    </SettingsRow>
  </SettingsGroup>;
}

/**
 * A quiet notice in the header while an update is waiting: what it is, what
 * changed, and one button that installs it. Put away until the next version.
 */
export function UpdateNotice({ app }: { app?: AppHost }) {
  const update = useAppUpdate(app);
  const [notesOpen, setNotesOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; if (notesOpen && node && !node.open) node.showModal(); }, [notesOpen]);
  const available = update.available;
  if (!available || update.dismissed === available.version) return null;
  return <div className="update-notice" role="status">
    <Icon name="sparkle" size={14}/>
    <span>{update.installing ? progressText(update.installing) : `Lazybox ${available.version}`}</span>
    {!update.installing && <>
      <button className="update-notice-link" onClick={() => setNotesOpen(true)}>What's new</button>
      <button className="update-notice-primary" onClick={() => void installUpdate(app)}>Restart to update</button>
      <button className="update-notice-close" aria-label="Not now" title="Not now: remind me with the next version" onClick={dismissUpdate}><Icon name="close" size={12}/></button>
    </>}
    {update.error && !update.installing && <span className="update-notice-error" role="alert" title={update.error}>Update failed</span>}
    {notesOpen && <DraggableDialog ref={dialog} className="update-notes-dialog" aria-labelledby="update-notes-title" onCancel={event => { event.preventDefault(); setNotesOpen(false); }} onClose={() => setNotesOpen(false)}>
      <DialogHeader><h2 id="update-notes-title">What's new in Lazybox {available.version}</h2><button aria-label="Close" onClick={() => setNotesOpen(false)}>×</button></DialogHeader>
      <pre className="about-notes">{available.notes || 'No notes for this version.'}</pre>
      <p className="about-hint">Restarting closes this window for a moment. Your agents keep working, and the Runner moves to {available.version} with the app.</p>
      <div className="update-notes-actions">
        <button onClick={() => setNotesOpen(false)}>Later</button>
        <button className="primary" data-autofocus onClick={() => { setNotesOpen(false); void installUpdate(app); }}>Restart to update</button>
      </div>
    </DraggableDialog>}
  </div>;
}
