/**
 * Run what the agent wrote. A shell code block in an agent's message gets a
 * Run split button beside Copy:
 *
 * - **Run** asks the conversation's agent to run it ("Run this and tell me
 *   the result:" and the block): the agent runs it with `lazybox run`, sees a
 *   failure and reacts. Sent at once, or queued behind the turn in progress.
 *   The block then says how it went, from the agent's matching tool call.
 * - **Run myself…** opens a confirm card under the block (the script,
 *   editable; the folder; Run/Cancel), then runs it as a command of this
 *   conversation in the Command output console. The block shows the outcome,
 *   and a failure offers to hand the end of its output to the agent.
 *
 * Inline code that reads as a command offers the same two in its right-click
 * menu only. Nothing ever runs without a click or key, and Run myself always
 * confirms. `code-run.ts` holds the pure rules.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { Collection, CommandStatus, Session } from '@lazybox/protocol';
import { agentRun, fixRequestMessage, placeholdersIn, runArgv, runRequestMessage, runTitle, scriptOf, shellScript, isShellLanguage } from './code-run';
import { openContextMenu, showMenuNotice } from './ContextMenu';
import type { MenuItem } from './context-menu-model';
import { Icon } from './Icons';
import { shortPath } from './tool-lines';
import type { TranscriptMessage } from './transcript-model';
import './code-run.css';

export type RunActions = {
  /** Sends a message to the agent now (queued behind a turn in progress); `drafted` when it went to the message box instead. */
  send(text: string): Promise<'sent' | 'drafted'>;
  /** Adds text to the message box for the person to review and send. */
  draft(text: string, notice: string): void;
  /** Shows a command of this conversation in the Command output console. */
  openOutput?(commandId: string): void;
};
type AgentRecord = { messageId: string; script: string; inline: boolean; queued: boolean; sawQueue: boolean; at: number };
type SelfRecord = { messageId: string; script: string; inline: boolean; commandId: string; cwd: string };
type Memory = { agent: AgentRecord[]; self: SelfRecord[] };
/** What was run from each conversation, kept while the app runs so a remounted chat still shows it. */
const memory = new Map<string, Memory>();
const remembered = (sessionId: string) => { let entry = memory.get(sessionId); if (!entry) { entry = { agent: [], self: [] }; memory.set(sessionId, entry); } return entry; };

export type AgentRunView = { state: 'queued' | 'sent' | 'running' | 'ok' | 'failed'; exitCode?: number };
export type SelfRunView = { commandId: string; state: 'running' | 'ok' | 'failed' | 'stopped'; exitCode?: number; signal?: string; folder: string };
export type RunView = { agent?: AgentRunView; self?: SelfRunView; confirming: boolean };
export type Folder = { label: string; path: string };

/**
 * One conversation's runs. The chat that shows the conversation creates it and
 * keeps it current (`update`); code blocks subscribe to their own view.
 */
export class CodeRuns {
  readonly sessionId: string;
  agentName = 'Claude';
  private api: RunnerClient;
  private session?: Session;
  private workspace?: Collection;
  private messages: readonly TranscriptMessage[] = [];
  private actions?: RunActions;
  private commands = new Map<string, CommandStatus>();
  private confirm?: { messageId: string; script: string; inline: boolean; at: number };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private listing = false;
  private attached = false;
  private views = new Map<string, { revision: number; signature: string }>();
  private revision = 0;

  constructor(api: RunnerClient, sessionId: string) { this.api = api; this.sessionId = sessionId; }

  // ---- Inputs, from the chat ------------------------------------------------

