package runner

import (
	"os"
	"strings"
	"testing"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
	"github.com/AntoineToussaint/lazybox/v2/internal/agent/agenttest"
)

func TestAgentsGetTheCLIFirstOnPathAndTheCommandBriefing(t *testing.T) {
	for _, withCLI := range []bool{true, false} {
		cfg := Config{State: t.TempDir()}
		if withCLI {
			cfg.CLIDir = "/opt/lazybox/bin"
		}
		b, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		fake := &agenttest.Adapter{}
		b.Adapters["codex"] = fake
		if _, err = b.OpenEmptyWorkspace("codex-default", accounts.Options{}, "direct"); err != nil {
			t.Fatal(err)
		}
		open := fake.Session.Open
		path := ""
		paths := 0
		for _, entry := range open.Env {
			if value, ok := strings.CutPrefix(entry, "PATH="); ok {
				path, paths = value, paths+1
			}
		}
		briefed := strings.Contains(open.Context, "lazybox run -- <command>")
		if withCLI && (paths != 1 || !strings.HasPrefix(path, "/opt/lazybox/bin"+string(os.PathListSeparator)) || !briefed) {
			t.Fatalf("CLI not offered: paths=%d path=%q briefed=%v", paths, path, briefed)
		}
		if !withCLI && (strings.Contains(path, "/opt/lazybox/bin") || briefed) {
			t.Fatal("briefing an agent about a CLI it cannot run")
		}
		b.Close()
	}
}
