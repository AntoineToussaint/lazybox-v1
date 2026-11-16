# Voice

Dictation into the message box, spoken commands for the app, and read-aloud.
On-device and private by default. User guide:
[docs/guides/voice.md](docs/guides/voice.md); every setting:
[docs/reference/voice-settings.md](docs/reference/voice-settings.md).

## Shape

```
 key / mic button / palette mic                        Settings → Voice
          │                                                   │ voice:v1 preference
          ▼                                                   ▼
  VoiceLayer (one per window, in CommandCenter)       voice-session.ts
  ⌥Space / ⌥⇧Space keydown+keyup, Esc, the pill  ──▶  one dictation per window
          │                                            engines · targets · read-aloud
          ▼                                                   │
  DictationTarget: Composer (useComposerDictation)            ▼
                   CommandPalette (voice query)        SpeechRecognizerHost (platform)
                                                        ├─ desktop: macOS Speech, on-device
                                                        │   (apps/desktop/src-tauri/src/voice.rs)
                                                        └─ browser: Web Speech (web-speech.ts)
```

- **`packages/surfaces/src/voice/voice-model.ts`** — the pure part, unit-tested
  in `scripts/voice.test.ts`: preferences, spoken commands (EN/FR, trailing
  only, negation-aware), spoken punctuation, how recognizer results (one
  *segment* per stretch of speech; a final settles one) become text, how that
  text joins the draft at the caret, the spoken palette ranking and what voice
  may run, and the speakable form of a reply.
