import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, ArtifactVersion, Collection } from '@lazybox/protocol';
import { ActionMenu } from './ActionMenu';
import { CreateIssueDialog, DeleteArtifactDialog, DiffStats, DiffView, SaveToRepositoryDialog } from './ArtifactDialogs';
import { artifactsChanged, errorText } from './artifact-client';
import { ARTIFACT_KINDS, agentReference, ago, asKind, kindIcon, kindLabel, lineDiff, slug, versionOrigin } from './artifact-model';
import { revealMessage } from './artifact-events';
import { composeInConversation } from './compose';
import { Icon } from './Icons';
import { RichContent } from './RichContent';
import { useRunner } from './RunnerContext';
import { useWorkbench } from './workbench';
import type { ViewTarget } from './workspace-model';
import './artifacts.css';

/** What the window offers an artifact page: its own native or browser window. */
export type ArtifactHost = { openArtifact?(target: { collectionId: string; artifactId: string }): Promise<void> };
export const ArtifactHostContext = createContext<ArtifactHost>({});

type Props = {
  collectionId: string;
  artifactId: string;
  /** From the list, when there is one: a newer `updatedAtUnixMillis` reloads the page. */
  summary?: Artifact;
  collection?: Collection;
  /** In a panel: back to the list (narrow layouts). */
  onBack?(): void;
  /** In a workspace: show a conversation (source message, Send to agent). */
  onShowSession?(target: ViewTarget): void;
  /** The conversation the page is beside, for Send to agent. */
  conversationId?: string;
  conversationTitle?: string;
  onDeleted?(): void;
  /** In its own window: the window is the page, so there is no "open in window". */
  standalone?: boolean;
};

/**
 * One artifact as a page: the rendered document, its versions with the
 * changes between them, where it came from, and every way out of Lazybox.
 */
