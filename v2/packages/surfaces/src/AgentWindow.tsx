import { LeaderMenu } from './LeaderMenu';
import { DetachedCommands } from './DetachedCommands';
import { SnippetPicker } from './SnippetPicker';
import { useKeyboardNavigation, useKeyboardAction, useKeymap, useMenuSnippet, type KeyHint } from './keyboard';
import { continueConversation } from './transcript-cache';
import { useChatScroll } from './useChatScroll';
import { sessionModelLabel, sessionAccountLabel, conversationTitle, titleFromMessage, branchSummary } from './conversation-model';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { useFileOpener, type OpenModifiers } from './file-links';
import type { FileLink } from './file-reference';
import { useTranscript } from './useTranscript';
import { useLiveStatus } from './LiveIndicator';
import { savePrompt } from './prompt-history';
import { saveSnippetUse } from './snippet-usage';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { type CommandStatus, type Session } from '@lazybox/protocol';
import type { SurfaceTarget, ViewStateStore } from '@lazybox/platform';
import { readDraft, writeDraft } from './view-state';
import { RunnerProvider, useRunner, type RunnerConnection } from './RunnerContext';
import { AttentionScope, useMarkViewed } from './useAttention';
import { useComposeRequests } from './compose';
export type { RunnerConnection } from './RunnerContext';
import './style.css';
import './chat-header.css';
import { awaitingFirstMessage } from './agent-status';
import { appendToDraft, composeRunMessage, useComposerOffers, useSharedRuns } from './command-runs';
import { useComposerDraft } from './useComposerDraft';
import { usePromptRecall } from './usePromptRecall';
import { useSessionRefresh, useSessionWorkspace } from './useSessionPolling';
import { useFileDrop } from './useFileDrop';
import { NewSessionForm, useSessionLauncher } from './NewSessionForm';
import { ChatHeader, ChatStatus, SessionHeader, SessionInspection, WindowTopbar } from './ChatHeader';
import { ConversationTitle } from './ConversationTitle';
import { PermissionRestartPrompt, SessionLifecycleButton, SessionMenu, sessionMenuItems } from './SessionMenu';
import { contextMenu } from './ContextMenu';
import { ResumeBar, TranscriptNotice } from './SessionNotices';
import { useSubagentHost } from './SubagentHost';
import { LiveBar } from './LiveBar';
import { SubagentContext } from './subagent-view';
import { BackgroundWorkButton, SubagentAttention } from './SubagentTray';
import { SubagentPanel } from './SubagentPanel';
import { MessageArea } from './MessageArea';
import { SubscriptionControls } from './SubscriptionSwitch';
import { Composer } from './Composer';
import { ConsoleWindow, EventLog, SessionCommands } from './SessionCommands';
import { faultSentence, sessionLimit, subscriptionName, turnFault } from './subscription-model';
import { useConversationActivity } from './activity-detail';

const HANDOVER_NOTICE = 'Added the compact view of a terminal run. Review it, add what you want, and send.';

export type AgentWindowProps = {
  connection: RunnerConnection;
  purpose?: 'coding' | 'help' | 'planning' | 'summary';
  assistantContext?: string;
  /** Initial choices. Starting a session always requires an explicit click. */
  agent?: 'claude' | 'codex';
  workingDirectory?: string;
  emptyWorkspace?: boolean;
  initialSessionId?: string;
  collectionId?: string;
  embedded?: boolean;
  showCommands?: boolean;
  allowStart?: boolean;
  /** Set only by an explicit Quick start action; never persisted. */
  autoStart?: boolean;
  onOpenChat?: () => void;
  initialCommandId?: string;
  initialCommandsOpen?: boolean;
  mode?: 'agent' | 'console';
  viewState?: ViewStateStore;
  onViewChange?: (target: SurfaceTarget) => void | Promise<void>;
  onSessionChange?: (sessionId: string) => void;
  onOpenViewer?: (sessionId: string, commandId: string) => void | Promise<void>;
  /** Shows one of this conversation's managed commands in the host's command console. */
  onOpenCommand?: (commandId: string) => void;
  /** Brings the main window forward: the command palette here navigates there. */
  onFocusMain?: () => void;
};

/** One independent view of a Runner session. Unmounting disconnects readers,
 * never execution. Changing the connection resets the view and its readers. */
