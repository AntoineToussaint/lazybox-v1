package runner

import (
	"errors"
	"os"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
)

// How Claude agents authenticate (CLAUDE_COMPLIANCE.md). Anthropic asks
// products built on the Agent SDK to use an API key or a cloud provider, and
// not to offer claude.ai login. So:
//
//   - an Anthropic API key saved in Settings is what the claude-default
//     account's agents run on (ANTHROPIC_API_KEY, every other credential
//     removed);
//   - Bedrock, Vertex, Foundry or Claude Platform on AWS come from the
//     Runner's own environment, untouched;
//   - without either, claude-default runs on the person's own Claude Code
//     sign-in, which they made themselves outside Lazybox;
//   - a Claude subscription saved in Lazybox (a sign-in Lazybox offered)
//     starts only with Claude sign-in in Lazybox turned on.

// ErrClaudeSignInOff refuses a Claude subscription Lazybox signed in.
var ErrClaudeSignInOff = errors.New("Claude sign-in in Lazybox is off, so Claude subscriptions saved in Lazybox do not start (CLAUDE_COMPLIANCE.md). Use an Anthropic API key in Settings → Agents & workspaces → Claude, or turn Claude sign-in in Lazybox on there")

// ClaudeAuth is what Settings → Agents & workspaces → Claude shows.
type ClaudeAuth struct {
	APIKeySet     bool
	APIKeyHint    string
	CloudProvider string
}

// profileEnv is the environment an agent on p starts with: the account's own
// credentials (accounts.Resolve), and for the claude-default account (any
// Claude account that is not a saved, isolated one) the saved API key instead
// of whatever the Runner inherited.
func (b *Bench) profileEnv(p accounts.Profile) ([]string, error) {
	env, err := accounts.Resolve(p, os.Environ())
	if err != nil || p.Provider != "claude" || p.Isolation == "environment" {
		return env, err
	}
	key, err := accounts.LoadAPIKey(b.Config.State)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return env, nil
	}
	return accounts.WithAPIKey(env, key), nil
}

// claudeSignInAllowed refuses a Claude subscription saved through a sign-in
// Lazybox offered while Claude sign-in in Lazybox is off. Other accounts,
// and every Codex account, are not affected.
func (b *Bench) claudeSignInAllowed(p accounts.Profile) error {
	if p.Provider != "claude" || !p.Managed || !(p.NativeLogin || p.TokenFile != "") {
		return nil
	}
	if p.TokenFile != "" {
		return accounts.ErrImportedToken
	}
	if !b.Preferences.Snapshot().ClaudeSubscriptionSignIn {
		return ErrClaudeSignInOff
	}
	return nil
}

// ClaudeAuth reports how Claude agents authenticate, without the key.
func (b *Bench) ClaudeAuth() (ClaudeAuth, error) {
	key, err := accounts.LoadAPIKey(b.Config.State)
	if err != nil {
		return ClaudeAuth{}, err
	}
	return ClaudeAuth{APIKeySet: key != "", APIKeyHint: accounts.APIKeyHint(key), CloudProvider: accounts.CloudProvider(os.Environ())}, nil
}

// SetClaudeAPIKey saves the key the claude-default account's agents run with,
// or forgets it. Conversations already running keep the credential they
// started with; the next one started uses this.
func (b *Bench) SetClaudeAPIKey(key string, clear bool) (ClaudeAuth, error) {
	if clear {
		if key != "" {
			return ClaudeAuth{}, errors.New("forget the key, or save one, not both")
		}
		if err := accounts.ForgetAPIKey(b.Config.State); err != nil {
			return ClaudeAuth{}, err
		}
	} else if err := accounts.SaveAPIKey(b.Config.State, key); err != nil {
		return ClaudeAuth{}, err
	}
	return b.ClaudeAuth()
}
