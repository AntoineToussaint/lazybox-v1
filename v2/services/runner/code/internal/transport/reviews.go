package transport

import (
	"bytes"
	"context"
	"errors"

	"github.com/AntoineToussaint/lazybox/v2/internal/gitinspect"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/reviews"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
)

// Inline review comments. The Runner keeps them per workspace and anchors
// each one against the member's working tree on every read: still at its
// lines, moved with them, or outdated. A comment is resolved on its own only
// when the person asked for that, after it was sent, and once a commit
// changed exactly what it quotes. Owner only, like every RPC off the agent
// allowlist.

func (s *Service) reviewStore(workspace string) (*reviews.Store, error) {
	if s.Bench.Reviews == nil {
		return nil, grpcError(codes.FailedPrecondition, errors.New("review comments are not available on this Runner"))
	}
	manager, err := s.collectionStore()
	if err != nil {
		return nil, err
	}
	if _, err = manager.Get(workspace); err != nil {
		return nil, rpcError(err)
	}
	return s.Bench.Reviews, nil
}

// memberRoots resolves and caches each member's worktree for one request.
type memberRoots struct {
	s         *Service
	workspace string
	roots     map[string]string
	errs      map[string]error
	heads     map[string]string
}

func (s *Service) memberRoots(workspace string) *memberRoots {
	return &memberRoots{s: s, workspace: workspace, roots: map[string]string{}, errs: map[string]error{}, heads: map[string]string{}}
}

func (m *memberRoots) root(ctx context.Context, member string) (string, error) {
	if root, ok := m.roots[member]; ok {
		return root, m.errs[member]
	}
	manager, err := m.s.collectionStore()
	root := ""
	if err == nil {
		root, err = manager.InspectionPath(ctx, m.workspace, member)
	}
	m.roots[member], m.errs[member] = root, err
	return root, err
}

func (m *memberRoots) head(ctx context.Context, member string) string {
	if head, ok := m.heads[member]; ok {
		return head
	}
	head := ""
	if root, err := m.root(ctx, member); err == nil {
		head, _ = gitinspect.Git{}.Head(ctx, root)
	}
	m.heads[member] = head
	return head
}

// committedAway reports whether a commit after the handover changed what a
// sent comment quotes: HEAD moved, that file differs between the two commits,
// and the quoted lines are in neither the new commit nor the working tree.
func committedAway(ctx context.Context, root, head string, c reviews.Comment, anchor reviews.Anchor) bool {
	if c.Side != reviews.SideNew || anchor.Freshness != reviews.Outdated || c.SentHead == "" || head == "" || head == c.SentHead {
		return false
	}
	git := gitinspect.Git{}
	before, hadIt, err := git.ShowAt(ctx, root, c.SentHead, c.Path)
	if err != nil {
		return false
	}
	after, hasIt, err := git.ShowAt(ctx, root, head, c.Path)
	if err != nil || (hadIt == hasIt && bytes.Equal(before, after)) {
		return false
	}
	return !hasIt || reviews.Locate(reviews.Lines(string(after)), c.Snippet, c.StartLine) == 0
}

func wireReviewComment(c reviews.Comment, a reviews.Anchor) *pb.ReviewComment {
	return &pb.ReviewComment{Id: c.ID, Member: c.Member, Path: c.Path, Side: c.Side, StartLine: uint32(c.StartLine), EndLine: uint32(c.EndLine), Snippet: c.Snippet, Hash: c.Hash, Body: c.Body,
		Head: c.Head, View: c.View, Base: c.Base, CreatedAtUnix: c.CreatedAt, UpdatedAtUnix: c.UpdatedAt, Disposition: string(c.Disposition),
		SentTo: c.SentTo, SentToTitle: c.SentToTitle, SentAtUnix: c.SentAt, SentHead: c.SentHead, ResolvedBy: c.ResolvedBy, Note: c.Note,
		Freshness: string(a.Freshness), CurrentStartLine: uint32(a.StartLine), CurrentEndLine: uint32(a.EndLine), FreshnessReason: a.Reason}
}

