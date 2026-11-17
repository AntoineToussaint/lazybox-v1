package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/AntoineToussaint/lazybox/v2/internal/installation"
)

// aliasName is the second name `lazybox link` and the cask give this
// release's CLI. V1's Homebrew formula owns `lazybox` in /opt/homebrew/bin,
// usually first on PATH, so `lazybox` can run V1; `lazybox-v2` never does.
const aliasName = "lazybox-v2"

// personPath is the PATH a new terminal of this person gets: their login
// shell's, read the way the service install reads it. It is what `lazybox`
// resolves against when they type it. This process's own PATH is the wrong
// one to ask when the app runs `lazybox link` or `lazybox doctor`: an app
// opened from the Finder has launchd's /usr/bin:/bin:/usr/sbin:/sbin, without
// Homebrew's directories, which hides V1's lazybox in /opt/homebrew/bin and
// makes every link directory look off PATH. When the shell cannot be read,
// this process's PATH stands in and problem says why. Read once per command.
func (c *cli) personPath(ctx context.Context, in installation.Installer) (path, problem string) {
	if c.shellEnv == nil {
		env := installation.ShellEnvironment{Problem: "no login shell reader"}
		if in.Shell != nil {
			env = in.Shell(ctx)
		}
		c.shellEnv = &env
	}
	if c.shellEnv.Problem != "" || c.shellEnv.Path == "" {
		problem = c.shellEnv.Problem
		if problem == "" {
			problem = "the login shell set no PATH"
		}
		return c.getenv("PATH"), problem
	}
	return c.shellEnv.Path, ""
}

// runsOn finds the first executable named name on path, as a shell would,
// and whether it is this release's CLI (the file itself or a link to it).
func runsOn(name, path, cli string) (found string, ours bool) {
	found = lookIn(name, path)
	return found, found != "" && sameFile(found, cli)
}

func sameFile(a, b string) bool {
	x, err := os.Stat(a)
	if err != nil {
		return false
	}
	y, err := os.Stat(b)
	return err == nil && os.SameFile(x, y)
}

// shadowedBefore is the `lazybox` a shell finds on path before dir, when it
// is not this release's CLI: linking into dir would not make `lazybox` run
// this release. "" when dir comes first or nothing else is found before it.
func shadowedBefore(path, dir, cli string) string {
	for _, entry := range filepath.SplitList(path) {
		if entry == "" {
			continue
		}
		if filepath.Clean(entry) == filepath.Clean(dir) {
			return ""
		}
		if found, ours := runsOn("lazybox", entry, cli); found != "" && !ours {
			return found
		}
	}
	return ""
}

// whichLazybox says in a few words what another lazybox is: V1's (the
// Homebrew formula, or a cargo install), another copy of the Lazybox app, or
// something else of that name.
func whichLazybox(found string) string {
	resolved, err := filepath.EvalSymlinks(found)
	if err != nil {
		resolved = found
	}
	switch {
	case strings.Contains(resolved, "/Cellar/lazybox/"):
		return "V1's lazybox (the Homebrew formula)"
	case strings.HasSuffix(resolved, "/.cargo/bin/lazybox"):
		return "V1's lazybox (cargo install)"
	case strings.HasSuffix(resolved, "/Contents/Resources/runtime/bin/lazybox"):
		return "the lazybox of another copy of Lazybox (" + appOf(resolved) + ")"
	}
	return "another lazybox (perhaps V1's)"
}

// appOf is the .app a runtime CLI belongs to.
func appOf(cli string) string {
	for dir := filepath.Dir(cli); dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if strings.HasSuffix(dir, ".app") {
			return dir
		}
	}
	return cli
}

// shadowAdvice is what to do when another lazybox runs instead of this
// release's: the alias when it reaches this release, then the ways out.
func shadowAdvice(found, path, cli string) string {
	use := "Run `" + aliasName + "`, which always runs this release"
	if _, ours := runsOn(aliasName, path, cli); !ours {
		use = "Run this release as `" + cli + "` (or `" + aliasName + "` once its link directory is on your PATH)"
	}
	if strings.Contains(whichLazybox(found), "Homebrew formula") {
		return use + ", or remove V1 with `brew uninstall lazybox`"
	}
	return use + ", or remove " + found + ", or link this release into a directory earlier on your PATH (`lazybox link --dir <dir>`)"
}