export function ArtifactPage({ collectionId, artifactId, summary, collection, onBack, onShowSession, conversationId, conversationTitle, onDeleted, standalone }: Props) {
  const { api } = useRunner();
  const host = useContext(ArtifactHostContext);
  const workbench = useWorkbench();
  const [artifact, setArtifact] = useState<Artifact>(), [error, setError] = useState(''), [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState(0); // 0 follows the latest version
  const [view, setView] = useState<'document' | 'changes'>('document');
  const [base, setBase] = useState(0); // 0 compares with the previous version
  const [contents, setContents] = useState(() => new Map<number, string>());
  // History sits beside the document when the page is wide, and over it on demand when narrow.
  const [wide, setWide] = useState(true), [historyChoice, setHistoryChoice] = useState<boolean>();
  const sizes = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((node: HTMLElement | null) => { sizes.current?.disconnect(); if (!node) return; sizes.current = new ResizeObserver(([entry]) => setWide(entry.contentRect.width > 760)); sizes.current.observe(node); }, []);
  const historyOpen = historyChoice ?? wide;
  const setHistoryOpen = (open: boolean) => setHistoryChoice(open);
  const [renaming, setRenaming] = useState(false), [dialog, setDialog] = useState<'delete' | 'save' | 'issue'>();
  const [status, setStatus] = useState('');
  const statusTimer = useRef(0);
  const say = (text: string) => { setStatus(text); clearTimeout(statusTimer.current); statusTimer.current = window.setTimeout(() => setStatus(''), 4000); };
  useEffect(() => () => clearTimeout(statusTimer.current), []);

  // The latest version, again whenever the list says the artifact changed.
  const stamp = summary ? `${summary.updatedAtUnixMillis}:${summary.title}:${summary.kind}:${summary.trackedPath}:${summary.trackingProblem}` : '';
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    void api.getArtifact({ collectionId, artifactId }, { signal: control.signal, timeoutMs: 10000 }).then(latest => {
      if (control.signal.aborted) return;
      setArtifact(latest); setError(''); setMissing(false);
      setContents(current => current.get(latest.contentVersion) === latest.content ? current : new Map(current).set(latest.contentVersion, latest.content));
    }, e => { if (!control.signal.aborted) { const text = errorText(e); setError(text); setMissing(/not.?found|no such|does not exist/i.test(text)); } });
    return () => control.abort();
  }, [api, collectionId, artifactId, stamp, poll]);
  // Without a list (its own window), the page watches for new versions itself.
  useEffect(() => { if (summary) return; const timer = setInterval(() => { if (document.visibilityState === 'visible') setPoll(value => value + 1); }, 4000); return () => clearInterval(timer); }, [!!summary]);

  const versions = artifact?.versions || [];
  const latestNumber = versions.at(-1)?.number || 0;
  const shown = selected || latestNumber;
  const baseNumber = base || Math.max(0, shown - 1);
  // Load the content of a version that is shown or compared.
  useEffect(() => {
    const control = new AbortController();
    for (const number of [shown, view === 'changes' ? baseNumber : 0]) {
      if (!number || contents.has(number)) continue;
      void api.getArtifact({ collectionId, artifactId, version: number }, { signal: control.signal, timeoutMs: 10000 })
        .then(result => { if (!control.signal.aborted) setContents(current => new Map(current).set(result.contentVersion, result.content)); }, e => { if (!control.signal.aborted) setError(errorText(e)); });
    }
    return () => control.abort();
  }, [api, collectionId, artifactId, shown, baseNumber, view, contents]);

  const content = contents.get(shown);
  const baseContent = baseNumber ? contents.get(baseNumber) : '';
  const diff = useMemo(() => view === 'changes' && content !== undefined && baseContent !== undefined ? lineDiff(baseContent, content) : [], [view, content, baseContent]);
  const version = versions.find(v => v.number === shown);
  const latest = versions.at(-1);
  const documentRef = useRef<HTMLDivElement>(null);

  if (missing) return <div className="artifact-page is-empty"><p className="module-empty">This artifact was deleted.</p>{onBack && <button onClick={onBack}>Back to artifacts</button>}</div>;
  if (!artifact) return <div className="artifact-page is-empty">{error ? <p className="artifact-error" role="alert">{error}<button onClick={() => setPoll(value => value + 1)}>Retry</button></p> : <p className="module-empty" role="status">Opening artifact…</p>}</div>;

  const kind = asKind(artifact.kind);
  const latestContent = contents.get(latestNumber) ?? artifact.content;
  const update = async (change: { title?: string; kind?: string; stopTracking?: boolean }, said: string) => {
    try { setArtifact(await api.updateArtifact({ collectionId, artifactId, ...change }, { timeoutMs: 10000 })); artifactsChanged(collectionId); say(said); }
    catch (e) { setError(errorText(e)); }
  };
  const copy = async (text: string, said: string) => { try { await navigator.clipboard.writeText(text); say(said); } catch (e) { setError(`Copy failed: ${errorText(e)}`); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([latestContent], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${slug(artifact.title)}.md`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Downloaded ${slug(artifact.title)}.md`);
  };
  const print = () => printDocument(artifact.title, `${kindLabel[kind]} · v${shown}${shown !== latestNumber ? ` of ${latestNumber}` : ''} · ${new Date(Number(version?.createdAtUnixMillis || artifact.updatedAtUnixMillis)).toLocaleString()}`, documentRef.current);
  const sourceOf = (v?: ArtifactVersion) => v?.source?.kind === 'message' && v.source.sessionId && v.source.messageId ? v.source : undefined;
  const message = sourceOf(version) || (artifact.originSessionId ? sourceOf(versions.find(v => sourceOf(v))) : undefined);
  const filePath = artifact.trackedPath || (version?.source?.kind === 'file' ? version.source.path : '');
  const openMessage = () => {
    if (!message || !onShowSession) return;
    onShowSession({ collectionId, sessionId: message.sessionId, commandId: '' });
    revealMessage({ sessionId: message.sessionId, messageId: message.messageId });
  };
  const openFile = () => { if (filePath && workbench) workbench.open(filePath, { focus: true }); };
  const sendToAgent = () => {
    const text = agentReference(artifact, latestContent);
    if (conversationId && onShowSession) {
      composeInConversation({ sessionId: conversationId, text });
      onShowSession({ collectionId, sessionId: conversationId, commandId: '' });
      say(`Added to the message box of “${conversationTitle || 'the conversation'}”. Review it and send.`);
    } else void copy(text, 'Copied a reference to this artifact. Paste it into a conversation to hand it to an agent.');
  };

  return <article ref={measureRef} className={`artifact-page${historyOpen ? ' has-history' : ''}${wide ? ' is-wide' : ''}`} aria-label={artifact.title}>
    <header className="artifact-page-header">
      <div className="artifact-title-row">
        {onBack && <button type="button" className="icon-button artifact-back" aria-label="Back to artifacts" title="Back to artifacts" onClick={onBack}><Icon name="back"/></button>}
        <span className={`artifact-kind-icon kind-${kind}`} title={kindLabel[kind]}><Icon name={kindIcon[kind]} size={18}/></span>
        {renaming ? <RenameField value={artifact.title} onDone={title => { setRenaming(false); if (title && title !== artifact.title) void update({ title }, 'Renamed.'); }}/>
          : <h2 title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{artifact.title}</h2>}
        <div className="artifact-page-actions">
          <button type="button" className="artifact-action" onClick={sendToAgent} title={conversationId ? `Put a reference in the message box of “${conversationTitle || 'the conversation'}” (not sent)` : 'Copy a reference an agent can read'}><Icon name="send" size={14}/><span>Send to agent</span></button>
          <ActionMenu label="Export" className="artifact-export-menu">
            <button type="button" onClick={() => void copy(latestContent, 'Copied as Markdown.')}><Icon name="copy"/><span>Copy as Markdown</span></button>
            <button type="button" onClick={download}><Icon name="download"/><span>Download .md</span></button>
            <button type="button" onClick={print}><Icon name="print"/><span>Print or save as PDF…</span></button>
            <button type="button" disabled={!collection?.members.length} onClick={() => setDialog('save')}><Icon name="repository"/><span>Save to repository…</span></button>
            <button type="button" disabled={!collection?.members.length} onClick={() => setDialog('issue')}><Icon name="external"/><span>Create GitHub issue…</span></button>
          </ActionMenu>
          {!standalone && host.openArtifact && <button type="button" className="icon-button" aria-label="Open in its own window" title="Open in its own window" onClick={() => void host.openArtifact!({ collectionId, artifactId }).catch(e => setError(errorText(e)))}><Icon name="external" size={15}/></button>}
          <ActionMenu label="Artifact actions" className="artifact-more-menu">
            <button type="button" onClick={() => setRenaming(true)}><Icon name="pencil"/><span>Rename</span></button>
            <button type="button" disabled={!message || !onShowSession} title={!onShowSession && message ? 'Open it from the workspace window' : undefined} onClick={openMessage}><Icon name="chat"/><span>Open source message</span></button>
            <button type="button" disabled={!filePath || !workbench} onClick={openFile}><Icon name="file"/><span>Open source file</span></button>
            {artifact.trackedPath && <button type="button" onClick={() => void update({ stopTracking: true }, `Stopped following ${artifact.trackedPath}. Its versions are kept.`)}><Icon name="close"/><span>Stop syncing with file</span></button>}
            <button type="button" className="danger" onClick={() => setDialog('delete')}><Icon name="cross"/><span>Delete…</span></button>
          </ActionMenu>
        </div>
      </div>
      <div className="artifact-meta">
        <label className="artifact-kind-select"><span className="visually-hidden">Kind</span><select value={kind} onChange={event => void update({ kind: event.target.value }, `Marked as ${kindLabel[asKind(event.target.value)].toLowerCase()}.`)}>{ARTIFACT_KINDS.map(value => <option key={value} value={value}>{kindLabel[value]}</option>)}</select></label>
        <span>v{latestNumber} · {versionOrigin(latest)} · <time dateTime={new Date(Number(artifact.updatedAtUnixMillis)).toISOString()} title={new Date(Number(artifact.updatedAtUnixMillis)).toLocaleString()}>{ago(artifact.updatedAtUnixMillis)}</time></span>
        {artifact.trackedPath && <button type="button" className="artifact-tracked" disabled={!workbench} onClick={openFile} title="Versions are recorded when this file changes on disk"><Icon name="refresh" size={12}/><span>Synced with {artifact.trackedPath}</span></button>}
        {artifact.trackingProblem && <span className="artifact-problem" role="status"><Icon name="alert" size={12}/>{artifact.trackingProblem}</span>}
        <span className="artifact-status" role="status" aria-live="polite">{status}</span>
      </div>
      {error && <p className="artifact-error" role="alert">{error}<button type="button" className="link-button" onClick={() => setError('')}>Dismiss</button></p>}
    </header>
    <div className="artifact-page-body">
      <main className="artifact-main">
        <div className="artifact-view-bar">
          <div className="artifact-segmented" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'document'} onClick={() => setView('document')}>Document</button>
            <button type="button" role="tab" aria-selected={view === 'changes'} disabled={versions.length < 2 && shown <= 1} onClick={() => setView('changes')}>Changes</button>
          </div>
          {view === 'changes' && shown > 1 && <label className="artifact-compare">v{shown} compared with <select value={baseNumber} onChange={event => setBase(Number(event.target.value))}>{versions.filter(v => v.number < shown).reverse().map(v => <option key={v.number} value={v.number}>v{v.number}{v.number === shown - 1 ? ' (previous)' : ''}</option>)}</select>{diff.length > 0 && <DiffStats lines={diff}/>}</label>}
          <button type="button" className="artifact-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><Icon name="history" size={14}/><span>{versions.length} version{versions.length === 1 ? '' : 's'}</span></button>
        </div>
        {shown !== latestNumber && <div className="artifact-old-version" role="note"><span>You are viewing v{shown} of {latestNumber}.</span><button type="button" className="link-button" onClick={() => { setSelected(0); setBase(0); }}>Back to latest</button></div>}
        {view === 'document'
          ? <div ref={documentRef} className="artifact-document">{content === undefined ? <p role="status" className="module-empty">Loading v{shown}…</p> : <RichContent text={content}/>}</div>
          : content === undefined || baseContent === undefined ? <p role="status" className="module-empty">Loading versions…</p> : <DiffView key={`${baseNumber}:${shown}`} lines={diff} label={`Changes from v${baseNumber} to v${shown}`}/>}
      </main>
      {historyOpen && <aside className="artifact-history" aria-label="Version history">
        <h3>History{!wide && <button type="button" className="icon-button" aria-label="Close history" onClick={() => setHistoryOpen(false)}><Icon name="close" size={13}/></button>}</h3>
        <ol role="listbox" aria-label="Versions" onKeyDown={event => {
          const step = event.key === 'ArrowDown' ? -1 : event.key === 'ArrowUp' ? 1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = versions.find(v => v.number === shown + step);
          if (next) { setSelected(next.number === latestNumber ? 0 : next.number); setBase(0); requestAnimationFrame(() => (event.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus()); }
        }}>
          {[...versions].reverse().map(v => <li key={v.number} role="option" aria-selected={v.number === shown} tabIndex={v.number === shown ? 0 : -1}
            onClick={() => { setSelected(v.number === latestNumber ? 0 : v.number); setBase(0); if (!wide) setHistoryOpen(false); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(v.number === latestNumber ? 0 : v.number); setBase(0); if (!wide) setHistoryOpen(false); } }}>
            <strong>v{v.number}{v.number === latestNumber && <em>latest</em>}</strong>
            <span>{versionOrigin(v)}</span>
            <time dateTime={new Date(Number(v.createdAtUnixMillis)).toISOString()} title={new Date(Number(v.createdAtUnixMillis)).toLocaleString()}>{ago(v.createdAtUnixMillis)}</time>
            {v.number > 1 && <button type="button" className="link-button" tabIndex={-1} onClick={event => { event.stopPropagation(); setSelected(v.number === latestNumber ? 0 : v.number); setBase(0); setView('changes'); if (!wide) setHistoryOpen(false); }}>Changes</button>}
          </li>)}
        </ol>
      </aside>}
    </div>
    {dialog === 'delete' && <DeleteArtifactDialog artifact={artifact} onClose={() => setDialog(undefined)} onDeleted={() => { setDialog(undefined); onDeleted?.(); }}/>}
    {dialog === 'save' && <SaveToRepositoryDialog artifact={artifact} collection={collection} onClose={() => setDialog(undefined)} onSaved={(path, next) => { setDialog(undefined); if (next) setArtifact(next); artifactsChanged(collectionId); say(`Saved to ${path}. It is not committed.`); }}/>}
    {dialog === 'issue' && <CreateIssueDialog artifact={artifact} collection={collection} onClose={() => setDialog(undefined)} onCreated={(url, number) => { setDialog(undefined); say(`Created issue #${number}.`); if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); }}/>}
  </article>;
}

