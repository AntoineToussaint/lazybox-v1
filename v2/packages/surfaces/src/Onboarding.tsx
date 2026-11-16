import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Icon } from './Icons';
import { invokeAction, readKeymap } from './keyboard';
import { runAction, useActions } from './actions';
import { readPreference, writePreference } from './view-state';
import { shortcut } from './workbench';
import { useRunner } from './RunnerContext';
import { useConversationIndex } from './useConversationIndex';
import type { SettingsTab } from './SettingsPage';
import { essentialKeys, welcomeDecision, whatsNewDecision, WELCOME_PREFERENCE, WHATS_NEW_PREFERENCE, type Release } from './onboarding-model';
import { releaseNotes } from './release-notes';
import { providerLine } from './help-availability';
import { useProviderAvailability } from './useProviderAvailability';
import './onboarding.css';

// The documentation ships with the app and reads offline (DocsViewer.tsx); it
// loads only when opened.
const DocsViewer = lazy(() => import('./DocsViewer').then(m => ({ default: m.DocsViewer })));

/** What Help asks the onboarding host for. */
export type OnboardingRequest = 'welcome' | 'whats-new' | 'shortcuts' | 'docs';
const EVENT = 'lazybox-onboarding';
/** Open the welcome, What's new or the shortcuts from anywhere in the window. */
export const openOnboarding = (request: OnboardingRequest) => window.dispatchEvent(new CustomEvent<OnboardingRequest>(EVENT, { detail: request }));
const DOCS_EVENT = 'lazybox-docs';
/** Open the documentation at a page, with an optional #anchor ("troubleshooting.md#…"). */
export const openDocs = (page = 'README.md') => window.dispatchEvent(new CustomEvent<string>(DOCS_EVENT, { detail: page }));

// A preference is a convenience: an unavailable store never breaks the window.
const read = (store: ViewStateStore | undefined, name: string) => { try { return readPreference(store, name); } catch { return null; } };
const write = (store: ViewStateStore | undefined, name: string, value: string) => { try { writePreference(store, name, value); } catch { /* shown again next time, at worst */ } };

/**
 * The first-run welcome and What's new after an update, plus what Help opens.
 * Mounted once per main window; `automatic` is false in a workspace window,
 * which only answers Help.
 */
export function Onboarding({ viewState, collections, collectionsLoaded, automatic, onOpenSettings }: { viewState?: ViewStateStore; collections: readonly Collection[]; collectionsLoaded: boolean; automatic: boolean; onOpenSettings(tab: SettingsTab): void }) {
  const [welcome, setWelcome] = useState(false);
  const [decided, setDecided] = useState(() => !automatic || read(viewState, WELCOME_PREFERENCE) !== null);
  const [whatsNew, setWhatsNew] = useState<{ releases: readonly Release[]; asked: boolean }>();
  // The page the documentation opens at; '' while it is closed.
  const [docs, setDocs] = useState('');
  useEffect(() => {
    if (!automatic) return;
    const decision = whatsNewDecision(read(viewState, WHATS_NEW_PREFERENCE), releaseNotes);
    if (decision.action === 'record') write(viewState, WHATS_NEW_PREFERENCE, decision.id);
    if (decision.action === 'show') setWhatsNew({ releases: decision.releases, asked: false });
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<OnboardingRequest>).detail;
      if (request === 'welcome') setWelcome(true);
      if (request === 'whats-new') setWhatsNew({ releases: releaseNotes, asked: true });
      if (request === 'docs') setDocs('README.md');
      // The shortcuts overlay lists every key; its Customize leads to Settings.
      if (request === 'shortcuts' && !runAction('shortcuts.open')) onOpenSettings('keyboard');
    };
    const docsListener = (event: Event) => setDocs((event as CustomEvent<string>).detail || 'README.md');
    window.addEventListener(EVENT, listener);
    window.addEventListener(DOCS_EVENT, docsListener);
    return () => { window.removeEventListener(EVENT, listener); window.removeEventListener(DOCS_EVENT, docsListener); };
  });
  // Help in the command palette and the desktop menu bar.
  useActions({
    'help.welcome': () => setWelcome(true),
    'help.whats-new': () => setWhatsNew({ releases: releaseNotes, asked: true }),
    'help.docs': () => setDocs('README.md'),
  });
  const closeWelcome = () => { write(viewState, WELCOME_PREFERENCE, 'seen'); setWelcome(false); };
  const dismissWhatsNew = () => { if (releaseNotes[0]) write(viewState, WHATS_NEW_PREFERENCE, releaseNotes[0].id); setWhatsNew(undefined); };
  return <>
    {!decided && <FirstRun collections={collections} collectionsLoaded={collectionsLoaded} onDecision={show => {
      setDecided(true);
      if (show) setWelcome(true); else write(viewState, WELCOME_PREFERENCE, 'existing');
    }}/>}
    {welcome && <Welcome viewState={viewState} onClose={closeWelcome}
      onSubscription={() => { closeWelcome(); onOpenSettings('subscriptions'); }}
      onWorkspace={() => { closeWelcome(); requestAnimationFrame(() => invokeAction('workspace.new')); }}/>}
    {whatsNew && <WhatsNew releases={whatsNew.releases} focus={whatsNew.asked} onDismiss={dismissWhatsNew}/>}
    {docs && <Suspense fallback={null}><DocsViewer key={docs} initial={docs} onClose={() => setDocs('')}/></Suspense>}
  </>;
}

