package runner

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/runner/commands"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/telemetry"
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

// outputEnv names the execution's directory for full-output files. The CLI
// creates it on first use, and falls back to OutputFallbackRoot when a sandbox
// does not let it write there (Codex's workspace-write allows only the
// workspace and the temp directories).
func (b *Bench) outputEnv(id string) string {
	return "LAZYBOX_V2_OUTPUT_DIR=" + filepath.Join(b.Config.OutputRoot, id)
}

// FinishPipe ends a pipe capture and keeps what a `lazybox run` gave its agent:
// on the command, for the console, and in telemetry, to measure the savings.
func (b *Bench) FinishPipe(c *commands.Command, cause error, report *commands.Report) error {
	if err := c.FinishPipeWith(cause, report); err != nil {
		return err
	}
	if report == nil {
		return nil
	}
	state := c.Status()
	if b.Telemetry != nil {
		run := telemetry.CommandRun{ID: state.ID, Scope: telemetry.Scope{Execution: state.Spec.SessionID}, Filter: report.Filter, ExitCode: report.ExitCode, OutputBytes: report.OutputBytes, AgentBytes: report.AgentBytes}
		if e, err := b.Get(state.Spec.SessionID); err == nil {
			run.Scope.Workspace, run.Scope.Conversation = e.CollectionID, e.Saved.ConversationID
		}
		ctx, cancel := context.WithTimeout(b.ctx, 5*time.Second)
		// The capture is already complete: a lost measurement must not fail it.
		_ = b.Telemetry.PutCommand(ctx, run)
		cancel()
	}
	b.trimOutput()
	return nil
}

// trimOutput bounds full-output files in the background, one sweep at a time.
func (b *Bench) trimOutput() {
	if !b.trimming.CompareAndSwap(false, true) {
		return
	}
	b.trims.Add(1)
	go func() {
		defer b.trims.Done()
		defer b.trimming.Store(false)
		_ = trimOutput([]string{b.Config.OutputRoot, b.Config.OutputFallbackRoot}, b.Config.OutputBudget, time.Now().Add(-outputGrace))
	}()
}

// outputGrace keeps a file the agent was just pointed at, even over budget.
const outputGrace = time.Hour

// trimOutput deletes the oldest full-output files until the roots together
// hold at most budget bytes. Files modified after keep are never deleted, and
// a session directory the sweep empties is removed.
func trimOutput(roots []string, budget int64, keep time.Time) error {
	type file struct {
		path string
		size int64
		mod  time.Time
	}
	var files []file
	var total int64
	var failures []error
	for _, root := range roots {
		if root == "" {
			continue
		}
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					return nil
				}
				return err
			}
			if !d.Type().IsRegular() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil // removed while walking
			}
			files = append(files, file{path, info.Size(), info.ModTime()})
			total += info.Size()
			return nil
		})
		if err != nil {
			failures = append(failures, err)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	for _, f := range files {
		if total <= budget || f.mod.After(keep) {
			break
		}
		if err := os.Remove(f.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			failures = append(failures, err)
			continue
		}
		total -= f.size
		if dir := filepath.Dir(f.path); !slices.Contains(roots, dir) {
			_ = os.Remove(dir) // succeeds only once the directory is empty
		}
	}
	return errors.Join(failures...)
}

// removeOutput deletes one execution's full-output files, wherever the CLI put them.
func (b *Bench) removeOutput(id string) error {
	var failures []error
	for _, root := range []string{b.Config.OutputRoot, b.Config.OutputFallbackRoot} {
		if root == "" {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, id)); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
