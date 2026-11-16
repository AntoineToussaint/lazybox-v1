# Lazybox V2 and herdr: the GUI, side by side — 2026-11-16

The [audit README](README.md) compares the two at a feature level. This
note compares the **interfaces**: what a person sees and touches in herdr's
desktop and phone apps, against the Lazybox V2 desktop/web UI on
`feat/v2-command-output` at `9c234e28` (missions slice 1 included). It ends
with a prioritized list of UI changes.

Method. herdr: its site, the `herdrdev/herdr-app` repository (README,
`CHANGELOG.md`, the shipped `defaults/` folder: `AGENTS.md`, `keys.json`,
layouts and the default mods' source), the TUI's README and keyboard docs,
the mobile page, a heise article, a Bitdoze gallery tour and the HN launch
thread. Every claim links its source. Lazybox: code on this branch, with
screenshots taken against the fake Runner (`scripts/fixtures/runner-ui.mjs`
plus `apps/web` through Vite, as the `scripts/test-*.mjs` suites do). The
screenshots are in `v2/.cache/compare-*.png`, which is ignored and not
committed. I did not run the herdr app. Its side comes from documents and
its own source, so anything that depends on how it feels to use is marked
as reported, not observed.

## What herdr is (as of 2026-11-16)

herdr is three products. Only the second one is a GUI.

| Product | What it is | Version / date | Source |
|---|---|---|---|
| **herdr** (TUI) | Rust/ratatui terminal multiplexer with its own server. Uses a tmux-style `ctrl+b` prefix, a sidebar of spaces and agents, and per-pane agent state. | v0.9.5, 2026-10-14; 51.4k stars | [README](https://github.com/herdrdev/herdr), [releases](https://github.com/herdrdev/herdr/releases), [keyboard](https://herdr.dev/docs/keyboard/) |
| **Herdr** (desktop app) | A native GPU app on Zed's **GPUI**, with a Ghostty-based terminal (`crates/ghostty-sys`). It is a client of **herdr-core** (`hc`), which owns every terminal. The whole UI is JSON layouts plus JavaScript "mods" that hot-reload. It does **not** share sessions with the TUI. | 0.1.16, 2026-11-14 (repo created 2026-10-16; 13 releases since 0.1.4 on 10-23); 3.0k stars, 644 open issues | [herdr-app README](https://github.com/herdrdev/herdr-app), [CHANGELOG](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md), [heise, 2026-11-02](https://www.heise.de/en/news/Herdr-desktop-app-A-hub-for-AI-coding-agents-11508175.html) |
| **Herdr mobile** | iPhone, iPad and Android app over SSH to herdr-core. It has an urgency inbox, the real terminal, a key bar, compose and dictation. It does not work with the TUI. | no version given | [herdr.dev/mobile](https://herdr.dev/mobile) |

Company context: Y Combinator ([2026-08-06](https://herdr.dev/blog/herdr-is-joining-y-combinator/)),
then a $6M seed led by Bessemer ([2026-09-08](https://herdr.dev/blog/herdr-raised-a-seed/)).

The one design fact that explains everything below: **herdr never renders an
agent; it renders the agent's terminal.** Claude Code, Codex and the other 20
or so CLIs run unmodified in panes. herdr adds the frame around them:
spaces, tabs, a status per pane, the agents list, notifications and
remote machines. Agent state comes from an open escape sequence, OSC 7501
(`working` / `blocked` / `idle` / `done`). An agent that doesn't emit it
"still runs but shows no status" ([herdr.dev](https://herdr.dev),
[defaults/AGENTS.md § The model](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)).
Lazybox is the opposite: it **owns the conversation** and re-renders it as
chat, approvals, review and evidence. So herdr wins on frame, density and
fidelity, and Lazybox wins wherever understanding what the agent did matters.

## Verdict

As a *window manager for agents*, herdr's GUI is ahead of Lazybox V2 by a
clear margin. These are the points that matter:

1. **The agents list is always on screen and sorted by urgency.** Lazybox
   puts the same information behind an Inbox button that opens a modal.
2. **Every action is one command.** Keys, the palette, the macOS menu bar,
   mods and the CLI all share a single list of commands. Lazybox has a
   six-entry `]]` menu, and file-only Mod+P.
3. **Panes are fully direct-manipulated:** drag to swap, drag to an edge,
   zoom, keyboard swap and resize. Lazybox can dock and collapse panels, but
   it has no zoom, no tabbed stacks and no terminal splits.
4. **The terminal is first-class.** It is Ghostty-grade: find, Kitty
   images, IME, ligatures, and dropping files or screenshots in. Lazybox's
   xterm has only the fit addon.
5. **It ships weekly** with release notes in the app, a welcome screen,
   themes, zoom and fonts. Lazybox is dark-only, with no onboarding and no
   release notes in the app.

Lazybox is ahead on everything **after** the agent stops: reading what it
did, review comments, the PR loop, checkpoints, the editor, Run/Preview,
cost, native OS notifications, missions with evidence, and approvals as UI.
herdr's Changes panel is one list of uncommitted files with a commit box
(its `changes` mod), and it has no approvals, PRs or cost at all.

The blunt part: **Lazybox's chat must be at least as good as the agent's
own TUI, because it replaces it.** It isn't yet. Question options are plain
text above a free-text field (`session-parts.tsx:36`). Tool calls are hidden
in an Activity dialog. Approval offers only "Allow once". herdr users
lose none of this, because they see Claude Code itself. Until the chat
reaches that bar, every herdr user who tries Lazybox will feel a downgrade
in the one surface they use most.

## Side by side

**Ahead** names who leads on that row. "=" means parity. Lazybox paths are
relative to `v2/packages/surfaces/src/` unless they say otherwise.

### Shell, layout, panes

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Model | A space is one repo on one machine. A tab is one task. Panes split right or down and hold terminals or mods ([AGENTS.md § The model](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)). | A workspace holds several repositories. It has up to 8 pages, each a split tree of up to 12 panels (Workspaces, Chat, Command output, Terminal, Changes, Files, Editor, Processes, Actions, Preview, Usage, Missions, Ask Lazybox). | Lazybox for scope (multi-repo); herdr for simplicity | `workspace-model.ts:22-48`, `PanelRegistry.tsx:70-84` |
| Moving panes | Drag a pane by its header dots onto another pane to swap them, or onto an edge to dock it beside, with a landing highlight ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). `pane.swap` and `pane.go` work by keyboard (`cmd-alt-[shift]-arrows`). | Drag a panel header to a left/right/top/bottom dock zone, or use the ⋯ menu "Dock left/right/top/bottom". There is no swap by drag and no keyboard move. "Customize page" mode offers ←/→ swap. | herdr | `usePanelDocking.ts`, `WorkspacePanel.tsx:57-99`, `PageEditor.tsx` |
| Zoom a pane | `pane.zoom` (`cmd-shift-enter`); navigation follows the zoom ([0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | None. A panel can only collapse or close. | **herdr** | grep: no zoom/maximize in `PanelLayout.tsx`, `WorkspacePanel.tsx` |
| Tabs | Every space has tabs (pills with a `+` menu that starts any installed agent). Tabs can be renamed (F2), reordered, selected with `cmd-1..9`, scrolled one at a time, and "settled" (put away). | Panels never stack as tabs. Only the Editor (tabs in 4 groups) and Terminal (one tab per shell) have tabs. Pages are tab-like but can only be created through Customize or JSON. | **herdr** | `WorkspacePanel.tsx`, `EditorArea.tsx`, `TerminalPanel.tsx` |
| Whole-window layouts | `layouts/*.json` is the window itself. It ships Herdr, Terminals and Herdr 98. `cmd-shift-l` cycles layouts. The site's gallery claims 312 community layouts (a 2026-11-08 count said 215) ([guide](https://herdr.dev/guide/), [Bitdoze](https://www.bitdoze.com/herdr-app-layouts-mods/)). | One built-in arrangement per page plus a raw JSON "Layout configuration" import. There are no presets to switch between. | herdr | `PageEditor.tsx`, `Workspace.tsx:360` |
| Escape hatch | `ctrl-alt-shift-escape` always restores the default layout and keys, and cannot be rebound. | "Reset retained layout" appears only when a restore fails. | herdr | `Workspace.tsx:360` |
| Secondary windows | One window; a peek over the tab for sub-agents. | A chat or a whole workspace can be detached into its own native window (desktop) or `window.open` (web), and reattached. | **Lazybox** | `apps/desktop/src-tauri/src/host.rs`, `placement.rs` |

### Sidebar, agent list, agent state

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Structure | Two stacked sidebar blocks. **Spaces** are grouped by machine; worktree spaces nest under their repo; each shows repo, branch, ahead/behind and uncommitted changes. **Agents** is every agent across spaces and machines ([main.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/layouts/main.json), [AGENTS.md § Mods](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)). | One Workspaces list with 3-line rows: name, repositories, and an agent line showing provider · model · status, which truncates to "C." at default width (screenshot `compare-workspace.png`). Conversations are listed **only under the selected workspace, and only if it has more than one**. Rows show no branch and no dirty or ahead state. | **herdr** | `WorkspaceRow.tsx:205-215`, `CollectionPanel.tsx` |
| Sorting | A toggle between **Priority** (needs you > just done > working) and **Grouped by space**. Hovering shows a **pin** that keeps an agent on top in both views. Section headers **fold** and keep a count ([0.1.4](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). Pins are shared with the phone ([0.1.12](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | Workspaces stay in Runner order and conversations in creation order. There is no pin and no fold. Urgency sorting exists only inside the Inbox dialog. | **herdr** | `conversation-model.ts:47`, `Inbox.tsx` |
| States | `working` / `blocked` / `idle` / `done`. `done` means finished while you weren't looking and becomes `idle` once seen. A space or tab shows its most urgent agent (blocked > done > working > idle). | Five tones: busy (spinning ring), waiting (breathing amber dot), failed (red), idle, saved. Unread "review" (lilac) and "failed" (red) dots replace the indicator. Live text ages: "Running a command · 12s", "Running · 2 sub-agents". | = (Lazybox's wording is richer; herdr rolls state up to tab and space) | `live-status.ts`, `LiveIndicator.tsx`, `attention.ts` |
| Coverage | Any program that emits OSC 7501 counts. 22 agent CLIs are detected, and Goose, Cursor, Kimi, Grok and others get their own icons. | Only Claude and Codex, which Lazybox runs itself. | herdr | [herdr.dev/tui](https://herdr.dev/tui/), `NewSessionForm.tsx` |
| Next/prev agent | `cmd-]` / `cmd-[` follow the agents list's own order (`setAgentOrder`). `ctrl-1..9` select a space. | j/k inside the focused sidebar only. There is no global "next agent that needs me". | **herdr** | [keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json), `keyboard.ts:4-52` |

### Attention and notifications

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Inbox | On the desktop, the Priority view of the agents list *is* the inbox, and it is always visible. The phone has a real Inbox (needs you, done, working, idle; a blue unread dot; swipe to pin or mark read; swipe left sends Esc) ([mobile](https://herdr.dev/mobile)). | A header button with a count (amber when urgent) opens a modal dialog grouped as Awaiting acceptance / Needs input / Failed / Ready for review / Working / Done, with j/k/Enter/m and "Mark all seen". | Lazybox for content, herdr for visibility | `Inbox.tsx`, `MissionInbox.tsx`, `compare-inbox.png` |
| OS notifications | A **sound** plus an **in-app toast** (unless you're looking) when an agent is blocked or done. System notifications and the Dock badge come **only from mods** (`notify-send` example; `setBadge`, "Herdr sets none by default"). heise says it "sends a system notification", which the shipped docs contradict ([AGENTS.md § settings](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md), [0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | Native notifications through `tauri-plugin-notification`; clicking one routes to the conversation. Dock badge count, a "(N)" tab title on web, and bursts of more than 3 collapsed into one. Each kind is toggled in Settings → Notifications. Nothing fires for the conversation in a focused window. | **Lazybox** | `apps/desktop/src-tauri/src/attention.rs`, `apps/web/src/browser-host.ts:64-86`, `useAttention.ts:113-159`, `NotificationSettings.tsx` |
| Sound | Bundled `done.mp3` and `request.mp3`, replaceable, with Play buttons in Settings → Alerts. | None (grep: no audio anywhere). | **herdr** | [assets/sounds](https://github.com/herdrdev/herdr-app/tree/master/assets/sounds) |

### Talking to an agent

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Surface | The agent's own TUI in a terminal pane, so nothing is lost. Paste or drag screenshots and files in, and Cmd+V pastes images ([0.1.10](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md), [0.1.15](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | A re-rendered chat: markdown, mermaid, copyable code, clickable file paths, images and attachments with lightbox, prompt navigator, queued follow-ups, Interrupt. | Lazybox for reading; herdr for fidelity | `MessageList.tsx`, `Composer.tsx`, `PromptNavigator.tsx` |
| Questions / approvals | Whatever the agent's TUI does (Claude Code's option pickers, "always allow"). | Question options are listed **as text** above a required free-text input. Approval offers **Decline / Allow once** only. | **herdr (by default)** | `session-parts.tsx:12-41` |
| Tool calls | Inline, as the agent prints them. | Hidden from the transcript, in an "Activity" dialog with search and filters. | herdr | `ToolActivity.tsx`, `transcript-model.ts` |
| Sub-agents | Helpers started with `hc run` show **under their parent** in the agents list. **Peek** (`ctrl/cmd-click` an address like `t7`) opens one over your tab, with "keep as tab" ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | A collapsible "Background work · N running" line. Live sub-agent cards, a tray, a panel and stop are **in flight** (sub-agents branch `8606528d`). | herdr today; Lazybox after that branch | `SessionNotices.tsx:36-56` |
| Telemetry | None. | Context meter by category, compaction reserve, $ estimate, a Usage & cost panel, and subscription limit cards. | **Lazybox** | `TelemetryPanel.tsx`, `compare-settings.png` |

### Review, git, files, terminal, runtime

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Changes | A right-hand panel: uncommitted files, a unified diff, a "Commit message" box and Commit. That is the whole mod. | Compare against uncommitted / workspace start / branch / any agent turn; diffs per repository; line and range **review comments** with freshness, sent to the agent as one message; commit (agent-drafted), push, create PR, checks, "send failing checks", merge. | **Lazybox, by far** | [changes/main.js](https://github.com/herdrdev/herdr-app/blob/master/defaults/mods/changes/main.js), `ChangesPanel.tsx`, `ReviewDiff.tsx`, `PullRequestFlow.tsx` |
| Diff view | Unified only. | Unified only (custom renderer; no side-by-side). | = | `ReviewDiff.tsx` |
| Checkpoints | None. | Per-turn markers with "Show changes in this turn" / "Revert files" and undo. | **Lazybox** | `TurnCheckpoints.tsx` |
| Files / editor | A Files panel (tree and preview) remembered per space. Drag files into a terminal to type their paths. No editor (a community herdr-nvim mod exists). | File tree with Go-to-file (Mod+P), and **Monaco** with tabs, 4 split groups, breadcrumbs, save/conflict handling, rendered markdown and opt-in vim. | **Lazybox** | `FileExplorer.tsx`, `EditorArea.tsx` |
| Terminal | Ghostty-derived: find (`cmd-f`), scroll thumb, Kitty graphics, ligatures, font weight, line height and cell width, IME, OSC 52 clipboard, copy-on-select, dropping files or screenshots, links. Terminals split freely. | xterm.js with **only the fit addon**: no search, no link handling, no splits, hard-coded dark theme. One tab per shell; shells outlive the Runner. | **herdr, by far** | `TerminalPanel.tsx:3,20`, [settings](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md) |
| Run / preview | No run or preview concept, and no browser (an HN commenter asks for one). | ▶ Run control with name · port · elapsed, Actions panel, sandboxed Preview iframe, script approval. | **Lazybox** | `RunControl.tsx`, `ActionsPanel.tsx`, `PreviewPanel.tsx` |
| Processes | `herdr-app ls` and the core keep terminals; no panel. | A Processes panel across workspaces: tmux attach, Stop, "Clean up orphans". | Lazybox | `ProcessesPanel.tsx` |
| Missions / board | A **Board** layout with columns Needs you / Working / Done / Idle (a demo layout; no trust model). | A Missions panel with columns Ready / Working / Needs you / Done, trust badges (claimed / observed / verified / accepted), evidence chips and gates. Acceptance happens in the inbox. | **Lazybox** | `MissionsPanel.tsx`, [guide](https://herdr.dev/guide/) |

### Keyboard, settings, look, lifecycle, remote

| Aspect | herdr app | Lazybox V2 | Ahead | Evidence |
|---|---|---|---|---|
| Command palette | `cmd-shift-p` covers every command. The same registry drives keys, menus, mods and `herdr-app do <command>`. | **None.** Mod+P opens files only. The `]]` which-key has 6 built-in entries plus user snippets. | **herdr** | [docs/commands.md](https://github.com/herdrdev/herdr-app/blob/master/docs/commands.md), `LeaderMenu.tsx`, `compare-which-key.png` |
| Bindings | `keys.json` with `global` / `layout:` / `terminal` / `mod:` sections. Applies live. Invalid keys produce an error toast. The **macOS menu bar** mirrors the bindings ([0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). There is a shortcuts overlay (`cmd-/`). | vim / arrows / tmux presets, fully rebindable with conflict checks (Settings → Shortcuts). The native menu has 3 items. There is no overlay listing all keys. | herdr (Lazybox's presets are a nice touch) | `keyboard.ts:55-81`, `KeyboardSettings.tsx`, `apps/desktop/src-tauri/src/host.rs:229-259` |
| Context menus | Right-click menus on terminals, tabs, spaces and agents. The terminal menu is a replaceable mod. | Only on workspace rows. A shared `ContextMenu.tsx` is **in flight** on the artifacts branch (`0ebd9356`). | herdr today | `WorkspaceRow.tsx:68` |
| Theme / fonts / zoom | Light/dark following the system, a theme picker, `themes/`, color overrides, UI and terminal fonts, app zoom (`cmd-=`/`cmd--`/`cmd-0`), minimum contrast. | **Dark only.** About 1,600 hard-coded hex values across the surfaces CSS and hardly any variables; Monaco, xterm and mermaid are pinned dark. No font or zoom setting. | **herdr** | `style.css:2`, `TerminalPanel.tsx:20` |
| Settings | A Settings window (Look, Machines, Alerts, Updates, Privacy, Keyboard) **and** the same plain files an agent can edit. | A Settings page with 10 tabs. Ask Lazybox can *propose* settings changes for approval. | = (different philosophies) | `SettingsPage.tsx`, `compare-settings.png` |
| Extensibility | Everything is a mod: JavaScript on GPUI, hot-reloaded, **unsandboxed**. The site claims 576 mods. Agents can edit the UI and check it with `herdr-app shot`. | None for users beyond layout JSON and `]]` entries. | herdr (at a security cost Lazybox should not copy) | [AGENTS.md § Mods](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md), [security](https://github.com/herdrdev/herdr-app/blob/master/docs/security.md) |
| Onboarding / updates | A welcome screen (including migration from the TUI), What's new after updates with media, a feedback form with screenshots, self-update. | No first-run flow. The empty states are decent: "What are we building?" and Start / Open terminal / Show changes. | **herdr** | `WorkspaceHome.tsx`, `MessageArea.tsx:62` |
| Persistence | Agents outlive the window, updates and crashes. After a reboot, panes come back with a shell in the same folder and **agents are not resumed** ([herdr.dev](https://herdr.dev), heise). HN has reports of lost sessions and empty panes ([HN](https://news.ycombinator.com/item?id=50298436)). | Agents and commands outlive Runner restarts (session hosts). Layout, pages, editor tabs, drafts and console scroll are saved per workspace (desktop `views-<scope>.json`). Behavior after a reboot was not verified here. | = (Lazybox also resumes the *conversation*; herdr resumes the terminal) | `apps/desktop/src-tauri/src/viewstate.rs`, `Workspace.tsx:65-104` |
| Remote machines | Add SSH machines in Settings or the sidebar. Their spaces and agents join the same lists, grouped by machine. | One Runner per window. | **herdr** | [README](https://github.com/herdrdev/herdr-app) |
| Phone | A native app: urgency inbox, swipe actions, the **real terminal** with a configurable key bar, compose with screenshots and photos, **on-device dictation**, a live mini-map of each tab's panes. Connects over SSH or Tailscale with no account. No push notifications are documented. | A web `RemoteApp` paired by **QR** over Tailscale: inbox, conversation, approval cards, composer, Interrupt. | herdr for richness; Lazybox for pairing ease | [mobile](https://herdr.dev/mobile), `remote/RemoteApp.tsx`, `DevicesSettings.tsx` |

## What herdr does notably better

- **The agents list is the product.** It is always visible, Priority-sorted,
  pinnable and foldable, and spans spaces and machines. It works with any
  CLI. On HN, the "agentic inbox" and the "visual indication of waiting
  agents" were the most cited reasons people switched. Lazybox hides the
  equivalent behind a modal and shows each workspace's agent as
  "Claude · cla…".
- **One command list for everything.** The palette, keys, macOS menu,
  right-click menus, mods and `herdr-app do` cannot drift apart because they
  are one list. Lazybox's actions live in buttons, a 6-key `]]` menu and a
  3-item native menu.
- **Panes.** Drag-swap, edge docking with a highlight, zoom, keyboard
  swap/go/resize, tabs per task, and settle. Lazybox has docking but none of
  the rest.
- **The terminal.** Lazybox's xterm is a bare widget. People who live in
  Ghostty will notice in seconds.
- **Polish cadence.** 13 releases in about 3.5 weeks. The changelogs are
  mostly small UX fixes: tab-bar scrolling one tab at a time so you don't
  type to the wrong agent; a selection that doesn't bleed; IME on every
  platform. Release notes appear in the app.
- **Look and comfort.** Light and dark, themes, zoom and fonts. Lazybox is
  dark-only with hard-coded colors, which blocks theming and accessibility.
- **Agents can see and change the UI.** `herdr-app shot` gives a PNG of the
  window, and every file is documented for agents in a generated
  `AGENTS.md`. The Lazybox equivalent (Ask Lazybox proposing settings) is
  narrower.

## What Lazybox does notably better

- **Everything after "done":** the Changes compare modes, review comments
  with freshness, the PR loop with checks and merge, per-turn checkpoints
  with revert, and Monaco. herdr's whole review story is uncommitted files
  plus a commit box. On HN, "none of these tools offer code-change
  capability properly".
- **Trust:** missions with claimed/observed/verified/accepted, evidence
  chips, and acceptance in the inbox. herdr's Board is a status display.
- **Real notifications by default:** native OS notifications, a dock badge,
  a title count, per-kind toggles and click-to-route. herdr needs a
  community mod for any of that.
- **Approvals, permissions and cost as UI:** live permission changes,
  subscription limits and rotation, a context meter, and $ per turn. herdr
  has none, because it can't see inside the agent.
- **Run and Preview with ports and script approval.** herdr has no runtime
  concept.
- **Multi-repo workspaces and detached windows.**
- **Safety:** no unsandboxed UI code, and no default-on telemetry. Both are
  points of HN criticism of herdr.

## What not to copy

- **Unsandboxed JavaScript mods.** The power is real, but it is trusted code
  with the user's permissions (herdr's own
  [security.md](https://github.com/herdrdev/herdr-app/blob/master/docs/security.md)).
  If Lazybox wants this, it should be declarative layout and menu files
  plus the settings MCP, not arbitrary code.
- **Joke layouts** (Herdr 98, Pasture). They are fun marketing and have no
  place on the roadmap.
- **Replacing the chat with raw terminals.** Lazybox's thesis is
  understanding and verifying work, which a terminal grid can't do. Offer the
  terminal as an *escape hatch* (see P1-6), not as the main surface.

## Prioritized gaps

Effort: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks. "Owner" is the area
or in-flight agent the change belongs to. Where a branch already covers a
change, it is noted as an overlap, not a duplicate.

### P0 — the daily loop with more than three agents

| # | Change | Why (herdr evidence) | Effort | Owner / overlap |
|---|---|---|---|---|
| P0-1 | **An always-visible Agents section in the sidebar**, across workspaces. Toggle *Priority* (needs input > awaiting acceptance > failed > review > working > idle) or *By workspace*. Each row: task title, workspace, live status and age, and an unread dot. Hover pin; fold headers with counts. The Inbox dialog stays as the detailed view. | herdr's agents mod ([0.1.4](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)) is the most praised feature on [HN](https://news.ycombinator.com/item?id=50298436). Lazybox's attention model (`attention.ts`) already computes it all. | M | Layout upgrade / sidebar; reuses `useAttention`. Coordinate with **missions** (awaiting acceptance) and **sub-agent cards** (children nest under parent). |
| P0-2 | **Command palette** (`Mod+Shift+P`) over a single action registry, plus a **shortcuts overlay** (`Mod+/`) generated from it. Every header button, ⋯ menu item, `]]` entry and native-menu item becomes a registered action, so they can't drift. | [commands.md](https://github.com/herdrdev/herdr-app/blob/master/docs/commands.md), [keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json). Lazybox has no palette (grep). | M | Keyboard (`keyboard.ts`). **Context menus** (artifacts branch `ContextMenu.tsx`) should consume the same registry: land the registry first, or together. |
| P0-3 | **Chat at TUI parity for decisions.** Question options become buttons (single or multi-select, with "Other" as free text). Approval gets "Always allow this command/tool" when the provider supports it. Tool calls appear inline as one collapsed line each (name · target · duration · status), with the Activity dialog kept for depth. | herdr users see Claude Code's own pickers. Lazybox: `session-parts.tsx:36` renders options as text, and `ToolActivity.tsx` hides tools from the transcript. | M | Chat. Overlaps **sub-agent cards** (their timelines show tool lines), so use one tool-line component for both. |
| P0-4 | **Global "next agent that needs me"** (`Mod+]` / `Mod+[`, following P0-1's order) and **workspace select** `Ctrl+1..9`. | `agent.next`/`agent.prev` and `space.select:N` ([keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json)). Lazybox's j/k only work inside the focused sidebar. | S | Keyboard |

### P1 — comfort and density

| # | Change | Why | Effort | Owner / overlap |
|---|---|---|---|---|
| P1-1 | **Zoom a panel** (`Mod+Shift+Enter`, a header button, and double-click the header). Navigation keeps the zoom. | `pane.zoom` ([0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). Lazybox has none. | S | Layout upgrade |
| P1-2 | **Tabbed panel stacks:** drop a panel onto another panel's center to stack them as tabs (two chats, or Changes + Files). Also **drag-to-swap**, and keyboard focus-move and swap (`Mod+Alt+arrows` / `+Shift`). | herdr pane drag and swap ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). Lazybox panels never stack (`workspace-model.ts`). | L | Layout upgrade (no commit found yet; this is its core) |
| P1-3 | **Terminal upgrade:** `@xterm/addon-search` (Mod+F), `addon-web-links` plus file-path links into the Editor, `addon-webgl`, image paste and drop (path typed in), theme from tokens, font size; **split** right/down inside the Terminal panel. | Ghostty-grade terminal ([0.1.13](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). Lazybox: `TerminalPanel.tsx:3` loads the fit addon only. | M | Terminal |
| P1-4 | **Sounds** for needs input / failed / ready, on by default but quiet, with choice and preview in Settings → Notifications; plus an **in-app toast** for an attention change in another workspace when the window is focused. | `sounds` setting, Settings → Alerts ([AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)). Lazybox has no audio. | S | Notifications (`NotificationSettings.tsx`) |
| P1-5 | **Workspace rows carry git state:** branch (or "N repos"), ahead/behind, dirty count, PR/check state. Fix the agent line truncating to "C." by showing the task title, not provider · model. | The spaces mod shows "repo, branch, ahead/behind and uncommitted changes". Lazybox: `compare-workspace.png`. | S | Sidebar; data already in the PR loop's ship state |
| P1-6 | **Peek:** Alt-click a conversation, sub-agent or process anywhere (inbox row, Background work, Processes, a mention in chat) to open it in an overlay over the current page, with "Open here" or "Open beside". This also gives an "open the raw terminal" escape hatch for a session-host agent. | herdr peek ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | M | **Sub-agent cards** branch (`8606528d`) owns sub-agent peek; generalize it, don't duplicate it. |
| P1-7 | **Light theme and theme tokens:** move the hard-coded hex values in `style.css` to CSS variables; `prefers-color-scheme` plus a Settings → Appearance with Light / Dark / System, UI zoom (`Mod+=` / `Mod+-` / `Mod+0`) and terminal and editor font size. | herdr themes, appearance and zoom ([AGENTS.md § settings](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)). Lazybox: `style.css:2` `color-scheme:dark`. | L (token sweep), M for zoom/fonts alone | **Settings polish** (`b89cd8bb`, WIP); sequence after it, to avoid conflicts in `style.css` |
| P1-8 | **Context menus on every object** (conversation, workspace, panel header, file, diff file, terminal tab, inbox row), fed by the P0-2 action registry. | herdr has right-click menus everywhere, with the terminal menu as a mod. | M | **Artifacts** branch (`0ebd9356`) introduces `ContextMenu.tsx`; extend that. |
| P1-9 | **Native menu bar mirrors the actions and shows the user's bindings** (File / Edit / View / Window / Help), rebuilt live when keys change. | [0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md). Lazybox has 3 items (`host.rs:229-259`). | M | Desktop shell; after P0-2 |

### P2 — later or strategic

| # | Change | Why | Effort | Owner / overlap |
|---|---|---|---|---|
| P2-1 | **Welcome and What's new:** a first-run sheet (connect a repo, start a conversation, pair a phone, pick a keyboard preset) and an in-app release-notes view after updates, with Settings → Updates. | herdr `frame/welcome` and `whatsnew` ([0.1.5, 0.1.6](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | M | Settings polish / desktop shell |
| P2-2 | **Several Runners in one window**, grouped by machine in the sidebar (Agents and Workspaces). | herdr machines ([README](https://github.com/herdrdev/herdr-app)). The audit lists remote Runners as missing. | L | Remote ([REMOTE.md](../../REMOTE.md)) |
| P2-3 | **Phone richness:** swipe actions (pin / mark seen / interrupt), **dictation** in the composer, a live view of a command's output, and push notifications when the app is closed (herdr documents only in-app banners, so this would be a lead, not catch-up). | [mobile](https://herdr.dev/mobile) | M–L | Phone (`remote/RemoteApp.tsx`) |
| P2-4 | **Layout presets** ("Focus", "Review", "Monitor: Agents + Missions + Processes") switchable with a key, stored as files the Ask Lazybox agent can edit through the settings MCP. | `layout.switch` and layout files. Declarative, no code mods. | M | Layout upgrade, after P1-2 |
| P2-5 | **`lazybox shot`:** a CLI or MCP tool that returns a PNG of the current window, so UI agents (and Ask Lazybox) can check what they changed. | `herdr-app shot` ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)). | S–M | Desktop shell / Ask Lazybox |
| P2-6 | **Side-by-side diff** toggle in Changes (Monaco diff editor is already a dependency). | Neither has one. This is about staying ahead of Conductor, not herdr. | M | Changes |
| P2-7 | **More harnesses visible in the sidebar:** adopt OSC 7501 so any CLI in a Lazybox terminal reports `working/blocked/done` and appears in the Agents list as a "terminal agent" (no chat, but attention works). | It is an open protocol; herdr's coverage comes from it. | M | Terminal + attention; complements the audit's "more harnesses" item |

## Top 10, in one line each

1. **P0-1 Agents list always visible, urgency-sorted, pinnable.** herdr's most praised feature; Lazybox hides it in a modal ([0.1.4](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md), [HN](https://news.ycombinator.com/item?id=50298436)).
2. **P0-2 Command palette plus shortcuts overlay over one action registry.** herdr runs keys, menus, mods and CLI from one list; Lazybox has no palette ([commands.md](https://github.com/herdrdev/herdr-app/blob/master/docs/commands.md)).
3. **P0-3 Clickable question options, "always allow", inline tool lines.** herdr users see the agent's own TUI; Lazybox's chat is below it (`session-parts.tsx:36`).
4. **P0-4 Next/prev agent needing you, and `Ctrl+1..9` workspaces.** Two keys herdr ships by default ([keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json)).
5. **P1-1 / P1-2 Panel zoom, tab stacks, drag-to-swap.** herdr's pane handling ([0.1.5](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md), [0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)).
6. **P1-3 Terminal: search, links, splits, image drop, WebGL.** Lazybox loads only xterm's fit addon.
7. **P1-4 Sounds and in-app toasts.** herdr's bundled done/request sounds; Lazybox is silent.
8. **P1-5 Branch, ahead/behind and dirty state on workspace rows; no more "C." truncation.** herdr's spaces mod.
9. **P1-7 Light theme, tokens, zoom and fonts.** Lazybox is hard-coded dark; herdr follows the system.
10. **P1-6 Peek a conversation or sub-agent without navigating.** herdr peek; extend the sub-agent cards branch rather than duplicating it.

## Sources

herdr: [herdr.dev](https://herdr.dev) · [guide](https://herdr.dev/guide/) ·
[TUI page](https://herdr.dev/tui/) · [keyboard (TUI)](https://herdr.dev/docs/keyboard/) ·
[mobile](https://herdr.dev/mobile) · [blog index](https://herdr.dev/blog/) ·
[herdr-app README](https://github.com/herdrdev/herdr-app) ·
[herdr-app CHANGELOG 0.1.4–0.1.16](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md) ·
[defaults/AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md) ·
[defaults/keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json) ·
[defaults/layouts/main.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/layouts/main.json) ·
[defaults/mods](https://github.com/herdrdev/herdr-app/tree/master/defaults/mods) ·
[docs/commands.md](https://github.com/herdrdev/herdr-app/blob/master/docs/commands.md) ·
[docs/security.md](https://github.com/herdrdev/herdr-app/blob/master/docs/security.md) ·
[herdr TUI README](https://github.com/herdrdev/herdr) ·
[heise, 2026-11-02](https://www.heise.de/en/news/Herdr-desktop-app-A-hub-for-AI-coding-agents-11508175.html) ·
[Bitdoze gallery tour, 2026-11-08](https://www.bitdoze.com/herdr-app-layouts-mods/) ·
[HN: "Herdr has released native app"](https://news.ycombinator.com/item?id=50298436).
Repository statistics are from the GitHub API on 2026-11-16.

Not verified: how herdr feels in use (I did not install it); whether herdr
posts system notifications without a mod (the docs say toast plus sound,
heise says system notification); Lazybox behavior after a machine reboot.
