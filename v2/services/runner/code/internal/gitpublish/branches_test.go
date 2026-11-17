package gitpublish

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// DefaultBranch is origin's own default branch as the clone recorded it,
// whatever its name; Contains tells a commit on a local branch from one the
// repository does not have.
func TestDefaultBranchAndContains(t *testing.T) {
	ctx := context.Background()
	_, source, one, _ := fixture(t)
	if _, err := (Git{}).DefaultBranch(ctx, one); !errors.Is(err, ErrNoDefault) {
		t.Fatalf("no origin/HEAD recorded: %v", err)
	}
	git(t, source, "fetch", "-q", "origin")
	git(t, source, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	git(t, source, "branch", "-m", "main", "production")
	git(t, source, "update-ref", "refs/remotes/origin/production", "refs/remotes/origin/main")
	git(t, source, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/production")
	if branch, err := (Git{}).DefaultBranch(ctx, one); err != nil || branch != "production" {
		t.Fatalf("default branch: %q %v", branch, err)
	}
	head := git(t, one, "rev-parse", "HEAD")
	if !(Git{}).Contains(ctx, one, "feature/one", head) {
		t.Fatal("the branch's own tip is on it")
	}
	if (Git{}).Contains(ctx, one, "feature/one", strings.Repeat("ab", 20)) {
		t.Fatal("a commit the repository does not have is on the branch")
	}
	if (Git{}).Contains(ctx, one, "feature/one", "HEAD") || (Git{}).Contains(ctx, one, "-x", head) {
		t.Fatal("only a full commit id on a branch name is asked about")
	}
}