  update({ session, workspace, messages, agentName, actions }: { session?: Session; workspace?: Collection; messages: readonly TranscriptMessage[]; agentName: string; actions: RunActions }) {
    this.actions = actions;
    let changed = false;
    if (messages !== this.messages) { this.messages = messages; changed = true; }
    if (workspace !== this.workspace) { this.workspace = workspace; changed = true; }
    if (agentName !== this.agentName) { this.agentName = agentName; changed = true; }
    if (session !== this.session) {
      this.session = session; changed = true;
      // A request sent during a turn waits in the Runner's queue: it runs once that queue empties, or the turn ends.
      for (const run of this.memory.agent) if (run.queued && session) {
        if (session.queued > 0) run.sawQueue = true;
        else if (run.sawQueue || !session.busy) run.queued = false;
      }
    }
    if (changed) this.emit();
  }
  /** Reads this conversation's earlier person runs once, and follows running ones. */
  attach() { this.attached = true; void this.refresh(); return () => { this.attached = false; clearInterval(this.timer); this.timer = undefined; }; }

  // ---- Subscription ---------------------------------------------------------

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.revision++; for (const listener of this.listeners) listener(); }
  private get memory() { return remembered(this.sessionId); }

  // ---- What a block shows -----------------------------------------------------

  /** A block's view as a string that changes only when what it shows does, for `useSyncExternalStore`. */
  signature(messageId: string, script: string): string {
    const key = messageId + '\0' + script, cached = this.views.get(key);
    if (cached?.revision === this.revision) return cached.signature;
    const signature = JSON.stringify(this.view(messageId, script));
    this.views.set(key, { revision: this.revision, signature });
    return signature;
  }
  view(messageId: string, script: string): RunView {
    const confirming = this.confirm?.messageId === messageId && this.confirm.script === script;
    const local = this.memory.agent.filter(run => run.messageId === messageId && run.script === script).at(-1);
    const derived = agentRun(this.messages, messageId, script);
    let agent: AgentRunView | undefined;
    if (local?.queued && !derived?.outcome) agent = { state: 'queued' };
    else if (derived?.outcome) agent = { state: derived.outcome.state, exitCode: derived.outcome.exitCode };
    else if (derived || local) agent = { state: 'sent' };
    return { agent, self: this.selfView(messageId, script), confirming };
  }
  private selfView(messageId: string, script: string): SelfRunView | undefined {
    const local = this.memory.self.filter(run => run.messageId === messageId && run.script === script).at(-1);
    let command = local && this.commands.get(local.commandId);
    if (!local) {
      // After a reload: the conversation's latest run of this script belongs to the latest message that has it.
      if (this.lastMessageWith(script) !== messageId) return undefined;
      command = [...this.commands.values()].filter(value => scriptOf(value.argv) === script).at(-1);
      if (!command) return undefined;
    }
    const folder = this.folderLabel(command?.cwd || local?.cwd || '');
    if (!command || !command.done) return { commandId: local?.commandId || command!.id, state: 'running', folder };
    const exitCode = command.exitCode;
    return { commandId: command.id, folder, state: command.signal ? 'stopped' : exitCode === 0 ? 'ok' : 'failed', exitCode, signal: command.signal || undefined };
  }
  private lastMessageWith(script: string): string {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].type === 'message_delta' && this.messages[i].text.includes(script)) return this.messages[i].id;
    return '';
  }
  /** The inline commands of a message someone ran, oldest first. */
  inlineScripts(messageId: string): string[] {
    const scripts = [...this.memory.agent, ...this.memory.self].filter(run => run.inline && run.messageId === messageId).map(run => run.script);
    if (this.confirm?.inline && this.confirm.messageId === messageId) scripts.push(this.confirm.script);
    return [...new Set(scripts)];
  }
  inlineSignature(messageId: string): string { return this.inlineScripts(messageId).join('\0'); }

  // ---- Conversation facts ---------------------------------------------------

  /** '' when this conversation may change things; else the mode that says it may not. */
  readOnlyMode(): '' | 'read-only' | 'plan' {
    return this.session?.permission === 'read-only' ? 'read-only' : this.session?.workflow === 'plan' ? 'plan' : '';
  }
  /** Why the person cannot run a command in this conversation now, or ''. */
  whyNotRunMyself(): string {
    const session = this.session;
    if (!session) return 'Still connecting to this conversation…';
    if (session.closed) return 'This conversation has ended: resume it to run commands in it.';
    if (session.fault) return 'This conversation stopped with an error: continue it to run commands in it.';
    return '';
  }
  /** Where a command can run: the workspace root and each of its repositories. */
  folders(): Folder[] {
    const root = this.workspace?.root || this.session?.workingDirectory || '';
    const out: Folder[] = root ? [{ label: this.workspace ? 'Workspace root' : 'Conversation folder', path: root }] : [];
    for (const member of this.workspace?.members || []) if (member.path && member.path !== root) out.push({ label: member.spec?.name || member.path.split('/').pop() || member.path, path: member.path });
    const own = this.session?.workingDirectory;
    if (own && !out.some(folder => folder.path === own)) out.push({ label: 'Conversation folder', path: own });
    return out;
  }
  defaultFolder(): string { return this.session?.workingDirectory || this.folders()[0]?.path || ''; }
  private folderLabel(path: string): string { return this.folders().find(folder => folder.path === path)?.label || (path ? shortPath(path, this.workspace?.root || '') : ''); }
  canOpenOutput() { return !!this.actions?.openOutput; }

  // ---- Doing ----------------------------------------------------------------

  /** Run: ask the agent. */
  async askAgent(messageId: string, script: string, language: string, inline = false) {
    if (!this.actions) return;
    const busy = !!this.session?.busy;
    try {
      const how = await this.actions.send(runRequestMessage(script, language));
      if (how === 'drafted') return;
      this.memory.agent.push({ messageId, script, inline, queued: busy, sawQueue: false, at: Date.now() });
      this.emit();
      showMenuNotice(busy ? 'Queued — runs after the current turn' : `Sent to ${this.agentName}`);
    } catch (error) { showMenuNotice(`Could not send: ${String(error instanceof Error ? error.message : error)}`); }
  }
  openConfirm(messageId: string, script: string, inline = false) { this.confirm = { messageId, script, inline, at: Date.now() }; this.emit(); }
  closeConfirm() { if (!this.confirm) return; this.confirm = undefined; this.emit(); }
  confirmOpenedAt(messageId: string, script: string) { return this.confirm?.messageId === messageId && this.confirm.script === script ? this.confirm.at : 0; }
  /** Run myself, once confirmed: a command of this conversation, shown in its console. Resolves to '' or why it did not start. */
  async runMyself(messageId: string, original: string, script: string, cwd: string): Promise<string> {
    const inline = !!this.confirm?.inline;
    try {
      const status = await this.api.startCommand({ sessionId: this.sessionId, title: runTitle(script), argv: runArgv(script), cwd });
      this.commands.set(status.id, status);
      // Edited before running: the block still owns the run.
      this.memory.self.push({ messageId, script: original, inline, commandId: status.id, cwd: status.cwd || cwd });
      this.confirm = undefined;
      this.emit();
      this.actions?.openOutput?.(status.id);
      this.follow();
      return '';
    } catch (error) { return String(error instanceof Error ? error.message : error).replace(/^\[\w+\]\s*/, ''); }
  }
  stop(commandId: string) {
    void this.api.cancelCommand({ commandId }).then(() => showMenuNotice('Stopping…'), error => showMenuNotice(`Could not stop: ${String(error)}`));
  }
  openOutput(commandId: string) { this.actions?.openOutput?.(commandId); }
  /** Ask the agent to fix a failed run: the script, where it ran, how it ended and the end of its output join the message box. */
  async askToFix(commandId: string, script: string) {
    const command = this.commands.get(commandId);
    if (!command || !this.actions) return;
    try {
      const limit = 16384, end = Number(command.offset), from = Math.max(0, end - limit);
      const read = await this.api.readCommand({ commandId, offset: BigInt(from), limit });
      const output = new TextDecoder().decode(read.data);
      // Where it ran, as the agent reads paths: a repository's name, nothing for the workspace root.
      const root = this.workspace?.root || this.session?.workingDirectory || '';
      const folder = command.cwd && command.cwd !== root ? shortPath(command.cwd, root) : '';
      this.actions.draft(fixRequestMessage({ script, folder, exitCode: command.exitCode, signal: command.signal || undefined, output, truncated: from > 0 }),
        `Added the failed run and the end of its output. Review it and send to ${this.agentName}.`);
    } catch (error) { showMenuNotice(`Could not read the output: ${String(error)}`); }
  }

  private follow() {
    if (this.timer || !this.attached) return;
    this.timer = setInterval(() => void this.refresh(), 1500);
  }
  private async refresh() {
    if (this.listing || !this.attached) return;
    this.listing = true;
    try {
      const { commands } = await this.api.listCommands({ sessionId: this.sessionId });
      let changed = false;
      for (const command of commands) {
        if (command.sessionId !== this.sessionId || !scriptOf(command.argv)) continue;
        const known = this.commands.get(command.id);
        if (!known || known.done !== command.done || known.exitCode !== command.exitCode || known.signal !== command.signal || known.offset !== command.offset) { this.commands.set(command.id, command); changed = true; }
      }
      if (changed) this.emit();
    } catch { /* The next poll retries; a block keeps its last state. */ }
    finally { this.listing = false; }
    const running = [...this.commands.values()].some(command => !command.done);
    if (running) this.follow();
    else if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
}

