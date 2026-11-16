import type { Collection, InfoResponse } from '@lazybox/protocol';
import { agentTitle, isAcp } from './providers';
import { conversationName, mergeConversations } from './conversation-model';
import { Icon } from './Icons';
import type { ViewTarget } from './workspace-model';

/** The page's workspace (with its repositories) and conversation, chosen from lists. */
export function WorkspaceSwitcher({ selection, workspaceID, collections, info, locked, onSelect, onShowRepositories }: {
  selection: ViewTarget;
  workspaceID: string;
  collections: Collection[];
  info?: InfoResponse;
  /** The workspace cannot change: a detach or dock is in flight, or the window shows one workspace. */
  locked: boolean;
  onSelect(target: ViewTarget): void;
  onShowRepositories(workspace?: Collection): void;
}) {
  const workspace = collections.find(value => value.id === workspaceID);
  const providerName = (profileId: string) => agentTitle(info?.profiles.find(profile => profile.id === profileId)?.provider, info?.profiles, 'Claude');
  // An ACP agent's profile is the agent itself: its label would only repeat its name.
  const profileLabel = (profileId: string) => { const profile = info?.profiles.find(p => p.id === profileId); return profile && !isAcp(profile.provider) ? profile.label : undefined; };
  return <div className="workspace-context">
    <div className="collection-breadcrumb">
      <Icon name="folder" size={17}/>
      <label><span className="sr-only">Workspace</span><select disabled={locked} value={selection.collectionId} onChange={event => { if (event.target.value !== workspaceID) onSelect({ collectionId: event.target.value, sessionId: '', commandId: '' }); }}>
        <option value="">Choose a workspace</option>
        {selection.collectionId && !collections.some(value => value.id === selection.collectionId) && <option value={selection.collectionId}>Unavailable workspace</option>}
        {collections.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select></label>
      <button className="workspace-repositories-link" disabled={!workspace} onClick={() => onShowRepositories(workspace)}>{workspace?.members.length || 0} {workspace?.members.length === 1 ? 'repository' : 'repositories'}</button>
    </div>
    <label className="session-switcher"><span className="sr-only">Session</span><select value={selection.sessionId} onChange={event => { const session = info?.sessions.find(value => value.id === event.target.value); onSelect({ collectionId: session ? session.collectionId : selection.collectionId, sessionId: event.target.value, commandId: '' }); }}>
      <option value="">Choose a conversation</option>
      {selection.sessionId && !info?.sessions.some(value => value.id === selection.sessionId) && <option value={selection.sessionId}>Unavailable session</option>}
      {mergeConversations([], info?.sessions || []).filter(value => !selection.collectionId || value.collectionId === selection.collectionId).map(value => <option key={value.id} value={value.id}>{conversationName(value)} · {providerName(value.profileId)} · {profileLabel(value.profileId) || value.id.slice(0, 6)}</option>)}
    </select></label>
  </div>;
}
