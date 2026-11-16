# Remote control from a phone

Status: first increment implemented 2026-11-16. A phone paired by QR code
follows and answers the agents on a local Runner from anywhere on the owner's
tailnet. Push notifications, the native iPhone app and an off-tailnet relay are
deferred (below). This is a Runner-local capability; it does not replace the
Hub's device identity in [device experience](DEVICE_EXPERIENCE.md).

## What the person does

1. **Settings → Devices → Access from your phone → Turn on.** The Runner asks
   Tailscale to serve its device gateway on this machine's tailnet name over
   HTTPS (`https://<machine>.<tailnet>.ts.net:8443`). The card says exactly
   what is missing when it cannot (Tailscale not installed, not signed in,
   HTTPS certificates off, port taken, Funnel on).
2. **Pair a phone.** A QR code appears at once, with the usual grants
   ("See conversations · Reply, answer and approve"); **Change** lets the
   owner add "Start conversations" or drop replying, which issues a new code.
   The code works once and for five minutes; the dialog counts down, follows
   it, and closing the dialog withdraws it.
3. **On the phone**, the camera opens the link. The page lists what the phone
   will be able to do, proposes a name ("iPhone"), and **Pair this phone**
   creates the phone's key. Both screens then show the same key fingerprint.
4. **The phone's inbox** groups every conversation by what it needs — needs
   input, failed, ready for review, working, done — across workspaces. A
   conversation shows its transcript, its pending approval or question with
   Allow/Decline or an answer form, and a composer above the keyboard. Back
   (button or gesture) returns to the inbox. Interrupt is there while a turn runs.
5. **Settings → Devices** lists each paired phone with its grants, fingerprint,
   paired date and last seen ("Active now"), and **Revoke**, which signs the
   phone out at its next request; the phone then says so and forgets its key.

## Threat model

Assets: the owner's bearer (can do anything), provider and GitHub
credentials, the ability to approve tool calls (code execution on the
machine), conversation content.

| Adversary | What they could try | What stops it |
| --- | --- | --- |
| Anyone on the same Wi-Fi / LAN | Reach the Runner's ports | Every Runner listener, including the device gateway, binds loopback only and refuses to start otherwise. Nothing listens on the LAN. |
| The internet | Reach the gateway | The route is `tailscale serve` (tailnet only), never Funnel. The Runner refuses to serve a port where Funnel is on, and the gateway rejects any request Tailscale marks as having come through Funnel (`Tailscale-Funnel-Request`). |
| Another device on the owner's tailnet (or a shared tailnet) | Call the gateway | It needs a device credential. The gateway's RPC endpoint accepts device credentials only; pairing needs an unexpired, unused one-time code that only the owner's screen shows. |
| Someone who photographs the QR code | Pair their own phone | The code works once and for 5 minutes; the owner's dialog shows which device paired, with its name and key fingerprint, and Revoke is one click. Closing the dialog withdraws an unused code. (Residual risk: a photograph used within that window before the owner's phone.) |
| Brute-forcing a code | Guess the secret | 256-bit secret; five wrong attempts burn the offer; 30 pairing attempts per minute per gateway. |
| A stolen access credential (logs, a proxy) | Replay it | It lasts 15 minutes and stops at once on revoke. Credentials are bearer headers, never cookies, so there is no CSRF; no CORS headers are sent. |
| A copy of the phone's storage | Become the phone | The phone's ECDSA P-256 private key is a non-extractable WebCrypto key: script can sign with it but cannot read it. A new credential needs a fresh single-use challenge signed with it. |
| A paired phone (lost, or a mistaken grant) | Escalate | The device allowlist (below) is exhaustive and pinned by tests; settings, subscriptions, GitHub, terminals, commands, files, deletion, processes, restart and device management are unreachable. Changing an agent's permission mode (e.g. to yolo) is refused even with every grant. Info hides account usage, emails, sign-in flows and gateways. |
| An agent on this machine | Use the phone's authority | Agent and terminal credentials are refused by the gateway; device credentials are refused by the owner's listener. |
| A malicious page | Frame or script the phone app | `Content-Security-Policy` with `script-src 'self'`, `frame-ancestors 'none'`, `form-action 'none'`, `no-referrer`, `nosniff`. |

