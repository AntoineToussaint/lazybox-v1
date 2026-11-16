# Contributing to Lazybox V2

Glad you're here. By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md), and by opening a pull request you agree
to the [Contributor License Agreement](CLA.md).

## Build and run

Requirements: macOS, Go (see `services/runner/code/go.mod`), Node.js 24 or
later with npm 11, a stable Rust toolchain (`rust-toolchain.toml`), the
[Codefly](https://github.com/codefly-dev/cli) CLI, and Docker for code
generation checks. `tmux` is needed for the session-host tests.

```sh
make deps            # locked npm dependencies
make dev             # build and run Lazybox Dev with its own Runner and state
make check           # format, vet, typecheck, generated code, Go and client tests
make check-desktop   # Tauri crate: fmt, tests, clippy
make check-release   # the full deterministic release catalog, UI suites included
```

[RUNNING.md](RUNNING.md) and [ENVIRONMENTS.md](ENVIRONMENTS.md) describe
launching, Dev and Working, and state locations.

## Standing rules

1. **Tests with every change.** Every bug fix lands with a regression test that
   fails without the fix. UI behaviour gets a Playwright suite registered in
   [`scripts/release-gates.json`](scripts/release-gates.json); CI runs every
   registered gate.
2. **Never hand-edit generated code.** Edit `services/runner/proto/api.proto`
   and run `make generate`. Wire changes stay compatible with
   `contracts/runner-v1.binpb` unless a decision in
   [DECISIONS.md](DECISIONS.md) says otherwise.
3. **Agents outlive the Runner.** Changes keep agents, their commands and
   terminals alive across a Runner restart; `make test-outlive` checks it.
4. **No V1 code without review.** Reusing anything from
   [lazybox-v1](https://github.com/AntoineToussaint/lazybox-v1) goes through
   [REUSE_AUDIT.md](REUSE_AUDIT.md).
5. **Docs are code.** The PR that changes behaviour updates the document that
   describes it.
6. **Conventional Commits** for commit messages and pull request titles.

Agent-specific guidance is in [AGENTS.md](AGENTS.md).

## Reporting bugs and requesting features

See [SUPPORT.md](SUPPORT.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).
