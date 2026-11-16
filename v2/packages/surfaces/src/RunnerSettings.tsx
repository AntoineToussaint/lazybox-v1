import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelPrice, RunnerSettings } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Icon } from './Icons';
import { SettingsGroup, SettingsHeader, SettingsRow, settingsError } from './settings-parts';
import './pricing.css';

export function useRunnerSettings(){
 const {api}=useRunner();const [settings,setSettings]=useState<RunnerSettings>(),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{const control=new AbortController();const load=()=>{void api.getRunnerSettings({}, {signal:control.signal,timeoutMs:5000}).then(value=>{if(!control.signal.aborted){setSettings(value);setError('');}},e=>{if(!control.signal.aborted)setError(settingsError(e,'load'));}).finally(()=>{if(!control.signal.aborted)setLoading(false);});};load();window.addEventListener('lazybox-settings-saved',load);return()=>{control.abort();window.removeEventListener('lazybox-settings-saved',load);};},[api]);
 return {settings,setSettings,error,setError,loading};
}
const announce=()=>window.dispatchEvent(new Event('lazybox-settings-saved'));

/** Loading and load failure, the same sentence shape on every Runner-backed tab. */
function SettingsLoading({ error, what }: { error: string; what: string }) {
  return error ? <div className="settings-error" role="alert">{error} <button type="button" onClick={announce}>Try again</button></div> : <p className="settings-empty" role="status">Loading {what}…</p>;
}

const editable = (s: RunnerSettings) => JSON.stringify([s.naming, s.permission, s.context, s.claudeContext, s.codexContext, s.claudeAiConnectors]);

export function AgentSettings() {
  const { api } = useRunner();
  const { settings, setSettings, error, setError } = useRunnerSettings();
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState('');
  useEffect(() => { if (settings && !baseline) setBaseline(editable(settings)); }, [settings, baseline]);
  if (!settings) return <><SettingsHeader title="Agents & workspaces"/><SettingsLoading error={error} what="agent settings"/></>;
  const dirty = !!baseline && editable(settings) !== baseline;
  const change = (patch: Partial<RunnerSettings>) => { setSettings({ ...settings, ...patch }); setSaved(false); };
  return <form className="runner-preferences agent-settings" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setSaved(false); setError('');
    try { const next = await api.saveRunnerSettings(settings); setSettings(next); setBaseline(editable(next)); announce(); setSaved(true); }
    catch (e) { setError(settingsError(e)); } finally { setBusy(false); }
  }}>
    <SettingsHeader title="Agents & workspaces" description="Defaults for new conversations and workspaces. Existing conversations keep the settings they started with."/>
    <SettingsGroup title="New workspaces">
      <SettingsRow label="Suggested workspace names" htmlFor="setting-naming" description="Suggestions follow the repositories you pick until you type a name. The folder on disk keeps its own fixed name.">
        <select id="setting-naming" value={settings.naming} onChange={e => change({ naming: e.target.value })}><option value="repositories">Repository names</option><option value="generated">Memorable generated names</option></select>
      </SettingsRow>
      <SettingsRow label="Default permissions" htmlFor="setting-permission" description="What a new agent may do without asking. Each conversation can choose differently when it starts.">
        <select id="setting-permission" value={settings.permission} onChange={e => change({ permission: e.target.value })}><option value="">Current CLI settings</option><option value="ask">Ask for approval</option><option value="read-only">Read only</option><option value="yolo">YOLO · full access, no approval prompts</option></select>
      </SettingsRow>
      {settings.permission === 'yolo' && <p className="settings-callout tone-warn" role="note"><Icon name="alert" size={14}/>New coding agents will run with unrestricted tool access and never ask first.</p>}
    </SettingsGroup>
    <SettingsGroup title="Documents and connectors" description="Plans, design docs, specs and reports agents write become Lazybox artifacts: versioned pages you read, compare and export here.">
      <SettingsRow label="Use my claude.ai connectors in Lazybox sessions" htmlFor="setting-claude-connectors" description={<>Off: new Claude agents do not load the connectors of your claude.ai account (Claude Docs, Gmail, Notion…), so their documents stay in Lazybox. MCP servers configured on this computer are not affected. Applies to conversations started afterwards.</>}>
        <span className="settings-switch"><input id="setting-claude-connectors" type="checkbox" role="switch" checked={settings.claudeAiConnectors} onChange={e => change({ claudeAiConnectors: e.target.checked })}/></span>
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="Context for agents" description="Added to the provider’s instructions next to the workspace facts. It never grants permissions or replaces a repository’s own instructions.">
      <SettingsRow stacked label="Lazybox context for every new agent" htmlFor="setting-context"><textarea id="setting-context" rows={6} maxLength={32768} value={settings.context} onChange={e => change({ context: e.target.value })}/></SettingsRow>
      <SettingsRow stacked label="Additional Claude context" htmlFor="setting-claude-context"><textarea id="setting-claude-context" rows={3} maxLength={16384} placeholder="Only for Claude agents" value={settings.claudeContext} onChange={e => change({ claudeContext: e.target.value })}/></SettingsRow>
      <SettingsRow stacked label="Additional Codex context" htmlFor="setting-codex-context"><textarea id="setting-codex-context" rows={3} maxLength={16384} placeholder="Only for Codex agents" value={settings.codexContext} onChange={e => change({ codexContext: e.target.value })}/></SettingsRow>
    </SettingsGroup>
    <div className="settings-savebar">
      {error ? <p className="settings-inline-error" role="alert">{error} <button type="button" className="link" onClick={() => { setBaseline(''); announce(); }}>Reload settings</button></p>
        : saved ? <p role="status" className="settings-saved"><Icon name="check" size={14}/>Agent settings saved.</p>
        : <p className="settings-dirty">{dirty ? 'Unsaved changes' : ''}</p>}
      <button className="primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save agent settings'}</button>
    </div>
  </form>;
}

