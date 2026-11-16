import { useState, type ComponentType } from 'react';
import type { Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { ChatPanel } from './AgentWindow';
import { ChangesPanel } from './ChangesPanel';
import { CollectionPanel } from './CollectionPanel';
import { CommandPanel } from './CommandPanel';
import { ConversationList } from './ConversationList';
import { EditorArea } from './EditorArea';
import { FileExplorer } from './FileExplorer';
import { ProcessesPanel } from './ProcessesPanel';
import { ActionsPanel } from './ActionsPanel';
import { PreviewPanel } from './PreviewPanel';
import { MissionsPanel } from './MissionsPanel';
import { useRunner } from './RunnerContext';
import { TelemetryPanel } from './TelemetryPanel';
import { TerminalPanel } from './TerminalPanel';
import { conversationReader } from './transcript-cache';
import type { ViewTarget } from './workspace-model';
import { WorkspaceHome } from './WorkspaceHome';

export type ModuleProps = {
  workspaceId: string;
  chooseRepositoryFolder?(): Promise<string | null>;
  target: ViewTarget;
  onTarget(target: ViewTarget): void;
  collections: Collection[];
  error: string;
  loaded?: boolean;
  refresh(): void;
  viewState?: ViewStateStore;
  onOpenViewer?(sessionId: string, commandId: string): Promise<void>;
  onOpenChat?(): void;
  onNewConversation?(workspaceId: string): void;
  onShowSession?(target: ViewTarget): void;
  onShowPanel?(kind: string, target?: ViewTarget): void;
  onShowModule?(kind: 'terminal' | 'changes'): void;
  /** Closes this panel (a terminal panel whose last shell exited cleanly). */
  onClosePanel?(): void;
};
export type PanelModule = { title: string; icon?: string; Component: ComponentType<ModuleProps> };

function ChatModule({ target, onTarget, viewState, collections, onOpenChat, onNewConversation, onShowModule }: ModuleProps) {
  const { api } = useRunner();
  const collection = collections.find(value => value.id === target.collectionId);
  // A workspace with no conversation open shows what it holds and how to start, not a form.
  if (collection && !target.sessionId) return <WorkspaceHome workspace={collection} viewState={viewState} onNewConversation={onNewConversation} onShowModule={onShowModule} onTarget={onTarget}/>;
  return <ChatPanel key={JSON.stringify([target.collectionId, conversationReader(api, target.sessionId).identity])} embedded showCommands={false} onOpenChat={onOpenChat}
    collectionId={target.collectionId} initialSessionId={target.sessionId}
    allowStart={!!collection && collection.state === 'ready' && !collection.ownershipUncertain}
    viewState={viewState}
    onSessionChange={sessionId => onTarget({ ...target, sessionId, commandId: '' })}/>;
}

function AssistantModule({ viewState, workspaceId }: ModuleProps) {
  const key = `${viewState?.key}:assistant-session`;
  const [sessionId, setSessionId] = useState(() => viewState?.getItem(key) || '');
  const [purpose, setPurpose] = useState<'help' | 'planning' | 'summary'>(() => { const saved = viewState?.getItem(`${key}:purpose`); return saved === 'planning' || saved === 'summary' ? saved : 'help'; });
  return <>
    <label className="assistant-purpose">Conversation<select aria-label="Assistant purpose" value={purpose} onChange={e => { setPurpose(e.target.value as typeof purpose); viewState?.setItem(`${key}:purpose`, e.target.value); setSessionId(''); viewState?.setItem(key, ''); }}>
      <option value="help">Help</option>
      <option value="planning">Planning</option>
      <option value="summary">Summary</option>
    </select></label>
    <ChatPanel key={purpose} collectionId={workspaceId} purpose={purpose} embedded showCommands={false} initialSessionId={sessionId} viewState={viewState}
      onSessionChange={id => { setSessionId(id); viewState?.setItem(key, id); }}/>
  </>;
}

/** First-party modules use the same runtime and target contract in every page. */
export const builtinPanels: Readonly<Record<string, PanelModule>> = {
  collections: { title: 'Workspaces', icon: 'collections', Component: CollectionPanel },
  chat: { title: 'Agent chat', icon: 'chat', Component: ChatModule },
  console: { title: 'Command output', icon: 'output', Component: CommandPanel },
  terminal: { title: 'Terminal', icon: 'terminal', Component: ({ workspaceId, collections, viewState, onClosePanel }) => <TerminalPanel key={workspaceId} workspaceId={workspaceId} collections={collections} viewState={viewState} onClosePanel={onClosePanel}/> },
  assistant: { title: 'Ask Lazybox', icon: 'chat', Component: AssistantModule },
  changes: { title: 'Changes', icon: 'branch', Component: ({ workspaceId, viewState, target, onShowSession }) => <ChangesPanel key={workspaceId} workspaceId={workspaceId} sessionId={target.collectionId === workspaceId ? target.sessionId : ''} onShowSession={onShowSession} viewState={viewState}/> },
  usage: { title: 'Usage & cost', icon: 'sliders', Component: ({ workspaceId }) => <TelemetryPanel workspaceId={workspaceId}/> },
  sessions: { title: 'Sessions', icon: 'history', Component: ({ workspaceId, target, onTarget }) => <ConversationList collectionId={workspaceId} target={target} onTarget={onTarget}/> },
  missions: { title: 'Missions', icon: 'target', Component: MissionsPanel },
  processes: { title: 'Processes', icon: 'processes', Component: ({ workspaceId, onShowSession, onShowPanel }) => <ProcessesPanel workspaceId={workspaceId} onShowSession={onShowSession} onShowPanel={onShowPanel}/> },
  actions: { title: 'Actions', icon: 'play', Component: ({ workspaceId, viewState, onShowPanel }) => <ActionsPanel key={workspaceId} workspaceId={workspaceId} viewState={viewState} onShowPanel={onShowPanel}/> },
  preview: { title: 'Preview', icon: 'eye', Component: ({ workspaceId }) => <PreviewPanel key={workspaceId} workspaceId={workspaceId}/> },
  files: { title: 'Files', icon: 'folder', Component: ({ workspaceId, collections }) => <FileExplorer workspaceId={workspaceId} collections={collections}/> },
  editor: { title: 'Editor', icon: 'file', Component: ({ workspaceId, viewState }) => <EditorArea workspaceId={workspaceId} viewState={viewState}/> },
};

/** Panels the page itself is made of: they are rearranged, not shown from the page menu. */
export const pagePanels = new Set(['collections', 'chat', 'changes']);

/** A panel title inside a sentence: "Add usage & cost". */
export const sentence = (title: string) => title.charAt(0).toLowerCase() + title.slice(1);