/** The conversation's runs, for code blocks under a chat. */
export const CodeRunContext = createContext<CodeRuns | null>(null);
/** The agent message a block belongs to; '' where code is not runnable (your own messages, previews). */
export const RunMessageContext = createContext('');
const noSubscribe = () => () => {};

/** The runs of the conversation and message this code is in, when it can run. */
export function useRunScope(): { host: CodeRuns; messageId: string } | undefined {
  const host = useContext(CodeRunContext), messageId = useContext(RunMessageContext);
  return host && messageId ? { host, messageId } : undefined;
}

/** Items to run an inline command: in its right-click menu. */
export function inlineRunItems(host: CodeRuns, messageId: string, command: string): MenuItem[] {
  const why = host.whyNotRunMyself();
  return [
    { label: `Run \`${clip(command)}\` (ask ${host.agentName})`, icon: 'play', run: () => host.askAgent(messageId, command, 'sh', true) },
    { label: 'Run myself…', icon: 'terminal', disabled: why || undefined, run: () => host.openConfirm(messageId, command, true) },
  ];
}
const clip = (text: string) => text.length > 48 ? text.slice(0, 47) + '…' : text;

/**
 * A code block's run controls. Undefined unless the block is a shell block
 * in an agent's message of a conversation that can run things.
 */
