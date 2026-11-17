# Artifacts: plans and reports as their own pages

Agents often write a plan, a review or a spec in a chat message, or in a
file such as `module-datasource/docs/PLAN.md`. You can track either as an
**artifact**: a versioned document of the workspace with its own page. You
can compare its versions, export it, and hand it back to an agent. It keeps
the link to where it came from.

## The model

The Runner keeps artifacts for each workspace
(`internal/runner/artifacts`, stored under `<state>/artifacts/<workspace>/<id>/`).
Each artifact has:

| Field | What it holds |
| --- | --- |
| `id`, `title`, `kind` | `kind` is plan, report, spec, notes or other. The title and kind can change at any time. |
| `format` | Always Markdown. Mermaid code blocks render as diagrams, as they do in chat. |
| `versions` | Append-only, oldest first. Each version has a number, a time, a sha256 digest, a size, an **author** and a **source**. The author is `person`, `agent` (with its execution) or `file` (the tracked file changed on disk). The source is `message` (execution, conversation, message cursor, turn), `file` (workspace path), `agent` or `edit`. |
| `origin_session_id`, `origin_conversation_id` | The conversation the artifact was first taken from. Later messages of that conversation offer "Update from this message". |
| `tracked_path`, `tracking_problem` | The workspace file the Runner follows, and why it could not follow it lately (removed, not text, larger than 1 MiB). |
| `links` | Reserved for missions and tasks (see [Orchestration](#orchestration)). Any link is refused until the Runner has missions. |

These rules hold for every caller:

- **Saving the same content again adds no version.** It returns the artifact
  unchanged, so a retried call is harmless.
- **`expected_version` protects reviewed changes.** If a newer version
  exists, the write is refused (`Aborted`) and the person reviews again.
- **Tracking an already tracked file returns the existing artifact.**
- **Limits:** a title of at most 200 characters, content of at most 1 MiB of
  UTF-8, and at most 1000 versions per artifact.
- **Deleting a workspace deletes its artifacts.** Deleting a conversation
  does not delete the artifacts taken from it.

## Where artifacts come from

**A chat message.** Every agent message has a quiet **Track** button that
appears on hover or keyboard focus, and its right-click menu has **Track as
artifact…**. Shift+right-click keeps the browser's own menu. The dialog
suggests:

- a title, from the message's first heading or else its first line;
- a kind, from the title.

It also shows a preview. When the conversation already has an artifact, the
dialog offers to update that one instead. Once tracked, the Artifacts panel
opens on the new page.

When the message links Markdown files of the workspace (a Markdown link, or
inline code naming one, as `docs/PLAN.md`), the dialog first asks what to
track: **Track `docs/PLAN.md`** (stays in sync with the file, as below) or
**Track this message's text**. A short message that mostly names the file
(at most 30 words, no code block) has the file chosen already; a longer reply
has its text chosen. Links resolve as opening them does.

On later messages of the same conversation, the right-click menu also offers
**Update "Title" from this message…**. This shows a line diff against the
latest version, folded around the changes, with a toggle to see the result.
Saving names the version that was compared. If someone saved a newer version
meanwhile, the diff is redone against it and nothing is overwritten.

**A repository file.** In Files, right-click a Markdown file and choose
**Track as artifact**. The editor's tab menu has the same action, and so does
the right-click menu of a file an agent names in a message: the link resolves
as opening it does (a choice when several files match), a non-Markdown file
shows the item disabled, and a file outside the workspace gets the Runner's
refusal. On a file link, the message's own item reads **Track this message as
artifact…**. The Runner
then checks the file every 2 seconds. A change becomes a new version (author
`file`) once the same content has been on disk for 2 seconds, so an agent
writing in several steps produces one version. The page shows "Synced with
`api/docs/PLAN.md`" and "v3 · file changed on disk · 2 min ago". The Runner
cannot know who edited the file, so it does not say. When the file
disappears, the last version is kept and the problem is shown.
**Stop syncing with file** ends the tracking and keeps every version.

**An agent.** Agents use the `lazybox` CLI with their own scoped credential:

```sh
lazybox artifact put PLAN.md --title "Datasource migration plan" --kind plan
lazybox artifact put - --id ID < PLAN.md      # a new version of the same artifact
lazybox artifact get ID [--version N]         # prints the Markdown
lazybox artifact list
```

Every agent's briefing (`commandBriefing` in
`internal/runner/command_output.go`) tells it to publish plans, design docs,
specs, reports and notes this way, to keep one artifact per document (each
revision is a new version with `--id`), to write the repository file too when
the document belongs there, and never to put these documents in an external
document tool or connector (Claude Docs, Notion, Google Docs…) unless the
person asks for that tool by name. An agent credential may call `ListArtifacts`, `GetArtifact`
and `PutArtifact` only for **its own execution's workspace**. Its versions
are always recorded as that agent, with source `agent`, whatever the request
claims. Every other artifact call is owner only, and a workspace terminal's
credential can call none of them (`internal/transport/auth.go`).

## Lazybox artifacts by default

A Claude agent signed in with a claude.ai account also gets that account's
**claude.ai connectors** (Claude's cloud MCP servers: Claude Docs, Gmail,
Notion…), and with them a way to write a plan somewhere other than Lazybox.
**Settings → Agents & workspaces → Use my claude.ai connectors in Lazybox
sessions** is off by default. Off, each new Claude session starts with the
Claude Code setting `disableClaudeAiConnectors: true` in its flag settings
layer and `ENABLE_CLAUDEAI_MCP_SERVERS=false` in its environment (the older
spelling, for a configured Claude binary that predates the setting)
(`workers/claude-sdk/src/options.ts`). The setting is read when a session
starts or resumes; a running session keeps what it started with.

What it does not cover:

- MCP servers configured on this computer (user or project settings,
  `.mcp.json`, plugins) still load: they are the person's own choice.
- Codex has no claude.ai connectors; its sessions are unchanged.
- Nothing changes on claude.ai: the connectors stay connected there and in
  other Claude Code sessions.
- A setting that already disables connectors (for example in
  `~/.claude/settings.json` or managed settings) wins even when the switch is
  on: any source that disables them disables them.

## The Artifacts panel and page

**The panel.** **Panels → Artifacts** (workspace header), or `] ] a`, opens
it. Tracking something also opens it. The list shows each artifact's kind
icon, title, kind, latest version, who made that version, when, and the file
it follows, if any. A dot marks an artifact **updated since you looked**: a
version you did not make, newer than the last one you opened on this device
(kept per workspace in the window's view state). A filter appears when there are more than four
artifacts. The keyboard works the list:

- ↑/↓ (or j/k) move.
- Enter opens.
- Delete asks before deleting.
- The menu key, or right-click, opens the row's menu.

When the panel is wide, the list and the open page sit side by side. When it
is narrow, the page replaces the list and **Back** returns to it. The panel
docks, collapses and closes like any other panel.

**The page** is a reader. A slim toolbar holds Document / Changes, History,
Send to agent, Export, Open in its own window and ⋯; once you scroll past the
title, it names the document.

- **The title block**: the kind (a pill; choose another to change it), the
  title in the display face (double-click to rename, Enter to save, Escape to
  cancel), who made the shown version, when, the **version picker**, and the
  reading time. A leading `# Title` that repeats the artifact's title is not
  shown twice. "Synced with `path`" and a tracking problem sit above the title.
- **The document** is typeset for long reading: a 44-em measure in Inter at
  16 px with 1.7 line height, headings with anchors, Newsreader for titles
  (both bundled, so the desktop app needs no network). Blockquotes that open
  with `> **Note**`, `**Tip**`, `**Important**`, `**Warning**`, `**Caution**`
  or `**Decision**` (or GitHub's `> [!NOTE]`) become callouts; a bold title
  after the kind (`**Decision: reads first**`) becomes the callout's title.
  Tables sit in their own frame with a sticky header and quiet zebra rows, and
  a cell that reads as a status or a level (Done, In progress, Planned,
  Blocked, High, Low…) becomes a pill. Task lists show checkboxes; code
  blocks their language and a copy button on hover; Mermaid diagrams render at
  once, fit the column, and keep zoom, pan and full screen behind a toolbar
  that appears on hover; footnotes jump both ways.
- **On this page**: when the page is at least 1080 px wide and the document
  has three or more sections, the outline sits beside it and follows the
  reading position; on a narrower page, **Contents** in the title block jumps
  to a section.
- **History** is closed until you open it: the toolbar's History button (with
  the version count) or **H**. Each window remembers whether it is open. It is
  a timeline of every version with its author and time; choose one to read
  it ("You are viewing v2 of 5 · What changed since · Back to latest"), or
  **Compare with vN** to see what it changed. It sits beside the reader on a
  wide page, which gives it its room, and over it on a narrow one.
- **Changes** compares the shown version with any earlier one. **Rendered**
  (the default) shows both versions side by side, rendered: unchanged blocks
  once on each side (long runs fold into "N unchanged blocks"), a replaced
  block beside its replacement with the changed table rows, list items and
  paragraphs marked, added and removed blocks tinted. Narrow, the two sides
  stack. **Text** shows the line diff. The choice is remembered per window.

The page follows new versions by itself.

**Page actions:**

- **Send to agent** puts a reference in the message box of the conversation
  beside the page. It is never sent for you. The reference has the title,
  the kind, the version, an outline of the headings, and the
  `lazybox artifact get ID` command so the agent can read the whole text. In
  its own window, where no conversation is beside it, the reference is
  copied instead.
- **Open in its own window** opens the page in its own native window on
  desktop (`open_artifact`, one window per artifact) or browser window on
  the web (`?view=artifact`). Closing that window changes nothing.
- **⋯** has Rename, Open source message (opens the conversation and scrolls
  to the message, with the usual highlight), Open source file, Stop syncing
  with file, and Delete… (asks first).

## Export

The **Export** menu has:

- **Copy as Markdown**: the latest version.
- **Download .md**: named after the title, for example
  `datasource-migration-plan.md`.
- **Print or save as PDF…**: prints the rendered document alone, as a
  document: a title block (kind, title, version, date, author, workspace),
  22 × 20 mm page margins, page numbers, light callouts, tables whose rows do
  not split, code that wraps, and no app chrome, buttons or outline. It waits
  briefly for a diagram still being drawn; a diagram drawn in a dark theme
  prints as its light negative. "Save as PDF" is the system print dialog's own
  option.
- **Save to repository…**: pick a workspace repository and a path (by
  default `docs/<title>.md`). The file is written but never staged or
  committed, so review it in Changes. Replacing an existing file is a
  second, explicit confirmation, made against the version of the file you
  saw. **Keep the artifact in sync with this file** (on by default for an
  artifact that is not yet synced) then tracks that file.
- **Create GitHub issue…**: opens an issue in a workspace repository's
  GitHub project through the GitHub connection. The body is the artifact
  plus one line naming it and its version. Clicking **Create issue** is the
  explicit go-ahead for that record.

## Orchestration

Missions and tasks ([ORCHESTRATION.md](ORCHESTRATION.md), slice 1) are not
in the Runner yet: `internal/work` is still a scaffold. The hookup is ready
on the artifact side:

- `Artifact.links` and `PutArtifactRequest.links` carry
  `{kind: mission|task, id, role: brief|evidence}`. The store keeps them;
  the Runner refuses any link today with "missions and tasks are not
  available on this Runner yet".
- When slice 1 lands, `PutArtifact` validates a link against `internal/work`.
  A `brief` link sets the mission's or task's brief. An `evidence` link
  records an `evidence.recorded` event that points at
  `artifact:<id>@v<N>`: a version, never the moving latest, so evidence
  cannot change after a verdict.
- The page then gains "Attach to mission/task…" (choose the mission or task
  and the role), and the mission board shows its brief and evidence
  artifacts. Agents pass `--mission`/`--task`/`--role` to
  `lazybox artifact put`. That uses the same agent scope, limited to tasks
  of the agent's own workspace.

## Known limits

- **Not verified in the native desktop window:** "Download .md" (an
  `<a download>`) and "Print" (`window.print()`) are tested in the browser
  only. If the webview ignores them, the next step is host actions
  (`save_file`, `print`) on the Tauri side.
- **Page numbers** use CSS page margin boxes (`@bottom-center`). They are
  tested in Chromium (`npm run test:artifact-reader` prints the sample design
  doc to `.cache/artifact-reader-print.pdf`); WebKit, the macOS desktop
  webview, is not verified and may print without them.
- **The rendered comparison is by block:** a moved paragraph shows as removed
  in one place and added in another, and footnote references inside a
  compared block do not link across blocks.
- **Comments anchored to paragraphs** are not built.
- **GitHub issue creation is tested only against a local test server:** the
  client call is tested that way, and the handler is tested only for
  refusing when GitHub is not connected. It has not been run against GitHub
  itself.
- **Not tested across a Runner restart:** file tracking resumes from the
  stored artifacts when the Runner opens, but this has not been exercised.
- **The message right-click menu lives in `MessageArtifactActions.tsx`:**
  it is a small handler of its own. When the app-wide context menu lands,
  its items move there with one registration under the `message` extension
  point.
