package main

import (
	"strings"
	"testing"

	workitems "github.com/AntoineToussaint/lazybox/v2/internal/runner/items"
)

// An agent links a pull request it opened, and lists what its workspace
// delivers, with the credential and endpoint Lazybox gave it: a development
// build's CLI (Dev, Working) never answers with the refusal of `lazybox link`
// for putting a release's CLI on PATH.
func TestAgentLinksAndListsItsPullRequests(t *testing.T) {
	r := newTestRunner(t)
	session, native := r.open("agent")
	env := map[string]string{}
	for _, entry := range native.Open.Env {
		if name, value, ok := strings.Cut(entry, "="); ok && strings.HasPrefix(name, "LAZYBOX_V2_") {
			env[name] = value
		}
	}
	if env["LAZYBOX_V2_ENDPOINT"] == "" || env["LAZYBOX_V2_SESSION_ID"] == "" {
		t.Fatalf("agent environment: %v", env)
	}

	out := r.cli(env, "", "link", "https://github.com/obin-ai/platform/pull/1121")
	if out.code != 0 || !strings.Contains(out.stdout, "Tracking obin-ai/platform#1121 in this workspace") {
		t.Fatalf("link: %+v", out)
	}
	// Without its scheme, after a flag, as a mention.
	out = r.cli(env, "", "link", "--role", "mentions", "github.com/obin-ai/platform/issues/7")
	if out.code != 0 || !strings.Contains(out.stdout, "Listed (not tracked) obin-ai/platform#7") {
		t.Fatalf("link a mention: %+v", out)
	}
	links := r.bench.WorkItems().Links(workitems.Filter{Workspace: r.collection.Id})
	if len(links) != 2 {
		t.Fatalf("links: %+v", links)
	}
	for _, l := range links {
		if l.Session != session.Id || l.Source != workitems.SourceCLI {
			t.Fatalf("linked as %+v", l)
		}
	}

	out = r.cli(env, "", "items")
	if out.code != 0 || !strings.Contains(out.stdout, "obin-ai/platform#1121  not read yet") || !strings.Contains(out.stdout, "https://github.com/obin-ai/platform/pull/1121") || !strings.Contains(out.stdout, "Mentioned (not tracked):") {
		t.Fatalf("items: %+v", out)
	}
	// Why it is not read yet is said.
	if !strings.Contains(out.stderr, "Connect GitHub") {
		t.Fatalf("items without GitHub: %+v", out)
	}

	// `lazybox link` alone, in an agent, asks for the URL.
	out = r.cli(env, "", "link")
	if out.code != exitUsage || strings.Contains(out.err.Error(), "development build") || !strings.Contains(out.err.Error(), "URL") {
		t.Fatalf("link alone: %+v", out)
	}
	// Another workspace is out of an agent's reach.
	if out = r.cli(env, "", "link", "https://github.com/obin-ai/platform/pull/9", "--workspace", "Other"); out.code == 0 {
		t.Fatalf("another workspace: %+v", out)
	}
}

func TestItemURLArgumentsAreToldFromLinkingTheCLI(t *testing.T) {
	for _, args := range [][]string{
		{"https://github.com/a/b/pull/1"},
		{"--json", "https://github.com/a/b/pull/1"},
		{"github.com/a/b/pull/1"},
		{"www.github.com/a/b/pull/1"},
		{"--role", "delivers", "x"},
		{"--workspace=W", "https://github.com/a/b/pull/1"},
	} {
		if !looksLikeItemURL(args) {
			t.Errorf("%v links the CLI", args)
		}
	}
	for _, args := range [][]string{{}, {"--dir", "/usr/local/bin"}, {"--shell", "zsh", "--force"}, {"--dry-run"}} {
		if looksLikeItemURL(args) {
			t.Errorf("%v links an item", args)
		}
	}
	for in, want := range map[string]string{
		"github.com/a/b/pull/1":             "https://github.com/a/b/pull/1",
		"http://github.com/a/b/pull/1":      "https://github.com/a/b/pull/1",
		"https://www.github.com/a/b/pull/1": "https://github.com/a/b/pull/1",
		" https://github.com/a/b/pull/1 ":   "https://github.com/a/b/pull/1",
	} {
		if got := itemURL(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}