Out of scope, as for agent credentials ([resource ownership](RESOURCE_OWNERSHIP.md#agent-credentials)):
another process running as the same OS user can read the Runner's state
directory. Tailscale's coordination server distributes WireGuard public keys;
its relays (DERP) see only ciphertext. Trusting Tailscale for tailnet
membership is a deliberate dependency of this increment.

## Decision: transport

| Option | Verdict |
| --- | --- |
| (a) LAN listener with TLS and a scoped token | Rejected. A phone browser cannot trust a self-signed certificate without warnings or a profile install; without a trusted origin there is no WebCrypto (secure context), no service worker and no web push. It also puts a Runner port on the LAN, and works on-LAN only. |
| (b) Relay with end-to-end encryption (V1 `crates/relay` + `crates/e2e-channel`, Noise IK) | Deferred to the native iPhone app. In a web page the relay (or whoever serves the page) also serves the code that does the encryption, so it could serve code that leaks the keys: that is not end to end. A signed native app can pin the Runner's key from the QR code, which is exactly V1's Noise IK model. It also needs an operated relay. |
| (c) Tailscale (`tailscale serve`) | **Chosen.** WireGuard between the phone and this machine, end to end; reachable off-LAN; tailnet-only; a real `*.ts.net` certificate, so the phone gets a secure context (WebCrypto, installable app, a path to web push) — with no infrastructure for us to run and no port on the LAN. The cost: the phone must have Tailscale and be in the owner's tailnet. |

Tailscale is the transport, not the authority: a tailnet peer still needs a
paired device credential, and the gateway still refuses the owner's bearer.

## Design

```
phone (Safari) ──WireGuard/HTTPS──▶ tailscale serve :8443 ──▶ device gateway 127.0.0.1:<port>
                                                                 ├─ /                   built phone app (apps/web/dist)
                                                                 ├─ /remote/v1/pair     one-time code + key proof
                                                                 ├─ /remote/v1/challenge, /session  sign-in
                                                                 └─ /lazybox.bench.v1.RunnerService/*  DeviceAuthority only
owner's windows ──▶ Codefly Connect/gRPC listeners on loopback ──▶ LocalAuthority (owner, agent, terminal)
```

- **Gateway** (`internal/remote/gateway.go`): a second loopback listener in
  the Runner process, on the port it used before (`<state>/remote.json`) so the
  Tailscale route survives restarts. Its RPC endpoint is a separate gRPC server
  with `transport.DeviceAuthority` alone, transcoded to Connect like the
  owner's listener. The Tailscale choice is remembered and restored at start;
  the route is never touched if another service owns the port
  (`internal/remote/tailscale.go`). The HTTPS port is `remote.httpsPort` in the
  Runner configuration (default 8443).
- **Pairing** (`internal/devices`): `BeginDevicePairing` (owner only) creates
  an offer: 128-bit id, 256-bit secret kept only as SHA-256, five minutes. The
  QR link is `https://<host>:8443/?view=remote#pair=<id>.<secret>&grants=…` —
  the secret is in the fragment, which browsers never send, so it reaches no
  server or proxy log, and the phone removes it from history at once. The
  phone generates a non-extractable ECDSA P-256 key and sends its SPKI public
  key, a name, and a signature over `lazybox-device-pair-v1\0<id>\0<key>`. The
  offer is consumed atomically; a used, expired, cancelled or burned offer
  pairs nothing.
- **Sign-in**: the phone asks for a challenge (32 random bytes, 60 s, single
  use, bound to the device) and signs `lazybox-device-session-v1\0<device>\0<challenge>`.
  The answer consumes the challenge whatever the outcome. The credential is
  `lbx-device.<device>.<expiry>.<HMAC>` under `<state>/device-credential.key`,
  checked on every call against the device record: revoking deletes the
  record, so the next call fails. The phone renews 90 s before expiry, and on
  any refused call through the existing `RunnerLink` renew path.
- **Records**: `<state>/devices.json` (0600): id, name, public key, grants,
  paired and last-seen times (written at most once a minute). No credential is
  ever written to disk.

### What a device may call

Pinned by `TestDeviceAllowlistIsPinned`; every other RPC is denied to a device
holding every grant (`TestDeviceCredentialIsDeniedEveryRPCOffTheAllowlist`).

| Grant | RPCs |
| --- | --- |
| `read` (always) | `Info` (redacted), `ListHistory`, `GetSession`, `ListCollections`, `GetCollection`, `ListWorkspaceChanges`, `ReadWorkspaceDiff`, `ListCommands`, `ReadCommand`, `ReadAttachment` (images a sent message carried); streams `WatchEvents`, `WatchOutput` |
| `respond` (default) | `Apply` with message, steer, interrupt, answer or approval — never permission |
| `start` (opt-in) | `OpenSession` only in an existing workspace with no directory, resume reference, permission, gateway or instructions override; `ResumeSession` |

## Verification

- Go: `internal/devices` (offer expiry, single use, burn after wrong secrets,
  proof of key, challenge replay/expiry/cross-device, forged/rebound/extended
  credentials, revoke, restart persistence, file modes, a real WebCrypto
  signature vector); `internal/transport` (pinned allowlist, exhaustive
  denial over the generated service description, per-grant enforcement,
  approval from a phone while agents still cannot, credentials do not cross
  listeners, revoke, Info redaction, Connect); `internal/remote` (HTTP pairing
  journey, JSON/POST/size limits, security headers and Funnel refusal on every
  path, static serving without traversal, loopback bind and port reuse,
  Tailscale states, HTTPS-only/loopback-only serve, never replacing another
  service, restore after restart).
- `scripts/remote-device.test.ts`: the phone's key is not extractable, only
  the public key leaves it, challenges are not reused, a used code and a
  revoked device are reported.
- Playwright against the fake Runner (`test:remote-pairing`,
  `test:remote-inbox`): the Settings flow and QR code, the phone pairing with
  real WebCrypto signatures checked by the fixture, matching fingerprints,
  replay refused, expiry, withdrawal, revoke signing the phone out; the phone
  inbox, approve, answer, reply, interrupt, back gesture, read-only phone, 320
  and 390 px widths, and that the phone sent only device credentials and
  called only allowlisted RPCs.

**Not verified:** a real `tailscale serve` (the tests use a fake CLI; the
command form is `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`
and `tailscale serve --https=<port> off`, as documented by Tailscale), a real
phone on a tailnet, iOS Safari's IndexedDB persistence of non-extractable keys
across app restarts, and the `Tailscale-Funnel-Request` header name, which is
defence in depth on top of refusing Funnel ports.

## Deferred

- **Push notifications.** Web push needs a service worker, VAPID keys, the
  Runner sending to Apple/Google push services, and on iOS a home-screen
  install (iOS 16.4+). The origin is now HTTPS and the app has a manifest, so
  this is possible; until then the phone's tab title carries the needs-input
  count and the inbox refreshes while open.
- **Off-tailnet access** through V1's relay with Noise IK, in the native iPhone
  app (see the decision above).
- A phone revoking itself on the Runner ("Forget pairing" only clears the
  phone); per-workspace grants; reviewing diffs and files on the phone (the RPCs
  are readable, the screens are not built); starting a conversation from the
  phone (the grant exists; the screen does not).
- Hub-level device identity and multi-human attribution (D05).
