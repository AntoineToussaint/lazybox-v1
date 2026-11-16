import type { OpenModifiers } from './file-links';
import { Fragment, memo, useRef, useState } from 'react';
import { contextMenu, type ContextMenuContext } from './ContextMenu';
import type { MenuItem } from './context-menu-model';
import { messageItems, messageRole, promptBefore, type MessageMenuDetail } from './chat-context-menu';
import { RichContent } from './RichContent';
import { SentAttachments } from './AttachmentThumbnail';
import './message-list.css';
import type { FileLink } from './file-reference';
import type { TranscriptMessage } from './transcript-model';
import type { ReplayProgress } from './transcript-cache';
import { switchedLine } from './subscription-model';
import { useCheckpointUI, type CheckpointScope } from './TurnCheckpoints';
import { MessageArtifactActions } from './MessageArtifactActions';
import { SubagentCard } from './SubagentCard';

const ownName = (id: string) => id;

type MessageMenu = (context: ContextMenuContext<MessageMenuDetail>) => MenuItem[];
const MessageRow = memo(function MessageRow({ message: m, agentName, onOpenFile, nameFor = ownName, sessionId = '', menu }: { message: TranscriptMessage; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; nameFor?(id: string): string; sessionId?: string; menu?: MessageMenu }) {
  if (m.type === 'switched' && m.switched) return <div className="subscription-switched" role="note"><span>{switchedLine(m.switched, nameFor)}</span></div>;
  if (m.type === 'subagent' && m.agentId) return <div className="subagent-anchor" data-message-id={m.id}><SubagentCard id={m.agentId}/></div>;
  if (m.type === 'reattached') return <div className="runner-divider" role="note" title="The Runner restarted and re-attached to this agent. Nothing was interrupted.">Runner restarted{(m.count || 1) > 1 ? ` ${m.count}×` : ''} · nothing interrupted</div>;
  return <article className={'message ' + m.type} data-message-id={m.id} onContextMenu={menu && contextMenu<MessageMenuDetail>('message', menu, { message: m, role: messageRole(m), sessionId }, 'Message actions')}>
    <span className="eyebrow">{m.type === 'operation_accepted' ? 'You' : m.type === 'failure' ? 'Stopped' : m.type === 'notice' ? 'Runner' : agentName}</span>
    <RichContent text={m.text} onOpenFile={onOpenFile}/>
    {m.files?.length ? <SentAttachments files={m.files}/> : null}
    <MessageArtifactActions message={m}/>
  </article>;
});

/**
 * The latest `visible` messages of a conversation. Only that tail is mounted:
 * opening a long conversation renders what is on screen, and earlier history
 * is added as the reader scrolls toward it. A render of the window that hosts
 * it (a keystroke in the composer) does not touch the rows.
 */
export const MessageList = memo(function MessageList({ messages, visible, agentName, onOpenFile, onShowEarlier, nameFor, checkpoints, sessionId, onReveal }: { messages: TranscriptMessage[]; visible: number; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; onShowEarlier(): void; /** A subscription's name by profile ID, for switch lines. */ nameFor?(id: string): string; checkpoints?: CheckpointScope; /** The conversation, for Quote in reply. */ sessionId?: string; /** Scroll a message into view, mounting earlier history when needed. */ onReveal?(id: string): void }) {
  const hidden = Math.max(0, messages.length - visible);
  const checkpoint = useCheckpointUI(messages, checkpoints);
  // One stable menu for every row, so a new message does not re-render the others.
  const latest = useRef({ messages, checkpoint, onReveal }); latest.current = { messages, checkpoint, onReveal };
  const [menu] = useState<MessageMenu>(() => (context: ContextMenuContext<MessageMenuDetail>) => { const { messages, checkpoint, onReveal } = latest.current; const id = context.detail.message.id; return messageItems(context, { prompt: promptBefore(messages, id), onReveal, turn: checkpoint.items(id) }); });
  return <>
    {hidden > 0 && <button type="button" className="show-earlier" onClick={onShowEarlier}>Show earlier messages <small>{hidden.toLocaleString()} more</small></button>}
    {messages.slice(hidden).map(m => <Fragment key={m.id}><MessageRow message={m} agentName={agentName} onOpenFile={onOpenFile} nameFor={nameFor} sessionId={sessionId} menu={menu}/>{checkpoint.marker(m.id)}</Fragment>)}
    {checkpoint.overlay}
  </>;
});

/** Opening a conversation: how much of its history has arrived, when the Runner says. */
export function ConversationLoading({ replay }: { replay?: ReplayProgress }) {
  const share = replay && replay.total > 0 ? Math.min(1, replay.loaded / replay.total) : undefined;
  return <div className="conversation-loading" role="status">
    <span>Loading conversation…{share !== undefined && ` ${Math.floor(share * 100)}%`}</span>
    {share !== undefined && <progress max={replay!.total} value={replay!.loaded} aria-label="Conversation history loaded"/>}
  </div>;
}