// review anchors every comment against the working trees as they are now.
func (s *Service) review(ctx context.Context, store *reviews.Store, workspace string, review reviews.Review) *pb.WorkspaceReview {
	roots := s.memberRoots(workspace)
	out := &pb.WorkspaceReview{AutoResolve: review.AutoResolve}
	for _, c := range review.Comments {
		anchor := reviews.Anchor{Freshness: reviews.Unknown}
		root, err := roots.root(ctx, c.Member)
		if err != nil {
			anchor.Reason = "The repository is not available: " + err.Error()
		} else if content, exists, err := gitinspect.ReadWorking(root, c.Path); err != nil {
			anchor.Reason = "The file cannot be read: " + err.Error()
		} else {
			anchor = reviews.Evaluate(c, content, exists)
		}
		if review.AutoResolve && c.Disposition == reviews.Sent && err == nil {
			if head := roots.head(ctx, c.Member); committedAway(ctx, root, head, c, anchor) {
				if changed, _ := store.ResolveByCommit(workspace, c.ID, head); changed {
					if fresh, err := store.Load(workspace); err == nil {
						for _, r := range fresh.Comments {
							if r.ID == c.ID {
								c = r
							}
						}
					}
				}
			}
		}
		out.Comments = append(out.Comments, wireReviewComment(c, anchor))
	}
	return out
}

func (s *Service) ListReviewComments(ctx context.Context, r *pb.ListReviewCommentsRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	review, err := store.Load(r.CollectionId)
	if err != nil {
		return nil, rpcError(err)
	}
	return s.review(ctx, store, r.CollectionId, review), nil
}

func (s *Service) AddReviewComment(ctx context.Context, r *pb.AddReviewCommentRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	roots := s.memberRoots(r.CollectionId)
	root, err := roots.root(ctx, r.Member)
	if err != nil {
		return nil, rpcError(err)
	}
	fileHash := ""
	if content, exists, err := gitinspect.ReadWorking(root, r.Path); err == nil && exists {
		fileHash = reviews.FileHash(content)
	}
	added, err := store.Add(r.CollectionId, reviews.Comment{Member: r.Member, Path: r.Path, Side: r.Side, StartLine: int(r.StartLine), Snippet: r.Snippet, Body: r.Body,
		FileHash: fileHash, Head: roots.head(ctx, r.Member), View: r.View, Base: r.Base})
	if err != nil {
		return nil, rpcError(err)
	}
	review, err := store.Load(r.CollectionId)
	if err != nil {
		return nil, rpcError(err)
	}
	out := s.review(ctx, store, r.CollectionId, review)
	out.AddedId = added.ID
	return out, nil
}

func (s *Service) EditReviewComment(ctx context.Context, r *pb.EditReviewCommentRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	review, err := store.Edit(r.CollectionId, r.Id, r.Body)
	if err != nil {
		return nil, rpcError(err)
	}
	return s.review(ctx, store, r.CollectionId, review), nil
}

func (s *Service) DeleteReviewComment(ctx context.Context, r *pb.DeleteReviewCommentRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	review, err := store.Delete(r.CollectionId, r.Id)
	if err != nil {
		return nil, rpcError(err)
	}
	return s.review(ctx, store, r.CollectionId, review), nil
}

func (s *Service) SetReviewDisposition(ctx context.Context, r *pb.SetReviewDispositionRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	to := reviews.Handover{Session: r.SessionId, Title: r.SessionTitle, Heads: map[string]string{}}
	if reviews.Disposition(r.Disposition) == reviews.Sent {
		current, err := store.Load(r.CollectionId)
		if err != nil {
			return nil, rpcError(err)
		}
		roots, chosen := s.memberRoots(r.CollectionId), map[string]bool{}
		for _, id := range r.Ids {
			chosen[id] = true
		}
		for _, c := range current.Comments {
			if _, seen := to.Heads[c.Member]; chosen[c.ID] && !seen {
				to.Heads[c.Member] = roots.head(ctx, c.Member)
			}
		}
	}
	review, err := store.SetDisposition(r.CollectionId, r.Ids, reviews.Disposition(r.Disposition), to)
	if err != nil {
		return nil, rpcError(err)
	}
	return s.review(ctx, store, r.CollectionId, review), nil
}

func (s *Service) SetReviewAutoResolve(ctx context.Context, r *pb.SetReviewAutoResolveRequest) (*pb.WorkspaceReview, error) {
	store, err := s.reviewStore(r.CollectionId)
	if err != nil {
		return nil, err
	}
	review, err := store.SetAutoResolve(r.CollectionId, r.Enabled)
	if err != nil {
		return nil, rpcError(err)
	}
	return s.review(ctx, store, r.CollectionId, review), nil
}
