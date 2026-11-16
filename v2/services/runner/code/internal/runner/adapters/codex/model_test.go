package codex

import (
	"context"
	"testing"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
)

// A model switch applies from the next turn: turn/start carries it, plan
// mode's collaboration settings name it, and a handoff keeps it.
func TestLiveModelSwitchAppliesToFollowingTurns(t *testing.T) {
	s := &session{settings: []byte(`{"model":"gpt-old","approvalPolicy":"never"}`)}
	if !s.Capabilities().LiveModel {
		t.Fatal("Codex turns accept a model")
	}
	r, err := s.Apply(context.Background(), agent.Operation{ID: "m", Kind: agent.Model, Model: "gpt-new"})
	if err != nil || r.Delivery != "accepted" {
		t.Fatalf("switch refused: %+v %v", r, err)
	}
	if string(s.overrides["model"]) != `"gpt-new"` || s.model != "gpt-new" {
		t.Fatalf("model not kept for turn/start: %s %q", s.overrides, s.model)
	}
	if got := string(s.SessionSettings()); got != `{"approvalPolicy":"never","model":"gpt-new"}` {
		t.Fatalf("a handoff would carry the old model: %s", got)
	}
	if _, err = s.Apply(context.Background(), agent.Operation{ID: "e", Kind: agent.Model}); err == nil {
		t.Fatal("an empty model was accepted")
	}
}
