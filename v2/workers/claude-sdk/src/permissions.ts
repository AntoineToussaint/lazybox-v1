import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

/**
 * "Always allow" for Claude's approvals.
 *
 * Where Claude suggests permission updates (`suggestions` in canUseTool), the
 * choices are those updates, at the scope the person picks: this conversation
 * (destination `session`) or this workspace (`localSettings`, the worktree's
 * .claude/settings.local.json). Claude then enforces them itself.
 *
 * Lazybox's "ask" permission adds a tool-wide `ask` rule for Bash and the
 * managed command tool, so every command asks. That rule outranks allow rules
 * and Claude offers no suggestions under it (observed with the CLI 2.1.325:
 * no `suggestions`, and a session allow rule did not stop the next ask). For
 * those two tools the worker keeps the grants itself, for this conversation
 * only, and matches them conservatively: an exact command, or a prefix of
 * plain words on a command with no shell operators. Anything else asks again.
 */
export type Scope = 'conversation' | 'workspace';
/** What the client renders (the request's `always` list) and sends back by id. */
export type AlwaysChoice = { id: string; scope: Scope | 'prefix'; label: string; detail?: string };
type Choice = AlwaysChoice & { updates?: PermissionUpdate[]; grant?: Grant };
/** A grant the worker holds: the tool, and the exact command or its leading words. */
export type Grant = { tool: string; exact?: string; prefix?: string[] };

const SHELL_OPERATORS = /[;&|<>`$()\n\\]/;
const words = (command: string) => command.trim().split(/\s+/).filter(Boolean);

/** The command a request runs, as one line, for Bash and the managed command tool. */
export function commandOf(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash' && typeof input.command === 'string') return input.command.trim();
  if (tool === 'mcp__lazybox__command' && input.action === 'start' && Array.isArray(input.argv) && input.argv.every(a => typeof a === 'string')) return (input.argv as string[]).join(' ');
  return '';
}

/** The leading words a prefix grant would keep: `npm run`, `git status`, `ls`. */
export function commandPrefix(command: string): string[] {
  if (!command || SHELL_OPERATORS.test(command)) return [];
  const [first, second] = words(command);
  if (!first || /[*?'"=]/.test(first)) return [];
  return second && /^[a-z][\w:.-]*$/i.test(second) ? [first, second] : [first];
}

/** Whether a grant the worker holds covers this request. */
export function covers(grant: Grant, tool: string, input: Record<string, unknown>): boolean {
  if (grant.tool !== tool) return false;
  const command = commandOf(tool, input);
  if (!command) return false;
  if (grant.exact !== undefined) return grant.exact === command;
  if (!grant.prefix?.length || SHELL_OPERATORS.test(command)) return false;
  const have = words(command);
  return grant.prefix.every((word, i) => have[i] === word);
}

const ruleText = (rule: { toolName: string; ruleContent?: string }) => {
  const content = rule.ruleContent?.trim();
  if (!content) return rule.toolName.startsWith('mcp__') ? `every ${rule.toolName.replace(/^mcp__(.+?)__/, '$1 · ')} call` : `every ${rule.toolName} request`;
  if (rule.toolName === 'Bash') {
    const prefix = content.replace(/(:\*|\s\*)$/, '');
    return prefix === content ? `\`${content}\`` : `commands starting with \`${prefix}\``;
  }
  if (rule.toolName === 'WebFetch' && content.startsWith('domain:')) return `fetches from ${content.slice(7)}`;
  if (['Read', 'Edit', 'Write'].includes(rule.toolName)) return `${rule.toolName === 'Read' ? 'reading' : 'editing'} ${content.replace(/^\/\//, '/').replace(/\/\*\*$/, '/')}`;
  return `${rule.toolName}(${content})`;
};

/** What a set of permission updates stops asking for, in words. */
export function describeUpdates(updates: readonly PermissionUpdate[]): string {
  const parts: string[] = [];
  for (const update of updates) {
    if ((update.type === 'addRules' || update.type === 'replaceRules') && update.behavior === 'allow') parts.push(...update.rules.map(ruleText));
    else if (update.type === 'addDirectories') parts.push(`access to ${update.directories.join(', ')}`);
    else if (update.type === 'setMode' && update.mode === 'acceptEdits') parts.push('file edits');
    else if (update.type === 'setMode') parts.push(`${update.mode} mode`);
  }
  return [...new Set(parts)].join(' and ');
}

