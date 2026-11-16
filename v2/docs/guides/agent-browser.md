# Let an agent use a browser

A coding agent can open its own browser to read docs, check a staging app or
click through a flow — and you watch every step beside the chat. It is a
separate Chromium, never your Chrome: it has none of your sign-ins, and the
ones made in it stay in its workspace.

Install its Chromium once: `make -C v2 browser`.

## Watch it

When the agent opens its browser, the chat header says **Claude is browsing**
and the **Agent browser** panel opens beside the chat (turn that off in
Settings → Browser). The panel shows the page live, a cursor and highlight on
what the agent clicks or types into, and an action log underneath. Click a log
entry to see where it happened.

## Answer its requests

The first time the agent goes to a site, it asks — with its reason — even in
full access:

| Key | Choice |
| --- | --- |
| `y` | Allow once — this visit to the site |
| `c` | Allow for this conversation |
| `a` | Always allow in this workspace |
| `n` | Deny…, with a reason the agent reads |

Downloads and submitting a sign-in form ask too. The agent never types
passwords; when it needs one it asks you to take over.

To stop being asked in one conversation, choose **Browse freely in this
conversation** from the panel's menu.

## Take over, give back, stop

- **Take over** (`T`) pauses the agent. Use the page yourself — click, type,
  use the address bar — for example to sign in.
- **Give back** (`G`) lets the agent continue; it reads the page again first.
- **Stop** closes the browser and stops the agent from using it until you
  choose **Let Claude browse again**.

## What it can never reach

Files on your computer, Lazybox itself, other programs on your computer (only
this workspace's running previews), and addresses on your private network.
These hold whatever you allow.

## Settings → Browser

- **Default:** ask before each new site (recommended), allow any site, or off.
- **Sites any agent may open without asking**, such as `docs.python.org` or
  `*.example.com`.
- **Downloads:** ask or block.
- Per workspace: its always-allowed sites, and **Clear browser data…** to
  delete its sign-ins, cookies and cache.

How it is built and why: [Agent browser](../../BROWSER.md).
