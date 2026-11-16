import { reviewerFor } from './slash-commands';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { Artifact, Session, Snippet } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { runAction, useActions, type ActionId } from './actions';
import { openArtifact } from './artifact-events';
import { TrackArtifactDialog, UpdateArtifactDialog } from './ArtifactDialogs';
import { requestReviewTray } from './ChangesPanel';
import { useReviewLauncher } from './review-client';
import { useWorkspaceReview } from './useWorkspaceReview';
import { showMenuNotice } from './ContextMenu';
import type { VimMode } from './composer-vim';
import { conversationArtifacts, trackable } from './MessageArtifactActions';
import { saveSnippetUse } from './snippet-usage';
import { SlashMenu, SlashWarning, SLASH_MENU_ID, slashOptionId } from './SlashMenu';
import {
  decideSend, findCommand, lazyboxCommands, providerCommands, resolveModel, slashMenu, snippetCommands,
  type CommandCatalog, type SlashChoice, type SlashCommand, type SlashContext, type SlashMenuState,
} from './slash-commands';
import { openUsage } from './TelemetryPanel';
import { requestOrchestrate } from './OrchestratorBadge';
import type { TranscriptMessage } from './transcript-model';

/** What the chat lets its slash commands do; each is the same thing its menus and buttons do. */
export type SlashActions = {
  /** Send text as its own message (an agent's command), whatever the draft. True once accepted. */
  sendText(text: string): Promise<boolean>;
  interrupt(): void;
  /** Live where the agent can, else the restart prompt. */
  setPermission(mode: string): void;
  switchSubscription(): void;
  /** A conversation that continues in a new agent (a restart with another model). */
  adopt(next: Session): void;
  /** A new conversation in the same workspace; this one is kept. */
  clear(): Promise<void>;
  rename(title: string): Promise<void>;
};

type Options = {
  api: RunnerClient;
  viewState?: ViewStateStore;
  enabled: boolean;
  session?: Session;
  sessionID: string;
  agentName: string;
  /** "claude", "codex" or an ACP agent (providers.ts). */
  provider: string;
  catalog: CommandCatalog;
  /** The model the conversation runs on now, as best known. */
  model: string;
  conversation: readonly TranscriptMessage[];
  shellBlock: boolean;
  detail: string;
  subscriptions: number;
  canCompose: boolean;
  message: string;
  setText(text: string): void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  /** This is the chat in front: the palette's commands mean it. */
  front(): boolean;
  actions: SlashActions;
  onError(message: string): void;
};

/** The palette's names for Lazybox's commands (actions.ts). */
const ACTIONS: Partial<Record<string, ActionId>> = {
  model: 'chat.model', permissions: 'chat.permissions', subscription: 'chat.subscription', compact: 'chat.compact', clear: 'chat.clear',
  context: 'chat.usage', review: 'chat.review', artifact: 'chat.artifact', stop: 'chat.stop', rename: 'chat.rename', orchestrate: 'chat.orchestrate',
};
const PERMISSION_WORDS: Record<string, string> = { ask: 'ask', approve: 'ask', default: 'ask', 'read-only': 'read-only', readonly: 'read-only', 'read only': 'read-only', read: 'read-only', plan: 'read-only', yolo: 'yolo', bypass: 'yolo' };

type Tracking = { kind: 'track'; message: TranscriptMessage; existing: Artifact[] } | { kind: 'update'; message: TranscriptMessage; artifact: Artifact };

/**
 * The slash commands of one chat: the menu over its message box, what Enter
 * does with a `/command`, the commands themselves, and their palette entries.
 */