export function useRunnableBlock(text: string, language: string, runnable: boolean): undefined | {
  script: string;
  header: ReactNode;
  footer: ReactNode;
  /** Built when a menu opens, so it says what is true then. */
  menu(): MenuItem[];
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
} {
  const scope = useRunScope();
  const script = runnable && scope && isShellLanguage(language) ? shellScript(text, language) : '';
  const host = script ? scope!.host : undefined, messageId = scope?.messageId || '';
  const signature = useSyncExternalStore(host ? host.subscribe : noSubscribe, () => host ? host.signature(messageId, script) : '');
  if (!host || !script) return undefined;
  const view = JSON.parse(signature) as RunView;
  const ask = () => void host.askAgent(messageId, script, language);
  const myself = () => { const why = host.whyNotRunMyself(); if (why) showMenuNotice(why); else host.openConfirm(messageId, script); };
  const menu = (): MenuItem[] => [
    { label: `Ask ${host.agentName} to run it`, icon: 'send', shortcut: 'Enter', run: ask },
    { label: 'Run myself…', icon: 'terminal', shortcut: 'Alt+Enter', disabled: host.whyNotRunMyself() || undefined, run: myself },
  ];
  const header = <span className="code-run" role="group" aria-label="Run">
    <button type="button" className="code-run-main" title={`Ask ${host.agentName} to run this and report back`} aria-label={`Run: ask ${host.agentName} to run this`} onClick={ask}><Icon name="play" size={10}/>Run</button>
    <button type="button" className="code-run-more" title="More ways to run" aria-label="More ways to run" aria-haspopup="menu"
      onClick={event => { const box = event.currentTarget.getBoundingClientRect(); openContextMenu({ x: box.left, y: box.bottom + 4 }, menu(), { keyboard: event.detail === 0, target: event.currentTarget, label: 'Run' }); }}><Icon name="chevron" size={10}/></button>
  </span>;
  const footer = (view.agent || view.self || view.confirming) ? <div className="code-run-footer">
    {view.confirming && <RunConfirm host={host} messageId={messageId} script={script}/>}
    <RunStatus host={host} view={view} script={script}/>
  </div> : null;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    if (event.altKey) myself(); else ask();
  };
  return { script, header, footer, menu, onKeyDown };
}