- **`voice-session.ts`** — the live part: the configured engines
  (`configureVoice`, given by the desktop host; the browser's otherwise), the
  dictation targets (palette when open, else the focused or last-focused
  message box), the dictation state machine (starting → listening → stopping →
  idle, or error), the settle timer (`SETTLE_MS`: a command at the end of words
  that did not change for 0.9 s applies — macOS reports one growing stretch and
  no final until it stops), the stop grace (`STOP_GRACE_MS`), and read-aloud.
- **`VoiceLayer.tsx`** — the voice actions in the registry (`voice.dictate`,
  `voice.command`, `voice.stop-reading`), the held keys and `Esc` (window
  capture, before the chord and sequence dispatchers, which skip `hold`
  actions), and the pill. A press shorter than `TAP_MS` (350 ms) turns a hold
  into a toggle.
- **`ComposerDictation.tsx`** — the message box as a target; the live words are
  drawn by an overlay (a transparent copy of the textarea's text with the live
  span tinted and underlined), so the textarea itself stays a plain controlled
  input. Previews are not saved; the draft is saved when the dictation ends.
  Typing or sending takes over.
- **`CommandPalette.tsx`** — a spoken query ranks by words (`spokenScore`), not
  letters in order. `spokenDecision` runs a clear winner (≥ 70 and 12 ahead of
  the next), asks about one that needs a yes (`voiceConfirms`: the person's own
  actions, and any registry action marked `destructive`), and otherwise leaves
  the list to pick from.
- **`useReadAloudReplies.ts`** — reads a reply when its `turn_ended` arrives
  after the conversation came up (and, where the Runner stamps `capturedAt`,
  within 10 s), once across windows (`claimReading`).

## Engines

### macOS: the Speech framework through objc2

`src-tauri/src/voice.rs` drives `SFSpeechRecognizer` with
`requiresOnDeviceRecognition` (when the language supports it),
`SFSpeechAudioBufferRecognitionRequest` fed from an `AVAudioEngine` input tap,
`addsPunctuation` on macOS 13+ (checked with `respondsToSelector`), and
`AVSpeechSynthesizer` for read-aloud. Every Objective-C object lives on the
main thread (thread-locals; commands hop there with `run_on_main_thread`).
Results go only to the webview that started the recognition (`voice-event`,
`EventTarget::webview`). One recognition for the whole app: starting one in a
window cancels another window's.

**Why objc2 and not a Swift helper.** The app already binds AppKit and WebKit
with objc2 (`capture.rs`), at the same crate versions; `objc2-speech`,
`objc2-avf-audio` and `objc2-av-foundation` are the same generated bindings, so
voice adds no toolchain (no `swiftc` in `build.rs`, no Swift runtime to bundle,
no second build system for CI), no process boundary, and no IPC protocol to
version. A helper executable would also be a second TCC identity: macOS
attributes microphone access to the *responsible* process, which for a helper
depends on how it is launched — a trap the in-process code avoids. The cost is
`unsafe` calls against Objective-C APIs; they are confined to `mod native`,
and everything with logic in it (permission mapping, language tags, events,
levels, rates, the privacy-pane URLs) is pure Rust with unit tests.

**Privacy model.** A language without on-device support is refused unless
`allowServer` (Settings: *Use Apple's server when needed*, off by default).
`Status.onDevice` is the recognizer's own `supportsOnDeviceRecognition`; the
UI claims "on-device" only from it. No audio buffer is kept: the tap appends
to the request and returns.

**Permissions.** `Info.plist` (merged into the bundle and embedded in a dev
binary by `tauri-codegen`) carries `NSMicrophoneUsageDescription` and
`NSSpeechRecognitionUsageDescription`; without them macOS kills the app on
the first request. `voice_request_permission` asks for speech recognition,
then the microphone; the first dictation calls it when either was never asked,
so nobody has to find Settings first. A release is signed with the hardened runtime
(`packaging/release.tauri.json`), which denies the microphone unless the app
declares `com.apple.security.device.audio-input`: `src-tauri/Entitlements.plist`,
named by that overlay and checked by `scripts/release/release.test.mjs`.

**Web panels** are child webviews labelled `viewer-…`: they hold no capability
(`host::APP_WEBVIEWS`), so they cannot call `voice_*`, and `viewer.rs` denies
them device permissions. Voice changes neither.

### Browser: Web Speech

`web-speech.ts`: `SpeechRecognition` / `webkitSpeechRecognition`, continuous
with interim results; `processLocally` where the browser offers it
(`SpeechRecognition.available`), and only then `onDevice`. No level: the pill
pulses on `speechstart`/`speechend` (opening a second `getUserMedia` stream
for a meter breaks Safari's recognizer and would prompt twice). Read-aloud is
`speechSynthesis`. The phone web app uses the same code; where the browser has
no recognizer (Firefox, iOS Safari without Siri) the button is hidden and the
keyboard's own dictation works in the text field.

### Optional: local Whisper (design, not shipped)

For higher accuracy on technical vocabulary (identifiers, file names), and for
languages macOS does not offer on-device.

- **Engine.** `whisper.cpp` (MIT) compiled into the desktop host as a static
  library through the `whisper-rs` crate, Metal on Apple silicon, CPU
  otherwise. A third `SpeechRecognizerHost` (`id: 'whisper'`) behind
  Settings → Voice → Engine.
- **Model.** Not bundled. Settings offers *Download model* with the choice and
  its size: `base.en` (142 MB, English), `small` (466 MB, multilingual,
  recommended), `large-v3-turbo` (1.6 GB). Downloaded from the pinned
  Hugging Face revision of `ggerganov/whisper.cpp` into the app's data folder,
  verified against a SHA-256 kept in the source, resumable, cancellable, with
  progress in Settings; deletable there. The only network use, and only on
  that click.
- **Streaming.** Whisper is not streaming. The tap fills a ring buffer at
  16 kHz mono; every 700 ms the last 10–15 s are decoded with the previous
  text as the prompt and emitted as the live segment; a VAD silence of 600 ms
  (or the stop) finalizes the segment — the same `result` events as today, so
  the TypeScript side does not change. Punctuation comes from the model.
- **Vocabulary.** The current workspace's file and symbol names (top N by
  recency) go into the initial prompt, which is where Whisper beats the system
  recognizer for code talk.
- **Privacy.** Always on-device (`onDevice: true`).
- **Cost.** About 1 GB of memory for `small` while dictating, released after a
  minute idle; first decode ~1 s on an M1.
- **Toggle.** `engine: 'whisper'` appears only once a model is installed.

## Tests

- `scripts/voice.test.ts` (in `test:client`): spoken commands EN/FR,
  punctuation, segment folding and settling, joining the draft, palette
  ranking and decisions, read-aloud text, preferences, keymap migration and
  validation of held keys.
- `scripts/test-voice.mjs` (`test:voice`, release gate `voice`): Playwright
  against the fake Runner with a fake speech engine injected into the page
  (a `SpeechRecognition` whose partial and final results the test says, and a
  recording `speechSynthesis`). Live transcript and its marking, editing, hold
  and tap, `Esc`, the pill's buttons, typing over, "new line", "send" with and
  without sending by voice, "annule", Vim normal mode, French, palette voice
  commands with a confirmation, read-aloud of a reply (and not of history, and
  not while dictating), Settings → Voice (privacy note, key recorder,
  language), and a browser without speech recognition. WebKit by default,
  `TEST_CHROMIUM=1` for Chromium.
- `src-tauri/src/voice.rs` unit tests (`make check-desktop`): permission
  states of both frameworks, BCP 47 parsing, the language list, the event
  wire format, levels, privacy-pane URLs, read-aloud bounds.

## Manual checklist: the real macOS engine

CI cannot exercise the microphone or the Speech framework. Before a release
that touches voice, on a Mac (Apple silicon and, if possible, Intel), with a
bundled build (`make build-desktop`, then open the `.app`; a dev binary run
from a terminal is attributed to the terminal by TCC):

1. **Fresh permissions.** (The bundle id is `ai.lazybox.v2.desktop` for a dev bundle, `ai.lazybox.app` for a release.) `tccutil reset Microphone ai.lazybox.v2.desktop` and
   `tccutil reset SpeechRecognition ai.lazybox.v2.desktop`. Settings → Voice
   shows both *Not asked yet*; **Allow…** shows the two macOS prompts with the
   Info.plist sentences; both become *Allowed*. Reset again and press `⌥Space`
   in a conversation instead: the same prompts appear, then *Voice is ready*
   (the held key came up while the prompt had the keyboard).
2. **Denied.** Deny the microphone in System Settings. Settings → Voice shows
   *Blocked*; the button opens Privacy & Security → Microphone; allow it,
   switch back: the state refreshes. `⌥Space` while blocked shows the pill's
   error with **Voice settings**.
3. **Hold to talk, English.** Hold `⌥Space`, say "fix the login bug comma then
   run the tests period", release. The pill shows the red light, a moving
   level, the time and *On-device*; words appear live, underlined; the result
   is "Fix the login bug, then run the tests." Nothing is sent.
4. **Tap, French.** Language *Français (France)*. Tap `⌥Space`, say « corrige
   le test à la ligne puis relance », pause, say « arrête ». Two lines; the
   light goes off.
5. **Send.** Turn on *Send when I say "send"*; dictate "ship it send": the
   message "Ship it" is sent once. Turn it off; "send" only stops, with the
   *Press ↵ to send* note.
6. **Cancel.** Dictate, press `Esc`: the draft is as before. Say « annule »:
   same.
7. **On-device only.** Pick a language marked *needs Apple's server* with the
   switch off: dictation refuses with the System Settings hint; with Wi-Fi off
   and an on-device language, dictation still works.
8. **Palette.** Hold `⌥⇧Space`, say "next agent that needs me": the
   conversation opens. Say "tell the agent to continue" (an action of yours):
   it asks; "yes" runs it.
9. **Two windows.** Start dictation in a detached chat, then press `⌥Space` in
   the main window: the first stops (one microphone). Close a window while
   dictating: the menu-bar microphone indicator turns off.
10. **Read aloud.** Replies: *First paragraph*, a voice and 1.3×; **Play a
    sample**; let an agent finish a turn: its first paragraph is read once,
    even with the conversation open in two windows; `Esc` stops it. Start
    dictating while it reads: reading stops.
11. **The indicator.** At no point is the macOS microphone indicator (orange
    dot in the menu bar) on without the pill's red light, and vice versa.
12. **Web panel.** Open a site that asks for the microphone in a Web panel: it
    is refused, and no prompt appears.
