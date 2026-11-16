import { ActionMenu } from './ActionMenu';
import { LeaderMenu } from './LeaderMenu';
import { ToolActivity } from "./ToolActivity";
import {SnippetPicker} from './SnippetPicker';
import {useKeyboardNavigation,useKeyboardAction,useKeymap,useMenuSnippet,useVimPreferences,leaderKeys,type KeyHint} from './keyboard';
import {useComposerVim} from './useComposerVim';
import {continueConversation} from './transcript-cache';
import {useChatScroll} from './useChatScroll';
import {sessionModelLabel,sessionAccountLabel,conversationTitle,titleFromMessage,branchSummary} from './conversation-model';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { useFileOpener, type OpenModifiers } from './file-links';
import type { FileLink } from './file-reference';
import { useTranscript } from './useTranscript';
import { LiveIndicator, useLiveStatus } from './LiveIndicator';
import { caretOnFirstLine, caretOnLastLine, readPromptHistory, recallOrder, savePrompt } from './prompt-history';
import { saveSnippetUse } from './snippet-usage';
import { ConversationLoading, MessageList } from './MessageList';
import { PromptNavigator } from './PromptNavigator';
import { useRunnerSettings } from './RunnerSettings';
import { TelemetryPanel } from './TelemetryPanel';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { type Collection, type CommandStatus, type Session } from '@lazybox/protocol';
import { Console, RequestCard } from './session-parts';
import type { SurfaceTarget, ViewStateStore } from '@lazybox/platform';
import { readDraft, writeDraft, readLaunchChoices, writeLaunchChoices, type FileReference } from './view-state';
import { RunnerProvider, useRunner, type RunnerConnection } from './RunnerContext';
import { Icon } from './Icons';
import { AttentionScope, useMarkViewed } from './useAttention';
import { useComposeRequests } from './compose';
export type { RunnerConnection } from './RunnerContext';
import './style.css';
import './chat-header.css';
import { sessionStatus, statusLabel, accountLabel, awaitingFirstMessage } from './agent-status';
import { appendToDraft, composeRunMessage, useComposerOffers, useSharedRuns } from './command-runs';
import { SubscriptionControls } from './SubscriptionSwitch';
import { faultSentence, sessionLimit, subscriptionName } from './subscription-model';

const PERMISSION_CHOICES: [string, string][] = [['ask', 'Ask for approval'], ['read-only', 'Read only'], ['yolo', 'YOLO']];

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
};

/** One independent view of a Runner session. Unmounting disconnects readers,
 * never execution. Changing the connection resets the view and its readers. */
export function AgentWindow(props: AgentWindowProps) {
  // A detached chat is visually embedded but still owns its window's keyboard
  // dispatcher. Workspace-hosted panels use their Workspace's dispatcher.
  const keyboardHint = useKeyboardNavigation(props.viewState);
  return <RunnerProvider connection={props.connection}><AttentionScope root={props.viewState?.root}><ChatPanel {...props} keyboardHint={keyboardHint}/></AttentionScope></RunnerProvider>;
}

