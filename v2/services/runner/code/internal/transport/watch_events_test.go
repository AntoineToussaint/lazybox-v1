package transport

import (
	"context"
	"testing"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
	"github.com/AntoineToussaint/lazybox/v2/internal/agent/agenttest"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc"
)

type eventStream struct {
	grpc.ServerStream
	ctx  context.Context
	sent chan *pb.JournalEvent
}

func (s *eventStream) Context() context.Context { return s.ctx }
func (s *eventStream) Send(e *pb.JournalEvent) error {
	s.sent <- e
	return nil
}

// A reader replaying a conversation learns where the replay ends, so it can
// render once when caught up; records appended after it asked are live.
func TestWatchEventsSaysWhereTheRetainedHistoryEnds(t *testing.T) {
	b, err := runner.New(runner.Config{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	b.Adapters["codex"] = &agenttest.Adapter{}
	e, err := b.Open("codex-default", t.TempDir(), "", accounts.Options{}, "direct", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		if err = b.Record(e, map[string]any{"type": "message_delta", "text": "history"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, includePrevious := range []bool{true, false} {
		history := e.Retained()
		ctx, cancel := context.WithCancel(context.Background())
		stream := &eventStream{ctx: ctx, sent: make(chan *pb.JournalEvent, 64)}
		done := make(chan error, 1)
		go func() {
			done <- (&Service{Bench: b}).WatchEvents(&pb.WatchEventsRequest{SessionId: e.ID, IncludePrevious: includePrevious}, stream)
		}()
		next := func() *pb.JournalEvent {
			select {
			case event := <-stream.sent:
				return event
			case <-time.After(5 * time.Second):
				t.Fatal("no event")
				return nil
			}
		}
		for cursor := uint64(1); cursor <= history; cursor++ {
			event := next()
			if event.Cursor != cursor || event.Retained != history {
				t.Fatalf("replayed record %d says retained %d, want cursor %d of %d", event.Cursor, event.Retained, cursor, history)
			}
		}
		if err = b.Record(e, map[string]any{"type": "message_delta", "text": "live"}); err != nil {
			t.Fatal(err)
		}
		if live := next(); live.Cursor != history+1 || live.Retained != live.Cursor {
			t.Fatalf("live record %d says retained %d", live.Cursor, live.Retained)
		}
		cancel()
		<-done
	}
}
