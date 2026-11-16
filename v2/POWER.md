# Power users: CLI parity, actions, hooks

Lazybox is for power users: more integration, still customizable, without
handing anyone's code the keys. herdr gets its power from unsandboxed
JavaScript mods ([audit](audits/2026-11-16/herdr-gui.md#what-not-to-copy));
Lazybox gets it from three declarative, scoped pieces:

1. **The `lazybox` CLI can do what a person does in the app**, with the
   owner's credential from their own terminal ([CLI reference](services/runner/code/cmd/lazybox/README.md)).
2. **Actions**: named sequences of steps in one YAML file, offered in the app's
   menus and run with the owner's own rules.
3. **Hooks**: programs, shell lines or webhooks the Runner starts on events,
   as managed commands, with no Runner credential unless granted one.

## The file

`~/.config/lazybox/actions.yaml` (`$XDG_CONFIG_HOME/lazybox/actions.yaml`
when set). The Dev and Working launchers pass it to their Runners
(`LAZYBOX_V2_ACTIONS_FILE`, or `actionsFile` in the Runner config), so one
file serves both. A Runner started any other way (`make run`, tests) reads
`<state>/actions.yaml`, never the person's home.

- **Create it** from Settings → Actions & hooks → *Create actions.yaml*, or
  `lazybox actions init`. Both write a commented starter and
  `actions.schema.json` (JSON Schema 2020-12) beside it, which the starter's
  `# yaml-language-server: $schema=./actions.schema.json` line hands to your
  editor for completion and checking. An existing file is never replaced.
- **Hot reload.** The Runner rereads the file every second
  (`internal/power/manager.go`); the app picks up the change on its next poll.
- **Mistakes are local.** An entry with an error is left out and reported with
  its line (Settings, `lazybox actions validate`); the others load. A save that
  is not YAML at all keeps the last version that loaded in force, marked
  stale, so a typo mid-edit never takes your actions away.
- Limits: 256 KiB, 100 actions, 50 hooks, 20 steps per action.

```yaml
version: 1
actions:
  - id: test-then-fix
    title: Run the tests, ask the agent to fix failures
    key: t                       # ]] t
    where: [palette, menu, conversation]
    steps:
      - run: test                # a workspace action (Actions panel)
      - when: failed
        send: The tests failed. Read the output in the console and fix them.
      - when: succeeded
        open: changes
hooks:
  - id: notify
    on: agent.needs-input
    run: [terminal-notifier, -title, Lazybox, -message, needs you]
```

## Actions

| Field | Meaning |
|---|---|
| `id` | lowercase letters, digits, dashes; unique |
| `title`, `description`, `icon` | what the menus show (`title` defaults from the id) |
| `key` | one key after the `]]` leader (`t`, `7`, `Shift+t`); a key a built-in or a `]]` snippet entry already uses is ignored and reported in Settings |
| `where` | any of `palette`, `menu` (the `]]` which-key menu), `conversation` (its menu), `workspace` (its row's menu); default `[palette, menu]` |
| `confirm` | ask before running |
| `steps` | 1–20 steps, run in order |

Each step does one thing, optionally named (`name:`), bounded (`timeout:`)
and conditional (`when: always | succeeded | failed`). A conditional step
reacts to the **last unconditional step** before it, so "run the tests → when
failed: send a fix request → when succeeded: open changes" branches on the
tests both times. A failed unconditional step ends the action unless a
`when: failed` step follows it (before the next unconditional step); a failing
branch step ends it; unconditional steps after a handled failure still run,
and the result then reads "Done · a failure was handled":

| Step | Forms | Succeeds when |
|---|---|---|
| `send` | `send: text` · `send: {text \| snippet, to: current \| new \| <conversation>, wait: true}` | the message is accepted; with `wait`, the turn ends without failure |
| `open` | `open: changes` (a panel) · `open: https://…` · `open: {file: api/README.md, line: 3}` | always |
| `run` | `run: <workspace action key>` | the action's command exits 0 — its scripts' approval still applies |
| `command` | `command: npm test` | the managed command exits 0 (refused in read-only conversations, as always) |
| `permission` | `permission: ask \| read-only \| yolo` | the conversation accepts the change |
| `wait` | `wait: idle \| needs-input` · `wait: {until, timeout}` | the state is reached in time |

Actions run in the app, with the owner's authority and the same rules a click
has: nothing in the file can do what the person could not. The built-in
action registry (`actions.ts`) is a fixed list, so the person's actions live
in a small store beside it (`packages/surfaces/src/user-commands.ts`): the
command palette lists them ("Your action", with their `]]` key), right-click
on a workspace row, a conversation row or a conversation header adds a
*Your actions* submenu, the `]]` menu binds their keys, `]] x` opens a
*Run an action…* picker, and Settings lists them with a Run button.
`lazybox actions run <id>` asks the open window to run one. A running action
shows a quiet progress card (bottom right) with Cancel; a failure stays until
closed, with the step and the reason.

## Hooks

| Field | Meaning |
|---|---|
| `id`, `description` | as for actions |
| `on` | one or more of `agent.needs-input`, `turn.done`, `turn.failed`, `pr.checks-failed`, `mission.accepted` |
| `filter` | `workspace`, `conversation` (name or title), `repository` (`owner/name`); `*` and `?` wildcards, case-insensitive; every filter set must match |
| `run` / `shell` / `webhook` | exactly one: a program and its arguments (no shell), a line for `/bin/sh -c`, or `{url, headers}` |
| `grants` | `read`, `respond`, `start` — a Runner credential for the hook's own `lazybox` calls (below) |
| `timeout` | default 1m, at most 10m |
| `enabled` | default true |

**Events.** The Runner looks for them every second (`internal/runner/power.go`):
a new pending approval or question; the main agent's turn ending (done or
failed; an interrupt you sent fires nothing); a fault; a pull request's checks
failing on its latest head (when Lazybox reads the PR, as the Changes panel and
missions do); a person passing a mission task's gate. A Runner restart replays
nothing: what was already there when it started is its baseline. Each event
runs each matching hook once.

**What a program receives.** The event as JSON in `$LAZYBOX_EVENT_FILE`, and
`LAZYBOX_EVENT`, `LAZYBOX_EVENT_SUMMARY`, `…_REASON`, `…_WORKSPACE(_NAME)`,
`…_CONVERSATION`, `…_SESSION`, `…_TITLE`, `…_REQUEST`, `…_PR_URL`,
`…_PR_REPOSITORY`, `…_MISSION`, `…_TEST`. Values an agent can influence (a
conversation title, the last line) arrive only as variables and JSON, never
spliced into a command line: quote them (`"$LAZYBOX_EVENT_TITLE"`) and a hook
cannot be injected. The environment is yours minus the Runner's wiring (every
`LAZYBOX_V2_*` and `CODEFLY*`), with the `lazybox` CLI first on `PATH`. The
working directory is the event's workspace. A webhook receives the same JSON
as a `POST` with `X-Lazybox-Event`; header values are never shown in Settings.

**Where it runs.** Every run is a managed command of the event's workspace
(`kind: hook`): it appears in Processes while it runs, its output (or a
webhook's request and response) is kept like any command's, and Settings →
Actions & hooks lists the last 100 runs with state, exit or HTTP status and
log. No conversation's console lists them. Events outside a workspace (Ask
Lazybox) run no hook. A hook runs at most 10 times a minute and 4 hooks at
once; the rest are recorded as skipped, with the reason — a `turn.done` hook
that sends a message cannot loop away.

**Test** in Settings (or `lazybox hooks test <id>`) runs a hook now with a
sample event from your newest conversation, marked `"test": true`.

### Credentials

Without `grants`, a hook holds no Runner credential at all: the owner's is
never given, and an inherited one is stripped. With `grants`, the run gets its
own `LAZYBOX_V2_ENDPOINT` with a credential that:

- reaches exactly what a [paired phone](REMOTE.md#what-a-device-may-call)
  with the same grants reaches, less `Info` — `read`: list and read
  conversations, workspaces, changes, commands; `respond`: send, steer,
  answer, approve or decline, interrupt (never a permission change); `start`:
  open or resume a conversation in an existing workspace;
- is bound to that run and its grants (HMAC under the Runner's credential key),
  works only while the run is live, and is revoked with its endpoint file when
  the run ends;
- never reaches settings, files, terminals, processes, devices, the actions
  file, hook runs or the window requests (`TestHookCredentialReachesOnlyItsGrantsWhileItRuns`
  walks every RPC).

## The CLI and the open window

`lazybox open`, `lazybox shot` and `lazybox actions run` ask the person's open
window to act (`PostUiRequest` → `WatchUiRequests` → `CompleteUiRequest`,
`internal/power/broker.go`). Only the main workspace window follows them; a
desktop window is preferred over a browser tab, then the most recently opened.
With no window open the CLI says so at once (exit 6). The request stream holds
one connection; a browser allows six to the Runner, so a browser tab joins
only 3 seconds after it opens and while it is visible (the desktop's native
fetch has no such limit). `shot` uses the desktop
webview's own snapshot (`apps/desktop/src-tauri/src/capture.rs`, WKWebView
`takeSnapshot`): Lazybox only, pixel-exact, no screen-recording permission; a
panel is cropped by its rectangle, scaled for the page zoom. A browser tab
cannot take one and says so. All of it is owner-only: an agent cannot take a
screenshot of your screen.

**Finding the Runner from any terminal.** The launchers record each
environment's endpoint locator in `~/.config/lazybox/runners/<dev|working>.json`
(no credential: the path of the private `endpoint.json`). `lazybox` uses
`--endpoint`, then `LAZYBOX_V2_ENDPOINT`, then `--runner NAME` /
`LAZYBOX_RUNNER`, then those locators (Working when both run). Inside an
agent or a Lazybox terminal it never falls back to them: those keep their
scoped credentials and allowlisted verbs. That is defense in depth, not a
boundary: an agent runs as your OS user ([resource ownership](RESOURCE_OWNERSHIP.md#agent-credentials)).

## Several Runners

See [several Runners in one window](MULTI_RUNNER.md): the design, and the first
step shipped here (`lazybox runners`, `lazybox ls --all`).

## Verification

- Go: `internal/power` (every step and hook form, faulty entries left out with
  their line, last good version kept on a broken save, Init never replacing,
  hot reload, schema in step with the parser, dispatch filters, once per event,
  rate and concurrency limits, the environment dropping Runner wiring and
  carrying titles uninterpreted, broker routing, timeouts and closed windows);
  `internal/transport` (hooks on needs-input and turn end as managed commands
  out of every console, the event file, PR checks and mission acceptance once
  each, webhook body/headers/log and failure, the hook credential walked over
  every RPC and revoked at the end, the actions RPCs, the window round trip;
  the agent, terminal and device allowlist tests cover every new RPC);
  `cmd/lazybox` (every verb against a test Runner; see the CLI README).
- UI: `scripts/user-actions.test.ts` (the executor) and `test:power-actions`
  (Playwright against the fake Runner).
- Desktop: `capture.rs` region scaling and clipping (`cargo test`).

**Known gaps:** `WatchEvents` does not put an accepted operation's kind on the
wire, so `lazybox watch`/`debug` infer it (text → message, a request id → a
response, otherwise "control"). `lazybox open FILE:LINE` needs a workspace
(`--workspace`, the terminal's own, or the only one).

**Not verified:** a real WKWebView snapshot and window focus (no desktop app
was run; `capture_window` is compiled and its geometry unit-tested only), a
real Slack or other webhook endpoint, hooks under the tmux process backend.
