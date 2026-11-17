# Extensions: panels you add

An extension is a panel you write in HTML, JavaScript and CSS — a board of
your agents, a cost dashboard, a view of your own service — and keep in a
folder. It runs in a sandbox, apart from Lazybox, and can read and do **only
what you allow** it, which Lazybox shows you in words before it runs. It cannot
read your files, terminals or messages, run commands, change a setting, see a
credential, or reach any site you did not allow.

## Try one

1. **Panels → New Extensions panel** (or ⌘K, *Show Extensions*).
2. Under **Examples**, **Add** the *Agent board* or the *Cost dashboard*.
3. Read the sheet: what it can see, what it can do, where it can connect.
   **Allow and turn on** — or **Not now**.

The *Agent board* shows every conversation as a card in a column of what it
needs from you (needs you, failed, ready for review, working, done). Click a
card to show its conversation; **Next** and **Inbox** run those actions of the
app. The *Cost dashboard* shows what your agents spent, by model, workspace and
conversation.

The panel's bar switches between your extensions (*All extensions…* lists
them, and what waits for your approval), shows what the one in front may do
(the shield) and reloads it.

## What an extension may do

When you allow an extension, you allow exactly the grants its sheet lists:

| In the sheet | Grant |
| --- | --- |
| See your workspaces | `read:workspaces` |
| See your conversations (titles, status — not messages) | `read:sessions` |
| See what needs you | `read:attention` |
| See a conversation's commands (not their output) | `read:commands` |
| See your missions | `read:missions` |
| See token use and cost | `read:usage` |
| Show a conversation | `show:conversations` |
| Run “Open the inbox” (one action that only shows, focuses or arranges) | `do:inbox.open` |
| Send messages as you | `send:messages` |

and the network hosts it lists, if any (“what it can see, it could send to
these sites”). Everything else is refused; the panel says so quietly
(“*Agent board asked to send messages as you; you have not allowed it*”, with
**Review access**).

**Updates.** If an extension's files change to ask for more, it keeps running
with what you allowed and shows **Asks for more** in Settings and in its panel
bar; the sheet marks what is new. Asking for less needs nothing from you.

**Settings → Extensions** lists them all with what each may do: the switch
turns one off or on, **Access** shows the sheet again, × removes it (its
folder and what you allowed).

## Make your own

```sh
lazybox extension new my-panel          # ~/.config/lazybox/extensions/my-panel
lazybox extension validate my-panel     # every problem by file:line
```

That writes `extension.yaml`, `index.html`, `app.js`, `style.css` and
`lazybox.d.ts` (the bridge's types, for your editor). Open a **New Extensions
panel**, review and allow it, and edit: **every save reloads the panel**.

```yaml
# extensions/my-panel/extension.yaml
lazybox: 1
name: My panel
panels:
  - {id: main, title: My panel, icon: puzzle, entry: index.html}
grants: [read:attention]
network: [https://api.example.com]     # or [] for none
```

```html
<!-- index.html: Lazybox serves _lazybox/ to every extension -->
<link rel="stylesheet" href="_lazybox/lazybox.css">
<script src="_lazybox/lazybox.js"></script>
<script src="app.js" defer></script>
```

```js
// app.js
lazybox.every(5000, async () => {
  const { items } = await lazybox.attention.list();
  render(items.filter(i => i.state === 'needs-input'));
});
```

- **Use the theme.** `lazybox.css` and `lazybox.js` set the person's theme as
  CSS variables — `var(--surface)`, `var(--text)`, `var(--text-muted)`,
  `var(--accent)`, `var(--line)`, `var(--chart-1)`… — and update them when it
  changes. Use them and your panel matches dark, light and every theme.
- **Scripts and styles live in files.** The sandbox refuses inline `<script>`,
  `<style>`, `style="…"` and `eval`. Setting `element.style.width` from your
  script is fine.
- **No storage, no popups, no leaving the panel.** `localStorage` and cookies
  throw; links and forms do nothing outside the panel.
- **The network** is only the hosts in `network:`, over https (or a service on
  this computer, `http://localhost:PORT`).

Every call, its grant and what it returns: [the bridge
reference](../reference/extensions.md). How it is kept safe:
[EXTENSIONS.md](../../EXTENSIONS.md).
