import { fuzzyMatch } from './fuzzy';

/**
 * Slash commands in the message box: `/` at the very start of the box opens a
 * menu of what can be run — Lazybox's own commands (they do the real thing,
 * never send text), the agent's own slash commands (sent as the prompt, the
 * provider executes them) and the snippets (inserted). This module is the pure
 * part: parsing what is typed, filtering and ranking, argument choices and the
 * rule for what Enter does. SlashMenu.tsx draws it; useSlashCommands.tsx runs it.
 */
export type SlashGroup = 'lazybox' | 'provider' | 'snippet';
export const SLASH_GROUPS: readonly SlashGroup[] = ['lazybox', 'provider', 'snippet'];

/** One value an argument can take (a model, a permission mode), as it is listed. */
export type SlashChoice = { value: string; label: string; detail?: string; current?: boolean; disabled?: string; keywords?: string };
export type SlashCommand = {
  /** Unique across groups: `lazybox:model`, `provider:review-pr`, `snippet:review`. */
  key: string;
  /** Without the slash. */
  name: string;
  group: SlashGroup;
  description: string;
  /** What follows the name, as the provider or Lazybox writes it: `<name>`, `quiet|smart|verbose`. */
  argumentHint?: string;
  icon: string;
  aliases?: string[];
  /** Why it cannot run now. It is still listed, so the person learns it exists. */
  disabled?: string;
  /** The argument is picked from these as it is typed. */
  choices?: SlashChoice[];
  /** A free argument is required (`/rename <title>`): choosing it completes `/name ` first. */
  needsArgument?: boolean;
  /** A free argument is accepted besides the choices (a model id not in the list). */
  freeArgument?: boolean;
  /** A snippet's body, inserted when chosen. */
  body?: string;
  /** A short tag after the name: "Next" for a snippet the last one chains to. */
  badge?: string;
  /** Extra words the filter matches (the action registry's keywords). */
  keywords?: string;
};

// ---- What is typed ------------------------------------------------------

export type SlashInput = { name: string; args: string; /** Something (a space) follows the name. */ completed: boolean };
/**
 * The command at the start of the message box: `/name` and what follows it.
 * Null when the box does not start with one — including a path such as
 * `/usr/local/bin`, whose first word holds another slash.
 */
export function parseSlash(text: string): SlashInput | null {
  const match = /^\/([^\s/]*)(?:(\s)([\s\S]*))?$/.exec(text);
  if (!match) return null;
  return { name: match[1], args: match[3] ?? '', completed: match[2] !== undefined };
}
/** A first word that reads as a command, not a path or a stray slash: `/compact`, `/review-pr`, `/plugin:tool`. */
export const COMMAND_NAME = /^[A-Za-z][\w:.-]*$/;

/** Every name a command answers to, lowercased. */
const names = (command: SlashCommand) => [command.name, ...(command.aliases || [])].map(name => name.toLowerCase());
/** The command a name means: Lazybox's own first, then the agent's, then a snippet. */
export function findCommand(commands: readonly SlashCommand[], name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  for (const group of SLASH_GROUPS) {
    const found = commands.find(command => command.group === group && names(command).includes(lower));
    if (found) return found;
  }
  return undefined;
}

// ---- Filtering and ranking ----------------------------------------------

export type RankedCommand = { command: SlashCommand; score: number; positions: number[] };
/**
 * The commands a typed name matches, grouped (Lazybox · the agent · snippets)
 * and best first within each group. An exact name always wins, then a
 * prefix, then letters in order; aliases count almost as much as the name,
 * and the description or keywords much less (`/tokens` finds `/cost`).
 * `best` is the index of the strongest match overall: the one Enter takes.
 */