/** Under an agent message: the inline commands someone ran from it, and the confirm card of one. */
export function InlineRuns({ messageId }: { messageId: string }) {
  const host = useContext(CodeRunContext);
  const signature = useSyncExternalStore(host ? host.subscribe : noSubscribe, () => host ? host.inlineSignature(messageId) : '');
  if (!host || !signature) return null;
  return <div className="inline-runs">{signature.split('\0').map(script => <InlineRun key={script} host={host} messageId={messageId} script={script}/>)}</div>;
}
function InlineRun({ host, messageId, script }: { host: CodeRuns; messageId: string; script: string }) {
  const signature = useSyncExternalStore(host.subscribe, () => host.signature(messageId, script));
  const view = JSON.parse(signature) as RunView;
  return <div className="inline-run">
    {view.confirming ? <RunConfirm host={host} messageId={messageId} script={script}/> : <code className="inline-run-command">{script}</code>}
    <RunStatus host={host} view={view} script={script}/>
  </div>;
}

function RunStatus({ host, view, script }: { host: CodeRuns; view: RunView; script: string }) {
  const { agent, self } = view;
  if (!agent && !self) return null;
  const name = host.agentName;
  const agentText = !agent ? '' : agent.state === 'queued' ? 'Queued — runs after the current turn'
    : agent.state === 'running' ? `Sent to ${name} · running…`
    : agent.state === 'ok' ? `Sent to ${name} · ran ✓`
    : agent.state === 'failed' ? `Sent to ${name} · failed ✗${agent.exitCode !== undefined ? ` exit ${agent.exitCode}` : ''}`
    : `Sent to ${name}`;
  const selfText = !self ? '' : self.state === 'running' ? 'Running' : self.state === 'ok' ? `✓ exit ${self.exitCode ?? 0}` : self.state === 'stopped' ? `■ Stopped${self.signal ? ` (${self.signal})` : ''}` : `✗ exit ${self.exitCode ?? '?'}`;
  return <div className="code-run-status">
    {agent && <span className={`code-run-chip tone-${agent.state}`} role="status" title={agent.state === 'queued' ? `${name} gets it when the turn in progress ends.` : `Asked ${name} to run this.`}>
      {agent.state === 'running' || agent.state === 'queued' ? <span className="code-run-dot" aria-hidden/> : <Icon name="send" size={10}/>}{agentText}</span>}
    {self && <span className="code-run-self">
      <span className={`code-run-chip tone-${self.state}`} role="status" title={self.folder ? `You ran this in ${self.folder}` : 'You ran this'}>
        {self.state === 'running' ? <span className="code-run-dot" aria-hidden/> : <Icon name="terminal" size={10}/>}{selfText}{self.folder && <small>in {self.folder}</small>}</span>
      {host.canOpenOutput() && <button type="button" className="code-run-link" onClick={() => host.openOutput(self.commandId)}>Show output</button>}
      {self.state === 'running' && <button type="button" className="code-run-link" onClick={() => host.stop(self.commandId)}><Icon name="stop" size={10}/>Stop</button>}
      {self.state === 'failed' && <button type="button" className="code-run-fix" onClick={() => void host.askToFix(self.commandId, script)}><Icon name="sparkle" size={10}/>Ask {name} to fix</button>}
    </span>}
  </div>;
}

/**
 * Run myself, before it runs: the exact script (editable, and to be edited
 * when it holds placeholders), the folder, Run and Cancel. Enter runs, Escape
 * cancels; Shift+Enter is a new line.
 */
