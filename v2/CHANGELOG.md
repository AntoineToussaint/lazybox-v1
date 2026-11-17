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

## [2026-11-17.28] - 2026-11-17 · A cost dashboard you can read at a glance

- **Spend for a period** The Cost dashboard example opens on the last 7 days; Today, 30 days and All switch it, by click or the arrow keys. The total leads, with how it compares to the period before (▲ 12% vs $15.73 the 7 days before), the average a day and how many turns had no price.
- **Tokens and the cache** Tiles show tokens in (uncached and from the cache), tokens out, the cache hit rate, and the conversation that cost most.
- **Spend over time** A chart per day (per hour for Today, per week for a long history), stacked by model, each model in the same colour everywhere. Hover a column, or focus the chart and use the arrows, for what each model cost that day.
- **Where it went** By model, by workspace and by conversation, ranked, with the cost and the share. A workspace or a model narrows the whole dashboard to it; a conversation shows it in the window. It fits a narrow side panel and spreads out when wide, in every theme.
- **For extensions** `lazybox.usage.read({series: true})` also gives usage hour by hour, under the same `read:usage` grant.

## [2026-11-17.27] - 2026-11-17 · Attachments are boxes

- **A big paste becomes a box** Paste more than 800 characters or 12 lines and it sits above the message as a box, Pasted text · 142 lines, its first line as the title (Pasted Python when it is clearly code), instead of filling the message box. Hover it to scroll through it; click it to read or edit it. ⌘Z right after the paste, or ⋯ → Insert inline, puts the text in the message instead. It is kept with your draft if the window reloads.
- **One box for every file** Images keep their thumbnail; a PDF shows its page count, any other file its name and size, all the same height. Hover or Tab to a box to preview it, Enter or a click opens it, Delete removes it, ⌥← ⌥→ or a drag reorders them. On a phone, tap a box to open it.
- **Clear limits** A file over the limit no longer refuses the whole selection: the files that fit are attached, and the one that does not shows as a red box saying why, Too large: 25 MiB of 20.
- **Every agent gets them** Claude, Codex and ACP agents all receive your attachments after your text, in the order of the boxes: an image as an image when the agent sees images, a pasted box or a source file as its text, a PDF or any other file as a file the agent opens. The sent message shows the same boxes, and hovering one says how the agent got it.

## [2026-11-17.26] - 2026-11-17 · The agent and its context under your message

- **Who answers, and how full their context is** The left of the message box's controls shows the agent and model (Claude · Opus 5.5) and the context used, as a small meter and a percentage that turns amber from 60% and red from 85%. Click the agent to switch model; click the meter for the context and token cost. It says what the chat header says, from the same reading. A narrow box keeps the meter; a phone keeps the percentage. A conversation that has not started shows none of it.
- **Your messages without "You"** Your own messages no longer carry a "You" label: they are yours. One you steered into a running turn shows a small steered tag. Messages from agents and Lazybox keep their label.
- **Clearer confirmations** Deleting a conversation or a workspace, archiving, stopping processes, removing an extension and clearing browser data share one dialog: the name under the question, what happens and what is kept, and a warning with its checkbox on one line. The confirm button is a full red, and plainly grey until a required box is ticked.
- **A tidier Artifacts list** The count and the search field share one row, the search icon inside the field; This workspace / All workspaces sits under it at one height. A slim list stacks them cleanly.

## [2026-11-17.25] - 2026-11-17 · A workspace's conversations are there as tabs

- **Every conversation as a tab** Opening a workspace shows its open conversations as tabs, most recent first (six at most; the rest are a click away in the sidebar). A conversation that had no tab after the last update is back in one.
- **A click keeps it** A click on a conversation brings its tab forward, or opens it in a tab that stays; nothing replaces the conversation you were in, and a review opened beside it never takes its place.
- **Closed stays closed** A tab you close stays closed the next time the workspace opens, until you open that conversation again.
- **Prefer one chat?** Settings → Chat → Open a workspace's conversations as tabs: off, a click shows a conversation in a preview tab that the next click replaces, as before.

## [2026-11-17.24] - 2026-11-17 · /model lists your models

- **/model lists your models** /model, the ⋯ menu and the model name in the header list the models you can switch to by name, the id after it: Claude's Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.2 plus whatever else Claude Code offers, or the models Codex lists for your subscription. A conversation whose agent an older Lazybox started gets the same list.
- **Choosing the current model does nothing** It is marked Current and never offered first; choosing it asks nothing.
- **A switch during a turn waits for it** The turn finishes on the model it started with, the next one uses the new model, and the conversation says so. An agent an older Lazybox started asks once, in one sentence, to restart, and Restart after this turn waits for the turn to end.

