// Package githubtest is an in-memory GitHub REST API for PR-loop tests: pull
// requests, reviews, check runs, commit statuses and merges, over httptest.
// It never contacts GitHub.
package githubtest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

type Check struct {
	Name, Status, Conclusion, URL string
}
type Status struct {
	Context, State, URL string
}
type PR struct {
	Number                   int
	Title, Body, Head, Base  string
	HeadSHA                  string
	Draft, Merged            bool
	State                    string
	MergeableState           string
	MergeMethod, MergeCommit string
	Reviews                  []string // "login:STATE"
	Requested                int
}

// Server is a fake GitHub for one token. Set MergeRefusal to make merges fail
// as branch protection does (HTTP 405 with GitHub's message).
type Server struct {
	*httptest.Server
	Token        string
	mu           sync.Mutex
	Repos        map[string]string // full name → default branch
	Heads        map[string]string // "owner/name:branch" → pushed head
	Pulls        map[string][]*PR  // full name → pull requests
	Checks       map[string][]Check
	Statuses     map[string][]Status
	MergeRefusal string
	Requests     []string
	Unauthorized int
	ReadOnly     bool
	// Issues and their comments, for the start-from-an-issue reads (issues.go).
	Issues IssueStore
}

func New(t *testing.T, token string) *Server {
	s := &Server{Token: token, Repos: map[string]string{}, Heads: map[string]string{}, Pulls: map[string][]*PR{}, Checks: map[string][]Check{}, Statuses: map[string][]Status{}}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.Close)
	return s
}

// Pull returns a pull request by number for assertions.
func (s *Server) Pull(fullName string, number int) *PR {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, pr := range s.Pulls[fullName] {
		if pr.Number == number {
			copy := *pr
			return &copy
		}
	}
	return nil
}

// SetHead records a push: the branch, and its open pull request, now point at sha.
func (s *Server) SetHead(fullName, branch, sha string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Heads[fullName+":"+branch] = sha
	for _, pr := range s.Pulls[fullName] {
		if pr.Head == branch && pr.State == "open" {
			pr.HeadSHA = sha
		}
	}
}

func (s *Server) Update(f func(*Server)) { s.mu.Lock(); defer s.mu.Unlock(); f(s) }