export function rankCommands(query: string, commands: readonly SlashCommand[]): { items: RankedCommand[]; best: number } {
  const q = query.toLowerCase();
  const scored: RankedCommand[] = [];
  commands.forEach((command, order) => {
    if (!q) { scored.push({ command, score: -order, positions: [] }); return; }
    const main = fuzzyMatch(q, command.name);
    let score = main ? main.score + (command.name.toLowerCase() === q ? 5000 : command.name.toLowerCase().startsWith(q) ? 1000 : 0) : -Infinity;
    for (const alias of command.aliases || []) {
      const match = fuzzyMatch(q, alias);
      if (match) score = Math.max(score, match.score * 0.9 + (alias.toLowerCase() === q ? 4500 : 0));
    }
    // Words of the description or keywords: only a whole word start, so a stray letter run does not match.
    if (score === -Infinity && q.length >= 3) {
      const words = `${command.description} ${command.keywords || ''}`.toLowerCase().split(/[^a-z0-9]+/);
      if (words.some(word => word.startsWith(q))) score = 100 - command.name.length;
    }
    if (score > -Infinity) scored.push({ command, score, positions: main && score >= main.score ? main.positions : [] });
  });
  const groupIndex = (command: SlashCommand) => SLASH_GROUPS.indexOf(command.group);
  const items = scored.sort((a, b) => groupIndex(a.command) - groupIndex(b.command) || b.score - a.score);
  let best = items.length ? 0 : -1;
  if (q) items.forEach((item, i) => { if (!item.command.disabled && (best < 0 || items[best].command.disabled || item.score > items[best].score)) best = i; });
  else best = items.findIndex(item => !item.command.disabled);
  return { items, best };
}

/** The choices an argument matches, the current one first when nothing is typed. */
export function rankChoices(query: string, choices: readonly SlashChoice[]): { items: SlashChoice[]; best: number } {
  const q = query.trim().toLowerCase();
  if (!q) {
    const best = choices.findIndex(choice => !choice.disabled && !choice.current);
    return { items: [...choices], best: best >= 0 ? best : choices.findIndex(choice => !choice.disabled) };
  }
  const scored = choices.flatMap(choice => {
    const exact = choice.value.toLowerCase() === q || choice.label.toLowerCase() === q;
    const match = fuzzyMatch(q, choice.label) || fuzzyMatch(q, choice.value);
    const extra = !match && choice.keywords && choice.keywords.toLowerCase().split(/\s+/).some(word => word.startsWith(q));
    return match || extra ? [{ choice, score: (match?.score ?? 50) + (exact ? 5000 : 0) }] : [];
  }).sort((a, b) => b.score - a.score);
  const items = scored.map(item => item.choice);
  return { items, best: items.findIndex(choice => !choice.disabled) };
}

// ---- The menu -----------------------------------------------------------

export type SlashMenuState =
  /** Typing a name: the commands it matches. */
  | { kind: 'commands'; query: string; items: RankedCommand[]; best: number }
  /** After a command with choices: the choices the argument matches. */
  | { kind: 'choices'; command: SlashCommand; query: string; items: SlashChoice[]; best: number }
  /** After any other command: what it takes. */
  | { kind: 'hint'; command: SlashCommand; args: string };

/**
 * What the menu shows for the message box's text, or null for no menu: the
 * box does not start with a command, holds more than one line, the person
 * closed the menu (Esc), or nothing matches — a message that merely starts
 * with a slash is never held up by an empty menu.
 */
export function slashMenu(text: string, commands: readonly SlashCommand[], dismissed = false): SlashMenuState | null {
  if (dismissed || text.includes('\n')) return null;
  const input = parseSlash(text);
  if (!input) return null;
  if (!input.completed) {
    if (input.name && !/^[\w:.-]+$/.test(input.name)) return null;
    const { items, best } = rankCommands(input.name, commands);
    return items.length ? { kind: 'commands', query: input.name, items, best } : null;
  }
  const command = findCommand(commands, input.name);
  if (!command || command.group === 'snippet') return null;
  if (command.choices?.length) {
    const { items, best } = rankChoices(input.args, command.choices);
    if (items.length) return { kind: 'choices', command, query: input.args, items, best };
  }
  return command.argumentHint ? { kind: 'hint', command, args: input.args } : null;
}

// ---- What Enter does ----------------------------------------------------