## [2026-11-17.23] - 2026-11-17 · Conversations are tabs

- **Conversations open as tabs** A single click on a conversation shows it in the chat's preview tab, its title in italics; the next click replaces it, so browsing does not pile up tabs. Double-click it, type in it, or choose Open in new tab and it stays as a tab of its own. A new conversation opens in a tab too.
- **Open one behind** ⌘-click or middle-click a conversation to open it in a tab behind the one you are reading. A conversation already open is brought forward, never opened twice.
- **See every conversation at a glance** Each conversation tab shows a dot for working, needs you, failed or done, and a close button. The tab in front is the selected conversation: the sidebar, Command output and Changes follow it.
- **Split, move, close** Right-click a conversation or its tab: Open in new tab, Open beside, Open below, Open in new window, Move to new page, Close other tabs, Close tabs to the right. Drag a tab onto another group or an edge to split. ⌘W closes a tab without ending the conversation, ⇧⌘T reopens it where it was, and ⌃⇥ goes through every tab.
- **Related conversations beside their parent** Opening an agent from its orchestrator's card puts it in a tab right after the orchestrator's, behind it, instead of replacing what you read.
- **Kept across restarts** Each workspace remembers its tabs, preview or not. A full page (16 panels) says so and offers to close its oldest preview tab.

## [2026-11-17.22] - 2026-11-17 · Review from the chat

