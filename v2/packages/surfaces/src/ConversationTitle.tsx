import { useState, type FormEvent } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { Session } from '@lazybox/protocol';
import type { branchSummary } from './conversation-model';
import { Icon } from './Icons';

type Branch = ReturnType<typeof branchSummary>;

/**
 * The conversation's title, renamed in place: Enter saves, Escape puts it back.
 * A title that is only the workspace folder's (generated) name is no title:
 * the header leads with the branch until the conversation gets a real one.
 */
export function ConversationTitle({ api, session, sessionID, realTitle, suggestedTitle, branch, onRenamed, onError }: {
  api: RunnerClient;
  session?: Session;
  sessionID: string;
  realTitle: string;
  suggestedTitle: string;
  branch: Branch;
  onRenamed(session: Session | undefined): void;
  onError(message: string): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [conversationName, setConversationName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const startRename = () => { if (!session) return; setConversationName(realTitle || suggestedTitle); setRenaming(true); };
  const saveName = async (event: FormEvent) => {
    event.preventDefault(); const title = conversationName.trim();
    if (savingName || !title) return;
    if (title === session?.title) { setRenaming(false); return; }
    setSavingName(true);
    try { const result = await api.renameConversation({ sessionId: sessionID, title }); onRenamed(result.session); setRenaming(false); }
    catch (error) { onError(String(error)); } finally { setSavingName(false); }
  };

  if (renaming) return <form className="conversation-rename" onSubmit={saveName}>
    <input autoFocus required maxLength={120} aria-label="Conversation name" value={conversationName} disabled={savingName}
      onFocus={event => event.target.select()}
      onChange={event => setConversationName(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape' && !savingName) { event.preventDefault(); event.stopPropagation(); setRenaming(false); } }}/>
    <button className="icon-button" aria-label="Save conversation name" title="Save (Enter)" disabled={savingName || !conversationName.trim()}><Icon name="check" size={14}/></button>
    <button type="button" className="icon-button" aria-label="Cancel renaming" title="Cancel (Esc)" disabled={savingName} onClick={() => setRenaming(false)}><Icon name="close" size={14}/></button>
  </form>;

  return <div className="conversation-title" data-untitled={realTitle ? undefined : true}>
    {realTitle
      ? <h2><button type="button" className="conversation-title-text" title="Rename conversation" disabled={!session} onClick={startRename}>{realTitle}</button></h2>
      : <h2 className="chat-branch-title">{branch
        ? <span className="chat-branch" title={branch.title}><Icon name="branch" size={13}/><span className="chat-branch-name">{branch.name}</span>{branch.detail && <small>{branch.detail}</small>}</span>
        : <span className="chat-untitled">New conversation</span>}</h2>}
    {realTitle
      ? <button type="button" className="icon-button conversation-rename-button" aria-label="Rename conversation" title="Rename" disabled={!session} onClick={startRename}><Icon name="pencil" size={13}/></button>
      : <button type="button" className="conversation-name-it" aria-label="Rename conversation" title={suggestedTitle ? `Name it “${suggestedTitle}”` : 'Give this conversation a name'} disabled={!session} onClick={startRename}><Icon name="pencil" size={12}/><span>Name it</span></button>}
  </div>;
}