export type SlashDecision =
  /** An ordinary message: send it. */
  | { kind: 'text' }
  /** Lazybox's own command: run it, send nothing. */
  | { kind: 'lazybox'; command: SlashCommand; args: string }
  /** The agent's own command: send the text as the prompt, the provider runs it. */
  | { kind: 'provider'; command: SlashCommand; args: string }
  /** A snippet's name: put its body in the box. */
  | { kind: 'snippet'; command: SlashCommand }
  /** Reads as a command but is none: ask before sending it as text. */
  | { kind: 'unknown'; name: string };
/**
 * The send rule, when no menu entry is chosen: Lazybox's command runs, the
 * agent's goes through as the prompt, and `/something` that is neither is
 * not sent without a second Enter ("Not a command — send as text?"). Text
 * that does not read as a command (`/usr/local/bin is missing`, `/ 2`) is a
 * message like any other.
 */
export function decideSend(text: string, commands: readonly SlashCommand[]): SlashDecision {
  const input = parseSlash(text.trimEnd());
  if (!input || !COMMAND_NAME.test(input.name)) return { kind: 'text' };
  const command = findCommand(commands, input.name);
  if (!command) return { kind: 'unknown', name: input.name };
  if (command.group === 'snippet') return { kind: 'snippet', command };
  return { kind: command.group, command, args: input.args.trim() };
}

// ---- The commands -------------------------------------------------------

