import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BrowserSettings, BrowserWorkspaceSites } from '@lazybox/protocol';
import { normalizeSite, sizeText } from './browser-model';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Icon } from './Icons';
import { useRunner } from './RunnerContext';
import { SettingsGroup, SettingsHeader, SettingsRow, settingsError } from './settings-parts';
import { publishBrowserSettings } from './useBrowser';
import './browser.css';

const permissions = [
  { value: 'ask', label: 'Ask before each new site', detail: 'Recommended. The first visit to a site waits for you in the conversation; sites you allow below never ask.' },
  { value: 'allow', label: 'Allow any site', detail: 'Agents open any site without asking. Sign-ins and downloads still ask.' },
  { value: 'off', label: 'Off', detail: 'Agents don’t get a browser. They can still search and fetch pages with their own tools.' },
];

/**
 * Settings → Browser: what the agent browser may do (BROWSER.md). Every
 * change saves at once against the Runner's revision; a change made elsewhere
 * meanwhile is reloaded and said so.
 */
export function BrowserSettingsPanel() {
  const { api } = useRunner();
  const [settings, setShown] = useState<BrowserSettings>();
  const current = useRef<BrowserSettings | undefined>(undefined);
  const setSettings = (next: BrowserSettings) => { current.current = next; setShown(next); };
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [site, setSite] = useState('');
  const [siteError, setSiteError] = useState('');
  const [clearing, setClearing] = useState<BrowserWorkspaceSites>();
  const load = async (note = '') => {
    try { const next = await api.getBrowserSettings({}); setSettings(next); publishBrowserSettings(next); setError(note); }
    catch (e) { setError(settingsError(e, 'load')); }
  };
  useEffect(() => { void load(); }, [api]);
  useEffect(() => { if (!status) return; const timer = setTimeout(() => setStatus(''), 2500); return () => clearTimeout(timer); }, [status]);
  // Saves run one after another, each on the settings the one before left,
  // so quick changes all land; each shows at once and a refusal restores what was.
  const queue = useRef(Promise.resolve(true));
  const save = (change: (from: BrowserSettings) => Partial<BrowserSettings>, done = 'Saved') => queue.current = queue.current.then(async () => {
    const before = current.current;
    if (!before) return false;
    setError('');
    const proposed = { ...before, ...change(before) } as BrowserSettings;
    setSettings(proposed);
    try {
      const next = await api.saveBrowserSettings(proposed);
      setSettings(next); publishBrowserSettings(next); setStatus(done); return true;
    } catch (e) {
      const text = settingsError(e);
      if (/another window|changed/i.test(text)) await load('Browser settings changed in another window. They are reloaded; make your change again.');
      else { setSettings(before); setError(text); }
      return false;
    }
  });
  const addSite = async (event: FormEvent) => {
    event.preventDefault();
    const result = normalizeSite(site);
    if ('error' in result) { setSiteError(result.error); return; }
    if (current.current?.allowedSites.includes(result.site)) { setSiteError(`${result.site} is already allowed.`); return; }
    setSiteError('');
    if (await save(from => ({ allowedSites: [...from.allowedSites.filter(s => s !== result.site), result.site] }), `${result.site} allowed`)) setSite('');
  };
  const removeSite = (removed: string) => void save(from => ({ allowedSites: from.allowedSites.filter(s => s !== removed) }), `${removed} removed`);
  const removeWorkspaceSite = (workspace: BrowserWorkspaceSites, removed: string) =>
    void save(from => ({ workspaces: from.workspaces.map(w => w.collectionId === workspace.collectionId ? { ...w, sites: w.sites.filter(s => s !== removed) } : w) }), `${removed} removed from ${workspace.name || 'the workspace'}`);

  return <section aria-labelledby="browser-settings-title">
    <SettingsHeader id="browser-settings-title" title="Browser" description="The browser agents drive, beside your chat. It is Lazybox’s own Chromium with a separate profile per workspace — never your browser, your cookies or your passwords."
      actions={<span className="browser-settings-status" role="status" aria-live="polite">{status && <><Icon name="check" size={13}/> {status}</>}</span>}/>
    {settings?.problem && <p className="settings-error" role="alert"><Icon name="alert" size={13}/> {settings.problem}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {!settings ? !error && <p className="settings-empty" role="status">Loading browser settings…</p> : <>
      <SettingsGroup title="When an agent opens a site">
        <div role="radiogroup" aria-label="When an agent opens a site">
          {permissions.map(choice => <label key={choice.value} className="settings-row">
            <span className="settings-row-text"><span className="settings-row-label">{choice.label}</span><small>{choice.detail}</small></span>
            <span className="settings-row-control"><input type="radio" name="browser-permission" value={choice.value} checked={(settings.defaultPermission || 'ask') === choice.value} onChange={() => void save(() => ({ defaultPermission: choice.value }))}/></span>
          </label>)}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Sites agents may always open" description="In every workspace, without asking. A site covers its own pages; *.example.com also covers its subdomains. Lazybox itself, files on this computer and its own services are never reachable.">
        {settings.allowedSites.length > 0 ? <ul className="browser-sites" aria-label="Allowed sites">
          {settings.allowedSites.map(value => <li key={value}><Icon name="globe" size={13}/><span className="mono">{value}</span>
            <button type="button" className="icon-button" aria-label={`Remove ${value}`} title="Remove" onClick={() => removeSite(value)}><Icon name="close" size={12}/></button></li>)}
        </ul> : <p className="browser-sites-empty">None yet. Sites you allow “always” from a conversation are kept per workspace, below.</p>}
        <form className="browser-site-add" onSubmit={addSite}>
          <input aria-label="Site to allow" aria-invalid={!!siteError || undefined} aria-describedby={siteError ? 'browser-site-error' : undefined} className="mono" placeholder="docs.example.com or *.example.com" spellCheck={false} autoCapitalize="off" value={site} onChange={event => { setSite(event.target.value); setSiteError(''); }}/>
          <button type="submit" disabled={!site.trim()}><Icon name="plus" size={13}/> Allow</button>
        </form>
        {siteError && <p id="browser-site-error" className="settings-error" role="alert">{siteError}</p>}
      </SettingsGroup>
      <SettingsGroup title="Downloads and the panel">
        <SettingsRow label="Downloads" htmlFor="browser-downloads" description="A file a page sends. Allowed files are saved where the agent can read them; nothing is opened or run.">
          <select id="browser-downloads" value={settings.downloads || 'ask'} onChange={event => { const downloads = event.target.value; void save(() => ({ downloads })); }}>
            <option value="ask">Ask each time</option>
            <option value="block">Block</option>
          </select>
        </SettingsRow>
        <label className="settings-row">
          <span className="settings-row-text"><span className="settings-row-label">Show the agent browser beside the chat when an agent starts browsing</span><small>Once per browsing. The chat’s “is browsing” chip opens it any time.</small></span>
          <span className="settings-row-control"><input type="checkbox" checked={settings.showPanel} onChange={event => { const showPanel = event.target.checked; void save(() => ({ showPanel })); }}/></span>
        </label>
      </SettingsGroup>
      <SettingsGroup title="Workspaces" description="Each workspace has its own browser profile: the sign-ins, cookies and storage its agents’ pages keep.">
        {settings.workspaces.length ? <div className="browser-workspaces">{settings.workspaces.map(workspace => <article key={workspace.collectionId} className="browser-workspace" aria-label={workspace.name || workspace.collectionId}>
          <header>
            <Icon name="folder" size={14}/><strong>{workspace.name || workspace.collectionId}</strong>
            <small>{workspace.hasData ? `Browser data · ${sizeText(Number(workspace.dataBytes))}` : 'No browser data'}</small>
            <button type="button" className="quiet" disabled={!workspace.hasData && !workspace.sites.length} onClick={() => setClearing(workspace)}>Clear browser data…</button>
          </header>
          {workspace.sites.length > 0 ? <ul className="browser-sites" aria-label={`Sites always allowed in ${workspace.name || 'this workspace'}`}>
            {workspace.sites.map(value => <li key={value}><Icon name="globe" size={13}/><span className="mono">{value}</span>
              <button type="button" className="icon-button" aria-label={`Remove ${value} from ${workspace.name || 'this workspace'}`} title="Remove" onClick={() => removeWorkspaceSite(workspace, value)}><Icon name="close" size={12}/></button></li>)}
          </ul> : <p className="browser-sites-empty">No site is always allowed here.</p>}
        </article>)}</div> : <p className="browser-sites-empty">No workspace has used the agent browser yet.</p>}
      </SettingsGroup>
    </>}
    {clearing && <ClearDataDialog workspace={clearing} onClose={() => setClearing(undefined)} onCleared={next => { setSettings(next); publishBrowserSettings(next); setClearing(undefined); setStatus(`Browser data of ${clearing.name || 'the workspace'} cleared`); }}/>}
  </section>;
}

function ClearDataDialog({ workspace, onClose, onCleared }: { workspace: BrowserWorkspaceSites; onClose(): void; onCleared(settings: BrowserSettings): void }) {
  const { api } = useRunner();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const name = workspace.name || 'this workspace';
  const clear = async () => {
    setBusy(true); setError('');
    try { onCleared(await api.clearBrowserData({ collectionId: workspace.collectionId })); }
    catch (e) { setError(settingsError(e)); setBusy(false); }
  };
  return <DraggableDialog ref={dialog} className="browser-clear-dialog" aria-label={`Clear browser data of ${name}`} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <DialogHeader><h2>Clear browser data?</h2><button disabled={busy} aria-label="Cancel" onClick={onClose}>×</button></DialogHeader>
    <p className="deletion-subject">{name}</p>
    <p>Deletes this workspace’s agent browser profile{workspace.hasData ? ` (${sizeText(Number(workspace.dataBytes))})` : ''}: its sign-ins, cookies, site storage and cache, and the sites always allowed here.</p>
    <p className="deletion-note">Open agent browsers of this workspace close. Agents sign in again only if you take over and do it.</p>
    {error && <p role="alert">{error}</p>}
    <footer><button autoFocus disabled={busy} onClick={onClose}>Cancel</button><button className="danger" disabled={busy} onClick={() => void clear()}>{busy ? 'Clearing…' : 'Clear browser data'}</button></footer>
  </DraggableDialog>;
}
