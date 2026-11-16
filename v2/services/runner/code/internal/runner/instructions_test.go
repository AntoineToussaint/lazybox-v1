package runner

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
	"github.com/AntoineToussaint/lazybox/v2/internal/agent/agenttest"
)

func applied(t *testing.T, s *agenttest.Session) agent.Operation {
	t.Helper()
	select {
	case op := <-s.Applied:
		return op
	case <-time.After(5 * time.Second):
		t.Fatal("operation never reached the provider")
	}
	return agent.Operation{}
}

func TestChangedInstructionsReachRunningSessionsOnceWithTheNextMessage(t *testing.T) {
	b, err := New(Config{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	fake := &agenttest.Adapter{}
	b.Adapters["codex"] = fake
	e, err := b.OpenEmptyWorkspace("codex-default", accounts.Options{}, "direct")
	if err != nil {
		t.Fatal(err)
	}
	if update := b.InstructionsUpdate(e); update != "" {
		t.Fatalf("a new session already has the current instructions: %q", update)
	}
	d := b.Preferences.Snapshot()
	d.Context = "Always run the linter."
	if err = b.Preferences.Save(d); err != nil {
		t.Fatal(err)
	}
	update := b.InstructionsUpdate(e)
	if !strings.HasPrefix(update, instructionsPreamble) || !strings.Contains(update, "Always run the linter.") {
		t.Fatalf("stale session not given the new instructions: %q", update)
	}
	if err = b.InstructionsDelivered(context.Background(), e, update); err != nil {
		t.Fatal(err)
	}
	if b.InstructionsUpdate(e) != "" {
		t.Fatal("an update is delivered once")
	}
	saved, err := b.History.Get(context.Background(), e.ID)
	if err != nil || saved.Instructions != update {
		t.Fatalf("delivery not durable: %v %q", err, saved.Instructions)
	}
	// Retrying the same message must not be refused because the update now differs.
	op := agent.Operation{ID: "message-1", Kind: agent.Message, Text: "hello", Context: update}
	if _, err = e.Engine.Apply(context.Background(), op); err != nil {
		t.Fatal(err)
	}
	if got := applied(t, fake.Session); got.Context != update || got.Text != "hello" {
		t.Fatalf("provider did not get the update beside the text: %+v", got)
	}
	op.Context = ""
	if _, err = e.Engine.Apply(context.Background(), op); err != nil {
		t.Fatalf("retry refused: %v", err)
	}
}

func TestAssistantsAreNotSentInstructionUpdates(t *testing.T) {
	b, err := New(Config{State: t.TempDir(), CLIDir: "/opt/lazybox/bin"})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	e := &Execution{Purpose: "help"}
	e.Saved.ID = "assistant"
	if b.InstructionsUpdate(e) != "" {
		t.Fatal("assistants are answer-only and get no command briefing")
	}
}

func TestPermissionChangesWhileRunningAndIsRemembered(t *testing.T) {
	b, err := New(Config{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	fake := &agenttest.Adapter{LivePermission: true}
	b.Adapters["codex"] = fake
	e, err := b.OpenEmptyWorkspace("codex-default", accounts.Options{Permission: "ask"}, "direct")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.SetPermission(context.Background(), e, "permission-1", "yolo"); err != nil {
		t.Fatal(err)
	}
	if got := applied(t, fake.Session); got.Kind != agent.Permission || got.Permission != "yolo" {
		t.Fatalf("provider not told: %+v", got)
	}
	saved, err := b.History.Get(context.Background(), e.ID)
	if err != nil || saved.Options.Permission != "yolo" || e.Options.Permission != "yolo" {
		t.Fatalf("new mode not remembered for resume: %v %q %q", err, saved.Options.Permission, e.Options.Permission)
	}
	if _, err = b.SetPermission(context.Background(), e, "permission-2", "inherit"); err == nil {
		t.Fatal("inherit is only a starting choice")
	}
}

func TestPermissionChangeRefusedWhereItCannotWork(t *testing.T) {
	b, err := New(Config{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	b.Adapters["codex"] = &agenttest.Adapter{}
	e, err := b.OpenEmptyWorkspace("codex-default", accounts.Options{}, "direct")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.SetPermission(context.Background(), e, "permission-1", "yolo"); err == nil {
		t.Fatal("a provider without live permission changes must refuse")
	}
	plan := &agenttest.Adapter{LivePermission: true}
	b.Adapters["codex"] = plan
	p, err := b.OpenEmptyWorkspace("codex-default", accounts.Options{Workflow: "plan"}, "direct")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.SetPermission(context.Background(), p, "permission-2", "yolo"); err == nil || !strings.Contains(err.Error(), "plan") {
		t.Fatalf("YOLO must stay incompatible with plan mode: %v", err)
	}
}
