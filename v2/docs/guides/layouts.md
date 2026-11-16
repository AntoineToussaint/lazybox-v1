# Layouts and docking

Each workspace has its own **pages** (the tabs at the top of the workspace), and
each page holds **panels**: the conversation, Changes, Files, the Editor, Command
output, a Terminal, a Web panel, Artifacts, Missions, Processes and more. Every
workspace remembers its own pages, arrangement and drafts.

![A panel's ⋯ menu: Dock left, right, top or bottom](../images/dock-panels.webp)

## Move, fold and close a panel

From the panel's own header — no edit mode needed:

| To… | Do this |
| --- | --- |
| Dock it to an edge | **⋯ → Dock left / right / top / bottom**, or **drag the header** onto one of the four edge zones (`Esc` cancels). |
| Fold it | Click its **title**: it collapses to its header (or a narrow tab beside another panel). Click again to unfold. |
| Resize it | Drag the divider between panels. |
| Close it | **×**. Bring it back from **Page actions (⋯) → Show panel**. |

Lazybox remembers the edge you last used for each kind of panel: a terminal you
moved left opens on the left next time, in every workspace. The workspace list
and the conversation are what the page is for, so they stay; everything else
docks around them. On a phone, panels show one at a time from the panel
switcher.

## Pages

**Page actions (⋯) → Customize page** opens the page editor: **Add panel**,
**Duplicate page**, **Rename page**, **Remove page** and **Reset pages** (up to
eight pages, twelve panels each). The only panel of a page has a **×** that
closes the page with it.

**Layout configuration** (same menu) shows the page as JSON: copy it to keep a
layout, paste one and **Import layout** to apply it. It holds panel references
and their arrangement only — never accounts or permissions.

## Windows

Use a second screen:

- **Open workspace window** (Page actions, or the palette: *Open this workspace
  in a new window*) opens the whole workspace in its own window. Closing it ends
  nothing.
- A conversation's session menu → **Open in its own window**.
- An artifact → **Open in its own window**; a Web panel → **⋯ → Move to a new
  window**, and back.

A conversation shows in at most one chat panel per page; choosing a conversation
reuses the page's chat panel.

## Peek instead of switching

To glance at another conversation, process, command or file without changing
your layout, `⌥`-click its row (or focus it and press `Space`): it opens in an
overlay you can move and resize. See [Peek](chat.md#peek-without-leaving-the-page).