function RenameField({ value, onDone }: { value: string; onDone(title: string): void }) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return <input ref={input} className="artifact-rename" aria-label="Artifact title" value={draft} maxLength={200} autoFocus
    onChange={event => setDraft(event.target.value)}
    onBlur={() => onDone(draft.trim())}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onDone(draft.trim()); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDone(''); } }}/>;
}

/**
 * Print only the document: a print sheet beside the app, shown by the print
 * stylesheet alone, removed after the print dialog closes. "Save as PDF" is
 * the system print dialog's own choice.
 */
export function printDocument(title: string, subtitle: string, rendered: HTMLElement | null) {
  if (!rendered) return;
  document.querySelector('.artifact-print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'artifact-print-sheet';
  const heading = document.createElement('header');
  const h1 = document.createElement('h1'); h1.textContent = title;
  const small = document.createElement('p'); small.textContent = subtitle;
  heading.append(h1, small);
  const body = rendered.cloneNode(true) as HTMLElement;
  // Interactive chrome (copy buttons, diagram controls) is not part of a printed page.
  body.querySelectorAll('button, [role="toolbar"]').forEach(node => node.remove());
  sheet.append(heading, body);
  document.body.append(sheet);
  document.documentElement.classList.add('printing-artifact');
  const previous = document.title;
  document.title = title;
  let done = false;
  const cleanup = () => { if (done) return; done = true; sheet.remove(); document.documentElement.classList.remove('printing-artifact'); document.title = previous; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Engines whose print() returns before the dialog closes still fire afterprint; the timer is the fallback.
  setTimeout(cleanup, 60_000);
}
