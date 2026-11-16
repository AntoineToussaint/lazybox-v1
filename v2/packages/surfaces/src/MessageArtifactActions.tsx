import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Artifact } from '@lazybox/protocol';
import { ContextMenu, menuPoint, type ContextMenuItem, type ContextMenuState } from './ContextMenu';
import { TrackArtifactDialog, UpdateArtifactDialog } from './ArtifactDialogs';
import { errorText } from './artifact-client';
import { openArtifact } from './artifact-events';
import { Icon } from './Icons';
import { useRunner } from './RunnerContext';
import type { TranscriptMessage } from './transcript-model';
import './artifacts.css';

/** The conversation a message list shows, for its message actions. */
export type MessageScope = { collectionId: string; sessionId: string; conversationId: string };
const MessageScopeContext = createContext<MessageScope | undefined>(undefined);
export function MessageScopeProvider({ scope, children }: { scope?: MessageScope; children: ReactNode }) {
  return <MessageScopeContext.Provider value={scope}>{children}</MessageScopeContext.Provider>;
}

/** Only an agent's prose can become an artifact; prompts, notices and failures cannot. */
export const trackable = (message: TranscriptMessage) => message.type === 'message_delta' && !!message.text.trim();

/** The artifacts first taken from this conversation, and whether `message` is newer than what each holds. */
export function conversationArtifacts(artifacts: Artifact[], scope: MessageScope) {
  return artifacts.filter(a => (scope.conversationId && a.originConversationId === scope.conversationId) || a.originSessionId === scope.sessionId);
}
const newerThanLatest = (artifact: Artifact, scope: MessageScope, message: TranscriptMessage) => {
  const source = artifact.versions.at(-1)?.source;
  if (source?.kind !== 'message' || source.sessionId !== scope.sessionId) return true;
  try { return BigInt(message.id) > BigInt(source.messageId); } catch { return message.id !== source.messageId; }
};

type Open = { kind: 'track'; existing: Artifact[] } | { kind: 'update'; artifact: Artifact };

/**
 * The artifact actions of one agent message: a hover button, and the
 * message's right-click menu (Shift+right-click keeps the browser's own).
 * It is a self-contained piece of the message row, so the app-wide context
 * menu can take its items with one registration when that lands.
 */
export function MessageArtifactActions({ message }: { message: TranscriptMessage }) {
  const scope = useContext(MessageScopeContext);
  const { api } = useRunner();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<Open>(), [menu, setMenu] = useState<ContextMenuState>(), [note, setNote] = useState('');
  const enabled = !!scope?.collectionId && trackable(message);
  const fresh = useRef(true);
  useEffect(() => { fresh.current = true; return () => { fresh.current = false; }; }, []);
  const source = scope ? { kind: 'message', sessionId: scope.sessionId, conversationId: scope.conversationId, messageId: message.id, turnId: message.turnId } : {};
  const existing = async () => {
    if (!scope) return [];
    try { return conversationArtifacts((await api.listArtifacts({ collectionId: scope.collectionId }, { timeoutMs: 5000 })).artifacts, scope); }
    catch { return []; }
  };
  const done = (artifact: Artifact, verb: string) => {
    setOpen(undefined);
    if (!openArtifact({ collectionId: artifact.collectionId, artifactId: artifact.id })) flash(`${verb} “${artifact.title}”. Open it from the Artifacts panel of this workspace.`);
  };
  const flash = (text: string) => { setNote(text); setTimeout(() => { if (fresh.current) setNote(''); }, 6000); };
  const startTrack = async () => { const found = await existing(); if (fresh.current) setOpen({ kind: 'track', existing: found }); };
  // The message row's own right-click and menu key.
  useEffect(() => {
    const article = anchor.current?.closest('article');
    if (!article || !enabled || !scope) return;
    const show = async (point: { x: number; y: number }) => {
      const selection = window.getSelection()?.toString() || '';
      const items: ContextMenuItem[] = [{ label: 'Track as artifact…', icon: 'artifact', run: () => void startTrack() }];
      for (const artifact of (await existing()).filter(a => newerThanLatest(a, scope, message)).slice(0, 4))
        items.push({ label: `Update “${artifact.title}” from this message…`, icon: 'history', run: () => setOpen({ kind: 'update', artifact }) });
      items.push({ label: 'Copy message as Markdown', icon: 'copy', separatorBefore: true, run: () => void navigator.clipboard.writeText(message.text).then(() => flash('Copied.'), e => flash(`Copy failed: ${errorText(e)}`)) });
      if (selection && article.contains(window.getSelection()?.anchorNode || null)) items.push({ label: 'Copy selection', icon: 'copy', run: () => void navigator.clipboard.writeText(selection) });
      if (fresh.current) setMenu({ ...point, items, label: 'Message actions', returnFocus: document.activeElement as HTMLElement | null });
    };
    const contextmenu = (event: MouseEvent) => {
      if (event.shiftKey || event.defaultPrevented) return;
      // Links and file references keep their own menu.
      if (event.target instanceof Element && event.target.closest('a[href]')) return;
      event.preventDefault();
      void show(menuPoint({ clientX: event.clientX, clientY: event.clientY, currentTarget: article, target: event.target! }));
    };
    article.addEventListener('contextmenu', contextmenu);
    return () => article.removeEventListener('contextmenu', contextmenu);
  }, [enabled, scope?.collectionId, scope?.sessionId, scope?.conversationId, message.id, message.text]);
  if (!enabled || !scope) return null;
  return <span ref={anchor} className="message-artifact-actions">
    <button type="button" className="message-artifact-button" aria-label="Track as artifact…" title="Track as artifact… (or right-click the message)" onClick={() => void startTrack()}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.currentTarget.closest('article')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); } }}>
      <Icon name="artifact" size={14}/><span>Track</span>
    </button>
    {note && <span className="message-artifact-note" role="status">{note}</span>}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(undefined)}/>}
    {open?.kind === 'track' && <TrackArtifactDialog collectionId={scope.collectionId} content={message.text} source={source} existing={open.existing.filter(a => newerThanLatest(a, scope, message))}
      onClose={() => setOpen(undefined)} onTracked={artifact => done(artifact, 'Tracked')} onUpdateInstead={artifact => setOpen({ kind: 'update', artifact })}/>}
    {open?.kind === 'update' && <UpdateArtifactDialog collectionId={scope.collectionId} artifactId={open.artifact.id} content={message.text} source={source}
      onClose={() => setOpen(undefined)} onSaved={artifact => done(artifact, 'Updated')}/>}
  </span>;
}
