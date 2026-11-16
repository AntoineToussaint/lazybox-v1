# Lazybox V2 documentation

Lazybox is one window for many coding agents across your workspaces — and the
place you check their work before it lands. These pages are for people **using**
Lazybox V2. They describe what is on the `feat/v2-command-output` branch today;
anything marked **Preview** works but is incomplete or not yet packaged.

> **V2 is a preview.** There is no installer yet: you build it from source on
> macOS ([Getting started](getting-started.md)). The released `lazybox` you get
> from Homebrew is V1, the terminal inbox — its docs are at
> [lazybox.ai/docs](https://lazybox.ai/docs/).

## Start

- **[Getting started](getting-started.md)** — install, first workspace, first
  agent, and the five keys worth learning on day one.
- **[Concepts](concepts.md)** — the Runner, workspaces, conversations,
  sub-agents, missions, artifacts and subscriptions, in one page.

## Guides

Task by task:

| I want to… | Guide |
| --- | --- |
| Work with an agent: answer its questions, approve, follow sub-agents | [Work in the chat](guides/chat.md) |
| See less (or more) of what the agent ran | [Activity detail](guides/activity-detail.md) |
| Check what an agent changed, comment, undo a turn, open and merge a PR | [Review an agent's work](guides/review-agent-work.md) |
| Run my app per workspace and look at it beside the chat | [Run your app](guides/run-your-app.md) |
| Track a goal across several conversations, with evidence | [Missions and evidence](guides/missions.md) |
| Keep plans and reports as versioned pages | [Artifacts](guides/artifacts.md) |
| Use several Claude or Codex accounts, and survive limits | [Subscriptions and limits](guides/subscriptions.md) |
| Answer my agents from my phone | [Pair your phone](guides/phone.md) |
| Arrange panels, pages and windows | [Layouts and docking](guides/layouts.md) |
| Switch to light, make my own theme, change fonts, zoom, notifications | [Appearance and notifications](guides/appearance.md) |
| Script Lazybox, add my own actions and hooks | [Automate with the CLI, actions and hooks](guides/automate.md) |

## Reference

- [Keyboard shortcuts](reference/keyboard-shortcuts.md) — generated from the
  app's action registry, so it always matches the defaults.
- [The `lazybox` CLI](reference/cli.md) — every command, exit codes, completions.
- [Configuration files](reference/configuration.md) — `.lazybox/workspace.yaml`,
  `.lazybox/process.yaml`, `~/.config/lazybox/actions.yaml`, with examples and
  their JSON Schemas.

## When something is wrong

- [Troubleshooting](troubleshooting.md) — `lazybox debug`, limits, provider
  errors, interrupted turns, a Runner that restarted.
- [FAQ](faq.md) — including "is Lazybox a terminal?" (no).

## Contributing

The design notes, audits, plans and test evidence behind V2 are indexed in
[internal docs](internal/README.md).
