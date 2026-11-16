import { query, createSdkMcpServer, tool, type McpServerConfig, type Query, type SDKUserMessage, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { nativeOptions } from './options.js';
import { droppedOnInterrupt } from './interrupt.js';
import { readQuota } from './usage.js';
import { NativeStatus } from './status.js';
import { CommandCatalog } from './catalog.js';
import { contextSnapshot } from './context.js';
import { SettingsApprovals, settingsServer, settingsServerName, updateSettingsTool } from './settings.js';
import { alwaysChoices, covers, decide, offered, type Grant } from './permissions.js';
import { browserServer, browserServerName } from './browser.js';
import { generateTitle } from './title.js';

type Request = { id?: string; method?: string; params?: any; result?: any; error?: any };
let session: Query | undefined;
let reference = '';
let interrupted = false;
// Current Lazybox permission mode; 'yolo' approves tool requests here, which
// works even when the SDK refuses to switch a running session to bypass mode.
let permission = '';
let inputWake: (() => void) | undefined;
const messages: SDKUserMessage[] = [];
const requests = new Map<string, { resolve: (value: PermissionResult) => void; input: Record<string, unknown>; kind: string; name: string; choices: ReturnType<typeof alwaysChoices> }>();
// "Always allow" grants this worker enforces itself, for this conversation (see permissions.ts).
const grants: Grant[] = [];
const tools = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const settingsApprovals = new SettingsApprovals();
// The agent's own slash commands and models, said once per change.
const catalog = new CommandCatalog();
const sayCatalog = (value: ReturnType<CommandCatalog['fromChanged']>) => { if (value) event({ ...value, sessionId: reference }); };
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
const event = (value: unknown) => send({ method: 'event', params: value });
const reply = (id: string | undefined, result: unknown) => send({ id, result });

async function* input(): AsyncGenerator<SDKUserMessage> {
  while (true) {
    if (messages.length === 0) await new Promise<void>(resolve => { inputWake = resolve; });
    const next = messages.shift();
    if (next) yield next;
  }
}

/** Calls a Runner tool over the worker pipe. */
const callRunner = (name: string, args: unknown) => new Promise<string>((resolve, reject) => {
  const id = randomUUID(); tools.set(id, { resolve, reject }); send({ id, method: 'tool', params: { name, arguments: args } });
});

/** Runner tools by purpose: the help assistant gets only Lazybox's settings, other assistants nothing, coding agents managed commands and, when the Runner offers it, the agent browser. */
export function mcpServers(purpose: string, browser = false, call: typeof callRunner = callRunner): Record<string, McpServerConfig> {
  if (purpose === 'help') return { [settingsServerName]: settingsServer(call, settingsApprovals) };
  if (['planning', 'summary'].includes(purpose)) return {};
  const commandTool = tool('command', 'Start/read/wait/cancel runner-owned commands with shared console output. Start returns an id; reuse it for read/wait/cancel, never restart a command to read output. actions lists the workspace actions (dev servers and the like, with state and URL); start_action starts one by name (restart: true restarts it); read its output with its commandId.', {
    action: z.enum(['start', 'read', 'wait', 'cancel', 'actions', 'start_action']), argv: z.array(z.string()).optional(), id: z.string().optional(), offset: z.number().int().nonnegative().optional(),
    name: z.string().optional().describe('start_action: the action to start, as actions lists it; omit for the default action.'), restart: z.boolean().optional().describe('start_action: restart it if it is running.'),
  }, async args => ({ content: [{ type: 'text', text: await call('lazybox_command', args) }] }));
  return { lazybox: createSdkMcpServer({ name: 'lazybox', version: '0.1.0', tools: [commandTool] }), ...(browser ? { [browserServerName]: browserServer(call) } : {}) };
}

async function open(options: any) {
  permission = options.permission || '';
  session = query({ prompt: input(), options: {
    ...nativeOptions(options, process.env),
    mcpServers: mcpServers(options.purpose, options.browser === true),
    canUseTool: async (name, original, context): Promise<PermissionResult> => {
      const kind = name === 'AskUserQuestion' ? 'question' : 'approval';
      // YOLO never covers Lazybox settings changes: those always ask the user.
      const settingsTool = name.startsWith(`mcp__${settingsServerName}__`);
      if (kind === 'approval' && permission === 'yolo' && !settingsTool) return { behavior: 'allow', updatedInput: original };
      // The person said "always" for this earlier in the conversation.
      if (kind === 'approval' && !settingsTool && grants.some(grant => covers(grant, name, original))) return { behavior: 'allow', updatedInput: original, decisionClassification: 'user_permanent' };
      const choices = kind === 'approval' ? alwaysChoices(name, original, { suggestions: context.suggestions, suppressAlwaysAllowRule: context.suppressAlwaysAllowRule, settingsTool }) : [];
      const id = context.requestId;
      if (!id) throw new Error('SDK omitted the native permission request id');
      if (requests.size >= 64) throw new Error('Pending request limit exceeded');
      return new Promise<PermissionResult>(resolve => {
        const finish = (result: PermissionResult) => {
          context.signal.removeEventListener('abort', abort);
          requests.delete(id); event({type:'activity',status:result.behavior==='allow'?'tool':'working',name:result.behavior==='allow'?name:undefined,sessionId:reference,agentId:context.agentID?`claude-agent:${context.agentID}`:undefined}); event({ type: 'request_resolved', requestId: id, status: 'callback_resolved', sessionId: reference }); resolve(result);
        };
        const abort = () => finish({ behavior: 'deny', message: 'Request canceled by provider' });
        requests.set(id, { resolve: finish, input: original, kind, name, choices });
        // Claude's own words for the ask, when it gives them, and the "always" choices it supports.
        const words = { title: context.title, displayName: context.displayName, description: context.description, decisionReason: context.decisionReason, blockedPath: context.blockedPath, defaultToNo: context.defaultToNo || undefined };
        event({ type: kind, requestId: id, sessionId: reference, agentId: context.agentID ? `claude-agent:${context.agentID}` : undefined, parentAgentId: context.agentID ? 'root' : undefined, text: name, data: { tool: name, input: original, toolUseId: context.toolUseID, ...(kind === 'approval' ? words : {}), ...(choices.length ? { always: offered(choices) } : {}) } });
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) abort();
      });
    },
  } });
  void receive(session);
  // The commands and models are known before the first message is sent.
  void session.initializationResult().then(init => sayCatalog(catalog.fromInitialize(init))).catch(() => { /* Each turn's init message still names the commands. */ });
  // Operations added after the original protocol. A running worker outlives
  // Runner upgrades, so the Runner asks this worker rather than assuming.
  return { reference: options.resume || '', features: ['permission', 'context', 'stop_agent', 'model', 'title'] };
}