export function ChatPanel({ purpose = 'coding', assistantContext = '', agent, workingDirectory = '', emptyWorkspace = false, initialSessionId = '', collectionId = '', embedded = false, showCommands = true, allowStart = true, autoStart = false, onOpenChat, initialCommandId = '', initialCommandsOpen, mode = 'agent', viewState, onViewChange, onSessionChange, onOpenViewer, keyboardHint = null }: Omit<AgentWindowProps, 'connection'> & { keyboardHint?: KeyHint | null }) {
  const { api, info, connecting, error: connectionError, refresh, revision } = useRunner();
  const keymap=useKeymap(viewState);
  const composer=useRef<HTMLTextAreaElement>(null);
  const [snippetsOpen,setSnippetsOpen]=useState(false);
  useKeyboardAction('snippets.open',()=>{if(canCompose&&(document.activeElement===composer.current||document.querySelector('[data-agent-composer]')===composer.current))setSnippetsOpen(true);});
  // A ]] menu entry sends its snippet to the conversation being typed in, or
  // inserts it when there is already a draft (never overwriting one).
  useMenuSnippet(entry=>{
    if(!canCompose||!(document.activeElement===composer.current||document.querySelector('[data-agent-composer]')===composer.current))return;
    void api.listSnippets({}).then(result=>{
      const snippet=result.snippets.find(row=>row.key===entry.snippet);
      if(!snippet){setError(`Snippet "${entry.snippet}" no longer exists. Update the ]] menu in Settings → Keyboard.`);return;}
      saveSnippetUse(viewState,snippet.key);
      if(entry.mode==='send'&&!message.trim()&&!files.length&&!missingFiles.length&&!sending)void send(undefined,snippet.body);
      else{const next=message+(message&&!message.endsWith('\n')?'\n':'')+snippet.body;setMessage(next);persistDraft(next,files,missingFiles);requestAnimationFrame(()=>composer.current?.focus());}
    },error=>setError(String(error)));
  });
  useKeyboardAction('chat.send',()=>{const focused=document.activeElement as HTMLTextAreaElement;if(focused===composer.current&&canSend)focused.form?.requestSubmit();});
  const [remembered] = useState(() => {const choices=readLaunchChoices(viewState);return agent&&agent!==choices.provider ? {} : choices;});
  const {settings: runnerSettings, loading: settingsLoading} = useRunnerSettings();
  const [provider, setProvider] = useState<string>(agent || remembered.provider || 'claude');
  const [profile, setProfile] = useState(remembered.profile || '');
  // On by default: the Runner may continue on another signed-in subscription of this provider.
  const [rotate, setRotate] = useState(true);
  const assistant = purpose !== 'coding';
  const [cwd, setCwd] = useState(workingDirectory);
  const [model, setModel] = useState(remembered.model || '');
  const [gateway, setGateway] = useState(remembered.gateway || '');
  const [instructions, setInstructions] = useState('');
  const quickStarted = useRef(false);
  const [permission, setPermission] = useState('');
  const [workflow, setWorkflow] = useState('execute');
  const [sessionID, setSessionID] = useState(initialSessionId);
  const transcript = useTranscript(api, sessionID, !!info);
  const [session, setSession] = useState<Session | undefined>(transcript.reader.session);
  useMarkViewed(session, mode === 'agent');
  // The workspace, for its branch: the header leads with it until the conversation has a title.
  const workspaceId = session?.collectionId || collectionId;
  const [workspace, setWorkspace] = useState<Collection>();
  useEffect(() => {
    setWorkspace(undefined);
    if (!workspaceId || !info) return;
    const control = new AbortController();
    void api.getCollection({ collectionId: workspaceId }, { signal: control.signal }).then(result => { if (!control.signal.aborted) setWorkspace(result.collection); }, () => {});
    return () => control.abort();
  }, [api, workspaceId, !!info, revision]);
  const { recent: events, messages: conversation, status: stream } = transcript;
  const scroll=useChatScroll(transcript.reader,conversation,session?.pending.length);
  const {visibleMessages,followingLatest,jumpToLatest}=scroll;
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [missingFiles, setMissingFiles] = useState<FileReference[]>([]);
  const [commandsOpen, setCommandsOpen] = useState(initialCommandsOpen ?? !!initialCommandId);
  const [uncertainSend, setUncertainSend] = useState('');
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  const [command, setCommand] = useState(initialCommandId);
  const [shell, setShell] = useState('');
  const [error, setError] = useState('');
  // A failed refresh of the session is current state, not an event: the next
  // successful refresh clears it (a Runner restart must not leave a stale alarm).
  const [refreshError, setRefreshError] = useState('');
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [renaming,setRenaming]=useState(false),[conversationName,setConversationName]=useState(''),[savingName,setSavingName]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [switchingSubscription,setSwitchingSubscription]=useState(false);
  const fileLinks = useFileOpener(session?.collectionId, viewState);
  // Stable, so the memoized messages do not re-render when the opener does.
  const openFileRef = useRef(fileLinks.open); openFileRef.current = fileLinks.open;
  const openFile = useCallback((reference: FileLink, how: OpenModifiers) => void openFileRef.current(reference, how), []);
  const [resuming,setResuming]=useState(false);
  const [processesStopped,setProcessesStopped]=useState(false);
  const openingRef = useRef(false);
  const sendingRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sendAttempt = useRef<{ id: string; text: string; files: File[] } | null>(null);
  const canResumeOnSend = !!session?.closed && !session.resumeBlocked && !session.recoveryRequired && !!session.providerReference && !!session.capabilities?.resume;
  const canCompose = !!session && (!session.closed || canResumeOnSend);
  const canAttach = !!session?.capabilities?.files && !!info?.attachmentLimits && canCompose && !sending;
  // At a subscription limit a message waits and is sent once the conversation continues.
  const limited = !!sessionLimit(session);
  const canSend = canCompose && (!session?.fault || canResumeOnSend || limited) && !sending && missingFiles.length === 0 && (!!message.trim() || files.length > 0);
  const vimEditing = useVimPreferences(viewState).composer;
  const reservedKeys = useMemo(() => leaderKeys(keymap), [keymap]);
  const vim = useComposerVim({ textarea: composer, enabled: vimEditing, value: message, resetKey: sessionID, reserved: reservedKeys, onSend: () => { if (canSend) composer.current?.form?.requestSubmit(); } });

  useEffect(() => {
    try {
      const draft = readDraft(viewState, sessionID);
      setMessage(draft.text); setMissingFiles(draft.files); setFiles([]); setUncertainSend(draft.operationId); sendAttempt.current = null;
    } catch (e) { setError(`Could not restore this window's draft: ${String(e)}`); }
  }, [viewState, sessionID]);
  const persistDraft = (text: string, selected: File[], missing: FileReference[], operationId = '') => {
    try { writeDraft(viewState, sessionID, { text, files: [...selected.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })), ...missing], operationId }); }
    catch (e) { setError(`Could not save this window's draft: ${String(e)}`); }
  };
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
  useComposerOffers(canCompose && !sending && !assistant ? sessionID : '', text => addToDraft(text, 'Added the compact view of a terminal run. Review it, add what you want, and send.'));
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

  const profiles = info?.profiles.filter(p => p.provider === provider) || [];
  const selectedProfile = profiles.find(p => p.id === profile)?.id || profiles.find(p => p.managed)?.id || profiles[0]?.id || '';
  const connected = !!info;
  useEffect(() => {
    if (!sessionID || !info) return;
    const control = new AbortController(); setSession(transcript.reader.session); setCommands([]);
    let refreshing = false;
    const update = async () => {
      if (refreshing || control.signal.aborted) return;
      refreshing = true;
      try {
        const [state, output] = await Promise.all([api.getSession({ sessionId: sessionID }, { signal: control.signal }), showCommands ? api.listCommands({ sessionId: sessionID }, { signal: control.signal }) : Promise.resolve({ commands: [] })]);
        if (!control.signal.aborted) {
          if (state.session?.successorExecutionId && !sendingRef.current) {
            const next=await api.getSession({sessionId:state.session.successorExecutionId},{signal:control.signal});
            if(!control.signal.aborted&&next.session){continueConversation(api,sessionID,next.session);setSessionID(next.session.id);onSessionChange?.(next.session.id);}
          } else { transcript.reader.session=state.session; setSession(state.session); setCommands(output.commands); }
          setRefreshError('');
        }
      } catch (e) { if (!control.signal.aborted) setRefreshError(String(e)); }
      finally { refreshing = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, sessionID, connected, showCommands]);
  const open = async (event?: FormEvent) => {
    event?.preventDefault();
    if (openingRef.current || !selectedProfile || !allowStart) return;
    openingRef.current = true; setOpening(true); setError('');
    const signal = lifetime.current!.signal;
    try {
      const options = { model, permission, workflow, gatewayId: gateway, rotationProfileIds: [], noRotation: !rotate, instructions };
      const result = assistant ? await api.openAssistant({ profileId: selectedProfile, purpose, context: assistantContext, collectionId, options }, { signal }) : await api.openSession({ profileId: selectedProfile, cwd: collectionId || emptyWorkspace ? '' : cwd, collectionId, emptyWorkspace, options }, { signal });
      if (!result.session) throw new Error('Runner did not return a session');
      if (!signal.aborted) { try { writeLaunchChoices(viewState, {provider, profile:selectedProfile, model, gateway}); } catch { /* Session remains usable if local preferences cannot be saved. */ } setSessionID(result.session.id); setCommand(''); onSessionChange?.(result.session.id); }
    } catch (e) { if (!signal.aborted) setError(String(e)); }
    finally { if (!signal.aborted) { openingRef.current = false; setOpening(false); } }
  };
  useEffect(() => {
    if (!autoStart || quickStarted.current || sessionID || !info || settingsLoading || !selectedProfile || !allowStart) return;
    if (remembered.profile && !profiles.some(p => p.id === remembered.profile)) {
      quickStarted.current = true;setError('The last account is no longer available. Choose an account to start this session.');return;
    }
    let cancelled = false;
    queueMicrotask(() => {if(!cancelled&&!quickStarted.current){quickStarted.current = true;void open();}});
    return () => {cancelled=true;};
  }, [autoStart, sessionID, info, settingsLoading, selectedProfile, allowStart]);
  const send = async (event?: FormEvent, snippetText?:string) => {
    event?.preventDefault();
    const text=snippetText??message;
    if(sendingRef.current||!(snippetText?canCompose&&(!session?.fault||limited)&&!sending&&!message.trim()&&!files.length&&!missingFiles.length:canSend))return false;
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
        continueConversation(api,sessionID,resumed.session);
        destination = resumed.session.id;
        // A view may close while delivery is in flight. Retain the same draft
        // and operation identity under the successor before sending any bytes.
        writeDraft(viewState, destination, { text, files: files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })), operationId: attempt.id });
      }
      await api.apply({ sessionId: destination, operationId: attempt.id, operation: { case: 'message', value: { text, attachments } } }, { signal });
      savePrompt(viewState, text, session?.conversationId || sessionID); recall.current = null;
      if (!signal.aborted) { setMessage(''); setFiles([]); setUncertainSend(''); sendAttempt.current = null; persistDraft('', [], []); if (destination !== sessionID) { writeDraft(viewState, destination, { text: '', files: [], operationId: '' }); setSessionID(destination); onSessionChange?.(destination); refresh(); } }
      return !signal.aborted;
    } catch (e) { if (!signal.aborted) {setError(String(e));if(snippetText)setMessage(text);} return false; }
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
  const startCommand = async (event: FormEvent) => {
    event.preventDefault();
    if (!shell.trim()) return;
    try { const output = await api.startCommand({ sessionId: sessionID, title: shell.slice(0, 64), argv: ['/bin/sh', '-c', shell] }); setCommand(output.id); }
    catch (e) { setError(String(e)); }
  };
  const live=useLiveStatus(session,events);
  const disconnected=stream.startsWith('Disconnected')||stream==='Reconnecting';
  const activeProfile = info?.profiles.find(p => p.id === session?.profileId);
  const agentName = (activeProfile?.provider || provider) === 'claude' ? 'Claude' : 'Codex';
  const currentCommand = command || commands.at(-1)?.id;
  // ↑/↓ recall sent messages, like a shell: this conversation's first, then
  // every other's. Browsing starts in an empty box (or with the caret at its
  // very start); the draft it replaced comes back below the newest entry.
  const recall=useRef<{list:string[];index:number;draft:string}|null>(null);
  useEffect(()=>{recall.current=null;},[sessionID]);
  const conversationKey=session?.conversationId||sessionID;
  const recallKey=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return false;
    const native=event.nativeEvent,el=event.currentTarget;
    if(native.isComposing||event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||(vim.mode&&vim.mode!=='insert'))return false;
    const {selectionStart:start,selectionEnd:end,value}=el;
    let state=recall.current;
    if(event.key==='ArrowUp'){
      if(!state){
        if(value&&!(start===0&&end===0))return false;
        const list=recallOrder(readPromptHistory(viewState),conversationKey,conversation.filter(m=>m.type==='operation_accepted').map(m=>m.text));
        if(!list.length)return false;
        state={list,index:-1,draft:value};
      }else if(!caretOnFirstLine(value,start,end))return false;
      if(state.index+1>=state.list.length){event.preventDefault();return true;}
      state={...state,index:state.index+1};
    }else{
      if(!state||!caretOnLastLine(value,start,end))return false;
      state={...state,index:state.index-1};
    }
    event.preventDefault();
    const text=state.index<0?state.draft:state.list[state.index];
    recall.current=state.index<0?null:state;
    // The text and caret are placed now, not a frame later: a late placement
    // would move the caret, or collapse the selection, of whatever was typed
    // or selected in between. The render that follows finds the box current.
    el.value=text;el.setSelectionRange(text.length,text.length);el.scrollTop=el.scrollHeight;
    setMessage(text);setUncertainSend('');sendAttempt.current=null;persistDraft(text,files,missingFiles);
    return true;
  };
  const composerKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(recallKey(event))return;vim.textareaProps.onKeyDown?.(event);};
  useEffect(() => {
    if (!onViewChange) return;
    void (async () => { try { await onViewChange({ sessionId: sessionID, commandId: currentCommand || '', commandsOpen }); } catch (e) { setError(`Could not save this window: ${String(e)}`); } })();
  }, [onViewChange, sessionID, currentCommand, commandsOpen]);
  const newSession = () => {
    setSessionID(''); setSession(undefined); setCommands([]); setCommand(''); setMessage(''); setFiles([]); setMissingFiles([]); setUncertainSend(''); sendAttempt.current = null; setError(''); onSessionChange?.('');
  };
  // The title renames in place: Enter saves, Escape puts it back.
  // A title that is only the workspace folder's (generated) name is no title:
  // the header leads with the branch until the conversation gets a real one.
  const realTitle=conversationTitle(session);
  const firstPrompt=conversation.find(m=>m.type==='operation_accepted')?.text||'';
  const suggestedTitle=titleFromMessage(firstPrompt);
  const branch=branchSummary(workspace);
  const startRename=()=>{if(!session)return;setConversationName(realTitle||suggestedTitle);setRenaming(true);};
  const saveName=async(event:FormEvent)=>{
    event.preventDefault();const title=conversationName.trim();
    if(savingName||!title)return;
    if(title===session?.title){setRenaming(false);return;}
    setSavingName(true);
    try{const result=await api.renameConversation({sessionId:sessionID,title});setSession(result.session);setRenaming(false);refresh();}
    catch(error){setError(String(error));}finally{setSavingName(false);}
  };
  const titleView=renaming
    ? <form className="conversation-rename" onSubmit={saveName}><input autoFocus required maxLength={120} aria-label="Conversation name" value={conversationName} disabled={savingName} onFocus={event=>event.target.select()} onChange={event=>setConversationName(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&!savingName){event.preventDefault();event.stopPropagation();setRenaming(false);}}}/><button className="icon-button" aria-label="Save conversation name" title="Save (Enter)" disabled={savingName||!conversationName.trim()}><Icon name="check" size={14}/></button><button type="button" className="icon-button" aria-label="Cancel renaming" title="Cancel (Esc)" disabled={savingName} onClick={()=>setRenaming(false)}><Icon name="close" size={14}/></button></form>
    : <div className="conversation-title" data-untitled={realTitle ? undefined : true}>{realTitle
      ? <h2><button type="button" className="conversation-title-text" title="Rename conversation" disabled={!session} onClick={startRename}>{realTitle}</button></h2>
      : <h2 className="chat-branch-title">{branch ? <span className="chat-branch" title={branch.title}><Icon name="branch" size={13}/><span className="chat-branch-name">{branch.name}</span>{branch.detail && <small>{branch.detail}</small>}</span> : <span className="chat-untitled">New conversation</span>}</h2>}
      {realTitle
        ? <button type="button" className="icon-button conversation-rename-button" aria-label="Rename conversation" title="Rename" disabled={!session} onClick={startRename}><Icon name="pencil" size={13}/></button>
        : <button type="button" className="conversation-name-it" aria-label="Rename conversation" title={suggestedTitle ? `Name it “${suggestedTitle}”` : 'Give this conversation a name'} disabled={!session} onClick={startRename}><Icon name="pencil" size={12}/><span>Name it</span></button>}</div>;
  const modelLabel=sessionModelLabel(session,transcript.reportedModel);
  const accountName=sessionAccountLabel(session,activeProfile);
  const profileList=info?.profiles;
  const nameFor=useCallback((id:string)=>subscriptionName(profileList?.find(p=>p.id===id),id),[profileList]);
  const shownAccount=accountName==='Account not reported'||accountName==='Loading account…'?'':accountName;
  const statusView=<span className="chat-status" data-state={session?.closed?'saved':session?.status} data-tone={live.tone}><LiveIndicator tone={live.tone}/><span className="chat-status-text"><span role="status">{live.label}{session?.queued ? ` · ${session.queued} queued` : ''}</span>{live.text.length>live.label.length&&<span aria-hidden="true">{live.text.slice(live.label.length)}</span>}</span></span>;
  const sessionMenu=<ActionMenu className="session-menu" label="Session actions"><strong>Session</strong><small>{accountName}</small><small>Gateway: {session?.gatewayId || 'direct'}</small><small className="mono">{sessionID}</small><small>{stream}</small>{session && !session.closed && !['help','planning','summary'].includes(session.purpose) && <div className="session-permission" role="group" aria-label="Permissions"><strong>Permissions{session.permission ? '' : ' · CLI settings'}{session.capabilities?.livePermission ? '' : ' · restart needed'}</strong>{PERMISSION_CHOICES.map(([mode, label]) => <button key={mode} aria-pressed={session.permission === mode} disabled={(mode === 'yolo' && session.workflow === 'plan') || session.permission === mode} title={mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.capabilities?.livePermission ? undefined : 'This agent started before live permission changes: it restarts in this mode and the conversation continues'} onClick={() => session.capabilities?.livePermission ? void changePermission(mode) : setRestartTo(mode)}>{label}</button>)}</div>}{session && !session.closed && <button onClick={()=>setSwitchingSubscription(true)}>Switch subscription…</button>}{session?.closed ? allowStart ? <button onClick={newSession}>New session</button> : <span>Saved conversation</span> : <button disabled={!session} onClick={() => void close()}>End session</button>}<button className="danger" disabled={!session} onClick={()=>setDeleting(true)}>Delete conversation…</button></ActionMenu>;
  // A Runner restart while nothing was said yet is not news: an empty
  // conversation stays empty instead of showing "Runner restarted".
  const spoken=conversation.some(m=>m.type!=='reattached');
  // A conversation that opened and waits for its first message takes the keyboard once.
  const focusedFor=useRef('');
  const firstMessage=!!session&&awaitingFirstMessage(session)&&!spoken;
  useEffect(()=>{
    if(!firstMessage||!canCompose||focusedFor.current===sessionID)return;
    focusedFor.current=sessionID;
    const active=document.activeElement;
    if(!active||active===document.body||composer.current?.closest('main')?.contains(active))composer.current?.focus({preventScroll:true});
  },[firstMessage,canCompose,sessionID]);
  const resumeSession=async()=>{
    if(resuming)return;setResuming(true);setError('');
    try{const result=await api.resumeSession({sessionId:sessionID,processesStopped},{signal:lifetime.current!.signal});if(result.session){continueConversation(api,sessionID,result.session);setSessionID(result.session.id);setProcessesStopped(false);onSessionChange?.(result.session.id);refresh();}}
    catch(error){setError(String(error));}finally{setResuming(false);}
  };
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const dragOver = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canAttach ? 'copy' : 'none';
    setDragging(canAttach);
  };
  const dropFiles = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    // Suppress the webview's default navigation to the dropped file, including
    // when this conversation cannot accept an attachment.
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (!canAttach) { setError('This conversation cannot accept files right now.'); return; }
    if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
      setError('Attach files individually; folders are not supported.'); return;
    }
    selectFiles(event.dataTransfer.files);
  };
  if (mode === 'console') return <main className="agent-window console-window"><header className="topbar"><div><h1>Command console</h1><p>Independent view · execution stays on the Runner</p></div></header>{error && <div role="alert" className="error">{error}</div>}{currentCommand ? <Console api={api} command={currentCommand} viewState={viewState} onError={setError}/> : <div className="empty">No command is selected.</div>}</main>;
  return <main className={'agent-window' + (embedded ? ' embedded-chat' : '') + (dragging ? ' file-drag-active' : '')}
    onDragEnter={dragOver} onDragOver={dragOver} onDrop={dropFiles}
    onDragLeave={event => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false);
    }}>
    {!embedded&&<LeaderMenu hint={keyboardHint}/>}
    {snippetsOpen&&<SnippetPicker store={viewState} canSend={canCompose&&!sending&&!message.trim()&&!files.length&&!missingFiles.length} onClose={()=>{setSnippetsOpen(false);composer.current?.focus();}} onInsert={body=>{const node=composer.current,start=node?.selectionStart??message.length,end=node?.selectionEnd??message.length;const next=message.slice(0,start)+body+message.slice(end);setMessage(next);persistDraft(next,files,missingFiles);setUncertainSend('');sendAttempt.current=null;requestAnimationFrame(()=>{node?.focus();node?.setSelectionRange(start+body.length,start+body.length);});}} onSend={text=>send(undefined,text)}/>}
    {!embedded && <header className="topbar"><span className="brand" aria-hidden="true">l<span>↗</span></span><div><h1>lazybox <span>V2</span></h1><p>One window. Your agent.</p></div><span className="pill" role="status">{connecting ? 'Connecting to Runner' : !info ? 'Runner unavailable' : sessionID ? sessionStatus(session) : 'Runner connected'}</span></header>}
    {(error || connectionError || refreshError) && !(embedded && connectionError) && <div className="error" role="alert">{error || connectionError || refreshError}<button onClick={() => { setError(''); setRefreshError(''); }}>Dismiss</button></div>}
    {!info && !connecting && <div className="connection-retry"><button onClick={refresh}>Retry connection</button></div>}
    {!sessionID && !allowStart ? <div className="empty">Select an existing session to view its chat.</div> : !sessionID ? <section className="session-setup"><div className="eyebrow">New conversation</div><h2>{emptyWorkspace ? 'Empty workspace' : 'Choose your agent.'}</h2><p>{assistant ? `${purpose === 'help' ? 'Ask about Lazybox' : purpose === 'planning' ? 'Discuss a plan' : 'Summarize supplied evidence'}. This conversation runs on the Runner.` : emptyWorkspace ? 'Start a conversation with room to create files. No repository needed.' : 'Connect to your project and start working.'}</p>
      <form onSubmit={open} className="open-form"><div className="setup-row"><label>Agent<select value={provider} disabled={!info || opening} onChange={e => { setProvider(e.target.value); setProfile(''); setModel(''); setGateway(''); }}><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Account profile<select value={selectedProfile} disabled={!profiles.length || opening} onChange={e => setProfile(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.label || p.id}{p.availability && p.availability.state !== 'available' && p.availability.state !== 'unknown' ? ` · ${accountLabel(p.availability.state)}` : ''}</option>)}</select></label></div>
        {info && !profiles.length && <div className="error">No {agentName} profile is configured on this Runner.</div>}
        {assistant ? <p className="collection-context">Advice and proposals · no repository required</p> : emptyWorkspace ? <p className="collection-context">A private folder is created on the Runner. Your files remain after the session ends.</p> : collectionId ? <p className="collection-context">Uses the selected workspace and its repositories</p> : <label>Working directory<input required disabled={opening} placeholder="/absolute/path/to/project" value={cwd} onChange={e => setCwd(e.target.value)}/></label>}
        <label>Permissions<select disabled={opening || assistant} value={assistant ? 'read-only' : permission} onChange={e => setPermission(e.target.value)}><option value="">Runner default{runnerSettings?.permission ? ` · ${runnerSettings.permission === 'yolo' ? 'YOLO' : runnerSettings.permission}` : ' · current CLI settings'}</option><option value="inherit">Current CLI settings</option><option value="ask">Ask for approval</option><option value="read-only">Read only</option><option value="yolo" disabled={workflow === 'plan'}>YOLO · full access, no approval prompts</option></select></label>
        {(permission==='yolo'||(!permission&&runnerSettings?.permission==='yolo'))&&!assistant&&<small>Full tool access for this session. Existing conversations keep their original permissions.</small>}
        <details className="session-options"><summary>Model, gateway & context</summary><div className="options-grid"><label>Model<input disabled={opening} placeholder="Provider default" value={model} onChange={e => setModel(e.target.value)}/></label><label>Gateway<select disabled={opening} value={gateway} onChange={e => setGateway(e.target.value)}><option value="">Runner default</option><option value="direct">Direct</option>{info?.gateways.filter(g => g.provider === provider).map(g => <option key={g.id} value={g.id}>{g.id==='metered'?'Metered · track workspace cost':g.id}</option>)}</select></label>{!assistant && <label>Workflow<select disabled={opening} value={workflow} onChange={e => {setWorkflow(e.target.value);if(e.target.value==='plan'&&permission==='yolo')setPermission('read-only');}}><option value="execute">Execute</option><option value="plan">Plan</option></select></label>}</div><label>Additional session context<textarea rows={3} maxLength={32768} value={instructions} disabled={opening} onChange={e=>setInstructions(e.target.value)} placeholder="Instructions for this conversation"/></label><small>Shared Lazybox and provider context can be edited in Settings → Agents.</small></details>
        {(() => { const pool = profiles.filter(p => p.isolation === 'environment' && p.id !== selectedProfile && !runnerSettings?.rotationExcludedProfileIds.includes(p.id)); const current = profiles.find(p => p.id === selectedProfile); return pool.length > 0 && !assistant && <div className="rotation-choice"><label><input type="checkbox" checked={rotate} disabled={opening} onChange={e => setRotate(e.target.checked)}/>Switch subscriptions automatically</label><small>{rotate ? `When ${current?.label || 'this account'} hits a limit: ${pool.map(p => p.label || p.id).join(', ')}` : `Stays on ${current?.label || 'this account'}, even at a limit`}</small></div>; })()}
        <button className="primary" disabled={opening || !info || !selectedProfile}>{opening ? `Starting ${agentName}…` : `Start ${agentName} ↗`}</button>
      </form><small>Uses the selected Runner account. Closing this window leaves your agent running.</small>
    </section> : <section className="single-session">
      {embedded ? <header className="chat-heading">
        <span className={'agent-avatar ' + agentName.toLowerCase()} aria-hidden="true">{agentName === 'Claude' ? '✳︎' : '›'}</span>
        <div className="chat-heading-main">{titleView}<div className="chat-heading-meta">{realTitle && branch && <span className="chat-meta-branch" title={branch.title}><Icon name="branch" size={11}/>{branch.name}</span>}<span className="chat-agent">{agentName}</span>{modelLabel && <span className="chat-model" title={session?.model && !session.modelReported && !transcript.reportedModel ? 'Requested model; the provider has not confirmed it yet' : 'Model'}>{modelLabel}</span>}{shownAccount && <span className="chat-account" title="Account">{shownAccount}</span>}{statusView}</div></div>
        <div className="chat-heading-actions">{sessionID && <><TelemetryPanel executionId={sessionID} conversationId={session?.conversationId} compact/><ToolActivity events={transcript.activity} truncated={transcript.activityTruncated}/></>}{onOpenChat && <button className="icon-button" aria-label="Open chat window ↗" title="Open in a separate window" onClick={onOpenChat}><Icon name="external"/></button>}{sessionMenu}</div>
      </header> : <>{session && titleView}<div className="panel-title"><div><span className="eyebrow">Agent session</span><h2>{agentName}<span className="chat-model">{modelLabel}</span></h2></div>{session?.closed ? allowStart ? <button onClick={newSession}>New session</button> : <span>Saved conversation</span> : <button disabled={!session} onClick={() => void close()}>End session</button>}</div><div className="session-meta">{statusView}<span>{accountName}</span><span>Gateway: {session?.gatewayId || 'direct'}</span><span>{session?.queued || 0} queued</span><span className="mono">{sessionID.slice(0, 12)}</span></div>{sessionID && <div className="agent-inspection-bar"><TelemetryPanel executionId={sessionID} conversationId={session?.conversationId} compact/><ToolActivity events={transcript.activity} truncated={transcript.activityTruncated}/></div>}</>}
      {dragging && <div className="file-drop-hint" role="status">Drop files to attach</div>}
      {session?.closed&&<div className="resume-bar"><span>{'Saved conversation'}</span>{session.resumeBlocked?<p>{session.resumeBlocked}</p>:canResumeOnSend?<small>Send a message to continue with this conversation’s saved account and permissions.</small>:<>{session.recoveryRequired&&<label><input type="checkbox" checked={processesStopped} onChange={event=>setProcessesStopped(event.target.checked)}/>I have stopped or reconciled the previous agent and its commands.</label>}<button disabled={resuming||!session.providerReference||!session.capabilities?.resume||(session.recoveryRequired&&!processesStopped)} onClick={()=>void resumeSession()}>{resuming?'Resuming…':'Resume conversation'}</button></>}</div>}
      {deleting&&session&&<DeleteConversationDialog session={session} onClose={()=>setDeleting(false)} onDeleted={()=>{setDeleting(false);newSession();}}/>}
    {fileLinks.element}
    {session && session.agents.length > 1 && <details className="agent-activity"><summary>Agent activity ({session.agents.length - 1})</summary><ul>{session.agents.filter(a => a.id !== 'root').map(a => <li key={a.id} data-parent={a.parentId}><span>{a.name || 'Sub-agent'}</span><small>{statusLabel(a.status)}</small></li>)}</ul>{session.activityTruncated && <small>Additional activity was omitted.</small>}</details>}
      {transcript.error && <div className="transcript-notice error" role="alert"><span>Conversation could not be loaded. {transcript.error}</span><button onClick={transcript.retry}>Retry conversation</button></div>}
      <div className="messages-frame"><PromptNavigator messages={conversation} paneRef={scroll.paneRef} onReveal={scroll.revealMessage}/>
      <div className="messages" tabIndex={-1} ref={scroll.paneRef} onScroll={scroll.onScroll}><div className="messages-content" ref={scroll.contentRef}>
      {transcript.loading && !conversation.length && <ConversationLoading replay={transcript.replay}/>}
      {!transcript.loading && !transcript.error && !spoken && <div className="empty"><span>READY TO WORK</span><h2>What are we building?</h2><p>Send {agentName} a message to get started.</p></div>}<MessageList messages={spoken ? conversation : []} visible={visibleMessages} agentName={agentName} onOpenFile={session?.collectionId ? openFile : undefined} onShowEarlier={scroll.showEarlier} nameFor={nameFor}/>{session?.fault && !limited && <div className="error" role="alert">{faultSentence(session.fault)}</div>}{session?.pending.map(p => <RequestCard key={p.requestId} request={p} api={api} session={sessionID} onError={setError}/>)}{session && <SubscriptionControls session={session} profiles={profileList || []} viewState={viewState} dialogOpen={switchingSubscription} onCloseDialog={()=>setSwitchingSubscription(false)} onSession={next=>{transcript.reader.session=next;setSession(next);}} onError={setError}/>}</div></div>
      </div>
      {!followingLatest && conversation.length > 0 && <button className="jump-to-latest" onClick={jumpToLatest}>Jump to latest</button>}
      {!transcript.error && disconnected && <div className="live-activity" data-tone="busy" role="status"><LiveIndicator tone="busy"/>Connection interrupted · reconnecting…</div>}
      {!transcript.error && !disconnected && live.tone === 'busy' && session && !session.closed && <div className="live-activity" data-tone="busy" aria-hidden="true"><LiveIndicator tone="busy"/>{live.text}</div>}
      <form className="composer" onSubmit={send}>
        {files.length > 0 && <ul className="attached-files" aria-label="Attached files">{files.map((file, i) => <li key={i}><span>{file.name} <small>{Math.ceil(file.size / 1024)} KiB</small></span><button type="button" aria-label={`Remove ${file.name}`} disabled={sending} onClick={() => { const next = files.filter((_, index) => index !== i); setFiles(next); setUncertainSend(''); persistDraft(message, next, missingFiles); }}>×</button></li>)}</ul>}
        {missingFiles.length > 0 && <div className="restore-files"><p>Reattach or remove these files before sending:</p>{missingFiles.map((file, i) => <button key={i} type="button" onClick={() => { const next = missingFiles.filter((_, index) => index !== i); setMissingFiles(next); setUncertainSend(''); persistDraft(message, files, next); }}>Remove {file.name}</button>)}</div>}
        {uncertainSend && !sending && <small className="composer-hint">The previous send was not confirmed. Retrying the unchanged message checks the same operation.</small>}
        {handedOver && <p className="composer-handover" role="status">{handedOver}<button type="button" aria-label="Dismiss" onClick={() => setHandedOver('')}>×</button></p>}
        <textarea ref={composer} data-agent-composer aria-label="Message" placeholder={limited ? `Message ${agentName}… (sent when the conversation continues)` : `Message ${agentName}…`} value={message} onChange={e => { recall.current = null; setMessage(e.target.value); setUncertainSend(''); sendAttempt.current = null; persistDraft(e.target.value, files, missingFiles); }} disabled={!canCompose || sending}
          {...vim.textareaProps} onKeyDown={composerKeyDown}/>        {restartTo && <div className="restart-permission" role="alert"><span>Restart the agent in {PERMISSION_CHOICES.find(([mode]) => mode === restartTo)?.[1] || restartTo}? The conversation continues; this agent started before permissions could change live.</span><button className="primary" disabled={!!session?.busy} title={session?.busy ? 'Wait for the current turn to finish' : undefined} onClick={() => void restartWithPermission(restartTo)}>Restart</button><button onClick={() => setRestartTo('')}>Cancel</button></div>}
        <div className="row">{vim.mode && <span className="vim-mode-chip" data-mode={vim.mode} role="status" aria-label={`Vim ${vim.mode} mode`} title="Vim editing: Esc for normal mode, i to type, Enter in normal mode sends. Turn it off in Settings → Shortcuts.">{vim.status}</span>}{session?.instructionsPending && !session.closed && <span className="composer-chip" role="status" title="The shared Lazybox instructions changed since this conversation started. The update is sent with your next message.">Instructions updated</span>}<button type="button" className="icon-button" aria-label="Snippets" title={`Snippets · ${keymap['snippets.open']}`} disabled={!canCompose||sending} onClick={()=>setSnippetsOpen(true)}><Icon name="snippets"/></button><button type="button" className="attachment" aria-label={embedded ? 'Attach files' : undefined} disabled={!canAttach} onClick={() => fileInput.current?.click()}>{embedded ? <><Icon name="attach"/> Attach</> : '+ Attach files'}</button><input ref={fileInput} hidden aria-label="Attach files" type="file" multiple onChange={e => { selectFiles(e.target.files); e.target.value = ''; }}/><small className="composer-hint keyboard-hint">{vim.mode === 'insert' ? `${keymap['chat.send']} to send · Esc for normal mode` : vim.mode ? vim.hint : `${keymap['chat.send']} to send · Shift+Enter for a new line`}</small>{(!embedded || session?.busy) && <button type="button" onClick={() => void interrupt()} disabled={!session?.busy || session.closed}>Interrupt</button>}<button className="primary send-button" aria-label={sending ? 'Sending…' : session?.busy ? 'Queue follow-up' : 'Send message'} disabled={!canSend}>{embedded ? <Icon name="send" size={18}/> : sending ? 'Sending…' : session?.busy ? 'Queue follow-up' : 'Send message'}</button></div>
      </form>
      {showCommands && !assistant && <details className="session-commands" open={commandsOpen} onToggle={event => setCommandsOpen(event.currentTarget.open)}><summary>Commands & output {commands.length > 0 && `(${commands.length})`}</summary><form onSubmit={startCommand} className="command-form"><input aria-label="Shell command" value={shell} onChange={e => setShell(e.target.value)} disabled={!session || session.closed}/><button disabled={!session || session.closed}>Run</button></form><div className="command-tabs">{commands.map(c => <button key={c.id} className={currentCommand === c.id ? 'selected' : ''} onClick={() => setCommand(c.id)}>{c.done ? '◦' : '●'} {c.title.slice(0, 28)}</button>)}</div>{currentCommand && <><Console key={currentCommand} api={api} command={currentCommand} viewState={viewState} onError={setError} onSendToAgent={canCompose && !sending ? text => { addToDraft(text, 'Added the compact view of a terminal run. Review it, add what you want, and send.'); return ''; } : undefined} onOpenViewer={onOpenViewer ? async () => { try { await onOpenViewer(sessionID, currentCommand); } catch (e) { setError(String(e)); } } : undefined}/><button className="cancel" onClick={async () => { try { await api.cancelCommand({ commandId: currentCommand }); } catch (e) { setError(String(e)); } }}>Cancel owned command</button></>}</details>}
      {!embedded && <details className="event-detail"><summary>Operation receipts & events ({events.length})</summary><pre>{events.slice(-40).map(e => `${e.cursor} ${e.event?.type} ${e.event?.status || e.receipt?.delivery || ''} ${e.receipt?.providerId || e.event?.turnId || ''}`).join('\n')}</pre></details>}
    </section>}
  </main>;
}
