import { useLayoutEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import type { InfoResponse, JournalEvent, Session } from '@lazybox/protocol';
import { sessionStatus } from './agent-status';
import type { branchSummary } from './conversation-model';
import { Icon } from './Icons';
import { LiveIndicator } from './LiveIndicator';
import type { LiveStatus } from './live-status';
import { TelemetryPanel } from './TelemetryPanel';
import { ToolActivity } from './ToolActivity';
import './chat-header.css';

type Branch = ReturnType<typeof branchSummary>;

/**
 * Whether an element is narrower than `width`: a chat in a slim panel says
 * its counts without their words, which stay in the tooltip and the
 * accessible name. Measured, not a container query: a size container would
 * become the containing block of the header's fixed popovers.
 */
function useNarrow(width: number) {
  const ref = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setNarrow(node.clientWidth < width);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return [ref, narrow] as const;
}

/** What the agent is doing now, with the queue behind it. */
export function ChatStatus({ session, live }: { session?: Session; live: LiveStatus }) {
  return <span className="chat-status" data-state={session?.closed ? 'saved' : session?.status} data-tone={live.tone}>
    <LiveIndicator tone={live.tone}/>
    <span className="chat-status-text">
      <span role="status">{live.label}{session?.queued ? ` · ${session.queued} queued` : ''}</span>
      {live.text.length > live.label.length && <span aria-hidden="true">{live.text.slice(live.label.length)}</span>}
    </span>
  </span>;
}

/** Usage and tool activity of the execution on screen. */
export function SessionInspection({ sessionID, session, activity, activityTruncated }: { sessionID: string; session?: Session; activity: JournalEvent[]; activityTruncated?: boolean }) {
  return <>
    <TelemetryPanel executionId={sessionID} conversationId={session?.conversationId} compact/>
    <ToolActivity events={activity} truncated={activityTruncated}/>
  </>;
}

type HeaderProps = {
  agentName: string;
  session?: Session;
  sessionID: string;
  title: ReactNode;
  status: ReactNode;
  modelLabel: string;
  inspection: ReactNode;
};

/** The header of a chat embedded in a workspace panel or a detached window. */
export function ChatHeader({ agentName, session, sessionID, title, status, modelLabel, inspection, realTitle, branch, modelRequested, shownAccount, onOpenChat, menu, onContextMenu, onPickModel }: HeaderProps & {
  /** The conversation's actions on a right-click, the same as its ⋯ menu. */
  onContextMenu?: MouseEventHandler<HTMLElement>;
  realTitle: string;
  branch: Branch;
  /** The model was asked for but the provider has not confirmed it yet. */
  modelRequested: boolean;
  shownAccount: string;
  onOpenChat?(): void;
  menu: ReactNode;
  /** The model picker (`/model`): the model name opens it. */
  onPickModel?(): void;
}) {
  const [header, narrow] = useNarrow(760);
  return <header ref={header} className="chat-heading" data-narrow={narrow || undefined} onContextMenu={onContextMenu}>
    <span className={'agent-avatar ' + agentName.toLowerCase()} aria-hidden="true">{agentName === 'Claude' ? '✳︎' : '›'}</span>
    <div className="chat-heading-main">
      {title}
      <div className="chat-heading-meta">
        {realTitle && branch && <span className="chat-meta-branch" title={branch.title}><Icon name="branch" size={11}/>{branch.name}</span>}
        <span className="chat-agent">{agentName}</span>
        {modelLabel && (onPickModel
          ? <button type="button" className="chat-model chat-model-button" title={(modelRequested ? 'Requested model; the provider has not confirmed it yet. ' : '') + 'Switch model (/model)'} aria-label={`Model ${modelLabel}: switch model`} onClick={onPickModel}>{modelLabel}<Icon name="chevron" size={10}/></button>
          : <span className="chat-model" title={modelRequested ? 'Requested model; the provider has not confirmed it yet' : 'Model'}>{modelLabel}</span>)}
        {shownAccount && <span className="chat-account" title="Account">{shownAccount}</span>}
        {status}
      </div>
    </div>
    <div className="chat-heading-actions">
      {/* The conversation's "N prompts" jump list lives here (PromptNavigator), not over the transcript. */}
      <span className="prompt-jump-slot" data-prompt-jump-slot=""/>
      {sessionID && inspection}
      {onOpenChat && <button className="icon-button" aria-label="Open chat window ↗" title="Open in a separate window" onClick={onOpenChat}><Icon name="external"/></button>}
      {menu}
    </div>
  </header>;
}

/** The session heading of a standalone agent window. */
export function SessionHeader({ agentName, session, sessionID, title, status, modelLabel, inspection, accountName, lifecycle }: HeaderProps & { accountName: string; lifecycle: ReactNode }) {
  return <>
    {session && title}
    <div className="panel-title">
      <div><span className="eyebrow">Agent session</span><h2>{agentName}<span className="chat-model">{modelLabel}</span></h2></div>
      {lifecycle}
    </div>
    <div className="session-meta">
      {status}
      <span>{accountName}</span>
      <span>Gateway: {session?.gatewayId || 'direct'}</span>
      <span>{session?.queued || 0} queued</span>
      <span className="mono">{sessionID.slice(0, 12)}</span>
    </div>
    {sessionID && <div className="agent-inspection-bar">{inspection}</div>}
  </>;
}

/** The brand bar of a standalone agent window, with the Runner's state. */
export function WindowTopbar({ connecting, info, sessionID, session }: { connecting: boolean; info?: InfoResponse; sessionID: string; session?: Session }) {
  return <header className="topbar">
    <span className="brand" aria-hidden="true">l<span>↗</span></span>
    <div><h1>lazybox <span>V2</span></h1><p>One window. Your agent.</p></div>
    <span className="pill" role="status">{connecting ? 'Connecting to Runner' : !info ? 'Runner unavailable' : sessionID ? sessionStatus(session) : 'Runner connected'}</span>
  </header>;
}
