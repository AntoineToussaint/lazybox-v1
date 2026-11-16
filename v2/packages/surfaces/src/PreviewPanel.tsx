import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRunner } from './RunnerContext';
import { Icon } from './Icons';
import { actionName, isLive, openExternally, previewable, useRuntimeRequest, useWorkspaceRuntime } from './workspace-runtime';
import './workspace-runtime.css';

type History = { entries: string[]; index: number };
const at = (history: History) => history.entries[history.index] || '';
/** Only web pages: never javascript:, file: or the app's own origin by accident. */
const webAddress = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
};
const historyNote = 'Steps through the addresses opened here. Links followed inside the preview keep their own history, which a page from another origin does not share with Lazybox.';

/**
 * A running action's page, inside the workspace: address bar, back and
 * forward over the addresses opened here, reload, and open in the browser.
 */
export function PreviewPanel({ workspaceId }: { workspaceId: string }) {
  const { api } = useRunner();
  const { runtime, unsupported, busy, store } = useWorkspaceRuntime(api, workspaceId);
  const targets = previewable(runtime);
  const [chosen, setChosen] = useState('');
  useRuntimeRequest(workspaceId, 'preview', key => setChosen(key));
  const target = targets.find(a => a.key === chosen) || targets[0];
  const [history, setHistory] = useState<History>({ entries: [], index: -1 });
  const [address, setAddress] = useState('');
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  // A new action, URL or run (a restart) starts a new history at its own address.
  const base = webAddress(target?.url || '');
  useEffect(() => {
    if (!base) { setHistory({ entries: [], index: -1 }); setAddress(''); return; }
    setHistory({ entries: [base], index: 0 }); setAddress(base); setLoading(true); setProblem('');
  }, [target?.key, base, target?.runState?.commandId]);
  const current = at(history);
  useEffect(() => { setAddress(current); }, [current]);
  if (!workspaceId) return <p className="module-empty">Choose a workspace to preview its running app.</p>;
  if (unsupported) return <p className="module-empty">This Runner does not run workspace actions yet.</p>;

  const go = (event: FormEvent) => {
    event.preventDefault();
    const url = webAddress(address);
    if (!url) { setProblem('Enter a web address (http or https).'); return; }
    setProblem('');
    if (url === current) { setNonce(n => n + 1); setLoading(true); return; }
    setHistory(h => ({ entries: [...h.entries.slice(0, h.index + 1), url], index: h.index + 1 }));
    setLoading(true);
  };
  const step = (by: number) => { setHistory(h => ({ ...h, index: Math.max(0, Math.min(h.entries.length - 1, h.index + by)) })); setLoading(true); };
  const reload = () => { setNonce(n => n + 1); setLoading(true); };

  if (!target) {
    const waiting = runtime?.actions.filter(a => a.url) || [];
    const first = waiting.find(a => !a.blocked) || waiting[0];
    const starting = first && (busy.has(first.key) || isLive(first.runState));
    return <section className="preview-panel" aria-label="App preview">
      <div className="runtime-empty preview-empty">
        <Icon name="eye" size={24}/>
        {!runtime ? <p role="status">Loading…</p> : first ? <>
          <p><strong>Start {actionName(first, runtime.actions)} to preview it.</strong></p>
          <p>Its page opens here while it runs{first.port ? `, on port ${first.port}` : ''}.</p>
          {first.blocked ? <p className="tone-warn-text">{first.blocked}</p> : <button type="button" className="primary" disabled={starting} onClick={() => void store?.startAction(first, false, runtime.actions)}><span aria-hidden="true">▶</span> {starting ? 'Starting…' : `Start ${actionName(first, runtime.actions)}`}</button>}
        </> : <>
          <p><strong>Nothing to preview.</strong></p>
          <p>An action with a <code>url:</code> in <code>.lazybox/workspace.yaml</code> shows its page here while it runs.</p>
        </>}
      </div>
    </section>;
  }
  const name = actionName(target, runtime!.actions);
  return <section className="preview-panel" aria-label="App preview">
    <form className="preview-toolbar" onSubmit={go}>
      {targets.length > 1 ? <select aria-label="Action to preview" value={target.key} onChange={e => setChosen(e.target.value)}>{targets.map(a => <option key={a.key} value={a.key}>{actionName(a, runtime!.actions)}</option>)}</select>
        : <span className="preview-target" title={target.run}><span className="run-state-dot tone-ok is-live" aria-hidden="true"/>{name}</span>}
      <button type="button" className="icon-button" aria-label="Back" title={`Back. ${historyNote}`} disabled={history.index <= 0} onClick={() => step(-1)}><Icon name="back" size={14}/></button>
      <button type="button" className="icon-button preview-forward" aria-label="Forward" title={`Forward. ${historyNote}`} disabled={history.index >= history.entries.length - 1} onClick={() => step(1)}><Icon name="back" size={14}/></button>
      <button type="button" className="icon-button" aria-label="Reload preview" title="Reload" onClick={reload}><Icon name="refresh" size={14}/></button>
      <input className="preview-address mono" aria-label="Preview address" spellCheck={false} value={address} onChange={e => setAddress(e.target.value)} onFocus={e => e.currentTarget.select()}/>
      <button type="button" className="icon-button" aria-label="Open in browser" title="Open in your browser" onClick={() => void openExternally(current).catch(error => setProblem(String(error)))}><Icon name="external" size={14}/></button>
    </form>
    {problem && <p className="runtime-notice tone-warn" role="alert">{problem}</p>}
    <div className={`preview-frame${loading ? ' is-loading' : ''}`}>
      {loading && <span className="preview-progress" aria-hidden="true"/>}
      {/* No top navigation: the app in the preview cannot take the Lazybox window away. */}
      {current && <iframe ref={frame} key={`${current}#${nonce}`} title={`Preview of ${name}`} src={current} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" onLoad={() => setLoading(false)}/>}
    </div>
  </section>;
}