export function AgentWindow(props: AgentWindowProps) {
  // A detached chat is visually embedded but still owns its window's keyboard
  // dispatcher. Workspace-hosted panels use their Workspace's dispatcher.
  const keyboardHint = useKeyboardNavigation(props.viewState);
  return <RunnerProvider connection={props.connection}>
    <AttentionScope root={props.viewState?.root}>
      <ChatPanel {...props} keyboardHint={keyboardHint}/>
      <DetachedCommands viewState={props.viewState} collectionId={props.collectionId || ''} sessionId={props.initialSessionId || ''} onFocusMain={props.onFocusMain}/>
    </AttentionScope>
  </RunnerProvider>;
}

export function ChatPanel({ purpose = 'coding', assistantContext = '', agent, workingDirectory = '', emptyWorkspace = false, initialSessionId = '', collectionId = '', embedded = false, showCommands = true, allowStart = true, autoStart = false, onOpenChat, initialCommandId = '', initialCommandsOpen, mode = 'agent', viewState, onViewChange, onSessionChange, onOpenViewer, onOpenCommand, keyboardHint = null }: Omit<AgentWindowProps, 'connection'> & { keyboardHint?: KeyHint | null }) {
  const { api, info, connecting, error: connectionError, refresh, revision } = useRunner();
  const keymap = useKeymap(viewState);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerFocused = () => document.activeElement === composer.current || document.querySelector('[data-agent-composer]') === composer.current;

  // Snippets: the picker, and a ]] menu entry. A menu entry sends its snippet
  // to the conversation being typed in, or inserts it when there is already a
  // draft (never overwriting one).
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  useKeyboardAction('snippets.open', () => { if (canCompose && composerFocused()) setSnippetsOpen(true); });
  useMenuSnippet(entry => {
    if (!canCompose || !composerFocused()) return;
    void api.listSnippets({}).then(result => {
      const snippet = result.snippets.find(row => row.key === entry.snippet);
      if (!snippet) { setError(`Snippet "${entry.snippet}" no longer exists. Update the ]] menu in Settings → Keyboard.`); return; }
      saveSnippetUse(viewState, snippet.key);
      if (entry.mode === 'send' && !message.trim() && !files.length && !missingFiles.length && !sending) void send(undefined, snippet.body);
      else { const next = message + (message && !message.endsWith('\n') ? '\n' : '') + snippet.body; setMessage(next); persistDraft(next, files, missingFiles); requestAnimationFrame(() => composer.current?.focus()); }
    }, error => setError(String(error)));
  });
  useKeyboardAction('chat.send', () => { const focused = document.activeElement as HTMLTextAreaElement; if (focused === composer.current && (canSend || missingFiles.length > 0 || !!message.trim())) focused.form?.requestSubmit(); });

  const assistant = purpose !== 'coding';
  const [sessionID, setSessionID] = useState(initialSessionId);
  const transcript = useTranscript(api, sessionID, !!info);
  const [session, setSession] = useState<Session | undefined>(transcript.reader.session);
  useMarkViewed(session, mode === 'agent');
  const workspace = useSessionWorkspace(api, session?.collectionId || collectionId, !!info, revision);
  const { recent: events, messages: conversation, status: stream } = transcript;
  const scroll = useChatScroll(transcript.reader, conversation, session?.pending.length);
  const { jumpToLatest } = scroll;
  const [error, setError] = useState('');
  const { message, setMessage, files, setFiles, missingFiles, setMissingFiles, uncertainSend, setUncertainSend, sendAttempt, persistDraft } = useComposerDraft(viewState, sessionID, setError);
  const [commandsOpen, setCommandsOpen] = useState(initialCommandsOpen ?? !!initialCommandId);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  const [command, setCommand] = useState(initialCommandId);
  // A failed refresh of the session is current state, not an event: the next
  // successful refresh clears it (a Runner restart must not leave a stale alarm).
  const [refreshError, setRefreshError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [switchingSubscription, setSwitchingSubscription] = useState(false);
  const fileLinks = useFileOpener(session?.collectionId, viewState);
  // Stable, so the memoized messages do not re-render when the opener does.
  const openFileRef = useRef(fileLinks.open); openFileRef.current = fileLinks.open;
  const openFile = useCallback((reference: FileLink, how: OpenModifiers) => void openFileRef.current(reference, how), []);
  const sendingRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canResumeOnSend = !!session?.closed && !session.resumeBlocked && !session.recoveryRequired && !!session.providerReference && !!session.capabilities?.resume;
  const canCompose = !!session && (!session.closed || canResumeOnSend);
  const canAttach = !!session?.capabilities?.files && !!info?.attachmentLimits && canCompose && !sending;
  // At a subscription limit a message waits and is sent once the conversation continues.
  const limited = !!sessionLimit(session);
  // After a provider error ends a turn, the next message continues the conversation.
  const continuesAfterError = !!session && !session.closed && turnFault(session.fault);
  const canSend = canCompose && (!session?.fault || canResumeOnSend || limited || continuesAfterError) && !sending && missingFiles.length === 0 && (!!message.trim() || files.length > 0);

  // A run handed over from a terminal joins the draft, after anything already
  // typed, and the cursor goes to its end: the person adds a line and sends.
  const [handedOver, setHandedOver] = useState('');
  useEffect(() => { if (!message.trim()) setHandedOver(''); }, [message]);
  useEffect(() => setHandedOver(''), [sessionID]);
  const addToDraft = (text: string, notice: string) => {
    const next = appendToDraft(message, text);
    setMessage(next); setUncertainSend(''); sendAttempt.current = null; persistDraft(next, files, missingFiles); setHandedOver(notice);
    requestAnimationFrame(() => { const box = composer.current; if (box) { box.focus(); box.setSelectionRange(next.length, next.length); box.scrollTop = box.scrollHeight; } });
  };
  useComposerOffers(canCompose && !sending && !assistant ? sessionID : '', text => addToDraft(text, HANDOVER_NOTICE));
  useSharedRuns(api, assistant ? '' : sessionID, session?.conversationId || session?.id || '', (claimedFor, command, view) => {
    const text = composeRunMessage(command, view);
    if (claimedFor === sessionID && !sending) { addToDraft(text, `“${command.title}” was shared from your terminal. Review it, add what you want, and send.`); return; }
    // The view moved on after the claim: keep the run in that conversation's draft.
    try { const draft = readDraft(viewState, claimedFor); writeDraft(viewState, claimedFor, { ...draft, text: appendToDraft(draft.text, text) }); }
    catch (e) { setError(`Could not keep the shared run in its draft: ${String(e)}`); }
  });
  // Another panel (Changes: failing checks) puts text after any draft, for
  // the person to review and send; it is never sent for them.
  // The saved draft is current (every edit persists it) even when this render
  // has not seen it yet, and saving now survives this view remounting.
  useComposeRequests(sessionID, canCompose, text => {
    const current = viewState ? readDraft(viewState, sessionID).text : message;
    const next = current + (current.trim() ? '\n\n' : '') + text;
    setMessage(next); persistDraft(next, files, missingFiles); setUncertainSend(''); sendAttempt.current = null;
    requestAnimationFrame(() => { const node = composer.current; if (node) { node.focus(); node.setSelectionRange(node.value.length, node.value.length); } });
  });

  useEffect(() => {
    const control = new AbortController(); lifetime.current = control;
    return () => { control.abort(); lifetime.current = null; };
  }, []);

  useSessionRefresh({
    api, sessionID, connected: !!info, showCommands, reader: transcript.reader, sending: sendingRef, setSession, setCommands, setRefreshError,
    onSuccessor: next => { setSessionID(next.id); onSessionChange?.(next.id); },
  });
  const launcher = useSessionLauncher({
    api, info, viewState, agent, workingDirectory, purpose, assistantContext, collectionId, emptyWorkspace, allowStart, autoStart, sessionID, lifetime,
    onError: setError,
    onStarted: id => { setSessionID(id); setCommand(''); onSessionChange?.(id); },
  });

  const send = async (event?: FormEvent, snippetText?: string) => {
    event?.preventDefault();
    const text = snippetText ?? message;
    // Never swallow Enter: say what is in the way.
    if (!snippetText && !sendingRef.current && !sending && missingFiles.length && (message.trim() || files.length)) { setError(`Attach ${missingFiles.length === 1 ? missingFiles[0].name : 'the files'} again, or remove ${missingFiles.length === 1 ? 'it' : 'them'}, to send.`); return false; }
    // Any other refusal says why: a message that cannot go must never look sent.
    if (!snippetText && (message.trim() || files.length) && !canSend) {
      const why = sendingRef.current || sending ? 'Still sending your previous message…'
        : !session ? 'Still connecting to this conversation…'
        : !canCompose ? (session.recoveryRequired ? 'This conversation needs recovery first: use Resume above.' : session.resumeBlocked ? 'This conversation cannot be continued from here.' : 'This conversation has ended.')
        : session.fault ? `${faultSentence(session.fault)} Resume it or start a new conversation to continue.`
        : '';
      if (why) setError(why);
      return false;
    }
    if (sendingRef.current || !(snippetText ? canCompose && (!session?.fault || limited || continuesAfterError) && !sending && !message.trim() && !files.length && !missingFiles.length : canSend)) return false;
    sendingRef.current = true; setSending(true); setError(''); jumpToLatest();
    const signal = lifetime.current!.signal;
    try {
      const previous = sendAttempt.current;
      const attempt = previous?.text === text && previous.files.length === files.length && files.every((file, i) => file === previous.files[i]) ? previous : { id: uncertainSend || crypto.randomUUID(), text, files };
      sendAttempt.current = attempt;
      setUncertainSend(attempt.id); persistDraft(text, files, [], attempt.id);
      const attachments = await Promise.all(files.map(async file => ({ name: file.name, mediaType: file.type, data: new Uint8Array(await file.arrayBuffer()) })));
      let destination = sessionID;
      if (session?.closed) {
        const resumed = await api.resumeSession({ sessionId: sessionID }, { signal });
        if (!resumed.session) throw new Error('Runner did not return the resumed conversation');
        continueConversation(api, sessionID, resumed.session);
        destination = resumed.session.id;
        // A view may close while delivery is in flight. Retain the same draft
        // and operation identity under the successor before sending any bytes.
        writeDraft(viewState, destination, { text, files: files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })), operationId: attempt.id });
      }
      // A delivery that never answers (a Runner restarting mid-request) must not
      // block sending forever. The operation id is kept, so sending again cannot
      // deliver the message twice.
      const deadline = AbortSignal.timeout(30_000);
      try { await api.apply({ sessionId: destination, operationId: attempt.id, operation: { case: 'message', value: { text, attachments } } }, { signal: AbortSignal.any([signal, deadline]) }); }
      catch (e) { if (deadline.aborted && !signal.aborted) throw new Error('The Runner did not confirm this message within 30 seconds. Press Enter to send it again: it will not be delivered twice.'); throw e; }
      savePrompt(viewState, text, session?.conversationId || sessionID); recall.reset();
      if (!signal.aborted) { setMessage(''); setFiles([]); setUncertainSend(''); sendAttempt.current = null; persistDraft('', [], []); if (destination !== sessionID) { writeDraft(viewState, destination, { text: '', files: [], operationId: '' }); setSessionID(destination); onSessionChange?.(destination); refresh(); } }
      return !signal.aborted;
    } catch (e) { if (!signal.aborted) { setError(String(e)); if (snippetText) setMessage(text); } return false; }
    finally { if (!signal.aborted) { sendingRef.current = false; setSending(false); } }
  };
  const selectFiles = (selected: FileList | File[] | null) => {
    const limits = info?.attachmentLimits;
    if (!limits) return;
    // Different client files can share a name, size, and modification time.
    // Preserve the selected bytes; the Runner deduplicates by content.
    const next = [...files, ...Array.from(selected || [])];
    const remaining = [...missingFiles];
    let changed = false;
    for (const file of Array.from(selected || [])) {
      const index = remaining.findIndex(saved => saved.name === file.name && saved.size === file.size && saved.lastModified === file.lastModified);
      if (index >= 0) remaining.splice(index, 1); else changed = true;
    }
    if (next.length + remaining.length > limits.maxFiles || next.some(file => BigInt(file.size) > limits.maxFileBytes) || [...next, ...remaining].reduce((size, file) => size + BigInt(file.size), 0n) > limits.maxMessageBytes) {
      setError(`Attach up to ${limits.maxFiles} files, ${Number(limits.maxFileBytes) / (1 << 20)} MiB per file and ${Number(limits.maxMessageBytes) / (1 << 20)} MiB total.`); return;
    }
    if (changed) { setUncertainSend(''); sendAttempt.current = null; }
    setFiles(next); setMissingFiles(remaining); setError(''); persistDraft(message, next, remaining, changed ? '' : uncertainSend);
  };
  const interrupt = async () => {
    try { await api.apply({ sessionId: sessionID, operationId: crypto.randomUUID(), operation: { case: 'interrupt', value: {} } }); }
    catch (e) { setError(String(e)); }
  };
  const [restartTo, setRestartTo] = useState('');
  // An agent whose worker predates live permission changes restarts in the new
  // mode between turns; the same provider conversation continues.
  const restartWithPermission = async (mode: string) => {
    setRestartTo('');
    try {
      const result = await api.restartWithPermission({ sessionId: sessionID, mode });
      if (!result.session) throw new Error('Runner did not return the restarted conversation');
      continueConversation(api, sessionID, result.session);
      setSessionID(result.session.id); onSessionChange?.(result.session.id); refresh();
    } catch (e) { setError(String(e)); }
  };
  const changePermission = async (mode: string) => {
    try {
      await api.apply({ sessionId: sessionID, operationId: crypto.randomUUID(), operation: { case: 'permission', value: { mode } } });
      setSession(current => current ? { ...current, permission: mode } : current);
    } catch (e) { setError(String(e)); }
  };
  const close = async () => {
    try { const result = await api.stopSessionResources({ sessionId: sessionID }); setSession(result.session); }
    catch (e) { setError(String(e)); }
  };
  const live = useLiveStatus(session, events);
  const disconnected = stream.startsWith('Disconnected') || stream === 'Reconnecting';
  const activeProfile = info?.profiles.find(p => p.id === session?.profileId);
  const agentName = (activeProfile?.provider || launcher.provider) === 'claude' ? 'Claude' : 'Codex';
  const currentCommand = command || commands.at(-1)?.id;
  // How much tool activity this conversation shows: the default, or its own.
  const activity = useConversationActivity(viewState, session?.conversationId || sessionID, mode === 'agent' && !!sessionID);
  const recall = usePromptRecall({
    viewState, sessionID, conversationKey: session?.conversationId || sessionID, conversation,
    onRecall: text => {
      setMessage(text); setUncertainSend(''); sendAttempt.current = null; persistDraft(text, files, missingFiles);
    },
  });
  useEffect(() => {
    if (!onViewChange) return;
    void (async () => { try { await onViewChange({ sessionId: sessionID, commandId: currentCommand || '', commandsOpen }); } catch (e) { setError(`Could not save this window: ${String(e)}`); } })();
  }, [onViewChange, sessionID, currentCommand, commandsOpen]);
  const newSession = () => {
    setSessionID(''); setSession(undefined); setCommands([]); setCommand(''); setMessage(''); setFiles([]); setMissingFiles([]); setUncertainSend(''); sendAttempt.current = null; setError(''); onSessionChange?.('');
  };
  const realTitle = conversationTitle(session);
  const firstPrompt = conversation.find(m => m.type === 'operation_accepted')?.text || '';
  const branch = branchSummary(workspace);
  const modelLabel = sessionModelLabel(session, transcript.reportedModel);
  const accountName = sessionAccountLabel(session, activeProfile);
  const profileList = info?.profiles;
  const nameFor = useCallback((id: string) => subscriptionName(profileList?.find(p => p.id === id), id), [profileList]);
  const shownAccount = accountName === 'Account not reported' || accountName === 'Loading account…' ? '' : accountName;
  // A Runner restart while nothing was said yet is not news: an empty
  // conversation stays empty instead of showing "Runner restarted".
  const spoken = conversation.some(m => m.type !== 'reattached');
  // A conversation that opened and waits for its first message takes the keyboard once.
  const focusedFor = useRef('');
  const firstMessage = !!session && awaitingFirstMessage(session) && !spoken;
  useEffect(() => {
    if (!firstMessage || !canCompose || focusedFor.current === sessionID) return;
    focusedFor.current = sessionID;
    const active = document.activeElement;
    if (!active || active === document.body || composer.current?.closest('main')?.contains(active)) composer.current?.focus({ preventScroll: true });
  }, [firstMessage, canCompose, sessionID]);
  const resumeSession = async (processesStopped: boolean) => {
    const result = await api.resumeSession({ sessionId: sessionID, processesStopped }, { signal: lifetime.current!.signal });
    if (!result.session) return false;
    continueConversation(api, sessionID, result.session); setSessionID(result.session.id); onSessionChange?.(result.session.id); refresh();
    return true;
  };
  const drop = useFileDrop({ canAttach, onFiles: selectFiles, onError: setError });
  const insertSnippet = (body: string) => {
    const node = composer.current, start = node?.selectionStart ?? message.length, end = node?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + body + message.slice(end);
    setMessage(next); persistDraft(next, files, missingFiles); setUncertainSend(''); sendAttempt.current = null;
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + body.length, start + body.length); });
  };

  const subagents = useSubagentHost({ api, sessionID, session, index: transcript.subagents, revealMessage: scroll.revealMessage, openFile: session?.collectionId ? openFile : undefined, onError: setError });
  if (mode === 'console') return <ConsoleWindow api={api} command={currentCommand} error={error} viewState={viewState} onError={setError}/>;

  const title = <ConversationTitle api={api} session={session} sessionID={sessionID} realTitle={realTitle} suggestedTitle={titleFromMessage(firstPrompt)} branch={branch}
    onRenamed={renamed => { setSession(renamed); refresh(); }} onError={setError}/>;
  const status = <><ChatStatus session={session} live={live}/><SubagentAttention/></>;
  const inspection = <><BackgroundWorkButton/><SessionInspection sessionID={sessionID} session={session} activity={transcript.activity} activityTruncated={transcript.activityTruncated}/></>;
  const lifecycle = <SessionLifecycleButton session={session} allowStart={allowStart} onNewSession={newSession} onClose={() => void close()}/>;

  return <main className={'agent-window' + (embedded ? ' embedded-chat' : '') + (drop.dragging ? ' file-drag-active' : '')} {...drop.handlers} onFocusCapture={activity.mark} onPointerDownCapture={activity.mark}>
    {!embedded && <LeaderMenu hint={keyboardHint}/>}
    {snippetsOpen && <SnippetPicker store={viewState} canSend={canCompose && !sending && !message.trim() && !files.length && !missingFiles.length}
      onClose={() => { setSnippetsOpen(false); composer.current?.focus(); }}
      onInsert={insertSnippet}
      onSend={text => send(undefined, text)}/>}
    {!embedded && <WindowTopbar connecting={connecting} info={info} sessionID={sessionID} session={session}/>}
    {(error || connectionError || refreshError) && !(embedded && connectionError) && <div className="error" role="alert">{error || connectionError || refreshError}<button onClick={() => { setError(''); setRefreshError(''); }}>Dismiss</button></div>}
    {!info && !connecting && <div className="connection-retry"><button onClick={refresh}>Retry connection</button></div>}
    {!sessionID && !allowStart
      ? <div className="empty">Select an existing session to view its chat.</div>
      : !sessionID
        ? <NewSessionForm launcher={launcher} info={info} purpose={purpose} emptyWorkspace={emptyWorkspace} collectionId={collectionId} agentName={agentName}/>
        : <SubagentContext.Provider value={subagents}><section className="single-session">
          {embedded
            ? <ChatHeader agentName={agentName} session={session} sessionID={sessionID} title={title} status={status} modelLabel={modelLabel} inspection={inspection}
              realTitle={realTitle} branch={branch} shownAccount={shownAccount} onOpenChat={onOpenChat}
              modelRequested={!!session?.model && !session.modelReported && !transcript.reportedModel}
              onContextMenu={contextMenu('session', () => [onOpenChat && { label: 'Open in its own window', icon: 'external', run: onOpenChat }, 'separator', ...sessionMenuItems({ session, allowStart,
                onChangePermission: mode => void changePermission(mode), onRestartWithPermission: setRestartTo, onSwitchSubscription: () => setSwitchingSubscription(true),
                onNewSession: newSession, onClose: () => void close(), onDelete: () => setDeleting(true), activity })], { sessionId: sessionID })}
              menu={<SessionMenu session={session} sessionID={sessionID} accountName={accountName} stream={stream} allowStart={allowStart}
                onChangePermission={mode => void changePermission(mode)} onRestartWithPermission={setRestartTo}
                onSwitchSubscription={() => setSwitchingSubscription(true)}
                onNewSession={newSession} onClose={() => void close()} onDelete={() => setDeleting(true)} activity={activity}/>}/>
            : <SessionHeader agentName={agentName} session={session} sessionID={sessionID} title={title} status={status} modelLabel={modelLabel} inspection={inspection}
              accountName={accountName} lifecycle={lifecycle}/>}
          {drop.dragging && <div className="file-drop-hint" role="status">Drop files to attach</div>}
          {session?.closed && <ResumeBar session={session} canResumeOnSend={canResumeOnSend} onResume={resumeSession} onError={setError}/>}
          {deleting && session && <DeleteConversationDialog session={session} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); newSession(); }}/>}
          {fileLinks.element}
          {transcript.error && <TranscriptNotice error={transcript.error} onRetry={transcript.retry}/>}
          <MessageArea api={api} session={session} sessionID={sessionID} transcript={transcript} scroll={scroll} spoken={spoken} agentName={agentName} limited={limited} nameFor={nameFor}
            onOpenFile={session?.collectionId ? openFile : undefined} onError={setError} detail={activity.detail}
            subscription={session && <SubscriptionControls session={session} profiles={profileList || []} viewState={viewState} dialogOpen={switchingSubscription} onCloseDialog={() => setSwitchingSubscription(false)} onSession={next => { transcript.reader.session = next; setSession(next); }} onError={setError}/>}/>
          {!transcript.error && <LiveBar api={api} session={session} sessionID={sessionID} live={live} disconnected={disconnected} activity={transcript.activity} onInterrupt={() => void interrupt()}
            onOpenCommand={onOpenCommand || (showCommands ? commandId => { setCommand(commandId); setCommandsOpen(true); } : onOpenViewer ? commandId => void onOpenViewer(sessionID, commandId) : undefined)}/>}
          <Composer textarea={composer} fileInput={fileInput} agentName={agentName} embedded={embedded} session={session} sessionID={sessionID} viewState={viewState} keymap={keymap}
            limited={limited} message={message} files={files} missingFiles={missingFiles} uncertainSend={uncertainSend} handedOver={handedOver}
            sending={sending} canCompose={canCompose} canAttach={canAttach} canSend={canSend}
            permissionPrompt={restartTo && <PermissionRestartPrompt mode={restartTo} busy={!!session?.busy} onRestart={() => void restartWithPermission(restartTo)} onCancel={() => setRestartTo('')}/>}
            onSubmit={send}
            onChange={text => { recall.reset(); setMessage(text); setUncertainSend(''); sendAttempt.current = null; persistDraft(text, files, missingFiles); }}
            onRecallKey={recall.onKeyDown}
            onRemoveFile={i => { const next = files.filter((_, index) => index !== i); setFiles(next); setUncertainSend(''); persistDraft(message, next, missingFiles); }}
            onRemoveMissingFile={i => { const next = missingFiles.filter((_, index) => index !== i); setMissingFiles(next); setUncertainSend(''); setError(''); persistDraft(message, files, next); }}
            onDropMissingFiles={() => { setMissingFiles([]); setUncertainSend(''); setError(''); persistDraft(message, files, []); requestAnimationFrame(() => composer.current?.focus()); }}
            onDismissHandover={() => setHandedOver('')}
            onOpenSnippets={() => setSnippetsOpen(true)}
            onSelectFiles={selectFiles}
            onInterrupt={() => void interrupt()}
            interruptInBar={!transcript.error && !disconnected && !!session?.busy && live.tone === 'busy'}
            onError={setError}/>
          {showCommands && !assistant && <SessionCommands api={api} session={session} sessionID={sessionID} commands={commands} currentCommand={currentCommand} open={commandsOpen} viewState={viewState}
            onToggle={setCommandsOpen} onSelect={setCommand} onError={setError} onOpenViewer={onOpenViewer}
            onSendToAgent={canCompose && !sending ? text => { addToDraft(text, HANDOVER_NOTICE); return ''; } : undefined}/>}
          {!embedded && <EventLog events={events}/>}
          <SubagentPanel/>
        </section></SubagentContext.Provider>}
  </main>;
}
