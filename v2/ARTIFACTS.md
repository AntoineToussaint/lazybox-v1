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

On later messages of the same conversation, the right-click menu also offers
**Update "Title" from this message…**. This shows a line diff against the
latest version, folded around the changes, with a toggle to see the result.
Saving names the version that was compared. If someone saved a newer version
meanwhile, the diff is redone against it and nothing is overwritten.

**A repository file.** In Files, right-click a Markdown file and choose
**Track as artifact**. The editor's tab menu has the same action. The Runner
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
`internal/runner/command_output.go`) tells it to publish plans, reports and
specs this way. An agent credential may call `ListArtifacts`, `GetArtifact`
and `PutArtifact` only for **its own execution's workspace**. Its versions
are always recorded as that agent, with source `agent`, whatever the request
claims. Every other artifact call is owner only, and a workspace terminal's
credential can call none of them (`internal/transport/auth.go`).

## The Artifacts panel and page

**The panel.** **Panels → Artifacts** (workspace header), or `] ] a`, opens
it. Tracking something also opens it. The list shows each artifact's kind
icon, title, latest version, who made that version and when, and the file
it follows, if any. A filter appears when there are more than four
artifacts. The keyboard works the list:

- ↑/↓ (or j/k) move.
- Enter opens.
- Delete asks before deleting.
- The menu key, or right-click, opens the row's menu.

When the panel is wide, the list and the open page sit side by side. When it
is narrow, the page replaces the list and **Back** returns to it. The panel
docks, collapses and closes like any other panel.

**The page.** The header shows the title (double-click to rename, Enter to
save, Escape to cancel), a kind picker, and the latest version's origin and
time. Below it:

- **Document** shows the rendered Markdown.
- **Changes** shows a diff between the shown version and any earlier one.
- **History** lists every version with its origin and time. It sits beside
  the document on a wide page and opens over it on a narrow one. Choosing an
  older version shows "You are viewing v2 of 5 · Back to latest".

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
- **Print or save as PDF…**: prints the rendered document alone, with its
  title, kind, version and date, using a print stylesheet. "Save as PDF" is
  the system print dialog's own option.
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
- **Printing is not complete for long documents:** a Mermaid diagram is
  printed as it is on screen. A diagram that was never scrolled into view is
  still a placeholder.
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
