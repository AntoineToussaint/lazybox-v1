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
2. saves the full output to a private file;
3. gives the agent a compact view built by
   [gortk](https://github.com/codefly-dev/gortk): a first line with the
   command and exit status, the output with passing and progress lines
   dropped and secrets masked, what was dropped, and the full-output path
   when anything was dropped or the command failed;
4. exits with the command's own status.

Commands get no stdin, so nothing waits for input. If the Runner is
unreachable, the command still runs and the agent still gets its view.
`--raw` gives the agent the full output for diffs and JSON.

`cmd | lazybox log` is unchanged: a transparent tee for output from a producer
lazybox did not start. It cannot know the exit status, so `run` is preferred.

**Every coding agent is told about it.** The Runner appends a fixed briefing
(`internal/runner/command_output.go`) after the editable Settings → Agents
text, and puts the CLI first on the agent's PATH. Being part of the binary, it
changes with releases without a settings migration. The launcher builds the
CLI from the Runner's own source; the Runner briefs agents only when the
binary exists.

## Roadmap

| # | Step | Status |
|---|---|---|
| 1 | `lazybox run`: live console, full-output file, compact failure-first view, real exit status | Done |
| 2 | Briefing and PATH for every coding agent; launcher builds the CLI for Dev and staged releases | Done |
| 3 | **Deliver changed instructions to live sessions.** A session is stale when a current shared section (Settings text, provider text, command briefing) is missing from what it started with and it has not received this update. The chat shows a note; the update travels with the next message as its own block, worded as a replacement (Claude: a text block ahead of the user's; Codex: an input item, since this `turn/start` has no context field). Recorded per conversation and inherited by resumes, so it is sent once. Removing text from Settings is not propagated. | Done |
| 4 | **Live permission change** from the session menu (Ask / Read only / YOLO). Claude: `setPermissionMode()`, and while in YOLO the worker approves tool requests itself, so sessions started without the bypass flag still switch. Codex: `approvalPolicy`/`sandboxPolicy` on following turns. Saved to the session record, so resume and account rotation keep it. A request already waiting still needs one answer. | Done |
| 5 | **Console polish.** Open the console when a run starts in the viewed session; label each run with what the agent received (bytes in → out, filter, exit); open the full-output file from the console. | Planned |
| 6 | **Measure before going further.** Record per-run bytes in/out and the gortk filter in telemetry. Judge by cost per completed task and failure rate, not bytes saved. | Planned |
| 7 | **Opt-in automatic wrapping** of known noisy commands (test, build, lint, install) through a Claude `PreToolUse` rewrite and the Codex equivalent. Only with step 6 showing a benefit; fall back to the original command on any wrapper error to avoid retry loops. | Later |
| 8 | **Retention.** Delete full-output files with their session; bound total size. Today they live in the system temp directory. | Planned |

## Known limits

- The CLI is built when the launcher starts. A Go change to the CLI needs a
  relaunch; the Runner itself hot-reloads.
- Codex's `workspace-write` sandbox may block the CLI's connection to the
  Runner. The command still runs and the agent still gets its view; the
  report says the console did not receive it.
- The compact view is built from the first 32 MiB of each stream. The console
  and the file keep everything.
- Commands needing a terminal (TUIs, password prompts) are out of scope; the
  interactive shell is roadmap R3.
