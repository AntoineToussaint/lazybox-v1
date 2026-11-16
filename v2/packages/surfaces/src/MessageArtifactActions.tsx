import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Artifact } from '@lazybox/protocol';
import { useContextMenuContribution } from './ContextMenu';
import type { MessageMenuDetail } from './chat-context-menu';
import { TrackArtifactDialog, UpdateArtifactDialog } from './ArtifactDialogs';
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
 * The artifact actions of one agent message: a hover button, and "Track as
 * artifact…" in the message's context menu (the `message` scope of the app's
 * context menus). The track dialog offers updating an existing artifact.
 */
export function MessageArtifactActions({ message }: { message: TranscriptMessage }) {
  const scope = useContext(MessageScopeContext);
  const { api } = useRunner();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<Open>(), [note, setNote] = useState('');
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
  useContextMenuContribution<MessageMenuDetail>('message', async ({ detail }) => {
    if (!enabled || !scope || detail.message.id !== message.id) return [];
    const updates = (await existing()).filter(a => newerThanLatest(a, scope, message)).slice(0, 4);
    return ['separator', { label: 'Track as artifact…', icon: 'artifact', run: () => void startTrack() },
      ...updates.map(artifact => ({ label: `Update “${artifact.title}” from this message…`, icon: 'history', run: () => setOpen({ kind: 'update', artifact }) }))];
  });
  if (!enabled || !scope) return null;
  return <span ref={anchor} className="message-artifact-actions">
    <button type="button" className="message-artifact-button" aria-label="Track as artifact…" title="Track as artifact… (or right-click the message)" onClick={() => void startTrack()}
>
      <Icon name="artifact" size={14}/><span>Track</span>
    </button>
    {note && <span className="message-artifact-note" role="status">{note}</span>}
    {open?.kind === 'track' && <TrackArtifactDialog collectionId={scope.collectionId} content={message.text} source={source} existing={open.existing.filter(a => newerThanLatest(a, scope, message))}
      onClose={() => setOpen(undefined)} onTracked={artifact => done(artifact, 'Tracked')} onUpdateInstead={artifact => setOpen({ kind: 'update', artifact })}/>}
    {open?.kind === 'update' && <UpdateArtifactDialog collectionId={scope.collectionId} artifactId={open.artifact.id} content={message.text} source={source}
      onClose={() => setOpen(undefined)} onSaved={artifact => done(artifact, 'Updated')}/>}
  </span>;
}
