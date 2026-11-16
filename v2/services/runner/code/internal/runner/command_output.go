package runner

import (
	"os"
	"strings"
)

// commandBriefing tells every coding agent how to run noisy commands. It is
// part of the Runner, not the editable settings, so it changes with the
// binary instead of needing a settings migration.
const commandBriefing = `## Running commands in Lazybox
Run tests, builds, linters, installs and other noisy commands as ` + "`lazybox run -- <command>`" + ` instead of calling them directly. The user sees the full output live in the Lazybox console. You receive a compact view: the exit status first, failures and errors kept, passing and progress lines dropped, and the path of a file with the full output whenever something was dropped or the command failed. The exit status is the command's own.
- Do not pipe through head, tail or grep, and do not add 2>&1. lazybox already captures both streams and keeps the failures; truncating the output yourself can hide the error.
- For shell syntax (pipes, &&, redirects), wrap it: ` + "`lazybox run -- sh -c '...'`" + `.
- If you need a line that was dropped, read the full-output file it printed instead of running the command again.
- Use ` + "`lazybox run --raw -- <command>`" + ` only when you must parse the exact output, such as a diff or JSON.
- Commands get no input. Pass non-interactive flags (--yes, CI=1) rather than waiting for a prompt.
- Start long-running servers and watchers with the Lazybox command tool, which runs them in the background, not with lazybox run.`

// withCLI puts the lazybox CLI first on PATH so agents, and the commands they
// start, run this Runner's CLI rather than another lazybox on the system.
func (b *Bench) withCLI(env []string) []string {
	if b.Config.CLIDir == "" {
		return env
	}
	out := make([]string, 0, len(env)+1)
	path := os.Getenv("PATH")
	for _, entry := range env {
		if value, ok := strings.CutPrefix(entry, "PATH="); ok {
			path = value
			continue
		}
		out = append(out, entry)
	}
	return append(out, "PATH="+b.Config.CLIDir+string(os.PathListSeparator)+path)
}
