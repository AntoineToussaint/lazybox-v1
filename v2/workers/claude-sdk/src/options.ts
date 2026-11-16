import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { helpPermissions } from './settings.js';
import { browserRule } from './browser.js';

type ExecutionOptions = {
  cwd: string; model?: string; resume?: string; context?: string;
  purpose?: string; binary?: string; permission?: string; workflow?: string;
  /** The Runner offers the agent browser: its tools need no per-call prompt (the Runner asks per site). */
  browser?: boolean;
};

/** Resolved startup options; authentication remains in the selected environment. */
export function nativeOptions(o: ExecutionOptions, env: NodeJS.ProcessEnv): Options {
  const options = baseOptions(o, env);
  // The browser asks the person per site, download and sign-in itself; a
  // prompt per click on top would teach them to click through.
  if (o.browser && o.purpose !== 'help') {
    const permissions = options.settings && typeof options.settings === 'object' ? (options.settings as { permissions?: Record<string, string[]> }).permissions || {} : {};
    options.settings = { ...(typeof options.settings === 'object' ? options.settings : {}), permissions: { ...permissions, allow: [...(permissions.allow || []), browserRule] } };
  }
  return options;
}

function baseOptions(o: ExecutionOptions, env: NodeJS.ProcessEnv): Options {
  return {
    cwd: o.cwd, model: o.model || undefined, resume: o.resume || undefined,
    ...(o.context ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: o.context } } : {}),
    pathToClaudeCodeExecutable: o.binary || undefined,
    // Omit settingSources and permissionMode to retain the native CLI settings
    // chain and configured mode. The SDK handles deny/allow rules before callbacks.
    env, includePartialMessages: true,
    // A sub-agent's own prose reaches the conversation, so its timeline can be
    // read; coding agents also report a one-line progress summary while they run.
    forwardSubagentText: true,
    ...(['help', 'planning', 'summary'].includes(o.purpose || '') ? {} : { agentProgressSummaries: true }),
    ...(['help', 'planning', 'summary'].includes(o.purpose || '') ? { tools: [], strictMcpConfig: true } : {}),
    // The help assistant's only tools are Lazybox's settings: reading them is
    // allowed, and every update asks, whatever the Runner permission says.
    ...(o.purpose === 'help' ? { permissionMode: 'default' as const, settings: { permissions: helpPermissions } }
      : o.permission === 'read-only' || o.workflow === 'plan' ? { permissionMode: 'plan' as const }
      : o.permission === 'yolo' ? { permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true }
      : o.permission === 'ask' ? { permissionMode: 'default' as const, settings: { permissions: { ask: ['Bash', 'mcp__lazybox__command'] } } }
      : {}),
  };
}