/** The agent's catalog, as the worker reports it (`command_catalog`). */
export type ProviderCommand = { name: string; description: string; argumentHint: string; aliases?: string[]; builtin?: boolean };
export type ProviderModel = { value: string; displayName: string; description: string };
export type CommandCatalog = { commands: ProviderCommand[]; models: ProviderModel[]; terminal: string[] };
export const emptyCatalog = (): CommandCatalog => ({ commands: [], models: [], terminal: [] });
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
/** A `command_catalog` payload folded into what was known: a part it lacks (models, say) is kept. */
export function mergeCatalog(previous: CommandCatalog, payload: Record<string, unknown>): CommandCatalog {
  const next = { ...previous };
  if (Array.isArray(payload.commands)) next.commands = payload.commands.flatMap((raw): ProviderCommand[] => {
    const c = raw as Record<string, unknown>;
    const name = text(c?.name, 80).replace(/^\//, '');
    if (!COMMAND_NAME.test(name)) return [];
    const aliases = Array.isArray(c.aliases) ? c.aliases.map(alias => text(alias, 80).replace(/^\//, '')).filter(alias => COMMAND_NAME.test(alias)) : undefined;
    return [{ name, description: text(c.description, 300), argumentHint: text(c.argumentHint, 120), ...(aliases?.length ? { aliases } : {}), ...(c.builtin ? { builtin: true } : {}) }];
  }).slice(0, 400);
  if (Array.isArray(payload.models)) next.models = payload.models.flatMap((raw): ProviderModel[] => {
    const m = raw as Record<string, unknown>;
    const value = text(m?.value, 200);
    return value ? [{ value, displayName: text(m.displayName, 120) || value, description: text(m.description, 300) }] : [];
  }).slice(0, 100);
  if (Array.isArray(payload.terminal)) next.terminal = payload.terminal.map(name => text(name, 80).replace(/^\//, '')).filter(Boolean);
  return next;
}

export type PermissionMode = 'ask' | 'read-only' | 'yolo';
export const PERMISSION_LABELS: Record<PermissionMode, string> = { ask: 'Ask for approval', 'read-only': 'Read only', yolo: 'YOLO' };
const PERMISSION_DETAILS: Record<PermissionMode, string> = { ask: 'Asks before commands and edits', 'read-only': 'Reads and plans, changes nothing', yolo: 'Runs everything without asking' };
export const DETAIL_CHOICES: SlashChoice[] = [
  { value: 'quiet', label: 'Quiet', detail: 'Only what the agent says, its decisions and edits' },
  { value: 'smart', label: 'Smart', detail: 'Runs of tool calls fold into one line' },
  { value: 'verbose', label: 'Verbose', detail: 'Every tool call on its own line' },
];

/** What Lazybox's commands need to know about the conversation in front. */
export type SlashContext = {
  provider: 'claude' | 'codex';
  /** There is a live conversation (not saved, not still connecting). */
  live: boolean;
  busy: boolean;
  /** A coding conversation (assistants take no permissions or Run). */
  coding: boolean;
  /** In a workspace: review, artifacts and missions belong to one. */
  workspace: boolean;
  permission: string;
  planWorkflow: boolean;
  livePermission: boolean;
  model: string;
  liveModel: boolean;
  /** The provider can resume: a restart (model, permissions) keeps the conversation. */
  resumable: boolean;
  models: ProviderModel[];
  /** The agent has said something that can be tracked. */
  agentMessage: boolean;
  /** The agent's latest shell block, to run. */
  shellBlock: boolean;
  /** The agent's catalog has /compact. */
  compact: boolean;
  detail: string;
  /** More than one subscription of this provider: switching means something. */
  subscriptions: number;
  /** Who can review this conversation's work, the default first (review-model.ts reviewerChoices). */
  reviewers?: readonly { key: string; label: string }[];
};

const unless = (...reasons: (string | false | undefined)[]) => reasons.find(Boolean) || undefined;
/** Lazybox's own commands, each with why it cannot run now (when it cannot). */
export function lazyboxCommands(ctx: SlashContext): SlashCommand[] {
  const notLive = !ctx.live && 'The conversation is not running';
  const agentName = ctx.provider === 'claude' ? 'Claude' : 'Codex';
  const restart = (live: boolean) => live ? '' : ctx.resumable ? ' (restarts the agent; the conversation continues)' : '';
  const models: SlashChoice[] = ctx.models.map(model => ({ value: model.value, label: model.displayName, detail: [model.value !== model.displayName ? model.value : '', model.description].filter(Boolean).join(' · '), current: sameModel(model, ctx.model), keywords: model.value }));
  if (ctx.model && !models.some(choice => choice.current)) models.unshift({ value: ctx.model, label: ctx.model, detail: 'Current model', current: true });
  const permissions: SlashChoice[] = (['ask', 'read-only', 'yolo'] as PermissionMode[]).map(mode => ({ value: mode, label: PERMISSION_LABELS[mode], detail: PERMISSION_DETAILS[mode] + restart(ctx.livePermission), current: ctx.permission === mode, disabled: mode === 'yolo' && ctx.planWorkflow ? 'YOLO is unavailable in plan mode' : undefined, keywords: mode === 'yolo' ? 'bypass dangerous skip' : mode === 'ask' ? 'approve default' : 'plan readonly' }));
  return [
    { key: 'lazybox:model', name: 'model', group: 'lazybox', icon: 'sparkle', argumentHint: '<name>', description: ctx.liveModel ? `Switch ${agentName}'s model` : `Switch ${agentName}'s model${restart(false)}`, choices: models, freeArgument: true, disabled: unless(notLive), keywords: 'opus sonnet haiku gpt' },
    { key: 'lazybox:permissions', name: 'permissions', group: 'lazybox', icon: 'shield', argumentHint: 'ask|read-only|yolo', aliases: ['permission', 'yolo'], description: 'Ask, Read only or YOLO', choices: permissions, disabled: unless(notLive, !ctx.coding && 'Assistants are read-only') },
    { key: 'lazybox:subscription', name: 'subscription', group: 'lazybox', icon: 'card', description: 'Switch subscription…', aliases: ['account'], disabled: unless(notLive), keywords: 'account login profile limit' },
    { key: 'lazybox:compact', name: 'compact', group: 'lazybox', icon: 'collapse', description: 'Compact the context: summarize the conversation so far', disabled: unless(notLive, ctx.busy && 'Wait for the turn to finish', !ctx.compact && (ctx.provider === 'codex' ? 'Codex compacts its context on its own' : 'Not available until the agent reports its commands')), keywords: 'summarize context shrink tokens' },
    { key: 'lazybox:clear', name: 'clear', group: 'lazybox', icon: 'plus', description: 'New conversation in this workspace (this one is kept)', aliases: ['new'], disabled: unless(!ctx.workspace && 'Only in a workspace'), keywords: 'reset fresh start' },
    { key: 'lazybox:cost', name: 'cost', group: 'lazybox', icon: 'activity', description: 'Token cost of this conversation', aliases: ['usage'], keywords: 'tokens price money spend' },
    { key: 'lazybox:context', name: 'context', group: 'lazybox', icon: 'activity', description: 'How full the context window is', keywords: 'tokens window memory' },
    // `/review` has the default reviewer review this conversation's changes; `/review claude` names one; `/review tray` opens the tray.
    { key: 'lazybox:review', name: 'review', group: 'lazybox', icon: 'review', argumentHint: reviewHint(ctx), description: ctx.reviewers?.length ? `${ctx.reviewers[0].label} reviews this conversation’s changes, read-only` : 'Open the review tray of this workspace', freeArgument: true,
      choices: [...(ctx.reviewers || []).map((reviewer, index) => ({ value: reviewer.key, label: `Review with ${reviewer.label}`, detail: index === 0 ? 'Default reviewer · a read-only conversation; findings land in the Review tray' : 'A read-only conversation; findings land in the Review tray', keywords: reviewer.label.toLowerCase() })),
        { value: 'tray', label: 'Open the review tray', detail: 'Comments and findings of this workspace', keywords: 'comments findings diff' }],
      disabled: unless(!ctx.workspace && 'Only in a workspace'), keywords: 'diff changes comments codex claude second opinion findings' },
    { key: 'lazybox:artifact', name: 'artifact', group: 'lazybox', icon: 'artifact', description: `Track ${agentName}'s last message as an artifact`, disabled: unless(!ctx.workspace && 'Only in a workspace', !ctx.agentMessage && `${agentName} has not said anything yet`), keywords: 'document report save' },
    { key: 'lazybox:mission', name: 'mission', group: 'lazybox', icon: 'target', description: 'Open missions', aliases: ['missions'], keywords: 'tasks goals orchestrate' },
    { key: 'lazybox:run', name: 'run', group: 'lazybox', icon: 'play', description: `Run the last command block ${agentName} wrote`, disabled: unless(!ctx.coding && 'Assistants have no commands to run', !ctx.shellBlock && 'No command block to run yet'), keywords: 'shell bash script execute' },
    { key: 'lazybox:stop', name: 'stop', group: 'lazybox', icon: 'stop', description: `Interrupt ${agentName}`, aliases: ['interrupt'], disabled: unless(notLive, !ctx.busy && `${agentName} is not working`), keywords: 'cancel abort halt' },
    { key: 'lazybox:detail', name: 'detail', group: 'lazybox', icon: 'activity', argumentHint: 'quiet|smart|verbose', description: 'How much tool activity this conversation shows', choices: DETAIL_CHOICES.map(choice => ({ ...choice, current: choice.value === ctx.detail })), keywords: 'activity tools noise' },
    { key: 'lazybox:rename', name: 'rename', group: 'lazybox', icon: 'pencil', argumentHint: '<title>', needsArgument: true, description: 'Rename this conversation', aliases: ['title'], disabled: unless(!ctx.live && !ctx.resumable && 'The conversation is still connecting') },
    { key: 'lazybox:help', name: 'help', group: 'lazybox', icon: 'keyboard', description: 'Keyboard shortcuts', aliases: ['shortcuts', 'keys'] },
  ];
}
function reviewHint(ctx: SlashContext): string {
  const names = [...new Set((ctx.reviewers || []).filter(r => !r.key.startsWith('profile:')).map(r => r.key))];
  return names.length ? `[${[...names, 'tray'].join('|')}]` : '';
}
/** The reviewer `/review <word>` names: a provider, a subscription's label, or the default with no word. */
export function reviewerFor<T extends { key: string; label: string }>(reviewers: readonly T[], args: string): T | 'tray' | undefined {
  const word = args.trim().toLowerCase();
  if (!word) return reviewers[0];
  if (word === 'tray' || word === 'comments') return 'tray';
  return reviewers.find(r => r.key.toLowerCase() === word || r.label.toLowerCase() === word || `profile:${word}` === r.key.toLowerCase())
    || reviewers.find(r => !r.key.startsWith('profile:') && r.label.toLowerCase().startsWith(word));
}
/** A listed model is the session's: by id, by the id an alias resolves to, or by its name. */
export function sameModel(model: ProviderModel, current: string): boolean {
  if (!current) return false;
  const c = current.toLowerCase();
  return model.value.toLowerCase() === c || model.displayName.toLowerCase() === c;
}
/** The model a typed argument names: a listed one by id or name, else the text itself (an id the list lacks). */
export function resolveModel(args: string, models: readonly ProviderModel[]): string {
  const q = args.trim();
  if (!q) return '';
  const lower = q.toLowerCase();
  return (models.find(m => m.value.toLowerCase() === lower || m.displayName.toLowerCase() === lower) || models.find(m => m.displayName.toLowerCase().startsWith(lower) || m.value.toLowerCase().startsWith(lower)))?.value || q;
}

/**
 * The agent's own commands, as listed by its catalog: Lazybox's command of
 * the same name stands in for it (Lazybox's `/model` switches live; the
 * agent's would wait for a terminal), and terminal-only ones are left out.
 */
export function providerCommands(catalog: CommandCatalog, lazybox: readonly SlashCommand[], disabled?: string): SlashCommand[] {
  const taken = new Set(lazybox.flatMap(names));
  const terminal = new Set(catalog.terminal.map(name => name.toLowerCase()));
  const seen = new Set<string>();
  return catalog.commands.flatMap(command => {
    const lower = command.name.toLowerCase();
    if (taken.has(lower) || terminal.has(lower) || seen.has(lower)) return [];
    seen.add(lower);
    return [{ key: `provider:${command.name}`, name: command.name, group: 'provider' as const, icon: command.builtin ? 'sparkle' : 'notes', description: command.description || (command.builtin ? 'Built-in command' : 'Custom command'), argumentHint: command.argumentHint || undefined, aliases: command.aliases?.filter(alias => !taken.has(alias.toLowerCase())), disabled }];
  });
}

/** Snippets by name; those the last one sent chains to (`next:`) come first, marked Next. */
export function snippetCommands(snippets: readonly { key: string; description: string; category: string; body: string }[], next: readonly string[] = []): SlashCommand[] {
  const rows = snippets.filter(snippet => COMMAND_NAME.test(snippet.key) || /^[\w:.-]+$/.test(snippet.key)).map(snippet => ({
    key: `snippet:${snippet.key}`, name: snippet.key, group: 'snippet' as const, icon: 'snippets', description: snippet.description || snippet.category || 'Snippet', body: snippet.body, badge: next.includes(snippet.key) ? 'Next' : undefined, keywords: snippet.category,
  }));
  return [...rows.filter(row => row.badge), ...rows.filter(row => !row.badge)];
}

// ---- The conversation's record ------------------------------------------

/** 156000 → "156k", 1200000 → "1.2M". */
export function shortTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
/**
 * The one line a command leaves in the conversation, from the event the
 * Runner or the agent recorded: "Switched model to claude-opus-5-5",
 * "Compacted context: 156k → 61k tokens". Empty for anything else.
 */
export function commandLine(type: string, text: string, status: string, data: Record<string, unknown>): string {
  if (type === 'model_changed' && text) return `Switched model to ${text}${status === 'restart' ? ' · the agent restarted' : ''}`;
  if (type === 'permission_changed' && text) return `Permissions: ${PERMISSION_LABELS[text as PermissionMode] || text}${status === 'restart' ? ' · the agent restarted' : ''}`;
  if (type === 'compacted') {
    const before = Number(data.preTokens), after = Number(data.postTokens);
    const how = data.trigger === 'auto' ? 'Context compacted automatically' : 'Compacted context';
    if (Number.isFinite(before) && before > 0 && Number.isFinite(after) && after > 0) return `${how}: ${shortTokens(before)} → ${shortTokens(after)} tokens`;
    if (Number.isFinite(before) && before > 0) return `${how} from ${shortTokens(before)} tokens`;
    return how;
  }
  return '';
}
