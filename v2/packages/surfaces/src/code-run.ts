/**
 * Running what an agent wrote: which code blocks and inline code are shell
 * commands, the script each one runs, what in it is still a placeholder, the
 * message that asks the agent to run it, and how that run went, read back
 * from the conversation. Pure: `code-runs.tsx` renders it and
 * `scripts/code-run.test.ts` pins it.
 */
import { fencedCode } from './context-menu-model';
import { stripAnsi } from './ansi';
import { commandText, isFailure, type ToolEntry } from './tool-lines';

/** Fence languages that hold shell commands. `console` and `shell-session` are transcripts: prompts, then output. */
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shell-session', 'shellsession', 'sh-session', 'terminal']);
const TRANSCRIPT = new Set(['console', 'shell-session', 'shellsession', 'sh-session', 'terminal']);
export const isShellLanguage = (language: string) => SHELL.has(language.toLowerCase());

const PROMPT = /^\s*[$%]\s+/;
/**
 * The script a shell block runs. A transcript (a `console` block, or a block
 * whose lines start with a `$ ` or `% ` prompt) keeps only the prompted lines,
 * prompts removed, with their `\` continuations; the rest is output. Any other
 * shell block runs as written. '' when nothing is left to run.
 */
export function shellScript(text: string, language: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const transcript = TRANSCRIPT.has(language.toLowerCase()) || lines.some(line => PROMPT.test(line));
  if (!transcript) return text.replace(/^\s*\n/, '').replace(/\s+$/, '');
  const kept: string[] = [];
  let continued = false;
  for (const line of lines) {
    if (PROMPT.test(line)) { kept.push(line.replace(PROMPT, '')); continued = /\\$/.test(line); }
    else if (continued) { kept.push(line); continued = /\\$/.test(line); }
  }
  return kept.join('\n').replace(/\s+$/, '');
}

/**
 * What in a script someone still has to fill in: `<your-token>`, an ellipsis
 * standing for an argument, `YOUR_API_KEY`. Conservative: redirections,
 * heredocs, process substitution and Go's `./...` are not placeholders.
 */
export function placeholdersIn(script: string): string[] {
  const found = new Set<string>();
  // <name> with letters inside, not a redirection (`< file`, `2>&1`) or a heredoc (`<<EOF`).
  for (const match of script.matchAll(/(?<![<\w])<([A-Za-z][\w .:/@-]*?)>(?!>)/g)) if (/[A-Za-z]{2}/.test(match[1])) found.add(match[0]);
  for (const match of script.matchAll(/…|(?<=^|\s)\.\.\.(?=\s|$)/gm)) found.add(match[0]);
  for (const match of script.matchAll(/(?<![<\w])(?:YOUR|your)[-_][A-Za-z][\w-]*/g)) found.add(match[0]);
  return [...found];
}