async function receive(q: Query) {
  try {
    const status = new NativeStatus();
    let readingContext=false;
    for await (const message of q) {
      for (const normalized of status.normalize(message)) {
        // A turn the person interrupted ends with Claude's "error during
        // execution" diagnostic ("[ede_diagnostic] … stop_reason=tool_use").
        // That is the interrupt, not a provider error: it must not fault the
        // conversation. Account limits still count.
        if (interrupted && droppedOnInterrupt(normalized)) continue;
        if (normalized.type === 'turn_ended') { if (interrupted) normalized.status = 'interrupted'; interrupted = false; }
        event(normalized);
      }
      reference = status.reference || reference;
      if (message.type === 'system' && !('parent_tool_use_id' in message && message.parent_tool_use_id)) {
        if (message.subtype === 'init') sayCatalog(catalog.fromInitMessage(message));
        else if (message.subtype === 'commands_changed') sayCatalog(catalog.fromChanged(message.commands));
      }
      if(message.type==='result'&&!readingContext&&typeof q.getContextUsage==='function'){
        readingContext=true;
        void q.getContextUsage({detail:'summary'}).then(report=>event({type:'context',agentId:'root',sessionId:reference,data:contextSnapshot(report)})).catch(()=>{/* Older CLIs retain their last observed totals. */}).finally(()=>{readingContext=false;});
      }
    }
    event({ type: 'failure', status: 'provider_process_exit', text: 'SDK stream ended' });
  } catch (error) {
    event({ type: 'failure', status: 'sdk_error', text: String(error) });
  }
}

