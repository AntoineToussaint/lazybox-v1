package transport

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// CLAUDE_COMPLIANCE.md: an Anthropic API key for Claude agents, Claude
// sign-in in Lazybox off by default, and automatic switching only through an
// extension's account policy.

// A fixture key: shaped like an Anthropic API key, valid nowhere.
const fixtureAPIKey = "sk-ant-api03-fixture-not-a-real-key-0000-wxyz"

func agentFailure(state string) agent.Event {
	return agent.Event{Type: "failure", Status: state, Account: &agent.AccountObservation{State: state, ResetAt: time.Now().Add(time.Hour).Unix()}}
}

// enableAccountPolicy installs and approves Lazybox's own Subscription
// rotation extension, as the person does in Settings → Extensions.
func enableAccountPolicy(t *testing.T, b *runner.Bench) {
	t.Helper()
	snap, err := b.Extensions().InstallExample("subscription-rotation")
	if err != nil {
		t.Fatal(err)
	}
	info, ok := snap.Find("subscription-rotation")
	if !ok {
		t.Fatal("the bundled Subscription rotation extension is missing")
	}
	if _, err = b.Extensions().Approve(info.ID, info.Manifest.Grants, info.Manifest.Hosts); err != nil {
		t.Fatal(err)
	}
}

// The saved key is what a claude-default agent runs on, the only Claude
// credential in its environment; the key never comes back on the wire, and a
// subscription token is refused.
func TestClaudeAPIKeyIsWhatTheAgentRunsOn(t *testing.T) {
	service, _ := collectionService(t)
	b := service.Bench
	adapter := rotatingFixture{opened: make(chan *rotatingNative, 4)}
	b.Adapters["claude"] = adapter
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-inherited-subscription")
	t.Setenv("ANTHROPIC_API_KEY", "")
	ctx := context.Background()
	env := func() string {
		t.Helper()
		r, err := service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "claude-default", Cwd: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		if r.Session.Provider != "claude" {
			t.Fatalf("provider %q", r.Session.Provider)
		}
		return "\n" + strings.Join((<-adapter.opened).Open.Env, "\n") + "\n"
	}
	// No key: the person's own Claude Code sign-in, as inherited.
	if got := env(); strings.Contains(got, "\nANTHROPIC_API_KEY=sk-") || !strings.Contains(got, "\nCLAUDE_CODE_OAUTH_TOKEN=fixture-inherited-subscription\n") {
		t.Fatal("without a key the agent must keep the person's own sign-in")
	}
	if _, err := service.SetClaudeApiKey(ctx, &pb.SetClaudeApiKeyRequest{ApiKey: "sk-ant-oat01-fixture-subscription"}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("a subscription token was saved as a key: %v", err)
	}
	auth, err := service.SetClaudeApiKey(ctx, &pb.SetClaudeApiKeyRequest{ApiKey: "  " + fixtureAPIKey + "\n"})
	if err != nil {
		t.Fatal(err)
	}
	if !auth.ApiKeySet || auth.ApiKeyHint != "wxyz" || strings.Contains(auth.String(), fixtureAPIKey) {
		t.Fatalf("the reply: %v", auth)
	}
	got := env()
	if !strings.Contains(got, "\nANTHROPIC_API_KEY="+fixtureAPIKey+"\n") || strings.Contains(got, "CLAUDE_CODE_OAUTH_TOKEN") {
		t.Fatalf("the agent's Claude credentials: the key, and only the key")
	}
	if read, _ := service.GetClaudeAuth(ctx, &pb.InfoRequest{}); !read.ApiKeySet || strings.Contains(read.String(), fixtureAPIKey) {
		t.Fatalf("GetClaudeAuth: %v", read)
	}
	if info, err := os.Stat(accounts.APIKeyFile(b.Config.State)); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("key file: %v %v", info, err)
	}
	// Codex is not given it.
	b.Adapters["codex"] = adapter
	r, err := service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "codex-default", Cwd: t.TempDir()})
	if err != nil || r.Session.Provider != "codex" {
		t.Fatal(err)
	}
	if codexEnv := strings.Join((<-adapter.opened).Open.Env, "\n"); strings.Contains(codexEnv, fixtureAPIKey) {
		t.Fatal("the Anthropic key reached Codex")
	}
	if auth, err = service.SetClaudeApiKey(ctx, &pb.SetClaudeApiKeyRequest{Clear: true}); err != nil || auth.ApiKeySet {
		t.Fatalf("forget: %v %v", auth, err)
	}
	if got := env(); strings.Contains(got, fixtureAPIKey) {
		t.Fatal("a forgotten key is still used")
	}
}