function RunConfirm({ host, messageId, script }: { host: CodeRuns; messageId: string; script: string }) {
  const [draft, setDraft] = useState(script);
  const [folder, setFolder] = useState(() => host.defaultFolder());
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const form = useRef<HTMLFormElement>(null), area = useRef<HTMLTextAreaElement>(null), run = useRef<HTMLButtonElement>(null);
  // What the conversation allows can change while the card is open (it connects, it ends, its mode changes).
  useSyncExternalStore(host.subscribe, () => `${host.whyNotRunMyself()}|${host.readOnlyMode()}|${host.folders().length}`);
  const placeholders = placeholdersIn(script), left = placeholders.filter(value => draft.includes(value));
  const why = !draft.trim() ? 'There is nothing to run.' : left.length ? `Replace ${left.join(', ')} first.` : host.whyNotRunMyself();
  const mode = host.readOnlyMode();
  const folders = host.folders();
  const openedAt = host.confirmOpenedAt(messageId, script);
  useLayoutEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest' });
    if (placeholders.length && area.current) {
      // Select the first thing to fill in.
      const at = script.indexOf(placeholders[0]);
      area.current.focus({ preventScroll: true }); area.current.setSelectionRange(at, at + placeholders[0].length);
    } else run.current?.focus({ preventScroll: true });
  }, [openedAt]);
  useEffect(() => { if (area.current) { area.current.style.height = 'auto'; area.current.style.height = `${Math.min(area.current.scrollHeight + 2, 260)}px`; } }, [draft]);
  const cancel = () => { host.closeConfirm(); form.current?.closest<HTMLElement>('.code-block,.message')?.focus?.({ preventScroll: true }); };
  const submit = async () => {
    if (why || starting) { if (why) setError(why); return; }
    setStarting(true); setError('');
    const problem = await host.runMyself(messageId, script, draft.replace(/\s+$/, ''), folder);
    setStarting(false);
    if (problem) setError(`Could not start: ${problem}`);
  };
  return <form ref={form} className="code-run-confirm" aria-label="Run this yourself" onSubmit={event => { event.preventDefault(); void submit(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.target as HTMLElement).tagName !== 'BUTTON' && (event.target as HTMLElement).tagName !== 'SELECT') { event.preventDefault(); event.stopPropagation(); void submit(); }
    }}>
    <div className="code-run-confirm-head"><strong>Run myself</strong><small>Runs as you, in this conversation’s command output. {host.agentName} is not involved.</small></div>
    {mode && <p className="code-run-warning" role="note"><Icon name="alert" size={12}/>This conversation is {mode === 'plan' ? 'in Plan mode' : 'read-only'}: {host.agentName} may not change anything here, but this command runs as you and can.</p>}
    {placeholders.length > 0 && <p className={`code-run-warning${left.length ? '' : ' is-done'}`} role="note"><Icon name={left.length ? 'pencil' : 'check'} size={12}/>{left.length ? <>Fill in {left.map((value, i) => <code key={i}>{value}</code>)} before running.</> : 'Placeholders filled in.'}</p>}
    <label className="code-run-field"><span>Script</span>
      <textarea ref={area} value={draft} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={Math.min(10, draft.split('\n').length)} onChange={event => { setDraft(event.target.value); setError(''); }}/></label>
    {folders.length > 0 && <label className="code-run-field"><span>Folder</span>
      <select value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(entry => <option key={entry.path} value={entry.path}>{entry.label} — {shortPath(entry.path)}</option>)}</select></label>}
    {error && <p className="code-run-error" role="alert">{error}</p>}
    <div className="code-run-confirm-actions">
      <button type="button" onClick={cancel}>Cancel <kbd>Esc</kbd></button>
      <button ref={run} type="submit" className="primary" disabled={starting} aria-disabled={!!why} title={why || 'Run this script in the chosen folder'}>{starting ? 'Starting…' : <>Run <kbd>↵</kbd></>}</button>
    </div>
  </form>;
}