- **Review from the chat** The conversation's header has Review: another agent reviews the workspace's changes, read-only, without a detour through Changes. /review in the message box and ] ] ⇧R (⌘K Review this workspace's changes) do the same; /review the retry loop tells the reviewer what to look at first.
- **The other agent reviews by default** Codex reviews Claude's work and Claude reviews Codex's; the Review button's tooltip names who will. Its chevron picks another agent for one run. Settings → Agents & workspaces → Default reviewer: the other agent, the same agent in a fresh conversation, or always one agent (an ACP agent too) on a model you choose. When the other agent is not installed or signed in, a fresh conversation of yours reviews, and the review says so.
- **Watch the review in a tab** A review opens as a tab beside the conversation it reviews, Review · Codex, and you stay in your message box. The tab shows a live dot while it works, then 3 findings or done; the review's row in the sidebar brings its tab to the front.
- **Clean means clean** A review that ends with majors still open no longer says Clean ✓: it says No blockers · 2 major open, and Send 2 findings to Claude puts them in the author's message box for you to send.

## [2026-11-17.21] - 2026-11-17 · Resize the sides inside panels

- **Drag the divider inside a panel** In Changes, drag the edge between the file list and the diff, and between the diff and the review tray; when Changes is narrow, the Files / Review column. The same divider sizes the Artifacts list and its version history, the Settings sections, the Documentation's page list, the snippet list and the agent browser's steps. It lights up under the pointer; double-click it for the default size.
- **From the keyboard** Tab to a divider: the arrow keys move it 16 px (⇧ for 64), Home and End take it to its narrowest and widest.
- **Fold a list away** Drag the Changes file list, the Artifacts list or the Documentation's pages all the way in (or press Enter on the divider) and it folds to a thin rail; click the rail, press Enter or drag it out to bring it back.
- **Remembered** Each divider keeps its size in this window, in every workspace and after a restart; a new window starts from the size you last chose. The content beside it never gets too narrow to read, and a phone keeps its stacked layouts.

## [2026-11-17.20] - 2026-11-17 · Pull requests your agents pushed themselves, tracked

- **The pull request from an agent's own push** A branch an agent pushed itself (git push -u, then gh pr create) now finds its pull request within a minute or so; before, Lazybox only asked about branches it had pushed. One an agent opened before this update, or while the Runner restarted, is picked up from the conversation when Lazybox starts.
- **Review required, in words** A pull request waiting on a required review says review required on its header pill, with a green dot once checks pass, and Review required · checks passed in the Pull requests panel. The pill of the branch's own pull request has a ↗ that opens it on GitHub.
- **Told when GitHub refuses** If GitHub cannot be read for a workspace's pull requests (a private repository the connection cannot see answers 404), the Pull requests panel says so in one line, naming the repository.
- **lazybox link and lazybox items in Dev and Working** Agents can link a pull request with lazybox link URL (with or without https://) and list their workspace's with lazybox items; Dev rebuilds the CLI agents run whenever the Runner is rebuilt.

## [2026-11-17.19] - 2026-11-17 · A queued message shows once

- **Queued or sent, never both** A message you send while the agent works waits above the message box, and only there: it no longer also shows in the conversation, inside the turn it is waiting for. Once the agent gets it, it shows once, where it did: after that turn (and after Stopped to send your message, for Send now), starting its own; a message steered into a Codex turn shows there, marked steered. A reload shows the same.

## [2026-11-17.18] - 2026-11-17 · Send now from the keyboard

- **⌘↵ sends now** While the agent works, ↵ still queues your message, and ⌘↵ sends it now: the agent's current step stops and your message is the next turn. Pressed ↵ and saw it queued? ⌘↵ with an empty message box sends the oldest queued message now. While the agent is idle, ⌘↵ sends like ↵, also while you dictate.
- **The key where you need it** While the agent works the message box says ↵ queues · ⌘↵ sends now, and the queued strip's Send now names the key. Change it in Settings → Shortcuts (Send now).

## [2026-11-17.17] - 2026-11-17 · Command output stays on what you read

- **Command output stays put** While an agent runs many quick commands, the Command output panel keeps showing the run you are reading. A new run takes it over only when the one shown has finished, you have not picked, searched, scrolled, selected or resized its text in the last 30 seconds, and the new run is still going after about a second and a half. Quick runs are listed in the picker, newest first, and counted.
- **Newer runs are offered** When newer runs exist, the panel's header says so, for example 2 newer · npm test ↵ Show; click it, or Tab to it and press ↵, to jump to the newest.
- **Follow new runs** The header's ⋯ menu has Follow new runs, on by default. Off, the output never switches by itself; newer runs are only offered. The choice is remembered for the window's workspace.
- **No tab comes forward by itself** A run starting never brings Command output in front of another tab in its group; a panel you put away stays away.
- **One row of controls** The header stays one row at any width: at narrow widths A−/A+, Copy and Hide noise move into its ⋯ menu.

## [2026-11-17.16] - 2026-11-17 · Long conversations open at once

- **The latest first** Opening or reloading a long conversation shows its latest turns at once, then reads the rest behind them; until it is in, the top of the conversation says Loading earlier messages…. A conversation of about 10,000 events shows its last turn in a fifth of the time it took before.

## [2026-11-17.15] - 2026-11-17 · Find your artifacts from anywhere

- **Artifacts show up in the conversation** When the agent publishes a plan or report, or a new version of one, a card shows under its steps with the title, the kind and the version: Open reads it in the Artifacts panel, and an update's Compare with v2 opens what changed. A message you tracked gets the same card.
- **"3 artifacts" in the chat header** The conversation's header counts the artifacts it made (or the workspace's, when it made none) and opens the Artifacts panel on just those; nothing shows when there are none. On a narrow chat it folds into ⋯ with the other numbers.
- **⌘K finds artifacts in every workspace** The palette lists every workspace's artifacts with the workspace's name, and * narrows it to artifacts. One from another workspace switches there and opens it.
- **All workspaces in the Artifacts panel** This workspace / All workspaces at the top of the list shows every workspace's artifacts, grouped by workspace, newest first. An empty panel says in one sentence how artifacts appear.

## [2026-11-17.14] - 2026-11-17 · The pull requests your agents open, tracked

- **Every pull request a workspace delivers** Lazybox now tracks the pull requests your agents open, not only the one you open from Changes: one an agent opens with gh pr create, one opened from any branch the workspace worked on, or one it links with lazybox link URL. Links and their state survive a Runner restart, and a deleted workspace's stay as history.
- **Where you look already** The header shows a pill per open pull request with its checks dot (the branch's own opens the PR loop), and each sidebar row one badge for its most urgent: checks failed, then changes requested, then ready to merge.
- **A Pull requests panel** ⌘K, Show pull requests (or the panels menu) lists every tracked pull request: Needs you, Waiting on others, Merged this week, and what conversations only mentioned. j/k move, Enter opens the workspace at the conversation that opened it, s sends the failures, r the review, m merges, each after a confirmation. In ⌘K, ! searches them.
- **One click back to the agent** In the Inbox and the panel, Send the failures gives the agent the failing GitHub Actions steps compacted as lazybox run does, with each full log saved for it; Address the review puts GitHub's review comments in the Review tray on their lines and sends them. Both arrive with a chip, wait for a turn in progress, and never go without your click.
- **Told when it changes** Checks failed or passed, changes requested, approved, merged, closed, conflicts: once each, as a quiet line in the conversation, a phone notification under your settings, and new hook events (pr.opened, pr.checks-passed, pr.approved, pr.merged…).
- **Light on GitHub** Open pull requests are checked about every minute while Lazybox has your focus, every five minutes otherwise, and an unchanged one costs nothing against GitHub's rate limit; if the limit is reached, checking pauses and says until when.

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
