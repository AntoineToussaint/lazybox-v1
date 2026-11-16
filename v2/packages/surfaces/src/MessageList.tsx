import type { OpenModifiers } from './file-links';
import { Fragment, memo, useMemo, useRef, useState } from 'react';
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
import { ToolLines } from './ToolLine';
import { turnActivity, type ActivityDetail, type ToolEntry, type TurnCache } from './tool-lines';
import { AnsweredLine } from './RequestCards';
import { Icon } from './Icons';
import { ReviewCard } from './ReviewLauncher';
import { InlineRuns, RunMessageContext } from './code-runs';

const ownName = (id: string) => id;

type MessageMenu = (context: ContextMenuContext<MessageMenuDetail>) => MenuItem[];
const MessageRow = memo(function MessageRow({ message: m, agentName, onOpenFile, nameFor = ownName, sessionId = '', menu, turn }: { message: TranscriptMessage; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; nameFor?(id: string): string; sessionId?: string; menu?: MessageMenu; /** Quiet: every tool call of the turn this run of calls opens. */ turn?: ToolEntry[] }) {
  if (m.type === 'switched' && m.switched) return <div className="subscription-switched" role="note"><span>{switchedLine(m.switched, nameFor)}</span></div>;
  if (m.type === 'subagent' && m.agentId) return <div className="subagent-anchor" data-message-id={m.id}><SubagentCard id={m.agentId}/></div>;
  if (m.type === 'tools') return m.tools ? <ToolLines entries={m.tools} turn={turn}/> : null;
  if (m.type === 'answered' && m.answered) return <AnsweredLine note={m.answered}/>;
  if (m.type === 'command') return <div className="command-line" role="note" data-message-id={m.id}><Icon name="check" size={12}/><span>{m.text}</span></div>;
  if (m.type === 'operation_accepted' && m.command) return <div className="command-line command-sent" role="note" data-message-id={m.id} title="You ran this command" onContextMenu={menu && contextMenu<MessageMenuDetail>('message', menu, { message: m, role: messageRole(m), sessionId }, 'Message actions')}><Icon name="chevronRight" size={12}/><code>{m.text.trim()}</code></div>;
  if (m.type === 'review' && m.review) return <div className="review-card-anchor" data-message-id={m.id}><ReviewCard data={m.review}/></div>;
  if (m.type === 'reattached') return <div className="runner-divider" role="note" title="The Runner restarted and re-attached to this agent. Nothing was interrupted.">Runner restarted{(m.count || 1) > 1 ? ` ${m.count}×` : ''} · nothing interrupted</div>;
  return <article className={'message ' + m.type} data-message-id={m.id} onContextMenu={menu && contextMenu<MessageMenuDetail>('message', menu, { message: m, role: messageRole(m), sessionId }, 'Message actions')}>
    <span className="eyebrow">{m.type === 'operation_accepted' ? 'You' : m.type === 'failure' ? 'Stopped' : m.type === 'notice' ? 'Runner' : agentName}</span>
    {/* Only an agent's own words offer to run their commands. */}
    {m.type === 'message_delta' ? <RunMessageContext.Provider value={m.id}><RichContent text={m.text} onOpenFile={onOpenFile}/><InlineRuns messageId={m.id}/></RunMessageContext.Provider> : <RichContent text={m.text} onOpenFile={onOpenFile}/>}
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
export const MessageList = memo(function MessageList({ messages, visible, agentName, onOpenFile, onShowEarlier, nameFor, checkpoints, sessionId, onReveal, detail = 'verbose' }: { messages: TranscriptMessage[]; visible: number; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; onShowEarlier(): void; /** A subscription's name by profile ID, for switch lines. */ nameFor?(id: string): string; checkpoints?: CheckpointScope; /** The conversation, for Quote in reply. */ sessionId?: string; /** Scroll a message into view, mounting earlier history when needed. */ onReveal?(id: string): void; /** How much tool activity to show. */ detail?: ActivityDetail }) {
  const hidden = Math.max(0, messages.length - visible);
  const checkpoint = useCheckpointUI(messages, checkpoints);
  // One stable menu for every row, so a new message does not re-render the others.
  const latest = useRef({ messages, checkpoint, onReveal }); latest.current = { messages, checkpoint, onReveal };
  const [menu] = useState<MessageMenu>(() => (context: ContextMenuContext<MessageMenuDetail>) => { const { messages, checkpoint, onReveal } = latest.current; const id = context.detail.message.id; return messageItems(context, { prompt: promptBefore(messages, id), onReveal, turn: checkpoint.items(id) }); });
  // Quiet: a turn's calls are one line, on its first run of calls.
  const turnCache = useRef<TurnCache>(new Map());
  const turns = useMemo(() => detail === 'quiet' ? turnActivity(messages, turnCache.current, hidden) : undefined, [messages, detail, hidden]);
  return <>
    {hidden > 0 && <button type="button" className="show-earlier" onClick={onShowEarlier}>Show earlier messages <small>{hidden.toLocaleString()} more</small></button>}
    {messages.slice(hidden).map(m => <Fragment key={m.id}><MessageRow message={m} agentName={agentName} onOpenFile={onOpenFile} nameFor={nameFor} sessionId={sessionId} menu={menu} turn={turns?.get(m.id)}/>{checkpoint.marker(m.id)}</Fragment>)}
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
