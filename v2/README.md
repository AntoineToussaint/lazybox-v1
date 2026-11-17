# Lazybox V2

**One window for all your coding agents, across all your workspaces — and the
place you check their work before it lands.** Lazybox V2 is for people who run
Claude and Codex all day: it keeps every agent of every workspace in view, shows
what each one actually did, and keeps them running when the app or its Runner
restarts.

> **Preview.** V2 installs as a Mac app ([INSTALL.md](docs/install.md)) once its
> first release is published; until then, build it from source on macOS. The
> `lazybox` formula on Homebrew is V1, the terminal PR inbox
> ([its docs](https://lazybox.ai/docs/)).

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/hero-light.webp">
  <img src="docs/images/hero.webp" alt="Lazybox V2: Workspaces above the Agents list on the left, a conversation with the agent's work folded into readable lines, its plan, and the artifact it published">
</picture>

## What you get

**Many agents, one window.** Workspaces of one or several repositories, each
in its own git worktrees, each with as many Claude or Codex conversations as you
like. The inbox (`]] i`) and `⌘J` take you to whichever needs you next; toasts,
sounds and notifications tell you when.

**A chat at least as good as the agent's own terminal.** Questions as option
cards, approvals that show exactly what will run, with *Allow once*, *Always
allow* and *Deny with a reason*. Tool calls fold into readable lines; sub-agents
are live cards you can open or stop. [Work in the chat →](docs/guides/chat.md)

<img src="docs/images/chat-decisions.webp" width="49%" alt="An agent's question as option cards"> <img src="docs/images/subagents.webp" width="49%" alt="Sub-agent cards with their live step, time and tokens">

**Verify before you trust.** Review every change in a split diff, leave inline
comments the agent receives as one message, have another agent review it
read-only (Codex checks Claude's work, and the other way round), undo any agent
turn from its checkpoint, then commit, push, open the pull request, watch its
checks and merge — without leaving the app. [Review an agent's work →](docs/guides/review-agent-work.md)

<img src="docs/images/agent-review.webp" width="49%" alt="Codex's findings on Claude's change: the Review tray to triage them, a finding's card on its lines"> <img src="docs/images/pr-loop.webp" width="49%" alt="The pull request card with its checks, failing first">

**Missions with evidence, and agents that run agents** *(preview)*. Split a
goal into tasks across conversations; Lazybox records the runs, commits and
checks behind each one, so *claimed* and *verified* never look the same. Or let
one conversation run the mission: it proposes a plan you approve, starts an
agent per task within a budget and the limits you set, and its agents' approvals
still come to you. [Missions →](docs/guides/missions.md) · [Let an agent run agents →](docs/guides/orchestrator.md)

<img src="docs/images/orchestrator.webp" width="49%" alt="An orchestrator's conversation and its agents nested under it in the Agents list"> <img src="docs/images/missions.webp" width="49%" alt="The missions board: the orchestrator above the columns, each card with its trust and evidence">

**Run your app per workspace.** A committed `.lazybox/workspace.yaml` gives every
workspace its setup, its dev server on its own ports, and a Preview beside the
chat; a Web panel browses docs and PRs in place. [Run your app →](docs/guides/run-your-app.md)

**An agent browser you watch.** Agents get their own Chromium — never your
Chrome — and you see every step live beside the chat: the page, a cursor on
what it clicks, an action log. New sites, downloads and sign-ins ask you
first, even in full access; take it over, give it back or stop it at any
time. [Agent browser →](docs/guides/agent-browser.md)

<img src="docs/images/workspace-runtime.webp" width="49%" alt="The Actions panel with a dev server running on the workspace's ports"> <img src="docs/images/console-log.webp" width="49%" alt="The console reading three services' output as a log: times, sources with chips, levels and milestones">

**Agents outlive everything.** Close the window, restart the Runner, install a
new build: agents and the commands they started keep running, and Lazybox picks
them up where they were.

**And:** Gemini CLI, Goose, OpenCode and any other ACP agent as first-class
conversations ([guide](docs/guides/other-agents.md)) · several subscriptions with automatic switching at a limit
([guide](docs/guides/subscriptions.md)) · versioned plans and reports as
[artifacts](docs/guides/artifacts.md) · your phone as a remote, paired by QR
code over Tailscale *(preview)* ([guide](docs/guides/phone.md)) · light, dark and your own
themes ([guide](docs/guides/appearance.md)) · voice: hold `⌥Space` to dictate,
say commands, hear replies — on-device on the Mac ([guide](docs/guides/voice.md)) · a `lazybox`
CLI that does what the app does, plus your own actions and hooks in one YAML
file ([guide](docs/guides/automate.md)) · panels of your own — a board, a dashboard — sandboxed, doing only what you
allowed ([guide](docs/guides/extensions.md)).

## Install

**[INSTALL.md](docs/install.md)**: the disk image or `brew install --cask
AntoineToussaint/lazybox/lazybox-v2`, the first run (the background Runner and
the `lazybox` command), updates, `lazybox doctor` and uninstalling. Building
from source, for Dev and Working: [Getting started](docs/getting-started.md#build-from-source).

## Quick start

1. **Welcome.** The first launch offers to connect a subscription (your `claude`
   or `codex` sign-in already works) and to add a repository.
2. **First workspace:** `]] w`, find your repositories (a local folder, or GitHub
   with a personal token), select, **Create workspace**.
3. **First agent:** `]] c`, choose Claude or Codex and *Ask for approval*,
   **Start**, and type what you want.
4. **Check its work:** `]] d` opens Changes.

| Key | Does |
| --- | --- |
| `⌘K` | Command palette — every action, conversation, workspace and file |
| `⌘J` / `⇧⌘J` | Next / previous conversation that needs you |
| `⌘1` … `⌘9` | Go to workspace 1…9 |
| `]]` | The leader: from the message box, opens a menu of every next key |
| `?` | All shortcuts, with your keys |

## Documentation

**[The V2 docs](docs/README.md)** — getting started, concepts, guides,
[keyboard shortcuts](docs/reference/keyboard-shortcuts.md),
[the CLI](docs/reference/cli.md),
[configuration files](docs/reference/configuration.md),
[troubleshooting](docs/troubleshooting.md) and the [FAQ](docs/faq.md).

## Contributing

`make -C v2 dev` for a hot-reloading Dev app, `make -C v2 check` before you
push, `make -C v2 help` for every target. Design notes, audits, the roadmap and
test evidence are indexed in [internal docs](docs/internal/README.md);
repository-wide rules are in [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md). Questions and bugs: [SUPPORT.md](../SUPPORT.md);
security reports: [SECURITY.md](../SECURITY.md).
