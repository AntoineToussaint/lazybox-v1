# Command output for agents and humans

A command an agent runs has two readers. The human wants every byte, live,
in a console window. The agent wants the outcome and the failures, in as few
tokens as possible, and a way to get the rest when it needs it. V1's
`lazybox log` served only the human: it kept output out of the agent's
context entirely. V2 serves both from one run.

This page is the design and the roadmap. Pipe capture and Runner-owned
commands are specified in [execution](EXECUTION.md); this page covers what
each reader receives.

## What we know (November 2026)

- **Compression helps less than it claims, and can hurt.** rtk reports 60–90%
  fewer output tokens. Independent Terminal-Bench runs measured −5% to +5%
  cost and a 1–2 point lower pass rate, because rtk rewrote only 31% of
  terminal calls, terminal output was ~11% of input, and one unsupported flag
  caused a 339-error retry loop
  ([Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/)). The
  gain is in large test and build logs, not in every command.
- **Agents almost never fetch more output.** A study of real sessions found no
  agent-initiated request for a second page ([arXiv 2608.26130](https://arxiv.org/abs/2608.26130)).
  Whatever the agent must know has to be in the first view.
- **Agents truncate on their own and miss failures.** Claude pipes through
  `tail`/`head` by habit and loses the crash line
  ([claude-code#39945](https://github.com/anthropics/claude-code/issues/39945)).
- **Peers spill to a file.** Claude Code keeps ~30k characters inline and saves
  the rest to a file with a preview; Goose keeps the last 50 lines and the
  file path; Codex keeps head and tail of 10 KB. Cursor drops output between
  20k and 40k characters with no file.
- **Masking old observations matches summarizing them** at about half the cost
  ([arXiv 2508.21433](https://arxiv.org/abs/2508.21433)). Rewriting old tool
  results breaks the prompt cache, so compress once, when the result is made.
- **A live Claude session keeps the system prompt it started with.** Resuming
  with a different appended prompt has no effect until compaction. New
  instructions must arrive in the conversation, as a user message or hook
  `additionalContext` ([Agent SDK](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)).
  Codex appends a developer message saying the new instructions replace the
  old ones. `setPermissionMode()` does work on a live Claude session.

## Design

**`lazybox run -- COMMAND`** (`services/runner/code/cmd/lazybox/run.go`)
runs the command itself, so it knows the real exit status and keeps stdout and
stderr apart. It:

1. streams every byte to the session's console as it arrives;
2. saves the full output to a private file in the session's output directory
   (see Retention below);
3. gives the agent a compact view built by
   [gortk](https://github.com/codefly-dev/gortk): a first line with the
   command and exit status, the output with passing and progress lines
   dropped and secrets masked, what was dropped, and the full-output path
   when anything was dropped or the command failed;
4. exits with the command's own status;
5. reports to the Runner, when it closes the console capture, what the agent
   received: its exit status, the size of the agent's view against the full
   output, the gortk filter and the full-output path.

Commands get no stdin, so nothing waits for input. If the Runner is
unreachable, the command still runs and the agent still gets its view.
`--raw` gives the agent the full output for diffs and JSON.

`cmd | lazybox log` is unchanged for agents: a transparent tee for output from
a producer lazybox did not start. It cannot know the exit status, so `run` is
preferred.

**From a workspace terminal** (V1's `cargo test 2>&1 | lazybox log`), the
reader is a person who may hand the result to an agent. With no session, both
verbs publish a *workspace run*: the terminal shows every byte as usual, the
run appears in the console of every conversation in the workspace, and the CLI
also keeps the full-output file and builds the same compact view, sent with
the capture's completion (`CommandReport.agent_view`, at most 64 KiB; `piped`
for `log`, whose title picks the gortk filter). **Send to agent** in the
console, or `--to CONVERSATION` in the terminal, puts that view in the
conversation's message box; the person sends it. The agent receives the
compact view, never the full output. The terminal's credential, scope and
lifetime are in [terminals](TERMINALS.md#what-the-shell-may-do-with-the-runner).
Workspace runs are not counted in telemetry: they reach an agent only if a
person sends them.

**The console follows runs.** When a command starts in the session being
viewed, a collapsed "Command output" panel opens on it, without taking focus
from the composer. Commands that existed before the session was opened never
open it. **Putting it away is a choice that holds:** hidden (its title),
closed (×) or toggled from the keyboard (`] ] o`, "Show or hide command
output" in the command palette), it stays away through later runs, per
workspace and across reloads, until the person opens it again. It then shows
the newest run and follows runs as before. A closed panel comes back from
**Page actions → Show panel → Command output**, the same key, or **Open in
console** in the chat's live bar. The live bar's own output lines can be
hidden too (the × in their corner, **Show output** to bring them back); that
choice is shared by every conversation. Each run's header reads, for example, `exit 1 · agent saw
2.1 KiB of 1.4 MiB (go-test filter)`, with the full-output path to copy. The
Runner records the same numbers in telemetry (`commands` table, one row per
run) to measure savings (step 6).

**Running what the agent wrote.** A shell code block in an agent's message
(`bash`, `sh`, `shell`, `zsh`, or a `console` transcript, whose prompts and
output lines are dropped) has a **Run** split button beside Copy
(`code-runs.tsx`, rules in `code-run.ts`):

- **Run** (also Enter on the focused block) sends the agent "Run this and tell
  me the result:" and the block, fenced, as its own message: the draft in the
  message box is untouched. The agent runs it with `lazybox run`, so it sees a
  failure and reacts. During a turn the message waits in the Runner's queue and
  the block says "Queued — runs after the current turn". The block then shows
  the agent's run from its matching tool call: running, ran ✓, failed ✗.
- **Run myself…** (the ▾ menu, the block's right-click menu, ⌥Enter) opens a
  confirm card under the block: the script, editable; the folder (the
  workspace root or one of its repositories, by default the conversation's);
  Run (Enter) and Cancel (Escape). A script with a placeholder (`<your-token>`,
  `…`, `YOUR_API_KEY`) cannot run until it is filled in. It runs as
  `/bin/sh -lc SCRIPT`, a command of the conversation (`StartCommand`, with
  its `cwd`, which the Runner requires to be inside the conversation's folder),
  and the console opens on it. The block shows Running, ✓ exit 0 or ✗ exit N;
  a failure offers **Ask the agent to fix**, which adds the script and the last
  60 lines of its output to the message box for the person to send.

`StartCommand` is the owner's alone, so a read-only or Plan conversation runs
a person's command too: the mode bounds the agent, and the person could type
the same command in a workspace terminal. The confirm card says so. An
agent's own start in such a conversation is still refused. Nothing runs
without a click or key, and Run myself always confirms.

Inline code that reads as a command (`make lint`, `bin/devbox check`, or a
bare subcommand such as `build` next to a program the message runs by path,
read as `bin/devbox build`) offers the same two in its right-click menu only,
so prose stays calm. **Run the last command block** (`] ] r`) and **Run the
last command block myself…** are in the command palette.

The hand-over of a failed run carries the end of its output, not a gortk
view: only `lazybox run` builds one, and a person's run is not wrapped in it.

**Retention.** The Runner gives every execution
`LAZYBOX_V2_OUTPUT_DIR=<state>/command-output/<execution id>`. Deleting a
conversation deletes the directories of all its executions. Both output roots
together are bounded (1 GiB by default, `commandOutputBudget` in the Runner
config): after each run the oldest files are deleted first, but never a file
modified in the last hour, so a path the agent was just given stays readable.
When the variable is absent, or its directory is not writable, the CLI falls
back to `$TMPDIR/lazybox-output/<execution id>` (or `$TMPDIR/lazybox-output`
outside a session); the Runner deletes and bounds that directory too.

**Every coding agent is told about it.** The Runner appends a fixed briefing
(`internal/runner/command_output.go`) after the editable Settings → Agents
text, and puts the CLI first on the agent's PATH. Being part of the binary, it
changes with releases without a settings migration. The same briefing tells agents to publish plans and reports with
`lazybox artifact put` ([artifacts](ARTIFACTS.md)). The launcher builds the
CLI from the Runner's own source; the Runner briefs agents only when the
binary exists.

## Roadmap

| # | Step | Status |
|---|---|---|
| 1 | `lazybox run`: live console, full-output file, compact failure-first view, real exit status | Done |
| 2 | Briefing and PATH for every coding agent; launcher builds the CLI for Dev and staged releases | Done |
| 3 | **Deliver changed instructions to live sessions.** A session is stale when a current shared section (Settings text, provider text, command briefing) is missing from what it started with and it has not received this update. The chat shows a note; the update travels with the next message as its own block, worded as a replacement (Claude: a text block ahead of the user's; Codex: an input item, since this `turn/start` has no context field). Recorded per conversation and inherited by resumes, so it is sent once. Removing text from Settings is not propagated. | Done |
| 4 | **Live permission change** from the session menu (Ask / Read only / YOLO). Claude: `setPermissionMode()`, and while in YOLO the worker approves tool requests itself, so sessions started without the bypass flag still switch. Codex: `approvalPolicy`/`sandboxPolicy` on following turns. Saved to the session record, so resume and account rotation keep it. A request already waiting still needs one answer. | Done |
| 5 | **Console polish.** Open the console when a run starts in the viewed session; label each run with what the agent received (bytes in → out, filter, exit); open the full-output file from the console. | Done, except opening the file: the console copies its path, since a browser view cannot open local files and the desktop shell has no open-file action yet |
| 6 | **Measure before going further.** Record per-run bytes in/out and the gortk filter in telemetry. Judge by cost per completed task and failure rate, not bytes saved. | Recording done (telemetry `commands`); no report or analysis yet |
| 7 | **Opt-in automatic wrapping** of known noisy commands (test, build, lint, install) through a Claude `PreToolUse` rewrite and the Codex equivalent. Only with step 6 showing a benefit; fall back to the original command on any wrapper error to avoid retry loops. | Later |
| 8 | **Retention.** Delete full-output files with their session; bound total size. | Done |

## Known limits

- The CLI is built when the launcher starts. A Go change to the CLI needs a
  relaunch; the Runner itself hot-reloads.
- Codex's `workspace-write` sandbox may block the CLI's connection to the
  Runner. The command still runs and the agent still gets its view; the
  report says the console did not receive it.
- That sandbox lets a command write only in the workspace and the temp
  directories, so under Codex in Ask mode full-output files land in the temp
  fallback rather than the Runner's state. They are still deleted with the
  conversation and bounded, but the system may also clear the temp directory
  on its own. A Codex agent that changes `TMPDIR` writes where the Runner does
  not look.
- The console opens only for runs it sees start while the session is viewed:
  it polls every 1.5 s, so a run that starts while switching sessions is in
  the list but does not open the panel.
- The compact view is built from the first 32 MiB of each stream. The console
  and the file keep everything.
- Commands needing a terminal (TUIs, password prompts) are out of scope; the
  interactive shell is roadmap R3.