// A Claude subscription saved through a sign-in Lazybox offered starts only
// with Claude sign-in in Lazybox turned on; adding one is refused while off.
func TestClaudeSignInInLazyboxIsOffByDefault(t *testing.T) {
	service, _ := collectionService(t)
	b := service.Bench
	adapter := rotatingFixture{opened: make(chan *rotatingNative, 4)}
	b.Adapters["claude"] = adapter
	home := filepath.Join(b.Config.State, "accounts", "claude-work", "claude")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := accounts.StoreProfile(b.Config.State, accounts.Profile{ID: "claude-work", Label: "Work", Provider: "claude", Isolation: "environment", Home: home, NativeLogin: true}); err != nil {
		t.Fatal(err)
	}
	if err := b.ReloadProfiles(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "claude-work", Cwd: t.TempDir()}); status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "Claude sign-in in Lazybox is off") || len(adapter.opened) != 0 {
		t.Fatalf("a Claude subscription saved in Lazybox started with sign-in off: %v", err)
	}
	if _, err := service.AddSubscription(ctx, &pb.AddSubscriptionRequest{RequestKey: "k", Provider: "claude", Label: "Home"}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("Lazybox offered a Claude sign-in with it off: %v", err)
	}
	if _, err := service.AddSubscription(ctx, &pb.AddSubscriptionRequest{RequestKey: "t", Provider: "claude", Label: "Home", SubscriptionToken: "sk-ant-oat01-fixture"}); err == nil || !strings.Contains(err.Error(), "does not store Claude subscription tokens") {
		t.Fatalf("a subscription token was imported: %v", err)
	}
	settings, err := service.GetRunnerSettings(ctx, &pb.InfoRequest{})
	if err != nil || settings.ClaudeSubscriptionSignIn {
		t.Fatalf("on by default: %v", err)
	}
	settings.ClaudeSubscriptionSignIn = true
	if _, err = service.SaveRunnerSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	if _, err = service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "claude-work", Cwd: t.TempDir()}); err != nil {
		t.Fatalf("turned on, it starts: %v", err)
	}
	if open := (<-adapter.opened).Open; !strings.Contains(strings.Join(open.Env, "\n"), "CLAUDE_CONFIG_DIR="+home) {
		t.Fatal("the saved subscription's own sign-in")
	}
}

