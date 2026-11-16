package transport

import (
	"context"
	"sync"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/gitinspect"
	"github.com/AntoineToussaint/lazybox/v2/internal/gitpublish"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/collections"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
)

// The sidebar's git state. ListWorkspaceGitSummaries is polled by every
// window, so it stays cheap: a few local Git processes per repository, at most
// a handful at a time, and never a network call on the request path. Pull
// requests come from the cache GetPullRequest (and create/merge) fill; a
// pushed branch whose entry is missing or old is refreshed in the background,
// so the next poll has it.

const (
	summaryWorkspaceLimit = 200
	summaryParallel       = 4
	pullRefreshParallel   = 2
	// How long a pull request read stays fresh: an open one changes as checks
	// run; a closed or merged one, and "none yet", change rarely.
	pullOpenFresh  = 90 * time.Second
	pullNoneFresh  = 3 * time.Minute
	pullDoneFresh  = 15 * time.Minute
	pullRefreshTTL = 20 * time.Second
)

type pullEntry struct {
	branch  string
	summary *pb.PullRequestSummary // nil: the branch has no pull request
	at      time.Time
}

// pullRequestCache is the last pull request read per workspace repository.
// Its zero value is ready to use.
type pullRequestCache struct {
	mu       sync.Mutex
	entries  map[string]pullEntry
	inflight map[string]bool
	slots    chan struct{}
	// running counts background refreshes, so a test can wait for them.
	running sync.WaitGroup
	// now is the clock; nil is time.Now.
	now func() time.Time
}

func pullKey(workspace, member string) string { return workspace + "\x00" + member }

func (c *pullRequestCache) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// remember records what GitHub said about a member's branch.
func (c *pullRequestCache) remember(workspace, member string, out *pb.PullRequestStatus) {
	if out == nil || out.Unavailable != "" || out.Branch == "" {
		return
	}
	entry := pullEntry{branch: out.Branch, at: c.clock()}
	if out.Found {
		entry.summary = &pb.PullRequestSummary{Number: out.Number, Title: out.Title, Url: out.Url, State: out.State, Draft: out.Draft, ChecksState: out.ChecksState, ReviewDecision: out.ReviewDecision, ObservedAtUnixMillis: entry.at.UnixMilli()}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]pullEntry{}
	}
	c.entries[pullKey(workspace, member)] = entry
}

// lookup is the known pull request for the branch, and whether it is fresh.
func (c *pullRequestCache) lookup(workspace, member, branch string) (*pb.PullRequestSummary, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[pullKey(workspace, member)]
	if !ok || entry.branch != branch {
		return nil, false
	}
	age := c.clock().Sub(entry.at)
	switch {
	case entry.summary == nil:
		return nil, age < pullNoneFresh
	case entry.summary.State == "open":
		return entry.summary, age < pullOpenFresh
	default:
		return entry.summary, age < pullDoneFresh
	}
}

// claim reserves a background refresh of one member; false when one runs.
func (c *pullRequestCache) claim(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.inflight == nil {
		c.inflight = map[string]bool{}
		c.slots = make(chan struct{}, pullRefreshParallel)
	}
	if c.inflight[key] {
		return false
	}
	c.inflight[key] = true
	c.running.Add(1)
	return true
}

func (c *pullRequestCache) release(key string) {
	c.mu.Lock()
	delete(c.inflight, key)
	c.mu.Unlock()
	c.running.Done()
}

// refreshPullRequest reads the member's pull request from GitHub in the
// background; GetPullRequest's own path records it in the cache.
func (s *Service) refreshPullRequest(workspace, member string) {
	key := pullKey(workspace, member)
	if !s.pulls.claim(key) {
		return
	}
	go func() {
		defer s.pulls.release(key)
		s.pulls.slots <- struct{}{}
		defer func() { <-s.pulls.slots }()
		ctx, cancel := context.WithTimeout(context.Background(), pullRefreshTTL)
		defer cancel()
		// Errors (rate limits, a dropped connection) leave the old entry; the
		// next poll tries again.
		_, _ = s.GetPullRequest(ctx, &pb.GetPullRequestRequest{CollectionId: workspace, Member: member})
	}()
}

type summarizer interface {
	Summary(ctx context.Context, root, base string) (gitinspect.Summary, error)
}

func (s *Service) ListWorkspaceGitSummaries(ctx context.Context, r *pb.WorkspaceGitSummariesRequest) (*pb.WorkspaceGitSummaries, error) {
	manager, err := s.collectionStore()
	if err != nil {
		return nil, err
	}
	var workspaces []collections.Collection
	if len(r.CollectionIds) == 0 {
		workspaces = manager.List()
	} else {
		seen := map[string]bool{}
		for _, id := range r.CollectionIds {
			if seen[id] {
				continue
			}
			seen[id] = true
			// A workspace deleted since the window listed them is simply absent.
			if w, err := manager.Get(id); err == nil && w.State != "deleted" {
				workspaces = append(workspaces, w)
			}
		}
	}
	if len(workspaces) > summaryWorkspaceLimit {
		workspaces = workspaces[:summaryWorkspaceLimit]
	}
	git, ok := s.gitInspector().(summarizer)
	if !ok {
		git = gitinspect.Git{}
	}
	pullsAvailable := s.githubConnected() && s.Bench.GitHubPulls != nil
	out := &pb.WorkspaceGitSummaries{}
	type job struct {
		workspace collections.Collection
		member    collections.Member
		row       *pb.RepositoryGitSummary
	}
	var jobs []job
	for _, w := range workspaces {
		summary := &pb.WorkspaceGitSummary{CollectionId: w.ID}
		out.Workspaces = append(out.Workspaces, summary)
		for _, m := range w.Members {
			row := &pb.RepositoryGitSummary{Member: m.Name}
			summary.Repositories = append(summary.Repositories, row)
			jobs = append(jobs, job{w, m, row})
		}
	}
	slots := make(chan struct{}, summaryParallel)
	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		slots <- struct{}{}
		go func(j job) {
			defer wg.Done()
			defer func() { <-slots }()
			row := j.row
			path, err := manager.InspectionPath(ctx, j.workspace.ID, j.member.Name)
			if err != nil {
				row.Error = err.Error()
				return
			}
			state, err := git.Summary(ctx, path, j.member.BaseCommit)
			if err != nil {
				row.Error = err.Error()
				return
			}
			row.Branch, row.Head = state.Branch, state.Head
			row.Upstream, row.Ahead, row.Behind = state.Upstream, uint32(state.Ahead), uint32(state.Behind)
			row.DefaultBranch, row.AheadOfDefault, row.BehindDefault = state.Default, uint32(state.AheadOfDefault), uint32(state.BehindOfDefault)
			row.Dirty, row.DirtyTruncated = uint32(state.Dirty), state.DirtyTruncated
			if origin, err := (gitpublish.Git{}).Origin(ctx, path); err == nil {
				row.GithubRepository = origin.GitHub
			}
			if row.Branch == "" {
				return
			}
			pr, fresh := s.pulls.lookup(j.workspace.ID, j.member.Name, row.Branch)
			row.PullRequest = pr
			// Only a pushed branch can have a pull request worth asking GitHub about.
			if !fresh && pullsAvailable && row.Upstream != "" && row.GithubRepository != "" {
				s.refreshPullRequest(j.workspace.ID, j.member.Name)
			}
		}(j)
	}
	wg.Wait()
	return out, nil
}
