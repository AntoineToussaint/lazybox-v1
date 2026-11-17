# Lazybox changelog

What changed for people using Lazybox, newest first. This file is the one
source for the release notes: the GitHub release of a version shows its
section (and the dated sections below it, up to the previous version), and
the app's **What's new** shows every section a person has not seen yet
(`packages/surfaces/src/release-notes.ts` is generated from it by
`node scripts/release/changelog.mjs --write`; `make -C v2 release` refuses
a changelog and app notes that disagree).

Each section is `## [id] - date · title`, where id is a released version
(`0.1.0`) or, for notes shipped to Dev and Working between releases, the date
and a counter (`2026-11-16.3`). An id never changes once shipped. Each item is
one line `- **What** body`, saying what a person can now do; a long item may
continue on lines indented by two spaces.

## [2026-11-17.13] - 2026-11-17 · Send now sends

- **Send now is one click, and it sends** A queued message's Send now stops the agent's current step and sends your message right away, the other queued messages in order after it, even after Lazybox restarted. The conversation shows one quiet line, Stopped to send your message, never an error from the provider.
- **A message never waits for nothing** When a turn ends, queued messages go out; none stays in the queue while the agent is idle.

## [2026-11-17.12] - 2026-11-17 · Diagrams that render, or say why

- **A diagram says why it did not render** Instead of "Diagram preview unavailable", a Mermaid diagram that cannot be drawn names the reason above its source: the line Mermaid could not read, a diagram type it does not know, a diagram too large to preview, a theme colour diagrams cannot use, or a renderer that could not load.
- **Diagrams recover on their own** A diagram that failed for a passing reason (its panel folded or hidden, the window not shown, the renderer not loaded yet) renders again once shown, a few times at most; Try again does it on demand. A diagram with a syntax error is not retried until its text changes.
- **Several diagrams at once** Diagrams streamed together render one after another and no longer disturb each other, and a theme colour Mermaid cannot read, such as oklch() or color-mix(), falls back to the built-in theme's colour instead of failing the diagram.

## [2026-11-17.11] - 2026-11-17 · Dictation that keeps up with your pauses

- **Pause while you dictate** Stop to think mid-sentence and go on: what you said before the pause stays in the message box, and the new words follow it. Listening no longer ends on a long pause when you tapped to keep listening; it stops when you do, or after a minute of silence.
- **Hold Right ⌥ to talk** The Option key on the right, alone, is the dictation key: hold it and speak, tap it twice to keep listening, tap it once to stop. With any other key it is still an ordinary ⌥ (⌥e, ⌥←). ⌥Space still works; if it does nothing, another app (ChatGPT, Raycast, Alfred) may use it, and the pill says so. Pick any key in Settings → Voice, now also Right ⌥ or Right ⌘ alone.
- **⌘↵ sends** In the message box ⌘↵ sends, as ↵ does. While you dictate, ⌘↵ (or ↵, or Send) waits for your last words, then sends.

## [2026-11-17.10] - 2026-11-17 · Start a task from a GitHub issue

