import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ConnectError, DeviceRequestError, DeviceRevoked, indexedDBDeviceStore, openDeviceSession, pairDevice, parsePairingFragment, type DeviceSession, type DeviceStore, type PairingOffer, type StoredDevice } from '@lazybox/client-core';
import type { Collection, Session } from '@lazybox/protocol';
import { RunnerProvider, useRunner } from '../RunnerContext';
import { AttentionScope, useInbox, useMarkViewed } from '../useAttention';
import { ageLabel, attentionTitle, requestSummary, type Attention } from '../attention';
import { AttentionIcon } from '../Inbox';
import { conversationDetails, conversationName } from '../conversation-model';
import { sessionStatus } from '../agent-status';
import { useTranscript } from '../useTranscript';
import { ConversationLoading, MessageList } from '../MessageList';
import { RequestCard } from '../session-parts';
import { LiveIndicator, useLiveStatus } from '../LiveIndicator';
import { Icon } from '../Icons';
import { useComposerDictation } from '../voice/ComposerDictation';
import { VoicePill } from '../voice/VoiceLayer';
import { useVoiceState } from '../voice/voice-session';
import { grantLabels } from '../DevicesSettings';
import '../style.css';
import '../inbox.css';
import './remote.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'pair'; offer: PairingOffer; replacing?: StoredDevice }
  | { kind: 'unpaired' }
  | { kind: 'revoked' }
  | { kind: 'offline'; stored: StoredDevice; message: string }
  | { kind: 'ready'; stored: StoredDevice; session: DeviceSession };

/** Renew the credential this long before it ends, so no request meets an expired one. */
const RENEW_BEFORE_MS = 90_000;

function defaultDeviceName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/iPad/.test(agent)) return 'iPad';
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? 'Android phone' : 'Android tablet';
  return 'Phone';
}

/**
 * Lazybox on a phone (REMOTE.md): pairing from the QR code, then the inbox,
 * a conversation, its requests, and a composer. It talks only to the device
 * gateway, with a credential its own key obtains; the owner's bearer never
 * reaches the phone.
 */