// Without an account policy a conversation never switches by itself; the
// person's explicit switch still works. Approving the bundled extension
// switches at the next limit; turning it off stops that, running
// conversations included.
func TestAutomaticSwitchingIsTheAccountPolicys(t *testing.T) {
	service, _ := collectionService(t)
	b := service.Bench
	adapter := twoSubscriptions(t, b)
	ctx := context.Background()
	limit := func(n *rotatingNative) {
		n.Events <- agentFailure("exhausted")
	}
	settings, _ := service.GetRunnerSettings(ctx, &pb.InfoRequest{})
	if len(settings.AutomaticSwitchingProviders) != 0 {
		t.Fatalf("switching on by default: %v", settings.AutomaticSwitchingProviders)
	}
	r, err := service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "a", Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	first := <-adapter.opened
	if len(r.Session.RotationProfileIds) != 0 {
		t.Fatalf("a pool without an account policy: %v", r.Session.RotationProfileIds)
	}
	limit(first)
	e, _ := b.Get(r.Session.Id)
	until(t, "the limit stops it", func() bool { return e.Engine.Snapshot().Fault == "exhausted" })
	if len(adapter.opened) != 0 || first.stopped.Load() {
		t.Fatal("switched by itself without an account policy")
	}
	// The person's choice needs no policy.
	if _, err = service.SwitchSubscription(ctx, &pb.SwitchSubscriptionRequest{SessionId: r.Session.Id, ProfileId: "b"}); err != nil {
		t.Fatal(err)
	}
	<-adapter.opened

	enableAccountPolicy(t, b)
	settings, _ = service.GetRunnerSettings(ctx, &pb.InfoRequest{})
	if !slices.Equal(settings.AutomaticSwitchingProviders, []string{"claude", "codex"}) {
		t.Fatalf("providers: %v", settings.AutomaticSwitchingProviders)
	}
	r, err = service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "a", Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	first = <-adapter.opened
	if strings.Join(r.Session.RotationProfileIds, ",") != "b" {
		t.Fatalf("pool %v", r.Session.RotationProfileIds)
	}
	limit(first)
	select {
	case second := <-adapter.opened:
		if second.Open.Profile != "b" {
			t.Fatalf("moved to %s", second.Open.Profile)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the account policy did not switch at the limit")
	}

	// Off again: a running conversation with a pool stops at its next limit.
	r, err = service.OpenSession(ctx, &pb.OpenSessionRequest{ProfileId: "a", Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	first = <-adapter.opened
	if _, err = b.Extensions().SetEnabled("subscription-rotation", false); err != nil {
		t.Fatal(err)
	}
	limit(first)
	e, _ = b.Get(r.Session.Id)
	until(t, "the limit stops it", func() bool { return e.Engine.Snapshot().Fault == "exhausted" })
	if len(adapter.opened) != 0 {
		t.Fatal("an extension turned off still switched")
	}
}

// Moving switching out of the core tells the people it affects, once, and
// turns nothing back on for them.
func TestAccountsMigrationNoticesOnce(t *testing.T) {
	state := t.TempDir()
	root := filepath.Join(state, "accounts")
	for _, p := range []accounts.Profile{
		{ID: "work", Provider: "codex", Isolation: "environment", Home: filepath.Join(root, "work", "codex")},
		{ID: "claude-work", Provider: "claude", Isolation: "environment", Home: filepath.Join(root, "claude-work", "claude"), NativeLogin: true},
	} {
		if err := accounts.StoreProfile(state, p); err != nil {
			t.Fatal(err)
		}
	}
	open := func(state string) *Service {
		t.Helper()
		b, err := runner.New(runner.Config{State: state, OutputFallbackRoot: t.TempDir(), WorktreeRoot: t.TempDir(), ItemPoll: -1})
		if err != nil {
			t.Fatal(err)
		}
		return &Service{Bench: b}
	}
	ctx := context.Background()
	service := open(state)
	settings, err := service.GetRunnerSettings(ctx, &pb.InfoRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(settings.Notices, []string{runner.NoticeSwitchingMoved, runner.NoticeClaudeSignInGated}) || settings.ClaudeSubscriptionSignIn || len(settings.AutomaticSwitchingProviders) != 0 {
		t.Fatalf("after the migration: notices %v, sign-in %v, switching %v", settings.Notices, settings.ClaudeSubscriptionSignIn, settings.AutomaticSwitchingProviders)
	}
	// A save never adds a notice; leaving one out dismisses it.
	settings.Notices = []string{runner.NoticeClaudeSignInGated, "made-up"}
	if settings, err = service.SaveRunnerSettings(ctx, settings); err != nil || !slices.Equal(settings.Notices, []string{runner.NoticeClaudeSignInGated}) {
		t.Fatalf("dismissed: %v %v", settings.Notices, err)
	}
	settings.Notices = nil
	if _, err = service.SaveRunnerSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	if err = service.Bench.Close(); err != nil {
		t.Fatal(err)
	}
	service = open(state)
	defer service.Bench.Close()
	if settings, _ = service.GetRunnerSettings(ctx, &pb.InfoRequest{}); len(settings.Notices) != 0 {
		t.Fatalf("the migration ran twice: %v", settings.Notices)
	}
	// A fresh Runner had nothing to move: no notice.
	fresh := open(t.TempDir())
	defer fresh.Bench.Close()
	if settings, _ = fresh.GetRunnerSettings(ctx, &pb.InfoRequest{}); len(settings.Notices) != 0 {
		t.Fatalf("notices on a fresh Runner: %v", settings.Notices)
	}
}
