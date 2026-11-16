# Configuration files

Lazybox reads three YAML files and your theme files. Two are committed to your
repositories and reviewed like code; the rest are yours.

| File | Lives in | Who edits it | What it does |
| --- | --- | --- | --- |
| [`.lazybox/workspace.yaml`](#lazyboxworkspaceyaml-setup-and-actions) | each repository | the team, by PR | setup, dev servers and archive scripts for every new workspace |
| [`.lazybox/process.yaml`](#lazyboxprocessyaml-how-missions-run) | each repository | the team, by PR | how missions run: roles, gates, budgets (**Preview**) |
| [`actions.yaml`](#actionsyaml-your-actions-and-hooks) | `~/.config/lazybox/` | you | your own actions and hooks |
| [Theme files](#themes) (`*.toml`, `*.json`) | `<Runner state>/themes/` | you | your own colour themes |

Most other settings live in the app (Settings), not in files.

**Editor completion.** Each YAML file has a JSON Schema. Point your editor at it with
a first line such as `# yaml-language-server: $schema=<path or URL>` (the YAML
extension of VS Code and most editors understand it).

## `.lazybox/workspace.yaml`: setup and actions

Schema: [`workspace.schema.json`](../../services/runner/code/internal/runner/workspaceruntime/workspace.schema.json).
Guide: [Run your app](../guides/run-your-app.md).

```yaml
version: 1                      # optional
setup: |                        # once per new worktree, after files are copied
  npm ci
archive:                        # before the workspace is deleted
  run: docker compose down -v
  timeout: 60                   # seconds; 120 by default
files:                          # copied from your checkout, never overwriting
  - .env
  - config/*.local.json
env:                            # for every script and action of this repository
  API_URL: http://localhost:$LAZYBOX_PORT_1
actions:
  web:
    run: npm run dev -- --port $LAZYBOX_PORT
    url: http://localhost:$LAZYBOX_PORT
    default: true               # what Run starts
    concurrent: false           # one workspace at a time
  api:
    run: go run ./cmd/api
    port: 1                     # this action's $LAZYBOX_PORT is the block's port 1
    cwd: services/api
    env: { LOG_LEVEL: debug }
  test: npm test                # a string is just `run`
```

| Key | Meaning |
| --- | --- |
| `setup` | Shell run once in each new worktree, after `files` are copied. |
| `archive` | Shell (or `{run, timeout}`) run before the workspace is deleted. A failure does not keep the workspace. |
| `files` | Paths or globs copied from your original checkout into the worktree, never overwriting. |
| `env` | Variables for every script and action of this repository. `$LAZYBOX_*` is expanded. |
| `actions.<name>` | A command string, or `run`, `url`, `port` (0–9 in the block), `cwd`, `env`, `default`, `concurrent`. |

**Variables** every script and action gets:

| Variable | Value |
| --- | --- |
| `LAZYBOX_PORT` | The action's port (`LAZYBOX_PORT_<port>`, port 0 by default) |
| `LAZYBOX_PORT_0` … `LAZYBOX_PORT_9` | The workspace's block of 10 ports |
| `LAZYBOX_WORKSPACE_ID`, `LAZYBOX_WORKSPACE_NAME`, `LAZYBOX_WORKSPACE_ROOT` | The workspace |
| `LAZYBOX_REPOSITORY`, `LAZYBOX_WORKTREE` | This repository's name and worktree folder |
| `LAZYBOX_ROOT_PATH` | The checkout the worktree was made from |

**Rules.** Scripts run in your login shell, in the worktree (or `cwd`). Decoding
is strict: an unknown or misspelt key is refused with its line, and nothing from
that file runs. Names are lowercase `[a-z0-9._-]`; `cwd` and `files` stay inside
the repository; `url` must point at this machine; `LAZYBOX_*` cannot be
overridden. Limits: 64 KiB, 32 actions, 64 files and 64 variables. **Nothing
runs until you approve the file's exact version** in Lazybox. In a workspace of
several repositories, each reads its own file and actions are named
`<repository>/<name>`.

**Just for you:** Settings → Workspaces takes the same YAML per repository
(no approval needed — you wrote it), plus the port range, the default action and
*skip setup*.

## `.lazybox/process.yaml`: how missions run

> **Preview.** You can write and check this file today, but missions do not read
> it yet: every mission runs the built-in *solo pair* process. See
> [Missions](../guides/missions.md).

Schema: [`process.v1.json`](../../services/runner/code/internal/process/schema/process.v1.json)
(also printed by `lazybox process schema`). Built-in presets:
[`solo-pair`](../../services/runner/code/internal/process/presets/solo-pair.yaml),
[`reviewed-team`](../../services/runner/code/internal/process/presets/reviewed-team.yaml),
[`factory`](../../services/runner/code/internal/process/presets/factory.yaml).

A repository's file starts from a preset and changes only what it sets:

```yaml
version: 1
extends: solo-pair
budgets:
  task: {usd: 5, retries: 2}
roles:
  worker:
    provider: codex
```

Check it from the repository, no Runner needed:

```sh
lazybox process validate              # schema and semantic checks, with line numbers
lazybox process show                  # the effective process, presets and your file combined
lazybox process explain task.reported # what fires on an event, in order
lazybox process events                # the events a process may name
```

A repository file can never raise autonomy, budgets, permissions or providers
above your own ceiling (set in Settings → Process). The full model — phases,
gates, roles, rules, conditions in CEL — is in the
[orchestration design](../../ORCHESTRATION.md#4-the-process-file).

## `actions.yaml`: your actions and hooks

Location: `~/.config/lazybox/actions.yaml` (`$XDG_CONFIG_HOME/lazybox/actions.yaml`
when set); `lazybox actions path` prints it. Create it with **Settings → Actions
& hooks → Create actions.yaml** or `lazybox actions init`, which also writes
`actions.schema.json` beside it and points the file at it. Schema in the source:
[`actions.schema.json`](../../services/runner/code/internal/power/actions.schema.json).
Guide: [Automate](../guides/automate.md).

```yaml
version: 1
actions:
  - id: test-then-fix
    title: Run the tests, ask the agent to fix failures
    key: t                                  # ]] t
    where: [palette, menu, conversation]
    steps:
      - run: test                           # a workspace action
      - when: failed
        send: The tests failed. Read the output in the console and fix them.
      - when: succeeded
        open: changes
  - id: review
    title: Ask for a review in a new conversation
    confirm: true
    steps:
      - send: {snippet: deepreview, to: new, wait: true}
      - open: changes
hooks:
  - id: notify
    on: agent.needs-input
    run: [terminal-notifier, -title, Lazybox, -message, needs you]
  - id: slack-on-failure
    on: [turn.failed, pr.checks-failed]
    filter: {repository: "acme/*"}
    webhook: {url: "https://hooks.slack.com/services/T000/B000/XXXX"}
  - id: log-done
    on: turn.done
    shell: 'echo "$LAZYBOX_EVENT_TITLE finished" >> ~/lazybox-done.log'
    timeout: 30s
```

### Actions

| Field | Meaning |
| --- | --- |
| `id` | Lowercase letters, digits, dashes; unique. |
| `title`, `description`, `icon` | What menus show (`title` defaults from the id). |
| `key` | One key after the `]]` leader (`t`, `7`, `Shift+t`). A key already taken is ignored and reported in Settings. |
| `where` | Any of `palette`, `menu` (the `]]` menu), `conversation` (its menu), `workspace` (its row's menu). Default `[palette, menu]`. |
| `confirm` | Ask before running. |
| `steps` | 1–20 steps, run in order. |

| Step | Forms | Succeeds when |
| --- | --- | --- |
| `send` | `send: text` · `send: {text \| snippet, to: current \| new \| <conversation>, wait: true}` | the message is accepted; with `wait`, the turn ends without failure |
| `open` | `open: changes` (a panel) · `open: https://…` · `open: {file: api/README.md, line: 3}` | always |
| `run` | `run: <workspace action>` | the action exits 0 (its script approval still applies) |
| `command` | `command: npm test` | the command exits 0 (refused in read-only conversations) |
| `permission` | `permission: ask \| read-only \| yolo` | the conversation accepts the change |
| `wait` | `wait: idle \| needs-input` · `wait: {until, timeout}` | the state is reached in time |

Every step may also have `name:`, `timeout:` and `when: always | succeeded |
failed`. A `when:` step reacts to the last step before it that has no `when:`.

### Hooks

| Field | Meaning |
| --- | --- |
| `id`, `description` | As for actions. |
| `on` | One or more of `agent.needs-input`, `turn.done`, `turn.failed`, `pr.checks-failed`, `mission.accepted`. |
| `filter` | `workspace`, `conversation` (name or title), `repository` (`owner/name`); `*` and `?` wildcards, case-insensitive; all set filters must match. |
| `run` / `shell` / `webhook` | Exactly one: a program and its arguments (no shell); a line for `/bin/sh -c`; or a URL / `{url, headers}` that receives the event as a JSON `POST`. |
| `grants` | `read`, `respond`, `start` — a Lazybox credential for the hook's own `lazybox` calls, live only while it runs. None by default. |
| `timeout` | Default `1m`, at most `10m`. |
| `enabled` | Default `true`. |

Limits: 256 KiB, 100 actions, 50 hooks. Lazybox rereads the file every second.
An entry with a mistake is left out and reported with its line; a save that is
not YAML at all keeps the last version that loaded. Check a file with
`lazybox actions validate [FILE]` (exit 2 on errors).

## Themes

A theme is a `.toml` or `.json` file in the Runner's themes folder,
`<Runner state>/themes` (`themeDirectory` in the Runner configuration moves it).
Settings → Appearance shows the folder (**Copy path**) and **New theme from
current** writes a starting file. Saved changes apply within seconds, in every
window. Guide: [Appearance](../guides/appearance.md#your-own-themes).

```toml
name = "Midnight"
appearance = "dark"        # "dark" or "light": which mode lists it
extends = "dark"           # optional: a built-in theme to start from

[tokens]                   # a few base colours; the rest are derived
bg = "#05060a"
surface = "#0b0d14"
"surface-raised" = "#121522"
line = "#252a3a"
text = "#e8ecf5"
"text-muted" = "#8b93a7"
accent = "#5eb1ff"

[typography]               # optional suggestions; the person's settings win
density = "compact"
chatLineHeight = 1.4
```

| Key | Meaning |
| --- | --- |
| `name` | What Settings shows. |
| `appearance` | `dark` or `light`. |
| `extends` | Optional built-in theme to start from: `dark`, `light`, `dark-high-contrast` or `solarized-light`. |
| `[tokens]` | Colour tokens by name. Set the base ones (marked in Settings → Appearance → **Token reference**, which lists every token with its meaning and current value); the others derive from them. |
| `[typography]` | Optional suggestions such as `density` and `chatLineHeight`. |

Colours are `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `hsl()` — nothing else,
so a theme cannot inject CSS. There is no JSON Schema for theme files yet:
Settings checks a saved file and lists each problem, with a suggestion for a
misspelt token, and keeps the last good version on screen.
