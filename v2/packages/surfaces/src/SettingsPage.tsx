import { WebSettings } from './WebSettings';
import { RuntimeSettings } from './RuntimeSettings';
import {KeyboardSettings} from './KeyboardSettings';
import { PowerSettings } from './PowerSettings';
import { NotificationSettings } from './NotificationSettings';
import { ChatSettings } from './ChatSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { DevicesSettings } from './DevicesSettings';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Profile, SubscriptionEnrollment, UsageWindow } from '@lazybox/protocol';
import type { AppHost, ViewStateStore, ZoomHost } from '@lazybox/platform';
import { useRunner } from './RunnerContext';
import { backWhen, comeback, resetTime, untilText, type Comeback } from './subscription-model';
import { SettingsHeader, useNow } from './settings-parts';
import { Icon } from './Icons';
import './settings.css';
import { RepositoryBrowser } from './RepositoryBrowser';
import { AgentSettings, PricingSettings, useRunnerSettings } from './RunnerSettings';
import { RunnerSection } from './RunnerControl';
import { OrchestrationProcessSettings } from './OrchestrationProcessSettings';
import { AboutSettings } from './AboutSettings';


function bareWindowName(window: UsageWindow) {
  if (window.name.startsWith('model:')) return `Weekly · ${window.name.slice(6)}`;
  if (window.name === 'seven_day_oauth_apps') return 'Weekly · OAuth apps';
  if (window.name === 'seven_day_opus') return 'Weekly · Opus';
  if (window.name === 'seven_day_sonnet') return 'Weekly · Sonnet';
  if (window.durationMinutes === 300n || window.name === 'five_hour') return '5-hour limit';
  if (window.durationMinutes === 10080n || window.name.startsWith('seven_day')) return 'Weekly limit';
  if (window.durationMinutes > 0n) return `${Number(window.durationMinutes) / 60}-hour limit`;
  return window.name.endsWith(':primary') ? 'Primary limit' : window.name.endsWith(':secondary') ? 'Secondary limit' : window.name.replaceAll('_', ' ');
}
function windowName(window: UsageWindow) {
 const bare=bareWindowName(window);
 const bucket=window.name.includes(':') ? window.name.split(':')[0] : '';
 return bucket && bucket!=='codex' && bucket!=='model' ? `${bucket.replaceAll('_',' ')} · ${bare}` : bare;
}
const terminal = (state = '') => ['added', 'failed', 'cancelled', 'expired'].includes(state);
export type SettingsTab = 'appearance' | 'chat' | 'subscriptions' | 'repositories' | 'agents' | 'workspaces' | 'pricing' | 'notifications' | 'web' | 'devices' | 'keyboard' | 'runner' | 'process' | 'power' | 'about';
/** The sections, in the order and groups the sidebar shows them. */
export const settingsTabs: { id: SettingsTab; label: string; icon: string; group: string }[] = [
  { id: 'subscriptions', label: 'Subscriptions', icon: 'card', group: 'Accounts' },
  { id: 'pricing', label: 'Pricing', icon: 'tag', group: 'Accounts' },
  { id: 'repositories', label: 'Repositories', icon: 'repository', group: 'Work' },
  { id: 'agents', label: 'Agents & workspaces', icon: 'sliders', group: 'Work' },
  { id: 'workspaces', label: 'Workspaces', icon: 'folder', group: 'Work' },
  { id: 'process', label: 'Process', icon: 'activity', group: 'Work' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Preferences' },
  { id: 'chat', label: 'Chat', icon: 'chat', group: 'Preferences' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'Preferences' },
  { id: 'web', label: 'Web & links', icon: 'globe', group: 'Preferences' },
  { id: 'keyboard', label: 'Shortcuts', icon: 'keyboard', group: 'Preferences' },
  { id: 'power', label: 'Actions & hooks', icon: 'play', group: 'Preferences' },
  { id: 'devices', label: 'Devices', icon: 'phone', group: 'System' },
  { id: 'runner', label: 'Runner', icon: 'processes', group: 'System' },
  { id: 'about', label: 'About', icon: 'sparkle', group: 'System' },
];

const usedText = (percent: number) => `${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used`;

/** The one line a subscription that cannot take work leads with. */
function comebackLine(back: Comeback, now: number, refreshing: boolean): { text: string; tone: 'warn' | 'bad' | 'muted' } | undefined {
  switch (back.kind) {
    case 'available': return undefined;
    case 'back': { const when = backWhen(back.resetAt, now); return { text: `${when[0].toUpperCase()}${when.slice(1)}`, tone: 'warn' }; }
    case 'due': return { text: refreshing ? 'Should be available again — checking…' : 'Should be available again. Refresh to confirm.', tone: 'muted' };
    case 'unknown': return { text: 'Limit reached · reset time not reported. Refresh to check again.', tone: 'warn' };
    case 'sign-in': return { text: 'Signed out by the provider. Add the subscription again to sign in.', tone: 'bad' };
    case 'billing': return { text: 'The provider reports a billing problem with this account.', tone: 'bad' };
  }
}

function SubscriptionCard({ profile, now, refreshing, error, onRefresh, footer }: { profile: Profile; now: number; refreshing: boolean; error?: string; onRefresh(): void; footer: ReactNode }) {
  const usage = profile.availability, windows = usage?.windows || [], codex = profile.provider === 'codex';
  const name = profile.label || (codex ? 'Current Codex account' : 'Current Claude account');
  const back = comeback(profile, now), line = comebackLine(back, now, refreshing);
  const state = back.kind === 'available' ? (usage?.state === 'available' || windows.length ? 'Available' : 'Not checked') : back.kind === 'sign-in' ? 'Sign-in required' : back.kind === 'billing' ? 'Billing issue' : back.kind === 'due' ? 'Resetting' : usage?.state === 'throttled' ? 'Rate limited' : 'Limit reached';
  const tone = back.kind === 'available' ? (state === 'Available' ? 'ok' : 'muted') : back.kind === 'sign-in' || back.kind === 'billing' ? 'bad' : back.kind === 'due' ? 'muted' : 'warn';
  const passed = (w: UsageWindow) => w.resetAt > 0n && Number(w.resetAt) * 1000 <= now;
  // An available card names only its next reset: the one of its most-used window.
  const busiest = back.kind === 'available' ? windows.filter(w => Number.isFinite(w.usedPercent) && !passed(w) && w.resetAt > 0n).sort((a, b) => b.usedPercent - a.usedPercent)[0] : undefined;
  const observed = usage && usage.observedAtUnixMillis > 0n ? `Last reported ${new Date(Number(usage.observedAtUnixMillis)).toLocaleString()}` : 'Not reported yet';
  return <article className={`subscription-card tone-${tone}`} aria-label={`${name} subscription`}>
    <header>
      <span className={`provider-mark ${profile.provider}`} aria-hidden="true">{codex ? '›' : '✳'}</span>
      <div className="subscription-identity"><h3 title={name}>{name}</h3>{usage?.email && <small className="subscription-email">{usage.email}</small>}<span>{codex ? 'Codex' : 'Claude'}{usage?.plan ? ` · ${usage.plan[0].toUpperCase()}${usage.plan.slice(1)}` : ''}</span></div>
      <span className={`account-state tone-${tone}`}>{state}</span>
    </header>
    {line && <p className={`subscription-back tone-${line.tone}`} role="status" title={back.kind === 'back' || back.kind === 'due' ? new Date(back.resetAt * 1000).toLocaleString() : undefined}>{line.text}</p>}
    <div className="subscription-usage">{windows.length ? windows.map(window => {
      const label = windowName(window), stale = passed(window), known = Number.isFinite(window.usedPercent);
      return <div className={`usage-window${stale ? ' is-reset' : ''}${known && window.usedPercent >= 100 && !stale ? ' is-full' : ''}`} key={window.name} title={window.resetAt > 0n ? `${stale ? 'Reset' : 'Resets'} ${new Date(Number(window.resetAt) * 1000).toLocaleString()}` : 'Reset time not reported'}>
        <div><span>{label}</span><strong>{stale ? 'Reset' : known ? usedText(window.usedPercent) : 'Unavailable'}</strong></div>
        <progress max="100" value={stale || !known ? 0 : Math.max(0, Math.min(100, window.usedPercent))} aria-label={`${label} used`}/>
        {stale && <small>Reset since the last report — refresh for current usage</small>}
      </div>;
    }) : <div className="usage-unavailable"><span>Usage not reported yet</span><small>Refresh to read this account’s current usage.</small></div>}
    {busiest && <small className="subscription-next-reset">{windowName(busiest)} resets {resetTime(busiest.resetAt, now)} ({untilText(busiest.resetAt, now)})</small>}
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <footer>{footer}<button type="button" className="quiet" disabled={refreshing} aria-label={refreshing ? "Refreshing…" : "Refresh usage"} title={observed} onClick={onRefresh}><Icon name="refresh" size={13}/>{refreshing ? "Refreshing…" : "Refresh"}</button></footer>
  </article>;
}
export function SettingsPage({ app, zoom, viewState, openSignIn, copySignInCode, chooseRepositoryFolder, tab: shownTab, onTab, onShowProcesses }: { /** The desktop app: version and updates (Settings → About). */ app?: AppHost; zoom?: ZoomHost; onShowProcesses?(): void; chooseRepositoryFolder?(): Promise<string | null>; viewState?: ViewStateStore; openSignIn?(url: string): Promise<void>; copySignInCode?(code: string): Promise<void>; tab?: SettingsTab; onTab?(tab: SettingsTab): void }) {
  const { api, info, refresh } = useRunner();
  const [ownTab, setOwnTab] = useState<SettingsTab>('subscriptions');
  const tab = shownTab || ownTab, setTab = (next: SettingsTab) => { setOwnTab(next); onTab?.(next); };
  const storageKey = `${viewState?.scope || viewState?.key}:subscription-enrollment`;
  const [flowID, setFlowID] = useState(() => { try { return viewState?.getItem(storageKey) || ''; } catch { return ''; } });
  const [restoreRequest, setRestoreRequest] = useState<{ key: string; provider: string } | undefined>(() => { try { const value = JSON.parse(viewState?.getItem(`${storageKey}:request`) || 'null'); return value && typeof value.key === 'string' && ['codex', 'claude'].includes(value.provider) ? value : undefined; } catch { return undefined; } });
  const [flow, setFlow] = useState<SubscriptionEnrollment>();
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<'claude' | 'codex'>('codex');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  useEffect(() => { setCopied(false); setCopyError(''); }, [flow?.id, flow?.userCode]);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(() => new Set());
  const usageInFlight = useRef(new Set<string>());
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});
  const [updated, setUpdated] = useState<Record<string, Profile>>({});
  const dialog = useRef<HTMLDialogElement>(null), labelInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ key: string; provider: string; label: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const autoOpen = useRef(false);
  const dismissed = useRef(new Set<string>());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const rememberFlow = (id: string) => {
    setFlowID(id);
    try { viewState?.setItem(storageKey, id); } catch { setError('Could not retain this sign-in view. The Runner still owns the request.'); }
  };
  useEffect(() => {
    if (adding) { dialog.current?.showModal(); if (!flowID) labelInput.current?.focus(); }
    else dialog.current?.close();
  }, [adding]);
  useEffect(() => {
    const pending = info?.pendingEnrollments.find(value => !dismissed.current.has(value.id));
    if (!flowID && pending) rememberFlow(pending.id);
  }, [info, flowID]);
  useEffect(() => {
    if (flowID || !restoreRequest) return;
    const controller = new AbortController();
    void api.getSubscriptionEnrollment({ requestKey: restoreRequest.key, provider: restoreRequest.provider }, { signal: controller.signal, timeoutMs: 10000 }).then(next => {
      if (controller.signal.aborted) return;
      setFlow(next);
      if (next.id) rememberFlow(next.id);
      else { setAdding(true); setError(next.error || 'Sign-in request not found.'); }
      setRestoreRequest(undefined);
      try { viewState?.setItem(`${storageKey}:request`, ''); } catch { /* the non-secret request reference can be retried */ }
    }).catch(() => { if (!controller.signal.aborted) setError('Could not recover the previous enrollment. Reconnect before adding another account.'); });
    return () => controller.abort();
  }, [api, flowID, restoreRequest]);
  useEffect(() => {
    if (!flowID) return;
    const controller = new AbortController(); let loading = false, done = false;
    const update = async () => {
      if (loading || done) return; loading = true;
      try {
        const next = await api.getSubscriptionEnrollment({ enrollmentId: flowID }, { signal: controller.signal, timeoutMs: 10000 });
        if (controller.signal.aborted) return;
        setFlow(next); attempt.current = undefined;
        if (terminal(next.state)) { done = true; if (next.state === 'added') refresh(); }
      } catch { if (!controller.signal.aborted) setError('Could not read the sign-in request. It may still be running; retry the connection before adding another account.'); }
      finally { loading = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [api, flowID]);
  const add = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current || !label.trim()) return;
    inFlight.current = true; autoOpen.current = true; setSubmitting(true); setError('');
    const old = attempt.current;
    const next = old?.provider === provider && old.label === label ? old : { key: crypto.randomUUID(), provider, label };
    attempt.current = next;
    try { viewState?.setItem(`${storageKey}:request`, JSON.stringify({ key: next.key, provider })); } catch { setError('Could not retain the sign-in request reference.'); }
    try {
      const result = await api.addSubscription({ requestKey: next.key, provider, label: label.trim(), subscriptionToken: '' }, { signal: lifetime.current!.signal, timeoutMs: 30000 });
      if (!lifetime.current?.signal.aborted) { setFlow(result); rememberFlow(result.id); attempt.current = undefined; viewState?.setItem(`${storageKey}:request`, ''); }
    } catch { if (!lifetime.current?.signal.aborted) setError('Could not confirm the subscription request. Retry unchanged to check the same request.'); }
    finally { inFlight.current = false; if (!lifetime.current?.signal.aborted) {setSubmitting(false);if(!dialog.current?.open && attempt.current) {setRestoreRequest({key:attempt.current.key,provider:attempt.current.provider});attempt.current=undefined;}} }
  };
  const close = () => { setAdding(false); if (!inFlight.current && attempt.current) {setRestoreRequest({key:attempt.current.key,provider:attempt.current.provider});attempt.current=undefined;} };
  const clear = () => { setRestoreRequest(undefined); try {viewState?.setItem(`${storageKey}:request`, '');} catch {} dismissed.current.add(flowID); rememberFlow(''); setFlow(undefined); setLabel(''); attempt.current = undefined; setError(''); close(); };
  const cancel = async () => {
    if (!flowID) return;
    try { setFlow(await api.cancelSubscriptionEnrollment({ enrollmentId: flowID }, { signal: lifetime.current!.signal, timeoutMs: 10000 })); }
    catch { setError('Could not confirm cancellation. The sign-in request remains visible.'); }
  };
  const copyCode = async () => {
    if (!flow?.userCode) return;
    setCopied(false); setCopyError('');
    try {
      if (copySignInCode) await copySignInCode(flow.userCode);
      else await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
    } catch { setCopyError('Could not copy. Select the code and copy it manually.'); }
  };
  const open = async () => {
    if (!flow?.signInUrl) return;
    try {
      if (openSignIn) await openSignIn(flow.signInUrl);
      else { const url = new URL(flow.signInUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); window.open(url.href, '_blank', 'noopener,noreferrer'); }
    } catch { setError('Could not open the provider sign-in page. Use Open sign-in page to try again.'); }
  };
  useEffect(() => {
    if (flow?.state === 'awaiting_login' && flow.signInUrl && autoOpen.current) {
      autoOpen.current = false;
      // Native hosts can open the system browser after the asynchronous RPC.
      // Browser hosts retain the explicit button to avoid popup blockers.
      if (openSignIn) void open();
    }
  }, [flow?.state, flow?.signInUrl]);
  const updateUsage = async (profile: Profile) => {
    if (usageInFlight.current.has(profile.id)) return;
    usageInFlight.current.add(profile.id);
    setRefreshing(new Set(usageInFlight.current)); setRefreshErrors(value => ({ ...value, [profile.id]: '' }));
    const signal = lifetime.current!.signal;
    try {
      const next = await api.refreshSubscription({ profileId: profile.id }, { signal, timeoutMs: 30000 });
      if (!signal.aborted) setUpdated(value => ({ ...value, [next.id]: next }));
    } catch { if (!signal.aborted) setRefreshErrors(value => ({ ...value, [profile.id]: 'Usage could not be refreshed. The last report is still shown.' })); }
    finally { usageInFlight.current.delete(profile.id); if (!signal.aborted) setRefreshing(new Set(usageInFlight.current)); }
  };
  // Per-account opt-out of automatic switching; every saved subscription is in by default.
  const { settings: runnerSettings, setSettings: setRunnerSettings } = useRunnerSettings();
  const [rotationSaving, setRotationSaving] = useState('');
  const excluded = runnerSettings?.rotationExcludedProfileIds || [];
  const setRotation = async (profile: Profile, use: boolean) => {
    if (!runnerSettings || rotationSaving) return;
    setRotationSaving(profile.id); setRefreshErrors(value => ({ ...value, [profile.id]: '' }));
    try {
      const next = use ? excluded.filter(id => id !== profile.id) : [...excluded.filter(id => id !== profile.id), profile.id];
      const request = { ...runnerSettings, rotationExcludedProfileIds: next };
      setRunnerSettings(request); // The switch moves now; a failed save reloads the Runner's value.
      setRunnerSettings(await api.saveRunnerSettings(request, { timeoutMs: 10000 }));
      window.dispatchEvent(new Event('lazybox-settings-saved'));
    } catch { setRefreshErrors(value => ({ ...value, [profile.id]: 'Could not save automatic switching. Settings may have changed in another window; try again.' })); window.dispatchEvent(new Event('lazybox-settings-saved')); }
    finally { setRotationSaving(''); }
  };
  const profiles = info?.profiles.filter(profile => profile.managed).map(profile => (updated[profile.id]?.availability?.observedAtUnixMillis || 0n) > (profile.availability?.observedAtUnixMillis || 0n) ? updated[profile.id] : profile) || [];
  const pending = !!flowID && !terminal(flow?.state);
  const now = useNow(30_000);
  // A limit whose reported reset has passed is checked once, by itself: the
  // card says "checking" and then shows what the provider reports now.
  const autoChecked = useRef(new Set<string>());
  // Started from a timer, so an effect React runs twice in development starts it once.
  useEffect(() => {
    const timers = profiles.flatMap(profile => {
      const back = comeback(profile, now);
      const key = back.kind === 'due' ? `${profile.id}:${back.resetAt}` : '';
      if (!key || autoChecked.current.has(key)) return [];
      return [setTimeout(() => { if (autoChecked.current.has(key)) return; autoChecked.current.add(key); void updateUsage(profile); }, 0)];
    });
    return () => timers.forEach(clearTimeout);
  });
  const select = (next: SettingsTab, focus = false) => { setTab(next); if (focus) requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus()); };
  const onTabKey = (event: KeyboardEvent) => {
    const index = settingsTabs.findIndex(t => t.id === tab), last = settingsTabs.length - 1;
    const next = ({ ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault(); select(settingsTabs[(next + settingsTabs.length) % settingsTabs.length].id, true);
  };
  // The chosen section stays in view in the narrow strip of sections.
  useEffect(() => { document.getElementById(`${tab}-tab`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [tab]);
  const panel = (id: SettingsTab, body: ReactNode) => tab === id && <section role="tabpanel" className="settings-panel" id={`${id}-panel`} aria-labelledby={`${id}-tab`}>{body}</section>;
  return <section className="settings-page" aria-labelledby="settings-title">
   <div className="settings-layout">
    <aside className="settings-sidebar">
      <h1 id="settings-title">Settings</h1>
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical" onKeyDown={onTabKey}>
        {settingsTabs.map((t, i) => <Fragment key={t.id}>
          {t.group !== settingsTabs[i - 1]?.group && <span className="settings-nav-group" aria-hidden="true">{t.group}</span>}
          <button type="button" id={`${t.id}-tab`} role="tab" aria-selected={tab === t.id} aria-controls={`${t.id}-panel`} tabIndex={tab === t.id ? 0 : -1} onClick={() => select(t.id)}><Icon name={t.icon} size={15}/><span>{t.label}</span></button>
        </Fragment>)}
      </nav>
    </aside>
    <div className="settings-content">
    {panel('chat', <ChatSettings store={viewState}/>)}
    {panel('appearance', <AppearanceSettings store={viewState} zoom={zoom}/>)}
    {panel('notifications', <NotificationSettings/>)}
    {panel('web', <WebSettings store={viewState}/>)}
    {panel('keyboard', <KeyboardSettings store={viewState}/>)}
    {panel('power', <PowerSettings viewState={viewState}/>)}
    {panel('runner', <RunnerSection onShowProcesses={onShowProcesses}/>)}
    {panel('process', <OrchestrationProcessSettings/>)}
    {panel('about', <AboutSettings app={app}/>)}
    {panel('agents', <AgentSettings/>)}
    {panel('workspaces', <RuntimeSettings/>)}
    {panel('devices', <DevicesSettings/>)}
    {panel('pricing', <PricingSettings/>)}
    {panel('repositories', <><SettingsHeader title="Repositories" description="Repositories you can add to a workspace: the ones on this machine, and those your GitHub connection can see."/><RepositoryBrowser chooseRepositoryFolder={chooseRepositoryFolder}/></>)}
    <section hidden={tab !== 'subscriptions'} role="tabpanel" className="settings-panel" id="subscriptions-panel" aria-labelledby="subscriptions-tab">
      <SettingsHeader title="Subscriptions" description={info?.sharedSubscriptions ? 'Claude and Codex accounts agents run on. Shared with your other Lazybox environments.' : 'Claude and Codex accounts agents run on, kept separate from your own CLI sign-ins.'}
        actions={<button className="primary" onClick={() => { setError(''); setAdding(true); }}><Icon name="plus" size={14}/> {pending ? 'Continue sign-in' : 'Add subscription'}</button>}/>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {pending && !adding && <div className="sign-in-banner"><span>{flow?.label || 'Subscription'} · sign-in pending</span><button onClick={() => setAdding(true)}>Continue sign-in</button></div>}
      {!info && <p className="settings-empty" role="status">Loading subscriptions…</p>}
      {info && !profiles.length && <div className="settings-empty"><h3>No subscriptions yet</h3><p>Add a Claude or Codex account so agents can run on it. Your CLI sign-ins keep working either way.</p></div>}
      <div className="subscription-grid">{profiles.map(profile => <SubscriptionCard key={profile.id} profile={profile} now={now} refreshing={refreshing.has(profile.id)} error={refreshErrors[profile.id]} onRefresh={() => void updateUsage(profile)}
        footer={profile.isolation === 'environment' ? <label className="rotation-toggle" title={`When another ${profile.provider === 'codex' ? 'Codex' : 'Claude'} subscription hits a limit, its conversations can continue on this one. Applies to conversations started afterwards.`}><input type="checkbox" role="switch" checked={!excluded.includes(profile.id)} disabled={!runnerSettings || !!rotationSaving} onChange={event => void setRotation(profile, event.target.checked)}/><span>Automatic switching</span></label> : <small>{profile.isolation === 'inherited' ? 'Uses current CLI sign-in' : info?.sharedSubscriptions ? 'Shared subscription' : 'Saved on this Runner'}</small>}/>)}</div>
      {profiles.length > 0 && <p className="usage-note">Usage is what each provider reports for the subscription. Lazybox never guesses a number it was not given.</p>}
    </section>
    </div>
   </div>
    <DraggableDialog ref={dialog} className="subscription-dialog" onCancel={() => close()} onClose={() => setAdding(false)} aria-labelledby="add-subscription-title">
      <DialogHeader><h2 id="add-subscription-title">{flowID ? 'Add subscription' : 'Connect a subscription'}</h2><button aria-label="Close subscription dialog" onClick={close}>×</button></DialogHeader>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {!flowID ? <form onSubmit={add}>
        <label>Provider<select aria-label="Provider" value={provider} disabled={submitting} onChange={e => setProvider(e.target.value as 'claude' | 'codex')}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
        <label>Account name<input ref={labelInput} autoComplete="off" maxLength={64} placeholder="e.g. Personal or Work" value={label} disabled={submitting} onChange={e => setLabel(e.target.value)} required/></label>
        <p>Sign in with {provider === 'claude' ? 'Claude' : 'ChatGPT'} in your browser. Your account will be saved for next time.</p>
        <button className="primary" disabled={submitting || !label.trim()}>{submitting ? 'Connecting…' : `Continue with ${provider === 'claude' ? 'Claude' : 'Codex'}`}<Icon name="external"/></button>
        <small>Your existing CLI sign-ins stay separate.</small>
      </form> : <div className="enrollment-state">
        {flow?.state === 'awaiting_login' ? <>
          <h3>Finish signing in with {flow.provider === 'claude' ? 'Claude' : 'ChatGPT'}</h3>
          <p>{flow.userCode ? 'Enter this code on the sign-in page:' : `Complete sign-in in your browser to connect ${flow.label}. This window will update automatically.`}</p>
          {flow.userCode && <div className="device-code-control"><input className="device-code" aria-label="Sign-in code" readOnly value={flow.userCode} onFocus={event => event.currentTarget.select()}/><button onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy code'}</button><span className="copy-status" role="status">{copied ? 'Code copied to clipboard' : ''}</span>{copyError && <p role="alert">{copyError}</p>}</div>}
          <button className="primary" onClick={() => void open()}>Open sign-in page <Icon name="external"/></button>
          <small role="status">Waiting for sign-in…</small>
        </> : flow?.state === 'added' ? <><span className="enrollment-check">✓</span><h3>Subscription added</h3><p>{flow.label} is available to sessions on this Runner.</p><button className="primary" onClick={clear}>Done</button></> : flow?.state === 'failed' || flow?.state === 'cancelled' || flow?.state === 'expired' ? <><h3>{flow.state === 'cancelled' ? 'Sign-in cancelled' : flow.state === 'expired' ? 'Sign-in request expired' : 'Could not add subscription'}</h3><p>{flow.error}</p><button onClick={clear}>Close</button></> : <p role="status">{flow?.state === 'cancelling' ? 'Cancelling sign-in…' : 'Preparing sign-in…'}</p>}
        {!terminal(flow?.state) && <button className="cancel-sign-in" disabled={flow?.state === 'cancelling'} onClick={() => void cancel()}>Cancel sign-in</button>}
      </div>}
    </DraggableDialog>
  </section>;
}