- **Paste an issue's link** Paste a GitHub issue's link (or acme/api#812) into New task's message box: it becomes the issue's chip, its repository is chosen, and the workspace is named after it on a branch like 812-fix-refund-rounding.
- **Pick from your issues** From an issue… in New task, or Start from an issue… in ⌘K, opens a picker on the open issues assigned to you: type to search, ↑↓ and Enter to pick, Tab to widen to issues that involve you or all of GitHub.
- **See exactly what the agent gets** The issue's text and its last comments go with your first message, quoted as content from GitHub so the agent treats it as information, not instructions. Open What the agent gets to read it before starting, and untick the comments to leave them out. The agent starts in Ask unless you pick YOLO.
- **Already started?** When an issue already has a workspace the sheet says which, with Open it, or Start another on a branch of its own.
- **Where the work came from** The conversation header shows the issue (key, title, state), and opens it in your browser or the Web panel. The agent is told to write Fixes #812 in its commits and pull request, so GitHub links them back.
- **From the terminal** lazybox new --from https://github.com/acme/api/issues/812 "Start with the ledger" does the same from a shell; --another starts a second workspace for the same issue.

## [2026-11-17.9] - 2026-11-17 · Add a Codex account in your browser

- **Codex signs in in your browser** Settings → Subscriptions → Add subscription → Codex now shows Continue in your browser: ChatGPT's sign-in page opens, and Lazybox continues by itself when you are done, with Open again and Cancel while it waits. No code to copy, and it works for accounts that do not allow device codes, such as most Business and Enterprise workspaces.
- **A code when you need one** Use a code instead (for another device) still gives you a one-time code to enter on another device. When an account refuses codes, Lazybox says why in one line and offers Sign in with the browser instead.
- **Another sign-in in the way** If another Codex sign-in is open on your Mac, Lazybox says so plainly and offers a code instead.
- **A calmer sign-in dialog** The Add subscription dialog uses the normal type size, opens with the focus on its main action, and a sign-in that ran out of time says so in plain words: The sign-in took too long and was stopped.

## [2026-11-17.8] - 2026-11-17 · Track the file an agent names

- **Track a linked file** Right-click a Markdown file an agent names in a message, such as `docs/PLAN.md`, and choose Track as artifact: the file is tracked, as from Files, and the artifact stays in sync with it. Other files show the item disabled, Markdown only; a file outside the workspace says why.
- **The file first, for a message that names one** Track on a message that links a Markdown file offers Track docs/PLAN.md (stays in sync with the file) above Track this message's text, and a short message that mostly names the file chooses the file already. On a file link, the message's own item reads Track this message as artifact….

## [2026-11-17.7] - 2026-11-17 · Updates you choose, feedback you read first

- **Updates you choose** Settings → Updates shows what changed since your version and installs only when you choose Install and restart. Skip a version, or be reminded tomorrow; turn off the automatic check (every six hours) if you prefer to check yourself. Nothing is ever forced.
- **Agents keep running through an update** Before installing, Lazybox says how many agents are running and that they keep going: only the app and its Runner restart, and the new Runner picks every agent, command and terminal back up.
- **Said plainly when something is off** No network, a download whose signature does not match this app's key (it is refused, nothing changes), an update that did not take, or a Runner on another version than the app: each is one sentence, with the fix (Move the Runner now).
- **Send feedback** Help → Send feedback writes a report you read before it goes anywhere: what happened, a screenshot of the window if you like, and diagnostics with credentials removed and your home folder shown as ~. Save it, copy it, or open a pre-filled GitHub issue; Lazybox uploads nothing and collects no telemetry.
- **Back after your Mac restarts** A conversation whose agent was running says so, keeps its checkpoints, commands and queued messages, and resumes the agent's own session with your next message; the queued messages go first.

## [2026-11-17.6] - 2026-11-17 · Let an agent run agents, within limits you set

- **An orchestrator** Type /orchestrate (or ⌘K, Let this conversation run agents…) to let one conversation start and drive agents for a mission: how many at once, their permission (never above its own), their subscriptions and a budget. Its header shows Orchestrator 2/3; click it for its agents and Revoke.
- **Only the agents it started** It messages, waits on and stops only its own agents (lazybox agents spawn, send, wait, watch, stop). It never approves, answers for you, passes a gate or accepts a task: its agents ask you, and you accept their work.
- **Messages read as theirs** A message between an orchestrator and its agent is an event from that agent, opening to exactly what was sent, with Open to go to it. An agent's header leads back to its orchestrator, and the board shows who started each task.
- **Approve the plan first** The orchestrator proposes its split (tasks, paths, order, estimate); you approve it once, with a $ cap and how many agents at once, on one sheet that flags paths two tasks would both change. It starts only the plan's tasks.
- **A budget that holds** Each agent reserves its estimate against the cap; past it, new agents pause and the board asks you to raise it. Every task shows what it cost against its estimate.
- **The missions board as a page** ⌘K, Open the missions board: the columns side by side, and tabs for a Timeline of everything every agent did (one lane each, what each event reacts to one click away), the Messages between agents, and Leases.
- **Overlaps seen as they happen** After every turn Lazybox compares what the mission's agents changed; two agents on the same file, or one inside another's exclusive lease (lazybox lease claim), flag both cards and tell the orchestrator. Nothing is blocked.
- **Work sized to your review** While three tasks (or the grant's number) wait for your review, the orchestrator's new agents are held, and the board says so.
- **Agent trees in the Agents list** An orchestrator's agents nest under it, with their role; one listed apart (waiting for your approval, say) says who started it. Plans to approve and tasks to accept sit at the top, and the Inbox counts them.

## [2026-11-17.5] - 2026-11-17 · Panels from the keyboard

- **Move between panels with arrows** ⌥⌘ and an arrow moves the focus to the panel group on that side; a ring shows where you are, and a screen reader says it. ⌥⇧⌘ and an arrow moves the panel into that group, or swaps two panels, and ⌃⌘ and an arrow moves the group's edge (held down, it keeps going, faster).
- **Tabs by number** ⌃1 to ⌃8 bring a tab of the group you are in to the front, and ⌃9 the last one; ⌘1 to ⌘9 still go to workspaces.
- **A + on every group** The + after a group's tabs (or ⌘T) starts a conversation that shows in that group, or opens any panel there.
- **Maximized stays maximized** While a panel is maximized, moving the focus, ⌘J, ⌘] and opening a conversation keep it maximized and show the new one.
- **One key to get back** ⌃⌥⇧Esc puts back the default layout and the default shortcuts at once, with Undo; it is the one shortcut that cannot be changed.
- **Split beside, fixed** ⌘\ on a panel that shares its group now splits it out at once, and on a lone panel the panel you pick opens beside it.

## [2026-11-17.4] - 2026-11-17 · Your phone tells you, and you answer from the Inbox

- **Notifications on your phone** Turn them on in the phone's Inbox and it tells you when an agent asks a question, waits for approval or fails, even with Lazybox closed. Choose the kinds, set quiet hours, send a test; a tap opens the conversation, ready to answer. On an iPhone, add Lazybox to the Home Screen first (iOS 16.4 or later); the phone shows how.
- **Answer from the Inbox row** Allow or Deny an approval, or tap a question's option, without opening the conversation. Undo stays a few seconds before the answer goes, and a command flagged as risky asks first, on the row and in the conversation.
- **Swipe the phone's Inbox** Right to allow or pin, left to mark read or stop a turn; a long press or ⋯ shows every action, and pulling down refreshes.
- **Follow a command from the phone** The commands an agent runs are listed under the conversation's title; tap one to follow its output live.
- **Which phones are notified** Settings → Devices shows each phone's notifications and can send it a test.

## [2026-11-17.3] - 2026-11-17 · A quieter, clearer conversation

- **Lazybox's messages are events, not yours** What Lazybox tells an agent (a repository you added, review findings, a question from the other agent, a mission task) is one line with an icon, such as Added authority to this workspace with its branch, the path on hover and to copy; it opens to exactly what the agent received. Never a You message.
- **Restarts stay quiet** A Runner restart that interrupted nothing is a small mark, not a line per restart; one that left something uncertain says so in one line.
- **Background work counted right** The background work list counts sub-agents and commands apart (2 sub-agents · 17 commands · 0 running · 1 failed), shows the newest first, folds older finished ones, and names a command by what the agent said it does, whole.
- **What your tokens cost, part by part** The usage popover shows input, cache read, cache write and output with their tokens and cost, how much input the cache served, and for usage without a price, which model and why.

## [2026-11-17.2] - 2026-11-17 · Put windows back where they came from

- **Put back in main window** A chat in its own window and a panel group opened in a new window now lead with a labelled Put back in main window button (or ⇧⌘D, or Window → Put Back in Main Window): the panel returns exactly where it was, and the main window comes forward on it.
- **Closing a window puts it back** Closing a chat's window or a panel's window returns its panel to the main window; nothing is lost, even when the window closed while the main window was not open.
- **In other windows** A quiet strip under the header lists what is open in other windows, with Show, Put back and Put all back; the command palette has Put all windows back and Put … back in main window for each.
- **The sidebar keeps its width** Switching to a workspace whose page has no panel docked beside the sidebar (all closed, floating or in other windows) no longer stretches the sidebar across the page: an empty area with the page's options takes the rest.

## [2026-11-17.1] - 2026-11-17 · Servers never hold up a conversation

- **Servers go to the background** When an agent starts a dev server or a watcher with lazybox run, it moves to the background once it is up (after 20 seconds, when it listens on a port or looks like a server): the agent carries on, the server keeps running, and it shows in Command output and Processes with its port and Stop.
- **Move to background** The live bar offers it for a server the agent is still waiting on; Processes and the console stop it like any command.
- **Run a server from a code block** Run asks the agent to start it in the background, Run myself starts it there; the block shows its port with Open preview and Stop, and uses the workspace's action when one runs the same command.
- **Queued messages you can act on** A message you send while the agent works waits above the message box: Send now stops the current step and sends it next, and Codex conversations can Steer it into the running turn.

## [0.1.0] - 2026-11-17 · Install Lazybox like any Mac app

- **A real installer** Download the disk image, drag Lazybox to Applications and open it, or brew install --cask lazybox-v2 from the lazybox tap. Nothing else to install: the app brings its Runner, the Claude worker and the Node it runs on.
- **Agents keep working when the window is closed** On first launch Lazybox asks once to set up its background service, the Runner. It starts when you log in, keeps your agents running when you quit the app, and an update restarts it without stopping them.
- **The lazybox command, everywhere** Lazybox offers to put lazybox on your PATH with shell completions, no administrator password needed. lazybox doctor checks the service, versions, providers, GitHub and disk space and says what to do about anything wrong; lazybox service and lazybox uninstall manage the rest.
- **The documentation, in the app** Help → Documentation opens the guides and references offline, with search; links between pages and Back work as in a browser.
- **Updates that explain themselves** When a new version is out, the header says so. Read what's new, then Restart to update: the app and its Runner move to the new version together, and Settings → About shows the one version they share.

## [2026-11-16.3] - 2026-11-16 · See more without leaving your place

- **Git state on workspace rows** Each workspace shows its branch, how far it is ahead of or behind its upstream and the default branch, uncommitted changes, and its pull request with a checks dot. The agent line shows what the conversation is doing instead of the model name.
- **Peek** Alt-click a conversation, sub-agent, command, artifact or file, or press Space on a focused row, to look at it over the current page. ⌘Enter opens it, ←/→ peeks the next one, Esc closes.
- **Side-by-side diff** Changes can show a split diff with word-level highlights and collapsed unchanged lines. n and p jump between hunks, and you can tick files as viewed. Review comments work in both views.
- **Welcome and Help** A first-run welcome shows how to connect a subscription, add a repository and the five keys that matter. Reopen it, these notes or your shortcuts from Help (?) in the header.

## [2026-11-16.2] - 2026-11-16 · Watch the work as it happens

- **One live bar for the running turn** Sub-agents and background commands are visible while they run, and you can stop any of them.
- **Links open in your browser** Clicking a web link in the desktop app opens it in your default browser.
- **Zoom** ⌘= / ⌘- / ⌘0 zoom the desktop app.

## [2026-11-16.1] - 2026-11-16 · Missions, artifacts and your phone

- **Missions** An event log per mission, a board derived from it, and acceptance from the inbox.
- **Artifacts** Track plans and reports as versioned artifacts, from a message, a file or an agent.
- **Control your Runner from your phone** Pair a phone by QR code over Tailscale to follow and answer your conversations.
- **Settings** A Settings sidebar, a real pricing table, and when a limited subscription is back.