/** The fenced shell blocks of a Markdown message, in order: their language and script. */
export function shellBlocksIn(markdown: string): { language: string; script: string }[] {
  const out: { language: string; script: string }[] = [];
  for (const match of markdown.matchAll(/^([ \t]*)(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[`~]*[ \t]*$/gm)) {
    const language = match[3].toLowerCase();
    if (!isShellLanguage(language)) continue;
    // A fence indented in a list: its lines lose that indent, as the renderer shows them.
    const indent = match[1].length;
    const body = indent ? match[4].split('\n').map(line => line.replace(new RegExp(`^[ \\t]{0,${indent}}`), '')).join('\n') : match[4];
    const script = shellScript(body, language);
    if (script) out.push({ language, script });
  }
  return out;
}

// ---- Inline code ----------------------------------------------------------

/** Programs whose name alone says "this is a command" when followed by arguments. */
const PROGRAMS = new Set(['make', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'go', 'cargo', 'rustup', 'git', 'gh', 'docker', 'docker-compose', 'kubectl', 'helm', 'terraform', 'python', 'python3', 'pip', 'pip3', 'uv', 'uvx', 'poetry', 'node', 'deno', 'brew', 'claude', 'codex', 'lazybox', 'codefly', 'curl', 'just', 'mise', 'bazel', 'gradle', 'mvn', 'swift', 'xcodebuild', 'tsc', 'pytest', 'jest', 'vitest', 'playwright', 'buf', 'ruff', 'eslint', 'prettier', 'bash', 'sh', 'zsh', 'ssh', 'gcloud', 'aws', 'az', 'flyctl', 'vercel', 'nx', 'turbo', 'ls', 'cat', 'tail', 'grep', 'rg', 'find', 'mkdir', 'chmod', 'export', 'source']);
/** A program given by path: `bin/devbox`, `./run.sh`, `scripts/setup`. */
const PATH_PROGRAM = /^(?:\.{1,2}\/|~\/|\/)?(?:[\w.-]+\/)*(?:bin|scripts?|tools|hack)\/[\w.-]+$|^\.{1,2}\/[\w./-]+$/;
/** Words an agent writes in backticks that are never a subcommand. */
const NOT_SUBCOMMANDS = new Set(['true', 'false', 'null', 'nil', 'none', 'undefined', 'main', 'master', 'yes', 'no', 'string', 'number', 'boolean', 'id', 'name', 'type', 'value', 'key', 'error', 'ok', 'todo', 'done', 'json', 'yaml']);
const words = (code: string) => code.trim().split(/\s+/);

/** An inline span that is a whole command on its own: `make lint`, `bin/devbox check`, `./run.sh --fast`. */
export function standaloneCommand(code: string): boolean {
  const text = code.trim();
  if (!text || text.length > 300 || text.includes('\n') || /^[#/]{2}/.test(text)) return false;
  const [first, ...rest] = words(text);
  if (PATH_PROGRAM.test(first)) return rest.length > 0 || first.startsWith('./');
  if (first === 'make') return true;
  return PROGRAMS.has(first) && rest.length > 0 && !/^[=:(]/.test(rest[0]);
}

/** The program of a standalone command when it is given by path (`bin/devbox`): its subcommands get named alone in prose. */
export function pathProgram(code: string): string {
  const first = words(code)[0] || '';
  return standaloneCommand(code) && PATH_PROGRAM.test(first) ? first : '';
}

/**
 * The command an inline span stands for, or '' when it is not one. A whole
 * command stands for itself. A bare subcommand (`build`, `up --solutions
 * none`) stands for one only next to a program the same message runs by path
 * (`bin/devbox check` earlier), and then reads as that program's
 * (`bin/devbox build`). Anything else is prose.
 */
export function inlineCommand(code: string, program = ''): string {
  const text = code.trim().replace(/\s+/g, ' ');
  if (standaloneCommand(text)) return text;
  if (!program) return '';
  const [first, ...rest] = words(text);
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(first) || NOT_SUBCOMMANDS.has(first) || PROGRAMS.has(first) || rest.length > 4) return '';
  if (!rest.every(word => /^(--?[a-z0-9][\w-]*(=[\w.,/:-]+)?|[\w.,/:-]+)$/i.test(word))) return '';
  return `${program} ${text}`;
}

/** Each path program a message runs, with where it appears: an inline subcommand reads as the nearest one before it. */
export function pathProgramsIn(markdown: string): { program: string; at: number }[] {
  const out: { program: string; at: number }[] = [];
  for (const match of markdown.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    const program = pathProgram(match[1]);
    if (program) out.push({ program, at: match.index! });
  }
  for (const block of markdown.matchAll(/^(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n\1/gm)) {
    if (!isShellLanguage(block[2])) continue;
    for (const line of shellScript(block[3], block[2]).split('\n')) {
      const program = pathProgram(line);
      if (program) { out.push({ program, at: block.index! }); break; }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
export function programAt(programs: readonly { program: string; at: number }[], offset: number | undefined): string {
  if (!programs.length) return '';
  if (offset === undefined) return programs[0].program;
  let chosen = programs[0].program;
  for (const entry of programs) if (entry.at <= offset) chosen = entry.program;
  return chosen;
}

// ---- Asking the agent ----------------------------------------------------

export const RUN_REQUEST = 'Run this and tell me the result:';
/** What Run sends: the request, then the exact script, fenced. A transcript goes as the script it runs. */
export function runRequestMessage(script: string, language = 'sh'): string {
  const fence = TRANSCRIPT.has(language.toLowerCase()) || !language ? 'sh' : language.toLowerCase();
  return `${RUN_REQUEST}\n${fencedCode(script, fence)}`;
}
/** The script a message asked the agent to run, when it is a Run request. */
export function requestedScript(text: string): string | undefined {
  if (!text.startsWith(RUN_REQUEST)) return undefined;
  const match = /^[^\n]*\n(`{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(text);
  return match?.[2];
}

const normal = (text: string) => text.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
/** The lines of a script that say what it does: no blanks, no comments. */
const commandLines = (script: string) => script.replace(/\\\n/g, ' ').split('\n').map(normal).filter(line => line.length >= 3 && !line.startsWith('#'));
/** A tool call runs (part of) the script: its command contains one of the script's lines. */
export function runsScript(entry: Pick<ToolEntry, 'name' | 'input'>, script: string): boolean {
  const command = normal(commandText(entry));
  return !!command && commandLines(script).some(line => command.includes(line));
}

export type RunOutcome = { state: 'running' | 'ok' | 'failed'; exitCode?: number };
type Message = { id: string; type: string; text: string; operationId?: string; tools?: ToolEntry[] };
/**
 * How the agent's run of a block went, read from the conversation: the latest
 * Run request for this script after the block's message (and before a later
 * agent message repeats the script, which then owns the requests), and the
 * last tool call after that request which runs it. `outcome` is undefined
 * until such a call appears.
 */
export function agentRun(messages: readonly Message[], messageId: string, script: string): { operationId?: string; outcome?: RunOutcome } | undefined {
  const start = messages.findIndex(message => message.id === messageId);
  if (start < 0) return undefined;
  let request = -1;
  for (let i = start + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.type === 'message_delta' && message.text.includes(script)) break;
    if (message.type === 'operation_accepted' && requestedScript(message.text) === script) request = i;
  }
  if (request < 0) return undefined;
  let last: ToolEntry | undefined;
  for (let i = request + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.type === 'operation_accepted' && requestedScript(message.text) === script) break;
    for (const entry of message.tools || []) if (runsScript(entry, script)) last = entry;
  }
  const outcome: RunOutcome | undefined = !last ? undefined
    : last.status === 'running' ? { state: 'running' }
    : isFailure(last) ? { state: 'failed', exitCode: last.exitCode }
    : { state: 'ok', exitCode: last.exitCode };
  return { operationId: messages[request].operationId, outcome };
}

// ---- Running it yourself ---------------------------------------------------

/** How a person's run is started: one shell, so a multi-line block is one script. */
export const runArgv = (script: string) => ['/bin/sh', '-lc', script];
/** The script of a command started by `runArgv`, else ''. */
export const scriptOf = (argv: readonly string[]) => argv.length === 3 && argv[0] === '/bin/sh' && argv[1] === '-lc' ? argv[2] : '';
/** A run's title in the console's list: its first command line, short. */
export function runTitle(script: string): string {
  const line = commandLines(script)[0] || normal(script);
  return line.length > 60 ? line.slice(0, 59) + '…' : line;
}

/** The end of a run's output for the agent: plain text, the last `lines` lines, and how much was left out. */
export function outputTail(output: string, lines = 60): { text: string; omitted: number } {
  const all = stripAnsi(output).replace(/\r(?!\n)/g, '\n').replace(/\s+$/, '').split('\n');
  return { text: all.slice(-lines).join('\n'), omitted: Math.max(0, all.length - lines) };
}
/** What "Ask … to fix" adds to the message box: the script, where it ran, how it ended, and the end of its output. */
export function fixRequestMessage({ script, folder, exitCode, signal, output, truncated }: { script: string; folder: string; exitCode?: number; signal?: string; output: string; truncated: boolean }): string {
  const tail = outputTail(output);
  const how = signal ? `was stopped (${signal})` : `failed (exit ${exitCode ?? 'unknown'})`;
  const where = folder ? ` in \`${folder}\`` : '';
  const shown = tail.omitted || truncated ? `The last ${tail.text.split('\n').length} lines of its output:` : 'Its output:';
  return `I ran this myself${where} and it ${how}:\n${fencedCode(script, 'sh')}\n${shown}\n${fencedCode(tail.text || '(no output)', 'text')}\nFind out why and fix it.`;
}