func write(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) wire(full string, pr *PR) map[string]any {
	state := pr.State
	if pr.Merged {
		state = "closed"
	}
	reviewers := []map[string]any{}
	for i := 0; i < pr.Requested; i++ {
		reviewers = append(reviewers, map[string]any{"login": "reviewer" + strconv.Itoa(i)})
	}
	return map[string]any{
		"number": pr.Number, "title": pr.Title, "body": pr.Body, "state": state, "draft": pr.Draft, "merged": pr.Merged,
		"html_url": "https://github.com/" + full + "/pull/" + strconv.Itoa(pr.Number), "mergeable": pr.MergeableState == "clean" || pr.MergeableState == "unstable",
		"mergeable_state": pr.MergeableState, "merge_commit_sha": pr.MergeCommit, "user": map[string]any{"login": "fixture"},
		"head": map[string]any{"ref": pr.Head, "sha": pr.HeadSHA}, "base": map[string]any{"ref": pr.Base}, "requested_reviewers": reviewers,
	}
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Requests = append(s.Requests, r.Method+" "+r.URL.Path)
	if r.Header.Get("Authorization") != "Bearer "+s.Token {
		s.Unauthorized++
		write(w, 401, map[string]any{"message": "Bad credentials"})
		return
	}
	if s.serveIssues(w, r) {
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "repos" {
		write(w, 404, map[string]any{"message": "Not Found"})
		return
	}
	full := parts[1] + "/" + parts[2]
	base, ok := s.Repos[full]
	if !ok {
		write(w, 404, map[string]any{"message": "Not Found"})
		return
	}
	rest := parts[3:]
	switch {
	case len(rest) == 0 && r.Method == "GET":
		write(w, 200, map[string]any{"full_name": full, "default_branch": base})
	case len(rest) == 1 && rest[0] == "pulls" && r.Method == "GET":
		head := r.URL.Query().Get("head")
		out := []map[string]any{}
		pulls := s.Pulls[full]
		for i := len(pulls) - 1; i >= 0; i-- {
			if parts[1]+":"+pulls[i].Head == head {
				out = append(out, s.wire(full, pulls[i]))
			}
		}
		write(w, 200, out)
	case len(rest) == 1 && rest[0] == "pulls" && r.Method == "POST":
		if s.ReadOnly {
			write(w, 403, map[string]any{"message": "Resource not accessible by integration"})
			return
		}
		var body struct {
			Title, Head, Base, Body string
			Draft                   bool
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		for _, pr := range s.Pulls[full] {
			if pr.Head == body.Head && pr.State == "open" {
				write(w, 422, map[string]any{"message": "Validation Failed", "errors": []map[string]any{{"resource": "PullRequest", "code": "custom", "message": "A pull request already exists for " + parts[1] + ":" + body.Head + "."}}})
				return
			}
		}
		sha := s.Heads[full+":"+body.Head]
		if sha == "" {
			write(w, 422, map[string]any{"message": "Validation Failed", "errors": []map[string]any{{"resource": "PullRequest", "field": "head", "code": "invalid"}}})
			return
		}
		pr := &PR{Number: len(s.Pulls[full]) + 1, Title: body.Title, Body: body.Body, Head: body.Head, Base: body.Base, Draft: body.Draft, State: "open", MergeableState: "unknown", HeadSHA: sha}
		s.Pulls[full] = append(s.Pulls[full], pr)
		write(w, 201, s.wire(full, pr))
	case len(rest) >= 2 && rest[0] == "pulls":
		number, _ := strconv.Atoi(rest[1])
		var pr *PR
		for _, candidate := range s.Pulls[full] {
			if candidate.Number == number {
				pr = candidate
			}
		}
		if pr == nil {
			write(w, 404, map[string]any{"message": "Not Found"})
			return
		}
		switch {
		case len(rest) == 2 && r.Method == "GET":
			write(w, 200, s.wire(full, pr))
		case len(rest) == 3 && rest[2] == "reviews" && r.Method == "GET":
			out := []map[string]any{}
			for _, review := range pr.Reviews {
				login, state, _ := strings.Cut(review, ":")
				out = append(out, map[string]any{"user": map[string]any{"login": login}, "state": state})
			}
			write(w, 200, out)
		case len(rest) == 3 && rest[2] == "merge" && r.Method == "PUT":
			var body struct {
				SHA         string `json:"sha"`
				MergeMethod string `json:"merge_method"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if s.MergeRefusal != "" {
				write(w, 405, map[string]any{"message": s.MergeRefusal})
				return
			}
			if body.SHA != pr.HeadSHA {
				write(w, 409, map[string]any{"message": "Head branch was modified. Review and try the merge again."})
				return
			}
			pr.Merged, pr.State, pr.MergeMethod, pr.MergeCommit = true, "closed", body.MergeMethod, "merged-"+pr.HeadSHA
			write(w, 200, map[string]any{"merged": true, "sha": pr.MergeCommit, "message": "Pull Request successfully merged"})
		default:
			write(w, 404, map[string]any{"message": "Not Found"})
		}
	case len(rest) == 3 && rest[0] == "commits" && rest[2] == "check-runs":
		runs := []map[string]any{}
		for _, c := range s.Checks[rest[1]] {
			runs = append(runs, map[string]any{"name": c.Name, "status": c.Status, "conclusion": c.Conclusion, "html_url": c.URL})
		}
		write(w, 200, map[string]any{"total_count": len(runs), "check_runs": runs})
	case len(rest) == 3 && rest[0] == "commits" && rest[2] == "status":
		statuses := []map[string]any{}
		for _, c := range s.Statuses[rest[1]] {
			statuses = append(statuses, map[string]any{"context": c.Context, "state": c.State, "target_url": c.URL})
		}
		write(w, 200, map[string]any{"state": "pending", "statuses": statuses})
	default:
		write(w, 404, map[string]any{"message": fmt.Sprintf("Not Found: %s", r.URL.Path)})
	}
}