const priceFields = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;
type PriceField = typeof priceFields[number];
const priceLabels: Record<PriceField, string> = { input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite5m: 'Cache write · 5 minutes', cacheWrite1h: 'Cache write · 1 hour' };
const providerNames: Record<string, string> = { claude: 'Claude', codex: 'Codex' };
const vendorNames: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
/** Rates are kept as thousandths of a dollar per million tokens. */
const dollars = (value: bigint | number) => Number(value) / 1000;
const money = (value: bigint | number) => Number(value) ? `$${dollars(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}` : '—';
const tokens = (value: bigint | number) => { const n = Number(value); return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : String(n); };

/** Where a rate comes from, as a person says it: "Custom", or the date of the published list price ("Nov 3, 2026"). */
export function priceSource(price: Pick<ModelPrice, 'custom' | 'version'>): { label: string; detail: string } {
  if (price.custom) return { label: 'Custom', detail: 'Your own price. It replaces the list price for this model.' };
  const match = /^([a-z]+)-standard-(\d{4})-(\d{2})-(\d{2})$/.exec(price.version);
  if (!match) return { label: 'List price', detail: 'The provider’s published standard rate.' };
  const vendor = vendorNames[match[1]] || match[1][0].toUpperCase() + match[1].slice(1);
  const date = new Date(Number(match[2]), Number(match[3]) - 1, Number(match[4])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return { label: date, detail: `${vendor} standard list price, as published ${date}.` };
}

type SortKey = 'model' | 'input' | 'output';
type Draft = { existing: boolean; provider: string; model: string; values: Record<PriceField, string>; maxInput: string; custom: boolean };
const blankDraft = (provider = 'claude'): Draft => ({ existing: false, provider, model: '', values: { input: '', output: '', cacheRead: '0', cacheWrite5m: '0', cacheWrite1h: '0' }, maxInput: '0', custom: false });
const draftOf = (p: ModelPrice): Draft => ({ existing: true, provider: p.provider, model: p.model, values: Object.fromEntries(priceFields.map(k => [k, String(dollars(p[k]))])) as Record<PriceField, string>, maxInput: String(Number(p.maxInput)), custom: p.custom });

/**
 * Settings → Pricing: the rate card cost estimates use, one table per provider.
 * Search and sort it; edit a row, or add a model, in a dialog.
 */
export function PricingSettings() {
  const { api } = useRunner();
  const { settings, setSettings, error, setError } = useRunnerSettings();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'model', descending: false });
  const [draft, setDraft] = useState<Draft>();
  const [saved, setSaved] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (settings?.prices || []).filter(p => !needle || `${p.model} ${providerNames[p.provider] || p.provider} ${priceSource(p).label}`.toLowerCase().includes(needle));
    const order = (a: ModelPrice, b: ModelPrice) => (sort.key === 'model' ? a.model.localeCompare(b.model, undefined, { numeric: true }) : Number(a[sort.key]) - Number(b[sort.key]) || a.model.localeCompare(b.model)) * (sort.descending ? -1 : 1);
    const providers = [...new Set(['claude', 'codex', ...rows.map(p => p.provider)])];
    return providers.map(provider => ({ provider, rows: rows.filter(p => p.provider === provider).sort(order) })).filter(g => g.rows.length);
  }, [settings?.prices, query, sort]);
  if (!settings) return <><SettingsHeader title="Model pricing"/><SettingsLoading error={error} what="model prices"/></>;
  const total = settings.prices.length, shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const header = (key: SortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    return <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="sort" onClick={() => setSort({ key, descending: active ? !sort.descending : key !== 'model' })}>{label}<span aria-hidden="true">{active ? (sort.descending ? '↓' : '↑') : ''}</span></button>
    </th>;
  };
  return <section className="pricing-settings">
    <SettingsHeader title="Model pricing" description="API rates in US dollars per million tokens, used only to estimate what conversations would cost. Subscription limits and invoices are separate."
      actions={<button type="button" className="primary" onClick={() => { setSaved(''); setError(''); setDraft(blankDraft()); }}><Icon name="plus" size={14}/>Add model price</button>}/>
    <div className="pricing-toolbar">
      <label className="pricing-search"><Icon name="search" size={14}/><input type="search" aria-label="Search model prices" placeholder="Search models" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <span className="pricing-count" aria-live="polite">{query ? `${shown} of ${total}` : `${total} ${total === 1 ? 'model' : 'models'}`}</span>
    </div>
    {saved && <p className="settings-saved" role="status"><Icon name="check" size={14}/>{saved}</p>}
    {error && !draft && <p className="settings-error" role="alert">{error}</p>}
    {!total ? <div className="settings-empty"><h3>No model prices</h3><p>Add a price for each exact model ID you want cost estimates for.</p></div>
      : !shown ? <p className="settings-empty">No model matches “{query}”.</p>
      : groups.map(group => <div className="price-group" key={group.provider}>
        <h3>{providerNames[group.provider] || group.provider}<span>{group.rows.length}</span></h3>
        <div className="price-table-frame">
          <table className="price-table" aria-label={`${providerNames[group.provider] || group.provider} model prices`}>
            <colgroup><col className="col-model"/><col className="col-num"/><col className="col-num"/><col className="col-num col-cache"/><col className="col-num col-cache"/><col className="col-num col-cache"/><col className="col-source"/><col className="col-edit"/></colgroup>
            <thead><tr>{header('model', 'Model')}{header('input', 'Input', true)}{header('output', 'Output', true)}<th scope="col" className="num col-cache" >Cache read</th><th scope="col" className="num col-cache" title="Cache write, 5-minute lifetime">Write 5m</th><th scope="col" className="num col-cache" title="Cache write, 1-hour lifetime">Write 1h</th><th scope="col" className="col-source">Rate card</th><th scope="col" className="col-edit"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>{group.rows.map(p => { const source = priceSource(p); return <tr key={p.model} onClick={event => { if (!(event.target as HTMLElement).closest('button')) { setSaved(''); setError(''); setDraft(draftOf(p)); } }}>
              <th scope="row"><span className="price-model" title={p.model}>{p.model}</span>{Number(p.maxInput) > 0 && <small title={`Usage above ${Number(p.maxInput).toLocaleString()} input tokens needs a long-context price and stays unpriced`}>Up to {tokens(p.maxInput)} input</small>}</th>
              <td className="num">{money(p.input)}</td><td className="num">{money(p.output)}</td>
              <td className="num col-cache">{money(p.cacheRead)}</td><td className="num col-cache">{money(p.cacheWrite5m)}</td><td className="num col-cache">{money(p.cacheWrite1h)}</td>
              <td className="col-source"><span className={`price-source${p.custom ? ' is-custom' : ''}`} title={source.detail}>{source.label}</span></td>
              <td className="col-edit"><button type="button" className="icon-button" aria-label={`Edit ${p.model} price`} title="Edit price" onClick={() => { setSaved(''); setError(''); setDraft(draftOf(p)); }}><Icon name="pencil" size={14}/></button></td>
            </tr>; })}</tbody>
          </table>
        </div>
      </div>)}
    <p className="usage-note">Usage already priced keeps the rate it was priced at. Usage without a price is estimated at the current rate once one exists; incomplete usage and other service tiers stay unpriced.</p>
    {draft && <PriceDialog draft={draft} prices={settings.prices} onClose={() => setDraft(undefined)} onSave={async (price, remove) => {
      const next = await api.setModelPrice({ revision: settings.revision, remove, price });
      setSettings(next); announce(); setDraft(undefined);
      setSaved(remove ? `Custom price for ${price.model} removed.` : 'Model price saved. Usage waiting for a price uses this rate when it has enough detail.');
    }}/>}
  </section>;
}

