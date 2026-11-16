# Work in the chat

The chat replaces the agent's own terminal interface, so everything you would
do there — answer, approve, steer, stop — is here, plus a clearer view of what
it did.

- [Send, steer and stop](#send-steer-and-stop)
- [Answer questions and approvals](#answer-questions-and-approvals)
- [Follow what it does](#follow-what-it-does)
- [Sub-agents and background commands](#sub-agents-and-background-commands)
- [Reuse your prompts and snippets](#reuse-your-prompts-and-snippets)
- [Peek without leaving the page](#peek-without-leaving-the-page)

## Send, steer and stop

- `Enter` sends, `Shift+Enter` starts a new line. A message sent while the agent
  works is **queued** and delivered when the turn ends.
- **Attach** files with the paperclip, by dropping them on the chat, or by
  pasting a screenshot. Up to four files, 20 MiB per message. Images show as
  thumbnails; hover one to see it larger.
- **Interrupt** (in the live bar at the bottom) stops the running turn. An
  interrupt is never treated as an error: send your next message and the agent
  carries on.
- **Permission** can change mid-conversation from the session menu (⋯):
  Ask for approval, Read only or YOLO.
- **End session** stops the agent but keeps the conversation; sending a new
  message resumes it. **Delete conversation…** removes it.

## Answer questions and approvals

![An agent's question as numbered option cards, with Other… and Send answer](../images/chat-decisions.webp)

When the agent needs you, the conversation shows a card and the inbox counts it.

**Questions** show their options as cards: click, or press `1`–`9`; `↑` `↓`,
`Space` and `Enter` work too. *Other…* lets you answer in your own words.
Several questions are answered together and sent with `⌘↵`.

**Approvals** show exactly what will run: the command (highlighted) and its
folder, or the diff of a file edit, with risk hints such as a recursive
delete, a download piped to a shell, network access, or a path outside the
workspace. Then:

| Answer | Key | What happens |
| --- | --- | --- |
| **Allow once** | `y` | Runs this call only. |
| **Always allow …** | `a` | Allows this kind of call for this conversation or this workspace, at a scope the provider supports. |
| **Deny** | `n` | Optionally tell the agent what to do instead; it receives your reason. |

Keys work while the chat has focus, never while you are typing.

## Follow what it does

- **Tool calls are one line each** — *Read src/a.ts*, *Ran npm test*, *Edited
  3 files +12 −4* — expandable in place to the command, its output, or the diff.
  How much you see is your choice: [Activity detail](activity-detail.md).
- **Edits** show their first changed lines without a click.
- **The plan** (Claude's to-do list, Codex's plan) is a live checklist in the
  conversation; older plans fold to one line.
- **Thinking** is one quiet line: *Thinking…*, then *Thought for 4s*.
- **The live bar** at the bottom of a running conversation says what is
  happening now, in words, with the command and the folder it runs in, the last
  lines of its output, and the right stop button (**Stop command** for a
  command Lazybox runs, otherwise **Interrupt**).
- **Each finished turn** ends with a quiet marker: *Turn 2 · 3 files changed*,
  with **Show changes in this turn** and **Revert to before this turn…** in its
  menu. See [checkpoints](review-agent-work.md#undo-a-turn-checkpoints).
- **Activity** in the chat header opens the full, searchable history of every
  tool call, with Running and Failed filters.
- **Command output** (`]] o`) is the console of the commands the agent ran —
  every byte, while the agent itself received a compact view.

Links in the agent's answer work: a `path:line` opens the file in the Editor
(`⌥`-click opens a quick look instead), and `⌥`-click on a web link opens it in
a [Web panel](run-your-app.md#browse-beside-your-work-the-web-panel).

## Sub-agents and background commands

![Sub-agent cards with their task, live step, time and tokens](../images/subagents.webp)

A sub-agent is a card where its parent started it: its task, live state, the
step it is on (*Reading platform/bin/devbox*), elapsed time, tool count and
tokens; once it ends, its outcome and the result it handed back. Open a card to
follow its own messages and tool calls in a panel docked beside the chat, or
floating. Stop one sub-agent from its card (Claude) without stopping the rest.

Beside the message box, one chip per running sub-agent or background command
takes you to it; **All** lists them as a tree. A background command (Claude's
`run_in_background`) is not a sub-agent: it gets a short name and a panel with
its script and the output the agent last read.

## Reuse your prompts and snippets

- **Recall:** `↑` in an empty message box brings back what you sent, newest
  first — this conversation's, then every other's — like a shell; `↓` walks back.
- **Jump to a prompt:** the marker rail and `⌥↑` / `⌥↓` move between your own
  messages in a long conversation.
- **Snippets** (`]] s`, or the snippet icon in the message box): a searchable
  picker over Lazybox's snippet catalog with a preview of the exact text.
  `Enter` sends it, `Shift+Enter` inserts it into your draft. Recent and
  favourite snippets come first.
- **Your own leader keys:** Settings → Shortcuts can add `]]` menu entries that
  send or insert a snippet with one key.

## Peek without leaving the page

`⌥`-click a row — a conversation, an inbox item, a process, a command, a file —
or focus it and press `Space`, and it opens live in an overlay over the page:
a conversation's latest messages with a message box, a command's output, a
file's content. `←` / `→` step through the neighbouring rows, `⌘↵` opens it for
real, `Space` or `Esc` closes it.
