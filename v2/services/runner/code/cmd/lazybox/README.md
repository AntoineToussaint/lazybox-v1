# V2 test CLI

Build with `make build-go` from `v2/`. `bin/lazybox` calls the generated Runner API and publishes transparent log pipes. It requires the Runner endpoint file; it never resolves V1 daemon state. See `v2/RUNNING.md`.

In a Lazybox workspace terminal it needs no flag: `cmd 2>&1 | lazybox log [--title CMD] [--to CONVERSATION]` and `lazybox run [--to CONVERSATION] -- cmd` publish to the workspace's console with the terminal's own credential. See `v2/TERMINALS.md`.
