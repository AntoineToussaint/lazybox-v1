package items

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/sources/github"
)

// GitHubAPI is what the built-in GitHub provider reads (github.Client).
type GitHubAPI interface {
	ReadPullRequest(ctx context.Context, token, fullName string, number int64, previous *github.PullRead) (github.PullRead, error)
	PullRequestsForBranch(ctx context.Context, token, fullName, branch, etag string) ([]github.BranchPull, string, bool, error)
}

// GitHub is the built-in provider: pull requests, read with conditional
// requests through the Runner's GitHub connection.
type GitHub struct {
	API GitHubAPI
	// Credential runs use with the connection's token (githubconnection).
	Credential func(ctx context.Context, use func(token string) error) error
}

func (GitHub) Name() string { return "github" }

func (GitHub) Resolve(url string) (Resolved, bool) { return ResolveGitHub(url) }

// githubETag is the opaque validator kept per item: each part's ETag, the
// head they were read on, and the parts a partial read reuses.
type githubETag struct {
	github.PullETags
	CreatedAt time.Time `json:"createdAt,omitzero"`
}

func (g GitHub) Refresh(ctx context.Context, list []Item, etags map[string]string) (Refreshed, error) {
	out := Refreshed{ETags: map[string]string{}, Failed: map[string]error{}}
	if g.API == nil || g.Credential == nil {
		return out, errors.New("GitHub is not connected")
	}
	err := g.Credential(ctx, func(token string) error {
		for _, item := range list {
			repository, number, ok := ParseGitHubKey(item.Ref.Key)
			if !ok {
				out.Failed[item.Ref.ID()] = errors.New("not a GitHub pull request key")
				continue
			}
			var previous *github.PullRead
			var tag githubETag
			if raw := etags[item.Ref.ID()]; raw != "" && item.PR != nil && json.Unmarshal([]byte(raw), &tag) == nil {
				previous = pullReadOf(item, tag)
			}
			read, err := g.API.ReadPullRequest(ctx, token, repository, number, previous)
			if err != nil {
				if limited, ok := asGitHubLimit(err); ok {
					return limited
				}
				if errors.Is(err, github.ErrUnauthorized) {
					return err
				}
				out.Failed[item.Ref.ID()] = err
				continue
			}
			if read.NotModified {
				out.Unchanged = append(out.Unchanged, item.Ref)
				continue
			}
			fresh := itemOf(repository, read)
			fresh.Ref = item.Ref
			out.Items = append(out.Items, fresh)
			encoded, _ := json.Marshal(githubETag{PullETags: read.ETags, CreatedAt: read.CreatedAt})
			out.ETags[item.Ref.ID()] = string(encoded)
		}
		return nil
	})
	return out, err
}

func asGitHubLimit(err error) (*RateLimited, bool) {
	var limit *github.RateLimitError
	if errors.As(err, &limit) {
		return &RateLimited{Until: limit.Reset}, true
	}
	return nil, false
}

// PullRequestsFor finds the pull requests opened from a branch.
func (g GitHub) PullRequestsFor(ctx context.Context, repository, branch, etag string) ([]Item, string, bool, error) {
	if g.API == nil || g.Credential == nil {
		return nil, "", false, errors.New("GitHub is not connected")
	}
	var found []Item
	var newTag string
	var same bool
	err := g.Credential(ctx, func(token string) error {
		list, tag, notModified, err := g.API.PullRequestsForBranch(ctx, token, repository, branch, etag)
		if err != nil {
			if limited, ok := asGitHubLimit(err); ok {
				return limited
			}
			return err
		}
		newTag, same = tag, notModified
		for _, pr := range list {
			found = append(found, Item{Ref: GitHubRef(repository, pr.Number), Kind: KindPullRequest, Repository: repository, Number: pr.Number, RawState: pr.State,
				URL: "https://github.com/" + repository + "/pull/" + itoa(pr.Number), PR: &PullRequest{Head: pr.Head}, UpdatedAt: pr.CreatedAt})
		}
		return nil
	})
	return found, newTag, same, err
}

// ItemOfStatus is the snapshot of what the PR loop read about a branch.
func ItemOfStatus(repository string, status github.PullRequestStatus, closedAt time.Time) Item {
	read := github.PullRead{Status: status, ClosedAt: closedAt}
	for _, c := range status.Checks {
		if c.Source == "status" {
			read.Statuses = append(read.Statuses, c)
		} else {
			read.Runs = append(read.Runs, c)
		}
	}
	return itemOf(repository, read)
}

func itemOf(repository string, read github.PullRead) Item {
	s := read.Status
	item := Item{Ref: GitHubRef(repository, s.Number), Kind: KindPullRequest, Title: s.Title, URL: s.URL, Repository: repository, Number: s.Number, Author: s.Author,
		RawState: s.State, UpdatedAt: read.UpdatedAt, ClosedAt: read.ClosedAt,
		PR: &PullRequest{Head: s.Head, Base: s.Base, HeadSHA: s.HeadSHA, Draft: s.Draft, Checks: s.ChecksState, Review: s.ReviewDecision, Mergeable: s.Mergeable, MergeableState: s.MergeableState, MergeCommit: s.MergeCommit}}
	for _, c := range s.Checks {
		item.PR.CheckRuns = append(item.PR.CheckRuns, Check{Name: c.Name, Status: c.Status, Conclusion: c.Conclusion, URL: c.URL, Summary: c.Summary, Source: c.Source, ID: c.ID})
	}
	item.State, item.Label = githubCategory(s.State, s.Draft)
	if item.State == StateMerged || item.State == StateClosed {
		if item.ClosedAt.IsZero() {
			item.ClosedAt = time.Now()
		}
	}
	return item
}

// githubCategory: an open pull request is in review (a draft is started).
func githubCategory(state string, draft bool) (string, string) {
	switch state {
	case "merged":
		return StateMerged, "Merged"
	case "closed":
		return StateClosed, "Closed"
	}
	if draft {
		return StateStarted, "Draft"
	}
	return StateReview, "Open"
}

// pullReadOf rebuilds the last read from a snapshot, so a partial 304 can
// reuse the parts that did not change.
func pullReadOf(item Item, tag githubETag) *github.PullRead {
	pr := item.PR
	status := github.PullRequestStatus{Found: true, Number: item.Number, Title: item.Title, URL: item.URL, State: item.RawState, Draft: pr.Draft, Base: pr.Base, Head: pr.Head, HeadSHA: pr.HeadSHA,
		MergeableState: pr.MergeableState, Mergeable: pr.Mergeable, ReviewDecision: pr.Review, MergeCommit: pr.MergeCommit, Author: item.Author}
	read := &github.PullRead{Status: status, ETags: tag.PullETags, CreatedAt: tag.CreatedAt, UpdatedAt: item.UpdatedAt}
	if Ended(item.State) {
		read.ClosedAt = item.ClosedAt
	}
	for _, c := range pr.CheckRuns {
		check := github.Check{Name: c.Name, Status: c.Status, Conclusion: c.Conclusion, URL: c.URL, Summary: c.Summary, Source: c.Source, ID: c.ID}
		if c.Source == "status" {
			read.Statuses = append(read.Statuses, check)
		} else {
			read.Runs = append(read.Runs, check)
		}
	}
	return read
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
