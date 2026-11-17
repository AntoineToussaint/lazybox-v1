package accounts

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Lazybox does not store a Claude.ai credential (CLAUDE_COMPLIANCE.md): a
// subscription token is refused before anything is written, and an account
// an earlier Lazybox imported from one no longer starts.
func TestClaudeSubscriptionTokenIsNeverStored(t *testing.T) {
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "current-login")
	root := t.TempDir()
	if _, err := Enroll(context.Background(), root, "claude-work", "claude", "", strings.NewReader("fixture-subscription-token\n"), nil, io.Discard, io.Discard); !errors.Is(err, ErrClaudeTokenImport) {
		t.Fatalf("token import not refused: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "accounts", "claude-work")); !os.IsNotExist(err) {
		t.Fatal("a refused import left an account folder")
	}
	if profiles, err := LoadProfiles(root); err != nil || len(profiles) != 0 {
		t.Fatal(profiles, err)
	}
	token := filepath.Join(root, "oauth-token")
	if err := os.WriteFile(token, []byte("fixture-subscription-token"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(Profile{ID: "imported", Provider: "claude", Isolation: "environment", Home: t.TempDir(), TokenFile: token}, nil); !errors.Is(err, ErrImportedToken) {
		t.Fatalf("an imported token still resolves: %v", err)
	}
	if os.Getenv("CLAUDE_CODE_OAUTH_TOKEN") != "current-login" {
		t.Fatal("global login changed")
	}
}
func TestEnrollmentAndResolutionRejectUnsafeProfiles(t *testing.T) {
	root := t.TempDir()
	for _, id := range []string{"../global", "", "a/b"} {
		if _, err := Enroll(context.Background(), root, id, "claude", "", strings.NewReader("token"), nil, io.Discard, io.Discard); err == nil {
			t.Fatal(id)
		}
	}
	if _, err := Enroll(context.Background(), root, "too-big", "claude", "", strings.NewReader(strings.Repeat("x", 16385)), nil, io.Discard, io.Discard); err == nil {
		t.Fatal("oversized secret")
	}
	if _, err := os.Stat(filepath.Join(root, "accounts", "too-big")); !os.IsNotExist(err) {
		t.Fatal("failed enrollment retained account")
	}
	path := filepath.Join(root, "public-token")
	if err := os.WriteFile(path, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(Profile{ID: "unsafe", Provider: "claude", Isolation: "environment", TokenFile: path}, nil); err == nil {
		t.Fatal("public credential file accepted")
	}
}
func TestCodexEnrollmentPinsNativeLoginToItsOwnHome(t *testing.T) {
	if os.PathSeparator != '/' {
		t.Skip("shell fixture")
	}
	root := t.TempDir()
	binary := filepath.Join(t.TempDir(), "codex-fixture")
	// Synthetic CLI checks argv and CODEX_HOME. No browser or provider is contacted.
	script := `#!/bin/sh
[ "$1" = '-c' ] && [ "$2" = 'cli_auth_credentials_store="file"' ] && [ "$3" = 'login' ] || exit 11
[ -n "$CODEX_HOME" ] && [ -z "$OPENAI_API_KEY" ] || exit 12
printf '%s' 'fixture-refreshable-auth' > "$CODEX_HOME/auth.json"
`
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENAI_API_KEY", "global-key")
	t.Setenv("CODEX_HOME", "/global/profile")
	p, err := Enroll(context.Background(), root, "codex-work", "codex", binary, nil, nil, io.Discard, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if p.Home == "/global/profile" || os.Getenv("CODEX_HOME") != "/global/profile" {
		t.Fatal("global home changed")
	}
	if _, err = os.Stat(filepath.Join(p.Home, "auth.json")); err != nil {
		t.Fatal(err)
	}
}
