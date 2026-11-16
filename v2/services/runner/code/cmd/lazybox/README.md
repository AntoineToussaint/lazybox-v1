# `lazybox` — the V2 CLI

Build with `make build-go` from `v2/` (`bin/lazybox`); the Dev and Working
launchers build it into the environment and put it first on every agent's
`PATH`. It never resolves V1 daemon state. See `v2/RUNNING.md`.

Everything a person does in the app is scriptable from here: list and follow
conversations, send, approve, stop, wait, open things in the window, take a
screenshot, run your own actions, inspect hooks. Every power verb takes
`--json` and exits with a documented code, so scripts and agents can rely on it.

## Which Runner it talks to

1. `--endpoint FILE` — an endpoint file, as written (`<state>/endpoint.json`
   is the owner's).
2. `LAZYBOX_V2_ENDPOINT` — set inside Lazybox: an agent's, a workspace
   terminal's or a hook's own **scoped** endpoint.
3. `--runner NAME` or `LAZYBOX_RUNNER=NAME` — a registered Runner.
4. The registered Runners: the Dev and Working launchers register theirs in
   `$XDG_CONFIG_HOME/lazybox/runners/<name>.json` (else
   `~/.config/lazybox/runners/`), and an installed release's service its own
   as `lazybox`. With one, it is used; with several, `lazybox` (the installed
   app) and then `working` are; otherwise the CLI asks you to choose.
   `lazybox runners` lists them and which is live.

`lazybox run` and `lazybox log` resolve the Runner the same way from your own
terminal, and the workspace from `--collection` (an id or a workspace's
name) or, without it, the workspace whose folder or worktree you are in.

Inside an agent, a workspace terminal or a hook (any of
`LAZYBOX_V2_SESSION_ID`, `LAZYBOX_V2_COLLECTION_ID`, `LAZYBOX_V2_ENDPOINT`
set), the CLI **never** falls back to a registered owner endpoint on its own:
it uses the scoped credential it was given, and owner verbs fail with exit 4
and a sentence saying what that credential may do. An explicit `--runner` or
`--endpoint` is the person's choice and is honoured. (Same-user processes can
read the owner's file anyway; this is a guard against accidents, not a
boundary — see `v2/RESOURCE_OWNERSHIP.md`.)

The Runner refuses any HTTP `Host` other than the one it serves on
(localhost), answering 404 — a DNS-rebinding guard. The CLI uses the endpoint
URL exactly as written; if you see "the Runner refused the request's Host",
you are reaching it under another name or address.

## Power verbs

