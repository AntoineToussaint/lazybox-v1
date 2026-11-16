package transport

import (
	"testing"

	"github.com/AntoineToussaint/lazybox/v2/internal/devices"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
)

// A pin the person makes on the desktop is the Runner's: every client,
// including a paired phone, reads it from the conversation. Only the owner
// pins or archives; an agent and a phone cannot.
func TestConversationPinsAndArchiveAreTheRunnersAndTheOwnersOnly(t *testing.T) {
	f := newDeviceFixture(t)
	ctx := timeout(t)
	e, _, agentCredential := f.open(t)
	owner := bearer(ctx, ownerToken)
	desk := f.authorityFixture.client
	_, phone := f.pair(t, devices.GrantRespond, devices.GrantStart)
	find := func(info *pb.InfoResponse) *pb.Session {
		for _, s := range info.Sessions {
			if s.Id == e.ID {
				return s
			}
		}
		t.Fatal("conversation missing from Info")
		return nil
	}

	pinned, err := desk.PinConversation(owner, &pb.PinConversationRequest{SessionId: e.ID, Pinned: true})
	if err != nil || pinned.Session.PinnedAtUnixMillis == 0 {
		t.Fatal("owner could not pin", pinned, err)
	}
	info, err := desk.Info(owner, &pb.InfoRequest{})
	if err != nil || find(info).PinnedAtUnixMillis != pinned.Session.PinnedAtUnixMillis {
		t.Fatal("the pin is not in the owner's Info", err)
	}
	// The phone sees the desktop's pin, in its Info and in History.
	info, err = f.client.Info(bearer(ctx, phone), &pb.InfoRequest{})
	if err != nil || find(info).PinnedAtUnixMillis != pinned.Session.PinnedAtUnixMillis {
		t.Fatal("the phone does not see the pin", err)
	}
	history, err := f.client.ListHistory(bearer(ctx, phone), &pb.ListHistoryRequest{Limit: 10})
	if err != nil || len(history.Sessions) != 1 || history.Sessions[0].PinnedAtUnixMillis == 0 {
		t.Fatal("the phone's history does not show the pin", history, err)
	}

	archived, err := desk.ArchiveConversation(owner, &pb.ArchiveConversationRequest{SessionId: e.ID, Archived: true})
	if err != nil || archived.Session.ArchivedAtUnixMillis == 0 || archived.Session.PinnedAtUnixMillis == 0 {
		t.Fatal("owner could not archive, or archiving unpinned", archived, err)
	}
	// Archiving stops nothing.
	if archived.Session.Closed {
		t.Fatal("archiving closed the conversation")
	}

	// Neither a phone nor the agent itself pins or archives.
	_, err = f.client.PinConversation(bearer(ctx, phone), &pb.PinConversationRequest{SessionId: e.ID})
	expectCode(t, "a phone unpinned", err, codes.PermissionDenied)
	_, err = f.client.ArchiveConversation(bearer(ctx, phone), &pb.ArchiveConversationRequest{SessionId: e.ID})
	expectCode(t, "a phone unarchived", err, codes.PermissionDenied)
	_, err = desk.PinConversation(bearer(ctx, agentCredential), &pb.PinConversationRequest{SessionId: e.ID})
	expectCode(t, "an agent unpinned its conversation", err, codes.PermissionDenied)
	_, err = desk.ArchiveConversation(bearer(ctx, agentCredential), &pb.ArchiveConversationRequest{SessionId: e.ID})
	expectCode(t, "an agent unarchived its conversation", err, codes.PermissionDenied)

	cleared, err := desk.PinConversation(owner, &pb.PinConversationRequest{SessionId: e.ID, Pinned: false})
	if err != nil || cleared.Session.PinnedAtUnixMillis != 0 {
		t.Fatal("owner could not unpin", cleared, err)
	}
	restored, err := desk.ArchiveConversation(owner, &pb.ArchiveConversationRequest{SessionId: e.ID, Archived: false})
	if err != nil || restored.Session.ArchivedAtUnixMillis != 0 {
		t.Fatal("owner could not unarchive", restored, err)
	}
	_, err = desk.PinConversation(owner, &pb.PinConversationRequest{SessionId: "missing", Pinned: true})
	expectCode(t, "pinning a conversation that does not exist", err, codes.NotFound)
}