async function handle(request: Request) {
  if (!request.method && request.id && tools.has(request.id)) {
    const pending = tools.get(request.id)!; tools.delete(request.id);
    if (request.error) pending.reject(new Error(JSON.stringify(request.error))); else pending.resolve(request.result);
    return;
  }
  try {
    const p = request.params;
    if (request.method === 'account_usage') { if (session) throw new Error('account query requires a dedicated worker'); reply(request.id, await readQuota(p)); return; }
    if (request.method === 'open') { if (session) throw new Error('already opened'); reply(request.id, await open(p)); return; }
    if (!session) throw new Error('session not opened');
    switch (request.method) {
      case 'message': {
        const content: any[] = [];
        // An instruction update from Lazybox goes ahead of the user's text, as its own block.
        if (p.context) content.push({ type: 'text', text: p.context });
        if (p.text) content.push({ type: 'text', text: p.text });
        for (const image of p.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
        messages.push({ type: 'user', uuid: randomUUID(), session_id: reference, message: { role: 'user', content }, parent_tool_use_id: null });
        inputWake?.(); inputWake = undefined;
        reply(request.id, { delivery: 'submitted' }); break;
      }
      case 'permission': {
        const mode = p.permission;
        if (!['ask', 'read-only', 'yolo'].includes(mode)) throw new Error('permission must be ask, read-only or yolo');
        const native = mode === 'read-only' ? 'plan' : mode === 'yolo' ? 'bypassPermissions' : 'default';
        // Bypass mode needs a flag set at launch; without it, 'default' plus the
        // approvals granted above gives the same result.
        try { await session.setPermissionMode(native); } catch (error) { if (mode !== 'yolo') throw error; await session.setPermissionMode('default'); }
        permission = mode;
        reply(request.id, { delivery: 'acknowledged' }); break;
      }
      case 'model': {
        // The model of the following turns; the provider resolves an alias.
        const model = p?.model;
        if (typeof model !== 'string' || !model || model.length > 256 || /\s/.test(model)) throw new Error('model must be one word: an alias or a model id');
        await session.setModel(model);
        reply(request.id, { delivery: 'acknowledged' }); break;
      }
      case 'stop_agent': {
        // Stops one sub-agent; the main agent's turn continues.
        if (typeof p?.nativeId !== 'string' || !p.nativeId) throw new Error('nativeId required');
        await session.stopTask(p.nativeId);
        reply(request.id, { delivery: 'acknowledged' }); break;
      }
      case 'title': {
        // Beside the conversation: names it, never touches its turn.
        reply(request.id, { title: await generateTitle(session, p?.description) }); break;
      }
      case 'interrupt': interrupted = true; await session.interrupt(); reply(request.id, { delivery: 'acknowledged' }); break;
      case 'answer': case 'approve': {
        const pending = requests.get(p.requestId);
        if (!pending || (request.method === 'answer') !== (pending.kind === 'question')) throw new Error('unknown, resolved or mismatched request');
        if (request.method === 'answer') {
          const answers = Object.fromEntries(Object.entries(p.answers || {}).map(([k, v]) => [k, (v as string[]).join(', ')]));
          pending.resolve({ behavior: 'allow', updatedInput: { ...pending.input, answers } });
        } else {
          // The user's approval of a settings update is what lets that exact update run.
          const { result, grant } = decide(pending.name, pending.input, pending.choices, p);
          if (p.decision === 'accept' && pending.name === updateSettingsTool) settingsApprovals.grant(pending.input);
          if (grant) grants.push(grant);
          pending.resolve(result);
        }
        reply(request.id, { delivery: 'submitted' }); break;
      }
      default: throw new Error('Unsupported worker operation');
    }
  } catch (error) { send({ id: request.id, error: { message: String(error) } }); }
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', line => {
  if (line.length > 16 << 20) { process.exitCode = 1; reader.close(); return; }
  try { void handle(JSON.parse(line)); } catch { process.exitCode = 1; reader.close(); }
});
reader.on('close', () => { session?.close(); process.exit(); });