| Verb | What it does |
|---|---|
| `ls [--all]` | Workspaces, their conversations and agents with live state (needs input, failed, working, review, idle, ended), sub-agents still running. `--all` lists every registered Runner, grouped by Runner. Inside an agent: its own commands instead, running first (a server in the background with its URL), then the last five that ended. |
| `inbox [--all]` | What needs you, in order: needs input › failed › working › ready for review, with the `approve`/`deny` line for each pending approval. |
| `runners` | Registered Runners, live or not, and which one the CLI uses. |
| `send <conversation> [text\|-]` | Send a message. Text from the arguments, or stdin with `-` or when piped. An ended conversation is resumed first. `--steer` steers the running turn. |
| `open <workspace\|conversation\|file[:line]> [--panel KIND] [--workspace W]` | Show it in the Lazybox window in front (desktop preferred over a browser tab). A file opens in its workspace: `--workspace`, the terminal's, or the only one. |
| `workspace repos [WORKSPACE]` | A workspace's repositories (name, path, branch) and the requests agents made that still wait. Inside an agent or a workspace terminal, its own workspace. |
| `workspace request-repo <name\|owner/repo\|path> --reason WHY [--no-wait] [--timeout 90s]` | For agents: ask the person to add a repository to this workspace instead of reaching outside it ([WORKSPACES.md](../../../../WORKSPACES.md#when-an-agent-needs-another-repository)). Matched against the catalog; adds nothing itself. Waits for the answer: the new worktree's path (exit 0), declined with the reason (exit 4), no answer yet (exit 5, the answer comes later as a message in the conversation). |
| `review add --file <repo>/<path> --line N[-M] --severity blocker\|major\|minor\|nit --title T [--body B\|-] [--key K]` | For a reviewer agent Lazybox started ([GITHUB.md](../../../../GITHUB.md#agent-review)): file one finding, anchored to the lines as the file is now. It lands in the person's Review tray, from that agent, for them to accept or dismiss. The same file, line and title (or `--key`) again updates it. Refused from a conversation that reviews nothing. |
| `review list` | The review this conversation takes part in and its findings, with ids, severity, where they point now and what became of them. |
| `review resolve <finding-id> --note WHY` · `review reopen <finding-id> --note WHY` | For the reviewer, in a later round of the [review loop](../../../../GITHUB.md#the-review-loop): its finding is fixed, or still open (back to pending, to reach the author again). Only its own review's findings. |
| `ask author\|reviewer "question" [--timeout 90s] [--no-wait]` | Between the author and the reviewer of one review: the question goes to the other conversation as a labelled message; its reply prints here (exit 0), or comes later as a message in this conversation (exit 5 when the wait ends first). Refused for anyone else, while the other side waits on your question, or over the limits. |
| `new <name> --repo R [--repo R…] [--branch B]` | Create a workspace from catalog repositories (`owner/name`, catalog name, identity or path). Progress on stderr, the new id on stdout. |
| `approve\|deny <request\|conversation>` | Answer a pending approval, by request id (or its suffix after `:`), or by conversation when it has exactly one. Questions are answered in the app. |
| `stop <conversation\|command> [--agent ID] [--end]` | Interrupt the running turn; `--agent` stops one sub-agent; `--end` ends the conversation (resumable). A command id cancels that command (SIGTERM to its group, SIGKILL after 5s), a `lazybox run` in the background included. Inside an agent: only its own commands. |
| `agents spawn --title T [--brief B\|-] [--workspace same\|new] [--permission P] [--profile ID] [--role R]` · `agents ls` · `agents send <agent\|parent> "…"` · `agents wait [agent…] --until settled\|idle\|needs-input\|reported\|closed [--any] [--timeout 10m]` · `agents watch` · `agents stop <agent> [--end]` · `agents report "…"` | For an agent the person made an Orchestrator ([guide](../../../../docs/guides/orchestrator.md)): start agents for its mission within the grant's ceiling, and drive only those; for an agent it started: talk to its parent and report its task. Refused without a grant (exit 4), past the caller's lineage (exit 4), above the ceiling or over the limits (exit 1, saying why: 4 KB, six messages a minute to one agent). `wait` exits 5 on timeout; the agents keep running. Never approves, answers or accepts. |
| `mission plan <file\|->` · `mission approve <mission> [--plan ID] [--cap $] [--wip N] [--note …]` · `mission reject <mission> --note …` · `mission budget <mission> --cap $` | An orchestrator proposes its plan (YAML or JSON: summary; tasks with key, title, brief, role, permission, workspace, paths, estimate_usd, after); the person approves it with a cap and a fan-out, rejects it, or raises the tree's budget. An agent's `approve`/`reject`/`budget` is refused (exit 4). |
| `wait <conversation> --until idle\|needs-input [--timeout 30m]` | Block until reached (exit 0); exit 5 on timeout; exit 1 if the turn failed, or ended without asking when waiting for input. |
| `watch <conversation\|workspace> [--since CURSOR\|DURATION] [--tail N]` | Follow events live as a timeline: time, agent or sub-agent, event, short text; streamed message deltas are folded into one line. Shows the last `--tail` (20) events first; `--since 0`/`--since 10m` replays from a cursor or a time. A workspace follows every live conversation and picks up new ones. `--json` prints NDJSON, one record per journal record (deltas included, `replay: true` for history). Colour only on a terminal, never with `NO_COLOR`. |
| `debug <conversation> [--events N]` | Diagnosis from the journal and the Runner's state: busy/queued/fault/status, pending requests, sub-agents, the last N lifecycle events (turns, accepted operations, receipts, failures, re-attachments, agent status) and findings in plain words — "the last turn ended by an interrupt you sent at 16:59", "fault X blocks messages", "a message has been queued behind the running turn for 5m", "no event for 12m while a turn runs". |
| `missions [ls\|show ID\|new TITLE --brief B\|accept ID TASK\|reject ID TASK --note N]` | Missions and their tasks; accept or reject work at a task's gate. |
| `shot [window\|PANEL] [--out FILE]` | PNG of the window or one panel, taken by the desktop app (a browser tab cannot). Default `./lazybox-shot-<time>.png`; `--out -` writes to stdout. |
| `actions [ls\|validate [FILE]\|schema\|path\|init\|run ID [--conversation C]]` | Your actions and hooks file (`v2/POWER.md`): list what loaded and its problems by line, check a file locally (exit 2 on errors), print the JSON Schema, create the file, or have the window run an action. |
| `hooks [ls\|runs\|test ID\|log RUN]` | Your hooks, their recent runs, a test run with its output, a run's output. |
| `completion zsh\|bash\|fish` | Shell completion, generated from the same table as the verbs, with conversation, workspace, action and hook names asked of the Runner. |

The flag forms the test client always had keep working: `send --session S
--text T`, `open --cwd D`, `approve --request R --decision accept`, `wait --id
COMMAND`, and `events`, `exec`, `read`, `cancel`, `output`, `close`,
`continue`, `answer`, `interrupt`, `info`, … (`lazybox` with no arguments
lists them).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | done |
| 1 | failed (the Runner refused, the turn failed, the hook failed) |
| 2 | usage or validation error (bad flags, an ambiguous name, an invalid actions file) |
| 3 | not found (conversation, workspace, request, action, hook) |
| 4 | not allowed: a scoped credential (agent, terminal, hook) or a refused token |
| 5 | timed out (`wait`, a window that did not answer) |
| 6 | unavailable: no Runner answers, none is registered, or no Lazybox window is open for `open`/`shot`/`actions run` |

### An installed release

These act on the release this `lazybox` belongs to (`v2/INSTALL.md`); a Dev or
Working build says so and exits 6.

| Verb | What |
| --- | --- |
| `--version`, `version` | The release; app, CLI and Runner carry the same one |
| `service [status]` | Installed? loaded? running (pid)? answering, with which version? Exit 6 when it is not answering |
| `service install` | Write the launchd job (`~/Library/LaunchAgents/ai.lazybox.runner.plist`) and start it; on a loaded job, replace it: the old Runner detaches its agents, the new one re-attaches them. Also refreshes the PATH agents get, from your login shell |
| `service start`, `stop`, `restart` | Load or kickstart; unload (until the next login); a fresh Runner. Agents keep running throughout |
| `service logs [-f] [--lines N]` | `~/Library/Logs/Lazybox/runner.log` |
| `service plan` | The plist `install` would write, written nowhere |
| `service uninstall` | Unload and remove the job and the CLI locator; data stays |
| `doctor` | Release, service, endpoint (and its mode), versions, Node, Claude worker, Claude Code, Codex, git, gh, GitHub connection, disk, `lazybox` on PATH; each with its fix. Exit 1 when a check fails |
| `link [--dir DIR] [--shell S]` | Link this CLI into `/usr/local/bin` (when writable without sudo) or `~/.local/bin`, with completions; never replaces another program without `--force` |
| `uninstall [--dry-run] [--remove-data [--yes]]` | Remove the service, links and completions it created; with `--remove-data`, also state, workspaces, logs and the app's window state, after typing `delete` |

`lazybox schema [actions|process|workspace|theme] [--write DIR]` prints (or
writes, for an editor) the JSON Schemas of the files a person writes. They
ship with the CLI and are identified by `urn:lazybox:schema:…` ids, never a
web address; a process file names `process.schema.json` beside it.

`LAZYBOX_SERVICE_LABEL` selects another launchd label, with state, logs and a
locator of its own: the release smoke test installs a test service that way.

### Completions

```sh
lazybox completion zsh  > "${fpath[1]}/_lazybox"            # or: source <(lazybox completion zsh)
lazybox completion bash > ~/.local/share/bash-completion/completions/lazybox
lazybox completion fish > ~/.config/fish/completions/lazybox.fish
```

## Debugging an agent headlessly

An agent (or you, from any terminal) can drive and observe Lazybox without the app:

```sh
lazybox ls --json | jq '.workspaces[].conversations[] | {title, state}'
lazybox send "Alpha/fix the tests" "Run the suite again"
lazybox watch "fix the tests" --json | jq -c 'select(.type=="turn_ended")'
lazybox wait "fix the tests" --until idle --timeout 20m && lazybox debug "fix the tests"
```

## Security

Owner verbs need the owner's endpoint (`<state>/endpoint.json`, 0600). An
agent's credential reaches only its own console (`run`, `log`), its own
commands (`ls`, `stop`) and its own workspace's artifacts (`artifact`); a
workspace terminal's only its own runs;
a hook's only what its file grants (`read`, `respond`, `start` — what a paired
phone with those grants may do, less `Info`). None of them gains a verb from
this CLI: the Runner enforces the allowlists (`internal/transport/auth.go`,
`hook_auth.go`), and every new RPC is owner-only.

## Other verbs

In a Lazybox workspace terminal no flag is needed: `cmd 2>&1 | lazybox log
[--title CMD] [--to CONVERSATION]` and `lazybox run [--to CONVERSATION] --
cmd` publish to the workspace's console with the terminal's own credential.
See `v2/TERMINALS.md` and `v2/COMMAND_OUTPUT.md`.

`lazybox run` moves a server or watcher to the background once it has run
20 seconds and listens on a TCP port or looks like one (`npm run dev`,
`docker compose up`, `--watch`): it returns at once with the command's id,
URL, latest output and output file, and the command keeps running and
streaming to the console. `--wait` keeps it in the foreground until it exits
(`--wait=2m` waits that long first); `--background` moves it as soon as it has
started. `lazybox stop ID` stops it (`v2/COMMAND_OUTPUT.md`, "Servers and
watchers").

`lazybox artifact put|get|list` publishes and reads workspace artifacts
(`v2/ARTIFACTS.md`).

`lazybox process validate|show|explain EVENT|events|schema` checks the
orchestration process file (`.lazybox/process.yaml`, see
`v2/ORCHESTRATION.md` §4) from files alone; with `--workspace` it asks the
Runner. It is implemented in `internal/process`.