export function useSlashCommands(o: Options) {
  const latest = useRef(o); latest.current = o;
  const { api, session, sessionID, catalog, provider } = o;
  const workspaceId = session?.collectionId || '';

  // Snippets join the menu once a command is typed; the chain the last one offers comes first.
  const [snippets, setSnippets] = useState<{ rows: Snippet[]; next: string[] }>({ rows: [], next: [] });
  const typingCommand = o.message.startsWith('/');
  const loadedFor = useRef('');
  useEffect(() => {
    if (!typingCommand || !o.enabled || loadedFor.current === sessionID) return;
    loadedFor.current = sessionID;
    const controller = new AbortController();
    void Promise.all([
      api.listSnippets({}, { signal: controller.signal }).catch(() => ({ snippets: [] as Snippet[] })),
      session?.conversationId ? api.listPromptHistory({ conversationId: session.conversationId, limit: 1 }, { signal: controller.signal }).catch(() => undefined) : Promise.resolve(undefined),
    ]).then(([list, history]) => { if (!controller.signal.aborted) setSnippets({ rows: list.snippets, next: history?.nextSnippets || [] }); });
    return () => { controller.abort(); if (loadedFor.current === sessionID) loadedFor.current = ''; };
  }, [typingCommand, o.enabled, sessionID, api, session?.conversationId]);

  // `/review`: another agent reviews this conversation's work (or, from a
  // review conversation, the work it reviews: a review is never reviewed).
  const runs = useWorkspaceReview(workspaceId).review?.runs;
  const asReviewer = session && runs?.find(run => run.reviewerSessionId === session.id);
  const reviewLauncher = useReviewLauncher(workspaceId, asReviewer ? { id: asReviewer.sourceSessionId, profileId: '', provider: asReviewer.sourceProvider } : session);
  useEffect(() => { if (reviewLauncher.error) { latest.current.onError(`Could not start the review: ${reviewLauncher.error}`); reviewLauncher.setError(''); } }, [reviewLauncher.error]);
  const live = !!session && !session.closed;
  const lastAgentMessage = useMemo(() => [...o.conversation].reverse().find(trackable), [o.conversation]);
  const context: SlashContext = {
    provider, agentName: o.agentName, live, busy: !!session?.busy, coding: !!session && (!session.purpose || session.purpose === 'coding'), workspace: !!workspaceId,
    permission: session?.permission || '', planWorkflow: session?.workflow === 'plan', livePermission: !!session?.capabilities?.livePermission,
    model: o.model, liveModel: !!session?.capabilities?.liveModel, resumable: !!session?.capabilities?.resume, models: catalog.models,
    agentMessage: !!lastAgentMessage, shellBlock: o.shellBlock, compact: provider === 'claude', detail: o.detail, subscriptions: o.subscriptions,
    reviewers: workspaceId && !reviewLauncher.unavailable ? reviewLauncher.choices : [],
  };
  const lazybox = lazyboxCommands(context);
  const commands: SlashCommand[] = [...lazybox, ...providerCommands(catalog, lazybox, o.canCompose ? undefined : 'The conversation cannot take a message now'), ...snippetCommands(snippets.rows, snippets.next)];
  const byName = (name: string) => lazybox.find(command => command.name === name)!;

  // ---- The menu --------------------------------------------------------
  const [dismissed, setDismissed] = useState(false);
  const [vimMode, setVimMode] = useState<VimMode | undefined>();
  useEffect(() => { if (!o.message.startsWith('/')) setDismissed(false); }, [o.message]);
  const menu = o.enabled && (!vimMode || vimMode === 'insert') ? slashMenu(o.message, commands, dismissed) : null;
  const menuKey = menu ? `${menu.kind}:${menu.kind === 'hint' ? menu.command.key : menu.kind === 'choices' ? `${menu.command.key}:${menu.query}` : menu.query}:${menu.kind === 'hint' ? 0 : menu.items.length}` : '';
  const [picked, setPicked] = useState({ key: '', index: 0 });
  const selected = menu && menu.kind !== 'hint' ? (picked.key === menuKey ? Math.min(picked.index, menu.items.length - 1) : Math.max(0, menu.best)) : -1;
  const select = (index: number) => setPicked({ key: menuKey, index });

  // A draft set aside while a command from the palette or a menu borrows the box.
  const stash = useRef<string | null>(null);
  const setText = (text: string) => {
    latest.current.setText(text);
    // The caret goes to the end a frame later, once the box holds the text — unless
    // the person typed on meanwhile: what they typed keeps its caret.
    const box = latest.current.textarea.current;
    if (box && document.activeElement !== box) box.focus({ preventScroll: true });
    requestAnimationFrame(() => { const box = latest.current.textarea.current; if (box && box.value === text) box.setSelectionRange(text.length, text.length); });
  };
  const finish = () => { const back = stash.current ?? ''; stash.current = null; setText(back); };
  /** Put `/name ` in the box (its choices show), keeping any draft to come back after. */
  const borrow = (text: string) => {
    const current = latest.current.message;
    // What the person typed is theirs to keep (Esc leaves it); a box borrowed from the palette or a menu is given back as it was.
    if (stash.current === null && !current.startsWith('/')) stash.current = current;
    setDismissed(false); setText(text);
  };

  // ---- Unknown commands ------------------------------------------------
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => { if (warning !== null && warning !== o.message) setWarning(null); }, [o.message, warning]);

  // ---- Running ---------------------------------------------------------
  const [restartModel, setRestartModel] = useState('');
  const [tracking, setTracking] = useState<Tracking>();
  const notice = (text: string) => showMenuNotice(text);
  const switchModel = async (model: string) => {
    const { session: current, sessionID: id, onError } = latest.current;
    if (!model || !current) return;
    if (current.capabilities?.liveModel) {
      try { await api.apply({ sessionId: id, operationId: crypto.randomUUID(), operation: { case: 'model', value: { model } } }); }
      catch (e) { onError(String(e)); }
      return;
    }
    if (!current.capabilities?.resume) { onError(`This agent cannot change models during a conversation. Start a new conversation with ${model}.`); return; }
    setRestartModel(model);
  };
  const restartWithModel = async (model: string) => {
    setRestartModel('');
    try {
      const result = await api.restartWithModel({ sessionId: latest.current.sessionID, model });
      if (!result.session) throw new Error('Runner did not return the restarted conversation');
      latest.current.actions.adopt(result.session);
    } catch (e) { latest.current.onError(String(e)); }
  };
  const startTracking = async () => {
    const message = lastAgentMessage, current = latest.current.session;
    if (!message || !current?.collectionId) return;
    const scope = { collectionId: current.collectionId, sessionId: latest.current.sessionID, conversationId: current.conversationId };
    let existing: Artifact[] = [];
    try { existing = conversationArtifacts((await api.listArtifacts({ collectionId: current.collectionId }, { timeoutMs: 5000 })).artifacts, scope); } catch { /* offered without updates */ }
    setTracking({ kind: 'track', message, existing });
  };

  /** Lazybox's command, for real. Choosing one that takes an argument without one shows its choices. */
  const run = (command: SlashCommand, rawArgs: string) => {
    const args = rawArgs.trim();
    const { actions, onError } = latest.current;
    if (command.disabled) { notice(command.disabled); return; }
    // `/review` alone starts the default reviewer: one Enter, not a menu.
    if (!args && (command.choices?.length || command.needsArgument) && !(command.name === 'review' && reviewLauncher.choices.length)) { borrow(`/${command.name} `); return; }
    finish();
    switch (command.name) {
      case 'model': void switchModel(resolveModel(args, latest.current.catalog.models)); break;
      case 'permissions': {
        const mode = PERMISSION_WORDS[args.toLowerCase()];
        if (!mode) { onError(`“${args}” is not a permission mode: choose ask, read-only or yolo.`); break; }
        const choice = command.choices?.find(c => c.value === mode);
        if (choice?.disabled) { notice(choice.disabled); break; }
        if (choice?.current) { notice(`Already ${choice.label}`); break; }
        actions.setPermission(mode); break;
      }
      case 'subscription': actions.switchSubscription(); break;
      case 'compact': void actions.sendText(args ? `/compact ${args}` : '/compact'); break;
      case 'clear': void actions.clear().catch(e => onError(String(e))); break;
      case 'cost': case 'context':
        if (!openUsage(latest.current.sessionID, command.name)) notice('The usage of this conversation shows in its header');
        break;
      case 'review': {
        const reviewer = reviewerFor(reviewLauncher.choices, args);
        if (reviewer === 'tray' || (!reviewer && !args)) { requestReviewTray(workspaceId); if (!runAction('changes.show')) notice('Open the Changes panel to see the review tray'); break; }
        if (!reviewer) { onError(`“${args}” is not a reviewer: ${reviewLauncher.choices.filter(c => !c.profileId).map(c => c.label.toLowerCase()).join(', ') || 'no agent is signed in'}.`); break; }
        notice(`Starting ${reviewer.label}’s review…`);
        void reviewLauncher.start({ scope: 'changes' }, reviewer);
        break;
      }
      case 'artifact': void startTracking(); break;
      case 'mission': if (!runAction('missions.open')) notice('Missions open in the main window'); break;
      case 'orchestrate': requestOrchestrate(latest.current.sessionID); break;
      case 'run': if (!runAction('code.run-last')) notice('No command block to run yet'); break;
      case 'stop': actions.interrupt(); break;
      case 'detail': {
        const value = args.toLowerCase();
        if (!['quiet', 'smart', 'verbose'].includes(value)) { onError(`“${args}” is not a detail: choose quiet, smart or verbose.`); break; }
        if (!runAction(`activity.${value}`)) notice(`Already ${value[0].toUpperCase()}${value.slice(1)}`);
        break;
      }
      case 'rename': void actions.rename(args).catch(e => onError(String(e))); break;
      case 'help': runAction('shortcuts.open'); break;
    }
  };
  /** An entry of the menu, chosen with Enter (or a click). */
  const choose = (index: number, complete = false) => {
    if (!menu || menu.kind === 'hint') return;
    if (menu.kind === 'choices') {
      const choice: SlashChoice | undefined = menu.items[index];
      if (!choice) return;
      if (choice.disabled) { notice(choice.disabled); return; }
      if (complete) { setText(`/${menu.command.name} ${choice.value}`); return; }
      run(menu.command, choice.value); return;
    }
    const command = menu.items[index]?.command;
    if (!command) return;
    if (command.group === 'snippet') { saveSnippetUse(latest.current.viewState, command.name); stash.current = null; setText(command.body || ''); return; }
    if (command.disabled) { notice(command.disabled); return; }
    if (complete || command.argumentHint || command.choices?.length || command.needsArgument) { setText(`/${command.name} `); return; }
    if (command.group === 'provider') {
      const text = `/${command.name}`;
      finish();
      // A send that did not go gives the command back to the box.
      void latest.current.actions.sendText(text).then(sent => { if (!sent && !latest.current.message) latest.current.setText(text); });
      return;
    }
    run(command, '');
  };

  /** Keys in the message box while the menu shows. True when the menu took the key. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, mode?: VimMode) => {
    if (mode !== vimMode) setVimMode(mode);
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return false;
    if (warning !== null && event.key === 'Escape') { event.preventDefault(); setWarning(null); return true; }
    if (!menu || (mode && mode !== 'insert')) return false;
    const count = menu.kind === 'hint' ? 0 : menu.items.length;
    const move = (by: number) => { event.preventDefault(); if (count) select((selected + by + count) % count); return true; };
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) return move(1);
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) return move(-1);
    if (event.key === 'Escape') {
      event.preventDefault(); setDismissed(true);
      if (stash.current !== null) finish();
      return true;
    }
    if (menu.kind === 'hint') return false;
    if (event.key === 'Tab' && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.shiftKey) return move(-1);
      event.preventDefault(); choose(selected, true); return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault(); choose(selected); return true;
    }
    return false;
  };

  /**
   * Before a send: a Lazybox command runs instead, a snippet's name becomes
   * its body, an unknown `/word` asks first. True when the send is handled here.
   */
  const intercept = (text: string): boolean => {
    if (!latest.current.enabled) return false;
    const decision = decideSend(text, commands);
    switch (decision.kind) {
      case 'text': return false;
      case 'lazybox': run(decision.command, decision.args); return true;
      case 'provider': if (decision.command.disabled) { notice(decision.command.disabled); return true; } return false;
      case 'snippet': setText(decision.command.body || ''); return true;
      case 'unknown':
        if (warning === text) { setWarning(null); return false; }
        setWarning(text); return true;
    }
  };

  // ---- The palette -----------------------------------------------------
  const fromPalette = (name: string) => {
    const command = byName(name);
    if (command.disabled) { notice(command.disabled); return; }
    if (command.choices?.length || command.needsArgument) borrow(`/${name} `);
    else run(command, '');
  };
  const can = (name: string) => () => latest.current.enabled && latest.current.front() && !byNameLatest(name)?.disabled;
  const byNameLatest = (name: string) => lazyboxCommands(contextRef.current).find(command => command.name === name);
  const contextRef = useRef(context); contextRef.current = context;
  const handlers: Partial<Record<ActionId, { run(): void; enabled(): boolean } | false>> = {
    'chat.commands': o.enabled && { run: () => borrow('/'), enabled: () => latest.current.enabled && latest.current.front() && latest.current.canCompose },
  };
  for (const [name, id] of Object.entries(ACTIONS)) handlers[id!] = o.enabled && { run: () => fromPalette(name), enabled: can(name) };
  useActions(handlers);

  // ---- What the composer shows ------------------------------------------
  const menuElement = menu && <SlashMenu menu={menu} selected={selected} sessionId={sessionID} agentName={o.agentName}
    onSelect={select} onChoose={index => choose(index)} onClose={() => { setDismissed(true); if (stash.current !== null) finish(); latest.current.textarea.current?.focus(); }}/>;
  const unknown = warning !== null ? decideSend(warning, commands) : undefined;
  const above: ReactNode = <>
    {menuElement}
    {unknown?.kind === 'unknown' && <SlashWarning name={unknown.name} onSend={() => { latest.current.textarea.current?.form?.requestSubmit(); }} onCancel={() => { setWarning(null); latest.current.textarea.current?.focus(); }}/>}
  </>;
  const prompt: ReactNode = restartModel ? <div className="restart-permission restart-model" role="alert">
    <span>Switch to {restartModel}? {o.agentName} restarts between turns and the conversation continues; this agent started before models could change live.</span>
    <button className="primary" disabled={!!session?.busy} title={session?.busy ? 'Wait for the current turn to finish' : undefined} onClick={() => void restartWithModel(restartModel)}>Restart now</button>
    <button onClick={() => setRestartModel('')}>Cancel</button>
  </div> : null;
  const dialogs: ReactNode = tracking && workspaceId && <>
    {tracking.kind === 'track' && <TrackArtifactDialog collectionId={workspaceId} content={tracking.message.text}
      source={{ kind: 'message', sessionId: sessionID, conversationId: session?.conversationId, messageId: tracking.message.id, turnId: tracking.message.turnId }} existing={tracking.existing}
      onClose={() => setTracking(undefined)} onTracked={artifact => { setTracking(undefined); if (!openArtifact({ collectionId: artifact.collectionId, artifactId: artifact.id })) notice(`Tracked “${artifact.title}”`); }}
      onUpdateInstead={artifact => setTracking({ kind: 'update', message: tracking.message, artifact })}/>}
    {tracking.kind === 'update' && <UpdateArtifactDialog collectionId={workspaceId} artifactId={tracking.artifact.id} content={tracking.message.text}
      source={{ kind: 'message', sessionId: sessionID, conversationId: session?.conversationId, messageId: tracking.message.id, turnId: tracking.message.turnId }}
      onClose={() => setTracking(undefined)} onSaved={artifact => { setTracking(undefined); if (!openArtifact({ collectionId: artifact.collectionId, artifactId: artifact.id })) notice(`Updated “${artifact.title}”`); }}/>}
  </>;
  const textareaProps = {
    // Still the "Message" textbox (not a combobox): the menu is announced through these.
    'aria-autocomplete': 'list' as const,
    'aria-controls': menu ? SLASH_MENU_ID(sessionID) : undefined,
    'aria-activedescendant': menu && menu.kind !== 'hint' && selected >= 0 ? slashOptionId(sessionID, selected) : undefined,
  };
  const modelCommand = byName('model');
  return {
    menu: menu as SlashMenuState | null, onKeyDown, intercept, above, prompt, dialogs, textareaProps,
    /** The model picker of the ⋯ menu and the header: the same choices and switch as `/model`. */
    models: { choices: modelCommand.choices || [], live: context.liveModel, disabled: modelCommand.disabled, choose: (value: string) => { const choice = modelCommand.choices?.find(c => c.value === value); if (choice?.current) return; void switchModel(value); }, pick: () => fromPalette('model') },
    find: (name: string) => findCommand(commands, name),
  };
}
