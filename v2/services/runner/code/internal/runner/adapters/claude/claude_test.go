package claude

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
)

func TestGatewayEnvironmentPreservesAuthAndNeverMutatesParent(t *testing.T) {
	parent := []string{"ANTHROPIC_BASE_URL=https://old.test", "ANTHROPIC_API_KEY=provider-secret", "BENCH_TOKEN=gateway-secret"}
	result := GatewayEnv(&agent.Gateway{ID: "meter", URL: "https://meter.test/route/"}, parent)
	joined := strings.Join(result, "\n")
	if strings.Count(joined, "ANTHROPIC_BASE_URL=") != 1 || !strings.Contains(joined, "ANTHROPIC_API_KEY=provider-secret") || !strings.Contains(joined, "ANTHROPIC_BASE_URL=https://meter.test/route") {
		t.Fatal("incorrect gateway or provider credential mapping")
	}
	result = GatewayEnv(&agent.Gateway{ID: "meter", URL: "https://meter.test", TokenEnv: "BENCH_TOKEN"}, parent)
	joined = strings.Join(result, "\n")
	if strings.Contains(joined, "ANTHROPIC_API_KEY=") || !strings.Contains(joined, "ANTHROPIC_AUTH_TOKEN=gateway-secret") {
		t.Fatal("gateway token mode retained competing auth")
	}
	if parent[0] != "ANTHROPIC_BASE_URL=https://old.test" || parent[1] != "ANTHROPIC_API_KEY=provider-secret" {
		t.Fatal("parent environment mutated")
	}
}

// stopWorker answers open with the given features, then acknowledges a
// stop_agent call only for the native task it expects.
func stopWorker(features string) string {
	return `read -r line
printf '%s\n' '{"id":"lazybox-1","result":{"reference":"ref","features":` + features + `}}'
while IFS= read -r line; do
  case "$line" in
    *'"method":"stop_agent"'*'"nativeId":"task-7"'*) printf '%s\n' '{"id":"lazybox-2","result":{"delivery":"acknowledged"}}' ;;
    *) printf '%s\n' '{"id":"lazybox-2","error":{"message":"unexpected"}}' ;;
  esac
done
`
}

func TestStopAgentReachesOnlyAWorkerThatSupportsIt(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	for _, tc := range []struct {
		features string
		works    bool
	}{{`["permission","context","stop_agent"]`, true}, {`["permission","context"]`, false}} {
		worker := filepath.Join(t.TempDir(), "worker.sh")
		if err := os.WriteFile(worker, []byte(stopWorker(tc.features)), 0700); err != nil {
			t.Fatal(err)
		}
		session, err := Adapter{Node: "/bin/sh", Worker: worker}.Open(ctx, agent.Open{Cwd: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		if session.Capabilities().StopAgent != tc.works {
			t.Fatalf("features %s: StopAgent capability %v", tc.features, !tc.works)
		}
		r, err := session.Apply(ctx, agent.Operation{ID: "stop", Kind: agent.StopAgent, AgentID: "claude-tool:x", NativeID: "task-7"})
		if tc.works && (err != nil || r.Delivery != "acknowledged" || r.ID != "stop") {
			t.Fatalf("stop not acknowledged: %+v %v", r, err)
		}
		if !tc.works && !errors.Is(err, agent.ErrUnsupported) {
			t.Fatalf("an older worker was asked to stop a sub-agent: %v", err)
		}
		_ = session.Close()
	}
}

// A conversation is named by the worker that offers it (Claude Code's own
// title generator); an older worker is not asked.
func TestTitleReachesOnlyAWorkerThatSupportsIt(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	script := func(features string) string {
		return `read -r line
printf '%s\n' '{"id":"lazybox-1","result":{"reference":"ref","features":` + features + `}}'
while IFS= read -r line; do
  case "$line" in
    *'"method":"title"'*'"description":"fix the login flake"'*) printf '%s\n' '{"id":"lazybox-2","result":{"title":"Login flake"}}' ;;
    *) printf '%s\n' '{"id":"lazybox-2","error":{"message":"unexpected"}}' ;;
  esac
done
`
	}
	for _, tc := range []struct {
		features string
		works    bool
	}{{`["permission","title"]`, true}, {`["permission"]`, false}} {
		worker := filepath.Join(t.TempDir(), "worker.sh")
		if err := os.WriteFile(worker, []byte(script(tc.features)), 0700); err != nil {
			t.Fatal(err)
		}
		session, err := Adapter{Node: "/bin/sh", Worker: worker}.Open(ctx, agent.Open{Cwd: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		title, err := agent.TitleOf(ctx, session, "fix the login flake")
		if tc.works && (err != nil || title != "Login flake") {
			t.Fatalf("title not generated: %q %v", title, err)
		}
		if !tc.works && !errors.Is(err, agent.ErrUnsupported) {
			t.Fatalf("an older worker was asked for a title: %v", err)
		}
		_ = session.Close()
	}
}

// The person's claude.ai connectors setting reaches the worker at open: off
// unless they turned it on (Settings → Agents).
func TestOpenTellsTheWorkerWhetherClaudeAIConnectorsLoad(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	for _, tc := range []struct {
		on   bool
		want string
	}{{false, `"claudeAiConnectors":false`}, {true, `"claudeAiConnectors":true`}} {
		worker := filepath.Join(t.TempDir(), "worker.sh")
		script := `read -r line
case "$line" in
  *'"method":"open"'*'` + tc.want + `'*) printf '%s\n' '{"id":"lazybox-1","result":{"reference":"ref","features":[]}}' ;;
  *) printf '%s\n' '{"id":"lazybox-1","error":{"message":"connectors setting missing"}}' ;;
esac
while IFS= read -r line; do :; done
`
		if err := os.WriteFile(worker, []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		session, err := Adapter{Node: "/bin/sh", Worker: worker}.Open(ctx, agent.Open{Cwd: t.TempDir(), ClaudeAIConnectors: tc.on})
		if err != nil {
			t.Fatalf("connectors %v: the worker was not told %s: %v", tc.on, tc.want, err)
		}
		_ = session.Close()
	}
}