const persistable = (u: PermissionUpdate) => u.type === 'addRules' || u.type === 'replaceRules' || u.type === 'addDirectories';
const at = (updates: readonly PermissionUpdate[], destination: PermissionUpdate['destination']) => updates.map(u => ({ ...u, destination }));

/**
 * The "always allow" choices for a request, narrowest first. None for the
 * settings tool (every change is confirmed), when Claude says the rule would
 * grant more than this ask, or where there is nothing safe to remember.
 */
export function alwaysChoices(tool: string, input: Record<string, unknown>, context: { suggestions?: PermissionUpdate[]; suppressAlwaysAllowRule?: boolean; settingsTool?: boolean }): Choice[] {
  if (context.settingsTool || context.suppressAlwaysAllowRule) return [];
  const suggestions = (context.suggestions || []).filter(u => !(u.type === 'addRules' || u.type === 'replaceRules') || u.behavior === 'allow');
  if (suggestions.length) {
    const what = describeUpdates(suggestions);
    if (!what) return [];
    const out: Choice[] = [{ id: 'conversation', scope: 'conversation', label: what, detail: 'Claude stops asking until this conversation ends.', updates: at(suggestions, 'session') }];
    // A mode is never written to settings; rules and directories may be.
    const lasting = suggestions.filter(persistable);
    if (lasting.length) out.push({ id: 'workspace', scope: 'workspace', label: describeUpdates(lasting), detail: 'Saved to this workspace’s .claude/settings.local.json; later conversations here follow it too.', updates: at(lasting, 'localSettings') });
    return out;
  }
  const command = commandOf(tool, input);
  if (command) {
    const out: Choice[] = [];
    const prefix = commandPrefix(command);
    if (prefix.length && prefix.join(' ') !== command) out.push({ id: 'prefix', scope: 'prefix', label: `commands starting with \`${prefix.join(' ')}\``, detail: 'Until this conversation ends. Commands that chain, pipe or redirect still ask.', grant: { tool, prefix } });
    out.push({ id: 'command', scope: 'conversation', label: `\`${command.length > 80 ? command.slice(0, 79) + '…' : command}\``, detail: 'This exact command, until this conversation ends.', grant: { tool, exact: command } });
    return out;
  }
  // Bash and the managed command tool without suggestions are covered above;
  // a tool-wide rule for them would allow every command.
  if (tool === 'Bash' || tool === 'mcp__lazybox__command') return [];
  return [{ id: 'conversation', scope: 'conversation', label: ruleText({ toolName: tool }), detail: 'Claude stops asking until this conversation ends.', updates: [{ type: 'addRules', rules: [{ toolName: tool }], behavior: 'allow', destination: 'session' }] }];
}

/** The choices as the client sees them, without the native updates. */
export const offered = (choices: readonly Choice[]): AlwaysChoice[] => choices.map(({ id, scope, label, detail }) => ({ id, scope, label, detail }));

export type Decision = { decision: string; always?: string; reason?: string };

/**
 * Claude's result for the person's decision, and a grant for the worker to
 * keep when the choice is one it enforces itself.
 */
export function decide(tool: string, input: Record<string, unknown>, choices: readonly Choice[], d: Decision): { result: PermissionResult; grant?: Grant } {
  if (d.decision !== 'accept') {
    const reason = d.reason?.trim();
    return { result: { behavior: 'deny', message: reason ? `The user declined this ${tool} request and said: ${reason}` : 'Declined by operator', decisionClassification: 'user_reject' } };
  }
  if (!d.always) return { result: { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' } };
  const choice = choices.find(c => c.id === d.always);
  if (!choice) throw new Error(`this request does not offer "${d.always}"`);
  return { result: { behavior: 'allow', updatedInput: input, ...(choice.updates ? { updatedPermissions: choice.updates } : {}), decisionClassification: 'user_permanent' }, grant: choice.grant };
}
