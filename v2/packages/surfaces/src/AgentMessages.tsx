import { useCallback } from 'react';
import { Icon } from './Icons';
import { useRunner } from './RunnerContext';
import { showConversation } from './review-client';
import { lineageIcon } from './orchestration-model';
import type { MessageOrigin } from './system-events';
import type { LineageNote, TranscriptMessage } from './transcript-model';
import './orchestration.css';

/** Opens a conversation by its id: its latest session, in whichever workspace it works. */
export function useOpenConversation() {
  const { info } = useRunner();
  return useCallback((conversationId: string, sessionId = '') => {
    const sessions = info?.sessions || [];
    const latest = sessions.filter(s => (s.conversationId || s.id) === conversationId || s.id === sessionId).sort((a, b) => Number(b.createdAtUnixMillis - a.createdAtUnixMillis)).find(s => !s.successorExecutionId)
      || sessions.find(s => s.id === sessionId || s.id === conversationId);
    if (latest) showConversation({ collectionId: latest.collectionId, sessionId: latest.id, anywhere: true });
    return !!latest;
  }, [info?.sessions]);
}

/** On a message another agent of this tree sent (its orchestrator, or an agent it started): open the sender. */
export function OpenSender({ origin }: { origin: MessageOrigin }) {
  const open = useOpenConversation();
  return <button type="button" className="lineage-open system-event-sender" title={`Open ${origin.from || 'the sender'}'s conversation`} onClick={() => open(origin.conversation || '', origin.session)}>Open</button>;
}

/** One quiet line about this conversation's agent tree: an agent started, a message sent, a grant given or taken back. */
export function LineageLine({ message, note }: { message: TranscriptMessage; note: LineageNote }) {
  const open = useOpenConversation();
  const target = note.kind === 'agent_spawned' || note.kind === 'agent_message' || note.kind === 'agent_stopped' ? note.conversation : '';
  return <div className={`lineage-line kind-${note.kind}`} role="note" data-message-id={message.id}>
    <Icon name={lineageIcon[note.kind] || 'subagent'} size={12}/>
    <span title={message.text}>{message.text}</span>
    {target && <button type="button" className="lineage-open" onClick={() => open(target, note.session)}>Open</button>}
  </div>;
}
