# Release validation

The deterministic release gate has one owner:
[`scripts/release-gates.json`](scripts/release-gates.json). Staging and
`make check-release` / `make check-dogfood` run the same ordered catalog, and
per-change [CI](#ci) runs it in parallel jobs. Codefly still owns service generation and transport validation;
the catalog delegates those checks to the existing Make targets.

```sh
make -C v2 list-release-gates
make -C v2 check-release
# Focused iteration; these receipts cannot promote a release:
cd v2
node scripts/release-gates.mjs run ui
node scripts/release-gates.mjs run core
node scripts/release-gates.mjs run native
node scripts/release-gates.mjs run ui --only inbox,chat-scroll   # named gates
node scripts/release-gates.mjs shards ui 3                       # CI's matrix
```

The catalog covers core Go/TypeScript/contracts/worker checks, native desktop
checks and all isolated UI fixtures, including continuity, scrolling, navigation,
activity and sidebar tests previously omitted by staging. The responsive-shell
gate covers desktop/tablet/phone navigation, visible composition controls and
retained chat DOM/drafts/event readers across panel switches and resize. The inbox
gate covers attention counts across workspaces, grouping, keyboard, mark-seen,
opening in the owning workspace, sidebar unread markers and notifications on
watched transitions only. Every npm `test:`
script must be admitted, declared an exact alias, or explicitly classified as
requiring a live environment. Adding a test without classifying it fails the
catalog check. This does not imply that every conceivable test already exists.

Native checks build the frontend assets required by Tauri before compiling its
embedded context, so they work from a clean snapshot rather than relying on a
previous desktop build. Deterministic gates remove inherited live-Runner/provider
opt-ins and source/watcher test overrides; `make test` supplies its own freshly
built worker path. Explicit live tests remain separate commands.

The live browser/provider test stays explicit because it needs a selected Runner
and credentials. Real-device, remote Hub, native service recovery and provider
qualification remain separate roadmap gates. A deterministic pass is not a
claim that the phone development journey is released.

## CI

[`.github/workflows/v2.yml`](../.github/workflows/v2.yml) runs on every pull
request that touches `v2/**` (and on pushes to `main`), so a regression fails
the PR that causes it rather than staging. It runs the release catalog split
into parallel jobs:

| Job | Runner | Runs |
| --- | --- | --- |
| `go` | macOS | `make fmt-check check-go`, `make test` at full parallelism, then `make test-outlive` (`-race`, `GOMAXPROCS=1`) |
| `generated` | Linux | `make check-generated`: Codefly + Buf regeneration drift, `buf lint`, `buf breaking` |
| `typescript` | Linux | `make check-workspaces`: typecheck, workspace links, `test:client`, `test:worker` |
| `launcher` | macOS | `make test-environments` |
| `desktop` | macOS | `make check-desktop` |
| `ui` ×3 | macOS | every `scope: "ui"` gate, through this gate runner |

The UI matrix comes from this catalog, never a copy of it:
`release-gates.mjs shards ui <count>` splits the UI gates into disjoint shards,
and each shard runs `release-gates.mjs run ui --only <ids>`, so it gets the same
environment scrubbing, process groups and deadlines as staging. An `--only`
report records its selection and can never promote a release. Adding a gate to
the catalog adds it to CI with no workflow edit; an unclassified `test:` script
fails the first job, as it fails staging. A failed shard uploads the
screenshots its suites saved (`v2/.cache/*.png`, `/tmp/lazybox-*.png`) and its
gate report. The suites drive Playwright as a library, so there are no traces.

macOS is where the product's platform matters. The Runner does not compile for
Linux today (`internal/processguard` calls `syscall.Getsid`, which Go defines
only for darwin/BSD), the launcher and Working packaging refuse other hosts,
Tauri embeds WKWebView, and the UI suites drive Playwright WebKit with layout
and scroll assertions written on macOS. The repository is public, so macOS
runners cost no minutes; their limit is five concurrent jobs per account, so
one of these six macOS jobs can queue behind the others.

`generated` installs the Codefly CLI release that produced the committed output
(pinned in the workflow, checksum-verified; v0.1.212 reproduces it byte for byte). `codefly sync` downloads the
pinned `go-grpc` agent and generates in its public `ghcr.io/codefly-dev/proto`
companion image through the runner's Docker, so it needs no Codefly login.

Not in CI, and why:

- `test:browser`, `make test-real*` and every other live/provider test: they
  need a selected live Runner and provider credentials (the catalog's
  `external` entries). CI holds neither.
- `make stage`/`promote` and the real Tauri app bundle: per-change CI checks
  the desktop crate (fmt, tests, clippy) but does not build, sign or launch
  the `.app`. The release workflow does, on a `v2-v*` tag (below).
- Real-device, remote Hub, native service install and provider qualification:
  separate roadmap gates, as above.

### Release

[`.github/workflows/v2-release.yml`](../.github/workflows/v2-release.yml)
runs on a `v2-v<x.y.z>` tag. Its first job *is* this workflow
(`workflow_call`), so a release passes exactly the gates a pull request does;
only then does it build, sign and smoke-test the installable app
(`make release`, [RELEASING.md](RELEASING.md)) and publish it. The smoke test
starts the built standalone Runner in a temporary state directory, checks the
bundled CLI reaches it with the same version, and stops it.

`v2 ci` is one check that passes only when every job did. It runs only when the
workflow does, so requiring it in branch protection needs a paths-aware rule;
otherwise a PR without `v2/` changes waits on a check that never starts.

## Evidence and promotion

Each run records its profile, catalog fingerprint, initial/final source digest,
platform, command/arguments, result, exit code and elapsed time per gate. A failed
gate does not suppress later diagnostic results. Cancellation leaves explicit
not-run results. Each gate owns a process group, has a deadline, and uses the
existing launcher cleanup for its descendants. Cleanup failure cannot become a
passing gate.

The policy fingerprint includes npm script commands, the catalog, Makefile and
gate runner implementation. Source mutation during checking fails the run.
Receipts are local validation records, not signed attestations against a malicious
operator with write access to the release store. External toolchain distributions
still need P00/P02 version qualification and packaging.

`stage` runs inside its frozen candidate, saves `gates.json` there, and writes
release metadata version 2 only after the full catalog and desktop build succeed.
`promote` requires every expected gate to have passed for the exact source and
current policy, plus the original app/source/compiled-worker hashes. Missing, failed, partial,
outdated-policy or legacy metadata cannot replace the Working pointer. A changed
policy requires a freshly staged candidate.

Already pinned version-1 installations can still launch; existing user state is
not migrated or interrupted. They cannot be newly promoted under the stronger
rules. Version-2 launch verifies the receipt against its frozen policy. Updating
Dev's policy does not silently invalidate a running Working release.

Default reports go under `.cache/gates-<profile>.json`; `--report <path>` selects
another output. Run mutable-tree validation while editing is idle, or use
`make stage` for a separate snapshot. Dependencies and generated outputs may be
validated/rebuilt; source changes are reported, not silently blessed.

## Flake detection

A gate that fails once and passes on a re-run is a race or wrong
synchronisation until its cause is found. Re-running until green or raising a
timeout hides it. Reproduce it first, under the conditions that expose it:

```sh
make -C v2 stress-go RUN='^TestName$' PKGS=./internal/runner [COUNT=50] [LOAD=15]
make -C v2 stress-ui SUITES='chat-polish file-navigation' [RUNS=10] [PARALLEL=3] [LOAD=0]
```

`stress-go` runs `go test -race` with `GOMAXPROCS=1`, alongside `LOAD` busy
loops (default: one per core). `stress-ui` runs each suite `RUNS` times in
`PARALLEL` lanes at once, so suites contend for the machine and anything they
share. Both report failures per test, keep each failing run's log, and never
retry. Record the failure rate before and after the fix, with the run count.
A diagnosis is confirmed by widening the suspected window, for example a delay
just before the operation, until the test fails every time, and showing that
the fix passes with that delay still in place.

Shared state between UI suites stays out of the way by design. Each suite has
its own Vite dependency cache (`scripts/fixtures/vite-cache.mjs`), because
suites with different configs otherwise rewrite one shared cache under each
other. `test:transcript-performance` bounds a long conversation's opening
relative to a short calibration conversation opened alongside it. The
absolute budgets apply only with `PERF_STRICT=1`, on a quiet machine.

## Watcher diagnostic

```sh
cd v2
node scripts/diagnose-ui-watcher.mjs
```

This compares Vite's default, native and polling backends in a disposable
directory, alongside Node's file watcher, then cleans up. It returns failure if
the default backend misses the change. It does **not** configure a fallback or
change Dev. The existing real-browser CSS reload test remains required.

On the current macOS machine, FSEvents delivery fails. The native backend delivers
changes but can hang during directory-watcher shutdown in libuv's FSEvents path.
The direct macOS API also starts without delivering events. See the existing
[upstream report](https://github.com/fsevents/fsevents/issues/406).

**Explicit compatibility stopgap (not an upstream fix):** Dev defaults to Vite's
polling backend on macOS, with a 250 ms text / 1,000 ms binary interval. Tauri's
native tree and source-local caches are excluded. Other platforms retain Vite's
default. `LAZYBOX_V2_UI_WATCHER=default|native|polling` selects a backend explicitly;
the launcher reports it. The deterministic gate checks the shipped default, not
an inherited override. Remove this stopgap after notification delivery **and
shutdown** pass on the supported macOS/toolchain combination.

The real browser gate still requires live CSS replacement, nested atomic saves,
private-path rejection and complete server shutdown. A passing configured-backend
gate does not mean the upstream FSEvents problem was fixed. The raw diagnostic
deliberately continues to fail while its default-backend probe fails.
