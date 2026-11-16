# Claude SDK worker

`main.ts` hosts the pinned supported Agent SDK, streaming input, native permission/question callbacks, images, interruption, and managed command tools. `settings.ts` gives only the Help assistant the `lazybox_settings` MCP server: reading Lazybox's settings needs no approval, and an update runs only for an input the user allowed on its approval card. Go owns queueing, journals, account context, and command execution. Build with `make build-worker`; see `RUNNING.md` for limits.
