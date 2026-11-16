import type { OpenModifiers } from './file-links';
import { Fragment, memo } from 'react';
import { RichContent } from './RichContent';
import { SentAttachments } from './AttachmentThumbnail';
import './message-list.css';
import type { FileLink } from './file-reference';
import type { TranscriptMessage } from './transcript-model';
import type { ReplayProgress } from './transcript-cache';
import { switchedLine } from './subscription-model';
import { useCheckpointUI, type CheckpointScope } from './TurnCheckpoints';
import { MessageArtifactActions } from './MessageArtifactActions';

const ownName = (id: string) => id;

const MessageRow = memo(function MessageRow({ message: m, agentName, onOpenFile, nameFor = ownName }: { message: TranscriptMessage; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; nameFor?(id: string): string }) {
  if (m.type === 'switched' && m.switched) return <div className="subscription-switched" role="note"><span>{switchedLine(m.switched, nameFor)}</span></div>;
  if (m.type === 'reattached') return <div className="runner-divider" role="note" title="The Runner restarted and re-attached to this agent. Nothing was interrupted.">Runner restarted{(m.count || 1) > 1 ? ` ${m.count}×` : ''} · nothing interrupted</div>;
  return <article className={'message ' + m.type} data-message-id={m.id}>
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
export const MessageList = memo(function MessageList({ messages, visible, agentName, onOpenFile, onShowEarlier, nameFor, checkpoints }: { messages: TranscriptMessage[]; visible: number; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; onShowEarlier(): void; /** A subscription's name by profile ID, for switch lines. */ nameFor?(id: string): string; checkpoints?: CheckpointScope }) {
  const hidden = Math.max(0, messages.length - visible);
  const checkpoint = useCheckpointUI(messages, checkpoints);
  return <>
    {hidden > 0 && <button type="button" className="show-earlier" onClick={onShowEarlier}>Show earlier messages <small>{hidden.toLocaleString()} more</small></button>}
    {messages.slice(hidden).map(m => <Fragment key={m.id}><MessageRow message={m} agentName={agentName} onOpenFile={onOpenFile} nameFor={nameFor}/>{checkpoint.marker(m.id)}</Fragment>)}
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