/** Waits for the Runner's answer before calling an install fresh: no workspace and no conversation. */
function FirstRun({ collections, collectionsLoaded, onDecision }: { collections: readonly Collection[]; collectionsLoaded: boolean; onDecision(show: boolean): void }) {
  const { info } = useRunner();
  const index = useConversationIndex();
  const decision = welcomeDecision({ seen: false, workspacesLoaded: collectionsLoaded, workspaces: collections.length, conversationsLoaded: !!info && (index.complete || index.unsupported), conversations: index.sessions.length });
  const sent = useRef(false);
  useEffect(() => { if (!sent.current && (decision === 'show' || decision === 'record')) { sent.current = true; onDecision(decision === 'show'); } }, [decision]);
  return null;
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="onboarding-keys">{keys.map((key, i) => <kbd key={i}>{key}</kbd>)}</span>;
}

function Welcome({ viewState, onClose, onSubscription, onWorkspace }: { viewState?: ViewStateStore; onClose(): void; onSubscription(): void; onWorkspace(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lessons = useMemo(() => essentialKeys(readKeymap(viewState), shortcut('Mod+P')), [viewState]);
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); node?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  return <DraggableDialog ref={dialog} className="onboarding-welcome" aria-labelledby="onboarding-welcome-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <DialogHeader>
      <div className="onboarding-title"><span className="brand-mark" aria-hidden="true">l<span>↗</span></span><h2 id="onboarding-welcome-title">Welcome to Lazybox</h2></div>
      <button className="onboarding-close" aria-label="Close welcome" onClick={onClose}><Icon name="close" size={16}/></button>
    </DialogHeader>
    <p className="onboarding-lede">Agents work in workspaces: your repositories, each on its own branch. They run on this machine with your own subscription, and come back to you when they need you.</p>
    <ol className="onboarding-steps">
      <li>
        <span className="onboarding-step-icon" aria-hidden="true"><Icon name="card" size={16}/></span>
        <div><h3>Connect a subscription</h3><p>Sign in with your Claude or ChatGPT plan. Add more than one and Lazybox switches when one reaches its limit.</p><AgentReadiness/></div>
        <button onClick={onSubscription}>Connect a subscription</button>
      </li>
      <li>
        <span className="onboarding-step-icon" aria-hidden="true"><Icon name="repository" size={16}/></span>
        <div><h3>Add a repository</h3><p>Create a workspace from one or more repositories. Each conversation in it works on the workspace's branches, never on your checkout.</p></div>
        <button onClick={onWorkspace}>Create a workspace</button>
      </li>
      <li className="onboarding-keys-step">
        <span className="onboarding-step-icon" aria-hidden="true"><Icon name="keyboard" size={16}/></span>
        <div>
          <h3>The five keys that matter</h3>
          <dl className="onboarding-key-list" aria-label="The five keys that matter">
            {lessons.map(lesson => <div key={lesson.label}>
              <dt>{lesson.keys.map((keys, i) => <span key={i}>{i > 0 && <span className="onboarding-or"> / </span>}<Keys keys={keys}/></span>)}</dt>
              <dd><strong>{lesson.label}</strong><small>{lesson.detail}</small></dd>
            </div>)}
          </dl>
        </div>
      </li>
    </ol>
    <footer>
      <button type="button" className="onboarding-docs" onClick={() => openOnboarding('docs')}>Read the documentation <Icon name="notes" size={12}/></button>
      <small>Reopen this from Help (?) in the header.</small>
      <button className="primary" data-autofocus onClick={onClose}>Get started</button>
    </footer>
  </DraggableDialog>;
}

/**
 * What is ready on the Runner's computer, from the same check Ask Lazybox
 * uses: "Claude Code 2.1.311 installed · signed in", "Codex not installed".
 */
function AgentReadiness() {
  const { report } = useProviderAvailability();
  if (!report) return null;
  return <ul className="onboarding-agents" aria-label="Agents on this computer">
    {report.providers.map(p => <li key={p.provider} className={p.state === 'ready' ? 'ready' : 'missing'}>
      <Icon name={p.state === 'ready' ? 'check' : p.installed ? 'alert' : 'skip'} size={12}/><span>{providerLine(p)}</span>
    </li>)}
  </ul>;
}

/** Release notes in a corner card: it never takes focus from work unless asked for from Help. */
function WhatsNew({ releases, focus, onDismiss }: { releases: readonly Release[]; focus: boolean; onDismiss(): void }) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) card.current?.focus(); }, [focus, releases]);
  const [newest, ...older] = releases;
  if (!newest) return null;
  return <aside ref={card} className="whats-new" aria-labelledby="whats-new-title" tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); } }}>
    <header>
      <span className="whats-new-badge"><Icon name="sparkle" size={13}/><span id="whats-new-title">What's new</span></span>
      <button className="onboarding-close" aria-label="Dismiss What's new" onClick={onDismiss}><Icon name="close" size={14}/></button>
    </header>
    <div className="whats-new-body">
      <ReleaseSection release={newest}/>
      {older.length > 0 && <details className="whats-new-older">
        <summary>{focus ? 'Earlier releases' : `${older.length} more since you last looked`}</summary>
        {older.map(release => <ReleaseSection key={release.id} release={release}/>)}
      </details>}
    </div>
    <footer><button className="primary" onClick={onDismiss}>Got it</button></footer>
  </aside>;
}

function ReleaseSection({ release }: { release: Release }) {
  return <section className="whats-new-release" aria-label={release.title}>
    <h3>{release.title}<small>{release.date}</small></h3>
    <ul>{release.items.map(item => <li key={item.title}><strong>{item.title}</strong><span>{item.body}</span></li>)}</ul>
  </section>;
}
