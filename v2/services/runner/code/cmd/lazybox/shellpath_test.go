package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
)

// v1Formula lays out V1's Homebrew formula under home: the Cellar binary and
// the bin link Homebrew puts first on PATH.
func v1Formula(t *testing.T, home string) (bin, lazybox string) {
	t.Helper()
	cellar := filepath.Join(home, "homebrew", "Cellar", "lazybox", "0.1.21", "bin")
	bin = filepath.Join(home, "homebrew", "bin")
	for _, dir := range []string{cellar, bin} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(cellar, "lazybox"), []byte("#!/bin/sh\necho v1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	lazybox = filepath.Join(bin, "lazybox")
	if err := os.Symlink(filepath.Join(cellar, "lazybox"), lazybox); err != nil {
		t.Fatal(err)
	}
	return bin, lazybox
}

// The app runs `lazybox link` with launchd's PATH, which has neither
// Homebrew nor ~/.local/bin. What a terminal runs is decided by the login
// shell's PATH, and there V1's formula comes first: link says so, names the
// lazybox-v2 alias it made, and doctor says the same.
func TestLinkAndDoctorJudgeThePathByTheLoginShellAndNameV1(t *testing.T) {
	r := newRelease(t, "0.1.0")
	brew, v1 := v1Formula(t, r.home)
	local := filepath.Join(r.home, ".local", "bin")
	r.path = "/usr/bin:/bin:/usr/sbin:/sbin"
	r.shell = brew + ":" + local + ":/usr/bin:/bin"

	got := r.run("", false, "link", "--dir", local, "--shell", "fish", "--json")
	if got.code != 0 {
		t.Fatalf("%+v", got)
	}
	var res linkResult
	if err := json.Unmarshal([]byte(got.stdout), &res); err != nil {
		t.Fatalf("%v: %s", err, got.stdout)
	}
	if !res.OnPath {
		t.Errorf("%s is on the login shell's PATH, but link says it is not: %+v", local, res)
	}
	if res.Shadowed != v1 || !strings.Contains(res.ShadowedWhat, "V1's lazybox (the Homebrew formula)") {
		t.Errorf("V1 shadows the link, but: %+v", res)
	}
	hints := strings.Join(res.Hints, "\n")
	for _, want := range []string{"`lazybox` in your terminal runs V1's lazybox", "Run `lazybox-v2` instead", "brew uninstall lazybox"} {
		if !strings.Contains(hints, want) {
			t.Errorf("hints lack %q:\n%s", want, hints)
		}
	}
	if strings.Contains(hints, "not on your PATH") {
		t.Errorf("a directory on the login shell's PATH was called off PATH:\n%s", hints)
	}
	alias := filepath.Join(local, aliasName)
	if res.Alias != alias || !sameFile(alias, r.runtime.CLI()) {
		t.Fatalf("no lazybox-v2 alias: %+v", res)
	}

	got = r.run("", false, "doctor", "--json")
	status := doctorChecks(t, got)
	cli := status["cli"]
	if cli.Status != checkWarn || !strings.Contains(cli.Detail, "runs V1's lazybox (the Homebrew formula) at "+v1) || !strings.Contains(cli.Fix, "Run `lazybox-v2`, which always runs this release") || !strings.Contains(cli.Fix, "brew uninstall lazybox") {
		t.Errorf("cli: %+v", cli)
	}
	if status["shell"].Status != checkOK {
		t.Errorf("shell: %+v", status["shell"])
	}

	// With V1 gone, `lazybox` is this release.
	_ = os.Remove(v1)
	if k := doctorChecks(t, r.run("", false, "doctor", "--json"))["cli"]; k.Status != checkOK || k.Detail != filepath.Join(local, "lazybox") {
		t.Errorf("cli without V1: %+v", k)
	}

	// Uninstall takes back both names.
	if got = r.run("", false, "uninstall"); got.code != 0 {
		t.Fatalf("%+v", got)
	}
	for _, gone := range []string{filepath.Join(local, "lazybox"), alias} {
		if _, err := os.Lstat(gone); err == nil {
			t.Errorf("%s survived uninstall", gone)
		}
	}
}

// A login shell that cannot be read is said, not dropped: link falls back to
// the PATH it was started with, doctor warns, and service install --json
// reports it for the setup window.
func TestAShellThatCannotBeReadIsReported(t *testing.T) {
	r := newRelease(t, "0.1.0")
	bin := filepath.Join(r.home, "bin")
	r.path = bin + ":/usr/bin"
	r.shellProblem = "could not read the login shell's PATH: signal: killed"

	got := r.run("", false, "link", "--dir", bin, "--shell", "fish", "--json")
	var res linkResult
	if err := json.Unmarshal([]byte(got.stdout), &res); err != nil {
		t.Fatalf("%v: %s", err, got.stdout)
	}
	if !res.OnPath || res.PathProblem != r.shellProblem {
		t.Errorf("link: %+v", res)
	}

	got = r.run("", false, "service", "install", "--json")
	var report map[string]any
	if err := json.Unmarshal([]byte(got.stdout), &report); err != nil {
		t.Fatalf("%v: %s %s", err, got.stdout, got.stderr)
	}
	if report["shellProblem"] != r.shellProblem || report["shell"] != "/bin/zsh" {
		t.Errorf("service install --json dropped the shell problem: %v", report)
	}

	k := doctorChecks(t, r.run("", false, "doctor", "--json"))["shell"]
	if k.Status != checkWarn || !strings.Contains(k.Detail, "signal: killed") || !strings.Contains(k.Fix, "lazybox service install") {
		t.Errorf("shell: %+v", k)
	}
}

// The service keeps the PATH read when it was installed; doctor names the
// directories the login shell has gained since.
func TestDoctorNamesWhatTheAgentsPathLacks(t *testing.T) {
	r := newRelease(t, "0.1.0")
	if got := r.run("", false, "service", "install", "--no-start"); got.code != 0 {
		t.Fatalf("%+v", got)
	}
	status := doctorChecks(t, r.run("", false, "doctor", "--json"))
	if status["service-path"].Status != checkOK {
		t.Errorf("service-path: %+v", status["service-path"])
	}
	r.shell = "/opt/mise/shims:" + r.shell
	k := doctorChecks(t, r.run("", false, "doctor", "--json"))["service-path"]
	if k.Status != checkWarn || !strings.Contains(k.Detail, "/opt/mise/shims") || !strings.Contains(k.Fix, "lazybox service install") {
		t.Errorf("service-path: %+v", k)
	}
}

func TestSignInChecksSayWhetherEachAgentCanStartWork(t *testing.T) {
	sub := func(label, state, detail string) *pb.SubscriptionAvailability {
		return &pb.SubscriptionAvailability{Label: label, State: state, Detail: detail}
	}
	for _, tc := range []struct {
		name   string
		p      *pb.ProviderStatus
		show   bool
		status string
		words  []string
	}{
		{"ready", &pb.ProviderStatus{Provider: "claude", Installed: true, State: "ready", Subscriptions: []*pb.SubscriptionAvailability{sub("Local CLI sign-in", "available", ""), sub("Work", "unverified", "")}}, true, checkOK, []string{"Local CLI sign-in", "Work (not checked yet)"}},
		{"signed out", &pb.ProviderStatus{Provider: "claude", Installed: true, State: "sign_in", Subscriptions: []*pb.SubscriptionAvailability{sub("Local CLI sign-in", "sign_in", "Needs you to sign in again")}}, true, checkWarn, []string{"not signed in", "Needs you to sign in again", "/login"}},
		{"no subscription", &pb.ProviderStatus{Provider: "codex", Installed: true, State: "no_subscription"}, true, checkWarn, []string{"not signed in", "codex login"}},
		{"limited", &pb.ProviderStatus{Provider: "codex", Installed: true, State: "limited", Subscriptions: []*pb.SubscriptionAvailability{sub("Pro", "limited", "Reached its limit")}}, true, checkWarn, []string{"at its limit", "Reached its limit"}},
		{"not installed", &pb.ProviderStatus{Provider: "codex", State: "not_installed"}, false, "", nil},
		{"an ACP agent", &pb.ProviderStatus{Provider: "acp:gemini", Installed: true, State: "no_subscription", Acp: &pb.AcpAgentInfo{Id: "gemini"}}, false, "", nil},
	} {
		k, show := signInCheck(tc.p)
		if show != tc.show {
			t.Errorf("%s: shown %v", tc.name, show)
			continue
		}
		if !show {
			continue
		}
		text := k.Detail + " " + k.Fix
		if k.Status != tc.status || !strings.HasPrefix(k.ID, "signin-") {
			t.Errorf("%s: %+v", tc.name, k)
		}
		for _, w := range tc.words {
			if !strings.Contains(text, w) {
				t.Errorf("%s: %q lacks %q", tc.name, text, w)
			}
		}
	}
}

func doctorChecks(t *testing.T, got result) map[string]check {
	t.Helper()
	var report struct {
		Checks []check `json:"checks"`
	}
	if err := json.Unmarshal([]byte(got.stdout), &report); err != nil {
		t.Fatalf("%v: %s %s", err, got.stdout, got.stderr)
	}
	status := map[string]check{}
	for _, k := range report.Checks {
		status[k.ID] = k
	}
	return status
}
