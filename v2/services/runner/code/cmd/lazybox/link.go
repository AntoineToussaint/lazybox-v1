package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/AntoineToussaint/lazybox/v2/internal/installation"
	"golang.org/x/sys/unix"
)

// `lazybox link` puts this release's CLI on PATH and installs its shell
// completions, without sudo; `lazybox uninstall` takes back exactly what it
// created, from the record it keeps (links.json in the support directory).

type linkRecord struct {
	Links       []string `json:"links"`
	Completions []string `json:"completions"`
}

func recordPath(p installation.Paths) string { return filepath.Join(p.Support, "links.json") }

func readRecord(p installation.Paths) linkRecord {
	var r linkRecord
	if data, err := os.ReadFile(recordPath(p)); err == nil {
		_ = json.Unmarshal(data, &r)
	}
	return r
}

func writeRecord(p installation.Paths, r linkRecord) error {
	if err := os.MkdirAll(p.Support, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(recordPath(p), append(data, '\n'), 0o600)
}

func writable(dir string) bool {
	info, err := os.Stat(dir)
	return err == nil && info.IsDir() && unix.Access(dir, unix.W_OK) == nil
}

// linkDirectory is where the CLI is linked: /usr/local/bin when this person
// can write it without sudo, otherwise ~/.local/bin (created).
func linkDirectory(home string) string {
	if writable("/usr/local/bin") {
		return "/usr/local/bin"
	}
	return filepath.Join(home, ".local", "bin")
}

// completionFile is where a shell loads a user-installed completion from.
func completionFile(shell, home, xdgData string) (path, hint string) {
	if xdgData == "" || !filepath.IsAbs(xdgData) {
		xdgData = filepath.Join(home, ".local", "share")
	}
	switch shell {
	case "zsh":
		for _, dir := range []string{"/opt/homebrew/share/zsh/site-functions", "/usr/local/share/zsh/site-functions"} {
			if writable(dir) {
				return filepath.Join(dir, "_lazybox"), ""
			}
		}
		dir := filepath.Join(xdgData, "zsh", "site-functions")
		return filepath.Join(dir, "_lazybox"), "add `fpath=(" + dir + " $fpath)` before `compinit` in ~/.zshrc"
	case "bash":
		return filepath.Join(xdgData, "bash-completion", "completions", "lazybox"), "needs bash-completion 2 (`brew install bash-completion@2`)"
	case "fish":
		return filepath.Join(home, ".config", "fish", "completions", "lazybox.fish"), ""
	}
	return "", ""
}

// ourCLI reports a link that points at a Lazybox release's CLI: this one, or
// an older copy of the app (a link left by a previous install is replaced).
func ourCLI(link, cli string) bool {
	target, err := filepath.EvalSymlinks(link)
	if err != nil {
		target, err = os.Readlink(link)
		if err != nil {
			return false
		}
	}
	return target == cli || strings.HasSuffix(target, "/Contents/Resources/runtime/bin/lazybox")
}

type linkResult struct {
	Link       string   `json:"link"`
	Target     string   `json:"target"`
	Completion string   `json:"completion,omitempty"`
	OnPath     bool     `json:"onPath"`
	Shadowed   string   `json:"shadowedBy,omitempty"`
	Hints      []string `json:"hints,omitempty"`
	DryRun     bool     `json:"dryRun,omitempty"`
}

func (c *cli) link(args []string) error {
	f := c.flags("link")
	dir := f.String("dir", "", "directory to link lazybox into (default /usr/local/bin when writable, else ~/.local/bin)")
	shell := f.String("shell", "", "shell to install completions for: zsh, bash or fish (default: your login shell)")
	noCompletions := f.Bool("no-completions", false, "do not install shell completions")
	force := f.Bool("force", false, "replace a lazybox in that directory that is not a Lazybox release's")
	dryRun := f.Bool("dry-run", false, "say what would change, change nothing")
	if _, err := c.parse(f, args); err != nil {
		return err
	}
	in, err := c.setup().installer()
	if err != nil {
		return err
	}
	if reason := in.Layout.Unstable(); reason != "" {
		return fail(exitUnavailable, "%s", reason)
	}
	home := in.Paths.Home
	target := *dir
	if target == "" {
		target = linkDirectory(home)
	}
	if !filepath.IsAbs(target) {
		return fail(exitUsage, "--dir must be an absolute path")
	}
	res := linkResult{Link: filepath.Join(target, "lazybox"), Target: in.Layout.CLI(), DryRun: *dryRun}
	if info, err := os.Lstat(res.Link); err == nil {
		if !ourCLI(res.Link, in.Layout.CLI()) && !*force {
			kind := "file"
			if info.Mode()&os.ModeSymlink != 0 {
				kind = "link"
			}
			return fail(exitFailure, "%s is already a %s that is not Lazybox's (perhaps the V1 lazybox TUI); pass --force to replace it, or --dir to link elsewhere", res.Link, kind)
		}
	}
	if *shell == "" {
		*shell = filepath.Base(c.getenv("SHELL"))
	}
	var completion string
	if !*noCompletions {
		path, hint := completionFile(*shell, home, c.getenv("XDG_DATA_HOME"))
		if path == "" {
			res.Hints = append(res.Hints, fmt.Sprintf("no completions for shell %q; `lazybox completion zsh|bash|fish` prints a script", *shell))
		} else {
			if completion, err = completionScript(*shell); err != nil {
				return err
			}
			res.Completion = path
			if hint != "" {
				res.Hints = append(res.Hints, "completions: "+hint)
			}
		}
	}
	res.OnPath = slices.Contains(filepath.SplitList(c.getenv("PATH")), target)
	if !res.OnPath {
		line := `export PATH="` + target + `:$PATH"`
		rc := "~/.zshrc"
		switch *shell {
		case "bash":
			rc = "~/.bash_profile"
		case "fish":
			line, rc = "fish_add_path "+target, "~/.config/fish/config.fish"
		}
		res.Hints = append(res.Hints, fmt.Sprintf("%s is not on your PATH: add `%s` to %s and open a new terminal", target, line, rc))
	}
	if found, err := c.setup().lookPath("lazybox"); err == nil && filepath.Dir(found) != target {
		if resolved, _ := filepath.EvalSymlinks(found); resolved != in.Layout.CLI() {
			res.Shadowed = found
			res.Hints = append(res.Hints, found+" comes first on your PATH, so `lazybox` runs that one; remove it or link with --dir into an earlier directory")
		}
	}
	if !*dryRun {
		if err = os.MkdirAll(target, 0o755); err != nil {
			return err
		}
		temporary := res.Link + ".lazybox-new"
		_ = os.Remove(temporary)
		if err = os.Symlink(in.Layout.CLI(), temporary); err != nil {
			return err
		}
		if err = os.Rename(temporary, res.Link); err != nil {
			_ = os.Remove(temporary)
			return err
		}
		record := readRecord(in.Paths)
		if !slices.Contains(record.Links, res.Link) {
			record.Links = append(record.Links, res.Link)
		}
		if res.Completion != "" {
			if err = os.MkdirAll(filepath.Dir(res.Completion), 0o755); err != nil {
				return err
			}
			if err = os.WriteFile(res.Completion, []byte(completion), 0o644); err != nil {
				return err
			}
			if !slices.Contains(record.Completions, res.Completion) {
				record.Completions = append(record.Completions, res.Completion)
			}
		}
		if err = writeRecord(in.Paths, record); err != nil {
			return err
		}
	}
	if c.json {
		return c.printJSON(res)
	}
	verb := map[bool]string{true: "Would link", false: "Linked"}[*dryRun]
	c.out("%s %s %s → %s\n", c.paint(green, "✓"), verb, res.Link, res.Target)
	if res.Completion != "" {
		c.out("%s %s %s completions: %s\n", c.paint(green, "✓"), map[bool]string{true: "Would install", false: "Installed"}[*dryRun], *shell, res.Completion)
	}
	for _, h := range res.Hints {
		c.out("  %s %s\n", c.paint(yellow, "!"), h)
	}
	return nil
}

// ---- uninstall ----

type removal struct {
	What   string `json:"what"`
	Path   string `json:"path"`
	Data   bool   `json:"data,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// uninstallPlan lists what `lazybox uninstall` removes, in order. Data (the
// Runner's state, the app's own storage and the logs) is in it only when asked.
func uninstallPlan(p installation.Paths, removeData bool) []removal {
	var plan []removal
	exists := func(path string) bool { _, err := os.Lstat(path); return err == nil }
	if exists(p.Plist) {
		plan = append(plan, removal{What: "Runner service", Path: p.Plist, Detail: "stops the Runner and removes its launchd job (" + p.Label + ")"})
	}
	if exists(p.Locator()) {
		plan = append(plan, removal{What: "CLI locator", Path: p.Locator()})
	}
	record := readRecord(p)
	for _, l := range record.Links {
		if exists(l) && ourCLI(l, "") {
			plan = append(plan, removal{What: "CLI link", Path: l})
		}
	}
	for _, f := range record.Completions {
		if exists(f) {
			plan = append(plan, removal{What: "shell completions", Path: f})
		}
	}
	if !removeData {
		return plan
	}
	if exists(p.Support) {
		detail := "conversations, subscriptions, settings and Runner state"
		if entries, err := os.ReadDir(p.Worktrees); err == nil && len(entries) > 0 {
			detail += fmt.Sprintf(", and %d workspace folder(s) with their git worktrees: uncommitted or unpushed work in them is lost", len(entries))
		}
		plan = append(plan, removal{What: "Lazybox data", Path: p.Support, Data: true, Detail: detail})
	}
	if exists(p.Logs) {
		plan = append(plan, removal{What: "logs", Path: p.Logs, Data: true})
	}
	if p.Label == installation.DefaultLabel {
		library := filepath.Join(p.Home, "Library")
		for _, dir := range []string{
			filepath.Join(library, "Application Support", installation.AppIdentifier),
			filepath.Join(library, "Caches", installation.AppIdentifier),
			filepath.Join(library, "WebKit", installation.AppIdentifier),
			filepath.Join(library, "Saved Application State", installation.AppIdentifier+".savedState"),
		} {
			if exists(dir) {
				plan = append(plan, removal{What: "app window and view state", Path: dir, Data: true})
			}
		}
	}
	return plan
}

func (c *cli) uninstall(args []string) error {
	f := c.flags("uninstall")
	dryRun := f.Bool("dry-run", false, "list what would be removed, remove nothing")
	removeData := f.Bool("remove-data", false, "also delete conversations, subscriptions, settings, workspaces and logs")
	yes := f.Bool("yes", false, "with --remove-data: do not ask for confirmation")
	if _, err := c.parse(f, args); err != nil {
		return err
	}
	in, err := c.setup().installer()
	if err != nil {
		return err
	}
	plan := uninstallPlan(in.Paths, *removeData)
	kept := hosted{}
	if !*dryRun {
		kept = c.liveProcesses(in.Paths.Endpoint())
	}
	app := in.Layout.AppBundle()
	if c.json && *dryRun {
		return c.printJSON(map[string]any{"dryRun": true, "remove": plan, "app": app})
	}
	if len(plan) == 0 {
		c.out("Nothing to remove: no Runner service, links or completions are installed.\n")
	} else if *dryRun || !c.json {
		c.out("%s\n", map[bool]string{true: "Would remove:", false: "Removing:"}[*dryRun])
		for _, r := range plan {
			mark := "-"
			if r.Data {
				mark = c.paint(red, "-")
			}
			c.out("  %s %s %s\n", mark, r.What, c.paint(dim, r.Path))
			if r.Detail != "" {
				c.out("      %s\n", r.Detail)
			}
		}
	}
	if *dryRun {
		if !*removeData {
			c.out("Your conversations, subscriptions and settings are kept; add --remove-data to delete them too.\n")
		}
		return nil
	}
	if *removeData && !*yes && slices.ContainsFunc(plan, func(r removal) bool { return r.Data }) {
		if !c.stdinTTY {
			return fail(exitUsage, "--remove-data deletes your conversations and workspaces; rerun with --yes to confirm, or from a terminal to be asked")
		}
		c.out("This deletes your conversations, subscriptions and workspaces for good. Type %s to continue: ", c.paint(bold, "delete"))
		answer, _ := bufio.NewReader(c.stdin).ReadString('\n')
		if strings.TrimSpace(answer) != "delete" {
			return fail(exitFailure, "nothing was removed")
		}
	}
	var removed []removal
	for _, r := range plan {
		switch r.What {
		case "Runner service":
			if _, err = in.Uninstall(c.ctx); err != nil {
				return fmt.Errorf("could not remove the Runner service: %w", err)
			}
		default:
			if r.Data {
				err = os.RemoveAll(r.Path)
			} else {
				err = os.Remove(r.Path)
				if errors.Is(err, os.ErrNotExist) {
					err = nil
				}
			}
			if err != nil {
				return fmt.Errorf("could not remove %s: %w", r.Path, err)
			}
		}
		removed = append(removed, r)
	}
	if !*removeData {
		_ = writeRecord(in.Paths, linkRecord{})
	}
	if c.json {
		return c.printJSON(map[string]any{"removed": removed, "keptRunning": kept, "app": app})
	}
	c.out("%s Lazybox is uninstalled from this account.\n", c.paint(green, "✓"))
	if kept.total() > 0 && !*removeData {
		c.out("  Still running: %s. Each stops by itself within a day.\n", kept)
	}
	if !*removeData {
		c.out("  Your conversations, subscriptions and settings are kept in %s.\n", in.Paths.Support)
	}
	if app != "" {
		c.out("  To remove the app itself, drag %s to the Trash (or `brew uninstall --cask lazybox-v2`).\n", app)
	}
	return nil
}