function PriceDialog({ draft: initial, prices, onClose, onSave }: { draft: Draft; prices: readonly ModelPrice[]; onClose(): void; onSave(price: Omit<ModelPrice, '$typeName' | 'version' | 'custom'>, remove: boolean): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { dialog.current?.showModal(); first.current?.focus(); }, []);
  const replacing = !draft.existing && prices.find(p => p.provider === draft.provider && p.model === draft.model.trim());
  const submit = async (remove = false) => {
    setError('');
    const parse = (text: string, scale: number) => { const value = Number(text) * scale; return text.trim() !== '' && Number.isFinite(value) && value >= 0 && Math.abs(value - Math.round(value)) <= 1e-6 ? BigInt(Math.round(value)) : undefined; };
    const values = Object.fromEntries(priceFields.map(k => [k, parse(draft.values[k], 1000)])) as Record<PriceField, bigint | undefined>;
    const maxInput = parse(draft.maxInput || '0', 1);
    if (!draft.model.trim()) return setError('Enter the exact model ID, as the provider reports it.');
    if (!remove && (priceFields.some(k => values[k] === undefined) || maxInput === undefined)) return setError('Enter each price in dollars, with at most three decimals, and a whole number of tokens.');
    if (!remove && (!values.input || !values.output)) return setError('Input and output prices must be more than zero.');
    setBusy(true);
    try { await onSave({ provider: draft.provider, model: draft.model.trim(), input: values.input || 0n, output: values.output || 0n, cacheRead: values.cacheRead || 0n, cacheWrite5m: values.cacheWrite5m || 0n, cacheWrite1h: values.cacheWrite1h || 0n, maxInput: maxInput || 0n }, remove); }
    catch (e) { setError(settingsError(e)); setBusy(false); }
  };
  const field = (key: PriceField) => <label key={key} className="price-field"><span>{priceLabels[key]}</span><span className="price-input"><span aria-hidden="true">$</span><input ref={key === 'input' && draft.existing ? first : undefined} type="number" inputMode="decimal" min="0" step="0.001" required={key === 'input' || key === 'output'} aria-label={priceLabels[key]} value={draft.values[key]} disabled={busy} onChange={e => setDraft({ ...draft, values: { ...draft.values, [key]: e.target.value } })}/></span></label>;
  return <DraggableDialog ref={dialog} className="price-dialog" aria-labelledby="price-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <DialogHeader><h2 id="price-dialog-title">{draft.existing ? 'Edit model price' : 'Add model price'}</h2><button type="button" aria-label="Close price editor" disabled={busy} onClick={onClose}><Icon name="close" size={16}/></button></DialogHeader>
    <form noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="price-identity">
        <label><span>Provider</span><select value={draft.provider} disabled={busy || draft.existing} onChange={e => setDraft({ ...draft, provider: e.target.value })}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
        <label><span>Exact model ID</span><input ref={draft.existing ? undefined : first} required maxLength={128} spellCheck={false} autoComplete="off" placeholder="claude-fable-5-1" value={draft.model} readOnly={draft.existing} disabled={busy} onChange={e => setDraft({ ...draft, model: e.target.value })}/></label>
      </div>
      {draft.existing && !draft.custom && <p className="price-note">Saving makes this your own price for {draft.model}, in place of the list price.</p>}
      {replacing && <p className="price-note">{draft.model.trim()} already has a price. Saving replaces it.</p>}
      <fieldset><legend>Per million tokens</legend><div className="price-fields">{field('input')}{field('output')}</div></fieldset>
      <fieldset><legend>Prompt cache</legend><div className="price-fields is-three">{field('cacheRead')}{field('cacheWrite5m')}{field('cacheWrite1h')}</div></fieldset>
      <label className="price-field price-threshold"><span>Long-context threshold</span><input type="number" inputMode="numeric" min="0" step="1" aria-label="Maximum input tokens" value={draft.maxInput} disabled={busy} onChange={e => setDraft({ ...draft, maxInput: e.target.value })}/><small>Input tokens above which usage stays unpriced. 0 means no threshold.</small></label>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {confirmRemove ? <div className="price-remove-confirm" role="group" aria-label="Remove custom price">
        <p>Remove your price for {draft.model}? Usage goes back to the list price, or stays unpriced when there is none.</p>
        <div><button type="button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep it</button><button type="button" className="danger" disabled={busy} onClick={() => void submit(true)}>{busy ? 'Removing…' : 'Remove custom price'}</button></div>
      </div> : <footer>
        {draft.existing && draft.custom && <button type="button" className="danger-quiet" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove custom price…</button>}
        <span className="spacer"/>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save model price'}</button>
      </footer>}
    </form>
  </DraggableDialog>;
}