export function RemoteApp({ baseUrl = location.origin, store: given, fetch }: { baseUrl?: string; store?: DeviceStore; fetch?: typeof globalThis.fetch }) {
  const store = useMemo(() => given || indexedDBDeviceStore(), [given]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const signIn = useCallback(async (stored: StoredDevice) => {
    try { setPhase({ kind: 'ready', stored, session: await openDeviceSession({ baseUrl, stored, fetch }) }); }
    catch (error) {
      if (error instanceof DeviceRevoked) { await store.clear().catch(() => {}); setPhase({ kind: 'revoked' }); return; }
      setPhase({ kind: 'offline', stored, message: error instanceof Error ? error.message : String(error) });
    }
  }, [baseUrl, fetch, store]);
  // The QR link's secret lives in the fragment; take it once, then drop it from the address bar and history.
  const [offer] = useState(() => parsePairingFragment(location.hash));
  useEffect(() => {
    let cancelled = false;
    if (location.hash) { const url = new URL(location.href); url.hash = ''; history.replaceState(history.state, '', url); }
    void store.load().catch(() => undefined).then(stored => {
      if (cancelled) return;
      if (offer) setPhase({ kind: 'pair', offer, replacing: stored });
      else if (stored) void signIn(stored);
      else setPhase({ kind: 'unpaired' });
    });
    return () => { cancelled = true; };
  }, [store, signIn, offer]);
  const revoked = useCallback(() => { void store.clear().catch(() => {}); setPhase({ kind: 'revoked' }); }, [store]);
  const forget = useCallback(async () => { await store.clear().catch(() => {}); setPhase({ kind: 'unpaired' }); }, [store]);
  return <div className="remote-app">
    {phase.kind === 'loading' && <div className="remote-center" role="status"><Brand/><p>Opening Lazybox…</p></div>}
    {phase.kind === 'pair' && <PairScreen baseUrl={baseUrl} offer={phase.offer} replacing={phase.replacing} store={store} fetch={fetch} onPaired={stored => void signIn(stored)}/>}
    {phase.kind === 'unpaired' && <Explain title="Pair this phone with Lazybox" lines={['On your computer, open Lazybox → Settings → Devices.', 'Choose Pair a phone.', 'Scan the code with this phone’s camera.']}/>}
    {phase.kind === 'revoked' && <Explain title="This phone was signed out" lead="It was revoked on your computer, so it can no longer see or answer your agents." lines={['To use it again, open Lazybox → Settings → Devices on your computer.', 'Choose Pair a phone and scan the new code.']}/>}
    {phase.kind === 'offline' && <div className="remote-center"><Brand/><h1>Can’t reach your computer</h1><p>{phase.message}</p><p className="remote-hint">Lazybox keeps working there. Check that the computer is awake and that Tailscale is connected on both devices.</p><button className="primary remote-wide" onClick={() => void signIn(phase.stored)}>Try again</button></div>}
    {phase.kind === 'ready' && <Signed baseUrl={baseUrl} stored={phase.stored} initial={phase.session} fetch={fetch} onRevoked={revoked} onForget={forget}/>}
  </div>;
}

function Brand() { return <span className="remote-brand" aria-hidden="true">✳︎</span>; }

function Explain({ title, lead, lines }: { title: string; lead?: string; lines: string[] }) {
  return <div className="remote-center"><Brand/><h1>{title}</h1>{lead && <p>{lead}</p>}<ol className="remote-steps">{lines.map(line => <li key={line}>{line}</li>)}</ol></div>;
}

function PairScreen({ baseUrl, offer, replacing, store, fetch, onPaired }: { baseUrl: string; offer: PairingOffer; replacing?: StoredDevice; store: DeviceStore; fetch?: typeof globalThis.fetch; onPaired(stored: StoredDevice): void }) {
  const [name, setName] = useState(defaultDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paired, setPaired] = useState<StoredDevice>();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const stored = await pairDevice({ baseUrl, offer, name: name.trim(), store, fetch }); setPaired(stored); }
    catch (e) { setError(e instanceof DeviceRequestError || e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (paired) return <div className="remote-center" role="status">
    <span className="remote-check" aria-hidden="true"><Icon name="check" size={30}/></span>
    <h1>Paired</h1>
    <p>Your computer shows this phone as <strong>{paired.device.name}</strong> with key <span className="mono">{paired.device.fingerprint}</span>.</p>
    <button className="primary remote-wide" autoFocus onClick={() => onPaired(paired)}>Open inbox</button>
  </div>;
  return <form className="remote-center remote-pair" onSubmit={submit}>
    <Brand/>
    <h1>Pair this phone</h1>
    <p>Follow and answer the agents running on your computer.</p>
    <div className="remote-grants" aria-label="This phone will be able to">
      {offer.grants.map(grant => <span key={grant}><Icon name="check" size={14}/>{grantLabels[grant] || grant}</span>)}
    </div>
    <label className="remote-name">Name this phone<input value={name} maxLength={64} autoComplete="off" onChange={event => setName(event.target.value)} required/></label>
    {replacing && <p className="remote-hint">This phone is already paired as {replacing.device.name}. Pairing again replaces it here; revoke the old one on your computer.</p>}
    {error && <p className="remote-error" role="alert">{error}</p>}
    <button className="primary remote-wide" disabled={busy || !name.trim()}>{busy ? 'Pairing…' : 'Pair this phone'}</button>
    <small className="remote-hint">A key is created on this phone and never leaves it. You can revoke this phone at any time in Settings → Devices on your computer.</small>
  </form>;
}

function Signed({ baseUrl, stored, initial, fetch, onRevoked, onForget }: { baseUrl: string; stored: StoredDevice; initial: DeviceSession; fetch?: typeof globalThis.fetch; onRevoked(): void; onForget(): void }) {
  const [session, setSession] = useState(initial);
  const renewing = useRef<Promise<DeviceSession | undefined> | undefined>(undefined);
  const renew = useCallback(() => {
    renewing.current ??= openDeviceSession({ baseUrl, stored, fetch }).then(next => { setSession(next); return next; }, error => { if (error instanceof DeviceRevoked) onRevoked(); return undefined; }).finally(() => { renewing.current = undefined; });
    return renewing.current.then(next => next && { baseUrl, token: next.token });
  }, [baseUrl, stored, fetch, onRevoked]);
  // Renew ahead of expiry; a refused credential also renews through the link.
  useEffect(() => {
    const timer = setTimeout(() => void renew(), Math.max(5_000, session.expiresAt - Date.now() - RENEW_BEFORE_MS));
    return () => clearTimeout(timer);
  }, [session.expiresAt, renew]);
  const connection = useMemo(() => ({ baseUrl, token: session.token, fetch, renew }), [baseUrl, session.token, fetch, renew]);
  return <RunnerProvider connection={connection}><AttentionScope root={`remote:${session.device.id}`}><PhoneShell device={session.device} onForget={onForget}/></AttentionScope></RunnerProvider>;
}

/** The open conversation is in the URL, so the phone's back gesture returns to the inbox. */
function useRoute(): [string, (session: string) => void] {
  const read = () => new URLSearchParams(location.search).get('session') || '';
  const [session, setSession] = useState(read);
  useEffect(() => { const pop = () => setSession(read()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const go = useCallback((next: string) => {
    const url = new URL(location.href);
    if (next) url.searchParams.set('session', next); else url.searchParams.delete('session');
    if (next) history.pushState({ session: next }, '', url); else if (history.state?.session) history.back(); else history.replaceState(null, '', url);
    setSession(next); window.scrollTo(0, 0);
  }, []);
  return [session, go];
}

function PhoneShell({ device, onForget }: { device: DeviceSession['device']; onForget(): void }) {
  const { api, info, error } = useRunner();
  const [route, go] = useRoute();
  const [collections, setCollections] = useState<Collection[]>([]);
  useEffect(() => {
    const control = new AbortController();
    const load = () => void api.listCollections({}, { signal: control.signal, timeoutMs: 10000 }).then(result => { if (!control.signal.aborted) setCollections(result.collections); }, () => {});
    load(); const timer = setInterval(load, 20000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api]);
  const offline = !!error && !info;
  return <>
    {route ? <PhoneConversation sessionId={route} device={device} collections={collections} onBack={() => go('')}/> : <PhoneInbox device={device} collections={collections} onOpen={go} onForget={onForget}/>}
    {error && <div className="remote-offline" role="status">{offline ? 'Connecting to your computer…' : 'Connection interrupted · reconnecting…'}</div>}
  </>;
}

const DONE_SHOWN = 5;
function PhoneInbox({ device, collections, onOpen, onForget }: { device: DeviceSession['device']; collections: Collection[]; onOpen(session: string): void; onForget(): void }) {
  const inbox = useInbox();
  const { info } = useRunner();
  const [allDone, setAllDone] = useState(false);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => setNow(Date.now()), [inbox.rows]);
  const needs = inbox.counts['needs-input'];
  useEffect(() => { document.title = needs ? `(${needs}) Lazybox` : 'Lazybox'; }, [needs]);
  const workspace = (row: Attention) => collections.find(value => value.id === row.session.collectionId)?.name || '';
  const summary = needs ? `${needs} waiting for you` : inbox.counts.failed || inbox.counts.review ? `${inbox.counts.failed + inbox.counts.review} to look at` : inbox.rows.length ? 'Nothing needs you' : '';
  return <main className="remote-inbox" aria-labelledby="remote-inbox-title">
    <header className="remote-bar">
      <Brand/>
      <div className="remote-bar-title"><h1 id="remote-inbox-title">Inbox</h1>{summary && <span role="status">{summary}</span>}</div>
      <button className="remote-icon-button" aria-label="This phone" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Icon name="phone" size={18}/></button>
    </header>
    {menu && <section className="remote-device-card" aria-label="This phone">
      <strong>{device.name}</strong>
      <span className="mono">{device.fingerprint}</span>
      <span>{device.grants.map(grant => grantLabels[grant] || grant).join(' · ')}</span>
      <button onClick={onForget}>Forget pairing on this phone</button>
      <small>Also revoke it on your computer (Settings → Devices) to remove it there.</small>
    </section>}
    {!info ? <p className="remote-empty" role="status">Loading conversations…</p>
      : !inbox.rows.length ? <div className="remote-empty"><Icon name="inbox" size={28}/><strong>No conversations yet</strong><p>Agents that need you will show up here.</p></div>
      : <>
        {!needs && !inbox.counts.failed && !inbox.counts.review && <p className="remote-caught-up"><Icon name="check" size={14}/>Nothing needs you right now. Your agents keep working.</p>}
        {inbox.groups.map(group => {
          const rows = group.state === 'idle' && !allDone ? group.rows.slice(0, DONE_SHOWN) : group.rows;
          return <section key={group.state} className={`remote-group group-${group.state}`} aria-labelledby={`remote-group-${group.state}`}>
            <h2 id={`remote-group-${group.state}`}><AttentionIcon state={group.state} size={13}/>{attentionTitle[group.state]}<span>{group.rows.length}</span></h2>
            <ul>{rows.map(row => <li key={row.key} className="remote-row" data-state={row.state} data-unread={row.unread || undefined}>
              <button onClick={() => onOpen(row.session.id)}>
                <AttentionIcon state={row.state} size={18}/>
                <span className="remote-row-main">
                  <span className="remote-row-title">{row.unread && row.state !== 'needs-input' && <i className="unread-dot" aria-label="unread"/>}<strong>{conversationName(row.session)}</strong></span>
                  <span className="remote-row-meta">{[workspace(row), conversationDetails(row.session, info.profiles, false)].filter(Boolean).join(' · ')}</span>
                  {(row.line || row.state !== 'idle') && <span className="remote-row-line">{row.state === 'working' ? <LiveText session={row.session}/> : <em>{row.reason}</em>}{row.line && <> · {row.line}</>}</span>}
                </span>
                <time dateTime={row.at ? new Date(row.at).toISOString() : undefined}>{ageLabel(row.at, now)}</time>
              </button>
            </li>)}</ul>
            {rows.length < group.rows.length && <button className="remote-more" onClick={() => setAllDone(true)}>Show {group.rows.length - rows.length} more</button>}
          </section>;
        })}
      </>}
  </main>;
}

function LiveText({ session }: { session: Session }) {
  const status = useLiveStatus(session);
  return <em className="remote-live">{status.text}</em>;
}

function PhoneConversation({ sessionId, device, collections, onBack }: { sessionId: string; device: DeviceSession['device']; collections: Collection[]; onBack(): void }) {
  const { api, info } = useRunner();
  const transcript = useTranscript(api, sessionId, !!info);
  const [fetched, setFetched] = useState<Session>();
  const [error, setError] = useState('');
  const live = info?.sessions.find(value => value.id === sessionId);
  // An ended conversation is not in the live list; read it, and keep reading while it is shown.
  useEffect(() => {
    const control = new AbortController();
    const load = () => void api.getSession({ sessionId }, { signal: control.signal, timeoutMs: 10000 }).then(result => { if (!control.signal.aborted) setFetched(result.session); }, failure => { if (!control.signal.aborted && !live) setError(ConnectError.from(failure).rawMessage); });
    load(); const timer = setInterval(load, 4000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, sessionId, !!live]);
  const session = live || fetched;
  useMarkViewed(session);
  const [visible, setVisible] = useState(60);
  const end = useRef<HTMLDivElement>(null);
  const count = transcript.messages.length + (session?.pending.length || 0);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [count]);
  const agentName = (session?.provider || info?.profiles.find(p => p.id === session?.profileId)?.provider) === 'codex' ? 'Codex' : 'Claude';
  const respond = device.grants.includes('respond'), start = device.grants.includes('start');
  const workspace = collections.find(value => value.id === session?.collectionId)?.name || '';
  const status = useLiveStatus(session, transcript.recent);
  return <main className="remote-conversation" aria-label={conversationName(session, 'Conversation')}>
    <header className="remote-bar">
      <button className="remote-icon-button" aria-label="Back to inbox" onClick={onBack}><Icon name="back" size={20}/></button>
      <div className="remote-bar-title"><h1>{conversationName(session, 'Conversation')}</h1><span>{[workspace, sessionStatus(session)].filter(Boolean).join(' · ')}</span></div>
    </header>
    <div className="remote-transcript">
      {transcript.error && <p className="remote-error" role="alert">Conversation could not be loaded. {transcript.error} <button onClick={transcript.retry}>Retry</button></p>}
      {error && !session && <p className="remote-error" role="alert">{error}</p>}
      {transcript.loading && !transcript.messages.length && <ConversationLoading replay={transcript.replay}/>}
      <MessageList messages={transcript.messages} visible={visible} agentName={agentName} onShowEarlier={() => setVisible(value => value + 60)}/>
      {session?.fault && <p className="remote-error" role="alert">{session.fault}</p>}
      {session?.pending.map(request => request.type === 'repository_request'
        ? <p key={request.requestId} className="remote-hint">{requestSummary(request)}? The agent waits for this repository. Add it or decline on your computer.</p>
        : request.type === 'browser_request'
        ? <p key={request.requestId} className="remote-hint">Browser · {requestSummary(request)}? The agent's browsing waits for you. Answer on your computer.</p>
        : respond
        ? <RequestCard key={request.requestId} request={request} api={api} session={session.id} onError={setError}/>
        : <p key={request.requestId} className="remote-hint">The agent is waiting for an answer. This phone can only read; answer on your computer.</p>)}
      {session && !session.closed && status.tone === 'busy' && <div className="remote-activity" aria-hidden="true"><LiveIndicator tone="busy"/>{status.text}</div>}
      <div ref={end}/>
    </div>
    {error && session && <p className="remote-error remote-floating" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></p>}
    {session && <PhoneComposer session={session} respond={respond} start={start} onError={setError}/>}
    <PhoneVoicePill/>
  </main>;
}

/** The recording light and the live words' controls, on the phone too. */
function PhoneVoicePill() {
  return <VoicePill state={useVoiceState()}/>;
}

function PhoneComposer({ session, respond, start, onError }: { session: Session; respond: boolean; start: boolean; onError(message: string): void }) {
  const { api, refresh } = useRunner();
  const key = `lazybox-remote-draft:${session.id}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } });
  const [sending, setSending] = useState(false);
  const attempt = useRef('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { try { if (text) sessionStorage.setItem(key, text); else sessionStorage.removeItem(key); } catch { /* Private mode: the draft lives in memory. */ } }, [key, text]);
  useEffect(() => { const node = box.current; if (node) { node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 160)}px`; } }, [text]);
  // Dictation with the browser's speech recognition (Web Speech). Where the
  // browser has none (iOS Safari without Siri), the keyboard's own microphone
  // dictates into the box instead, so no button is shown.
  const formRef = useRef<HTMLFormElement>(null);
  const dictation = useComposerDictation({ textarea: box, value: text, enabled: respond && !sending, onPreview: setText, onCommit: value => { setText(value); attempt.current = ''; }, onSend: () => formRef.current?.requestSubmit() });
  if (!respond) return <footer className="remote-composer remote-readonly">This phone can read conversations only. Pair it again to reply.</footer>;
  if (session.closed && !start) return <footer className="remote-composer remote-readonly">This conversation ended. Continue it on your computer.</footer>;
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); onError('');
    // The same operation id until it is accepted: a retried send is not a second message.
    attempt.current ||= crypto.randomUUID();
    try {
      let target = session.id;
      if (session.closed) {
        const resumed = await api.resumeSession({ sessionId: session.id }, { timeoutMs: 60000 });
        if (!resumed.session) throw new Error('The conversation could not be continued');
        target = resumed.session.id;
      }
      await api.apply({ sessionId: target, operationId: attempt.current, operation: { case: 'message', value: { text: message, attachments: [] } } }, { timeoutMs: 30000 });
      attempt.current = ''; setText(''); refresh();
    } catch (error) { onError(`Not sent: ${ConnectError.from(error).rawMessage || String(error)}. Your message is kept; try again.`); }
    finally { setSending(false); }
  };
  const interrupt = async () => {
    try { await api.apply({ sessionId: session.id, operationId: crypto.randomUUID(), operation: { case: 'interrupt', value: {} } }, { timeoutMs: 15000 }); }
    catch (error) { onError(ConnectError.from(error).rawMessage || String(error)); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(); };
  return <form ref={formRef} className="remote-composer" onSubmit={event => { dictation.takeOver(); void send(event); }}>
    {session.busy && !session.closed && <button type="button" className="remote-interrupt" onClick={() => void interrupt()}>Interrupt</button>}
    <textarea ref={box} rows={1} aria-label="Message" placeholder={session.closed ? 'Continue this conversation…' : session.busy ? 'Queue a follow-up…' : 'Reply…'} value={text} onChange={event => { dictation.takeOver(); setText(event.target.value); attempt.current = ''; }} onKeyDown={keyDown} enterKeyHint="send"/>
    {dictation.supported && <button type="button" className={'remote-mic' + (dictation.active ? ' is-active' : '')} aria-label={dictation.active ? 'Stop dictation' : 'Dictate'} aria-pressed={dictation.active} disabled={sending} onClick={dictation.toggle}><Icon name="mic" size={18}/></button>}
    <button className="primary remote-send" aria-label={sending ? 'Sending…' : 'Send message'} disabled={sending || !text.trim()}><Icon name="send" size={18}/></button>
  </form>;
}
