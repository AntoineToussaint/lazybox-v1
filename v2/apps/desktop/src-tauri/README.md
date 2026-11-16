# Native desktop host

This independent Cargo workspace contains the Tauri 2 native host. It reads `LAZYBOX_V2_ENDPOINT` supplied by `make desktop`, validates the local origin and bearer, and grants the native HTTP plugin access to that exact Runner RPC origin/path at runtime. The bundled frontend uses a Tauri bootstrap command and native HTTP fetch. No browser/Vite server is needed.

Native console windows carry only validated session/command identities in their navigation. The Runner remains an independent Codefly Go process. `make check-desktop` runs format, unit tests, and clippy. No V1 Rust or daemon implementation is imported; only the existing application icon assets are reused.

Windows use HTML5 file drops in the shared chat component. The native Tauri drag/drop handler is disabled so it does not consume those events. Dropped files use the same browser File API and Runner upload as the picker; no additional filesystem or authentication permissions are granted.

Attention notifications go through the host: the webview holds no notification permission, only the `notify_attention`, `set_attention_badge` and `take_attention_destination` commands (`src/attention.rs`, on `tauri-plugin-notification`). Only the main window sends them. A click on a notification opens or focuses the main window and hands it the conversation to show; the destination waits in the host until the window takes it, so a click that reopens a closed main window is not lost. The dock badge is the needs-input count (macOS, and Linux desktops that support it).
