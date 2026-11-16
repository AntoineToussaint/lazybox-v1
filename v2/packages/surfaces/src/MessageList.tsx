import type { OpenModifiers } from './file-links';
import { memo } from 'react';
import { RichContent } from './RichContent';
import './message-list.css';
import type { FileLink } from './file-reference';
import type { TranscriptMessage } from './transcript-model';
import type { ReplayProgress } from './transcript-cache';

const MessageRow = memo(function MessageRow({ message: m, agentName, onOpenFile }: { message: TranscriptMessage; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void }) {
  if (m.type === 'reattached') return <div className="runner-divider" role="note" title="The Runner restarted and re-attached to this agent. Nothing was interrupted.">Runner restarted{(m.count || 1) > 1 ? ` ${m.count}×` : ''} · nothing interrupted</div>;
  return <article className={'message ' + m.type}>
    <span className="eyebrow">{m.type === 'operation_accepted' ? 'You' : m.type === 'failure' ? 'Provider failure' : m.type === 'notice' ? 'Runner' : agentName}</span>
    <RichContent text={m.text} onOpenFile={onOpenFile}/>
    {m.files?.length ? <ul className="sent-files" aria-label="Sent attachments">{m.files.map((file, i) => <li key={i}>↳ {file.name} · {Math.ceil(file.size / 1024)} KiB</li>)}</ul> : null}
  </article>;
});

/**
 * The latest `visible` messages of a conversation. Only that tail is mounted:
 * opening a long conversation renders what is on screen, and earlier history
 * is added as the reader scrolls toward it. A render of the window that hosts
 * it (a keystroke in the composer) does not touch the rows.
 */
export const MessageList = memo(function MessageList({ messages, visible, agentName, onOpenFile, onShowEarlier }: { messages: TranscriptMessage[]; visible: number; agentName: string; onOpenFile?(reference: FileLink, how: OpenModifiers): void; onShowEarlier(): void }) {
  const hidden = Math.max(0, messages.length - visible);
  return <>
    {hidden > 0 && <button type="button" className="show-earlier" onClick={onShowEarlier}>Show earlier messages <small>{hidden.toLocaleString()} more</small></button>}
    {messages.slice(hidden).map(m => <MessageRow key={m.id} message={m} agentName={agentName} onOpenFile={onOpenFile}/>)}
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
