package engine

import (
	"errors"
	"testing"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
)

// A queued message is listed while it waits. "Send now" moves it ahead of the
// others and interrupts the turn, so it is the next turn; "steer" delivers it
// into the running turn, only where the provider supports steering, and
// otherwise leaves it where it was.
func TestQueuedMessagesAreListedAndDeliveredNowOrSteered(t *testing.T) {
	for _, steer := range []bool{false, true} {
		t.Run(map[bool]string{false: "claude-like", true: "codex-like"}[steer], func(t *testing.T) {
			e, s := bench(t, steer)
			ctx := contextFor(t)
			if _, err := e.Apply(ctx, agent.Operation{ID: "turn", Kind: agent.Message, Text: "start the server"}); err != nil {
				t.Fatal(err)
			}
			applied(t, s)
			for _, id := range []string{"later", "urgent"} {
				if _, err := e.Apply(ctx, agent.Operation{ID: id, Kind: agent.Message, Text: id + " message"}); err != nil {
					t.Fatal(err)
				}
			}
			queued := e.Snapshot().QueuedMessages
			if len(queued) != 2 || queued[0].OperationID != "later" || queued[1].Text != "urgent message" || queued[1].QueuedAt.IsZero() {
				t.Fatalf("queued messages: %+v", queued)
			}
			if _, err := e.DeliverQueued(ctx, "missing", DeliverNow); !errors.Is(err, ErrNotQueued) {
				t.Fatal("an unknown message", err)
			}
			_, err := e.DeliverQueued(ctx, "urgent", DeliverSteer)
			if !steer {
				if !errors.Is(err, agent.ErrUnsupported) {
					t.Fatal("steering without the capability", err)
				}
				if q := e.Snapshot().QueuedMessages; len(q) != 2 || q[1].OperationID != "urgent" {
					t.Fatalf("a refused steer keeps the message in place: %+v", q)
				}
				// Send now: interrupt, then this message is the next turn.
				if _, err = e.DeliverQueued(ctx, "urgent", DeliverNow); err != nil {
					t.Fatal(err)
				}
				if op := applied(t, s); op.Kind != agent.Interrupt {
					t.Fatalf("send now did not interrupt: %+v", op)
				}
				if q := e.Snapshot().QueuedMessages; len(q) != 2 || q[0].OperationID != "urgent" {
					t.Fatalf("send now moves the message first: %+v", q)
				}
				s.Events <- agent.Event{Type: "turn_ended", Status: "interrupted"}
				if op := applied(t, s); op.ID != "urgent" || op.Kind != agent.Message {
					t.Fatalf("the next turn is not the message sent now: %+v", op)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if op := applied(t, s); op.ID != "urgent" || op.Kind != agent.Steer || op.Text != "urgent message" {
				t.Fatalf("steer delivery: %+v", op)
			}
			if q := e.Snapshot().QueuedMessages; len(q) != 1 || q[0].OperationID != "later" {
				t.Fatalf("a steered message leaves the queue: %+v", q)
			}
			if !e.Snapshot().Busy {
				t.Fatal("steering must not end the turn")
			}
		})
	}
}
