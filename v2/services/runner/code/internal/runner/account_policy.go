package runner

import (
	"errors"
	"slices"

	"github.com/AntoineToussaint/lazybox/v2/internal/accounts"
)

// Account policies (EXTENSIONS.md, "Account policy"). The core keeps several
// signed-in accounts per provider, chosen explicitly per conversation; it
// never moves a conversation to another account by itself. An enabled
// extension whose approved grants include switch:<provider> and whose
// manifest says switchOnLimit is what turns automatic switching on, and
// turning it off stops it at the next limit, running conversations included.

// ErrNoAccountPolicy refuses automatic switching nothing turned on.
var ErrNoAccountPolicy = errors.New("automatic switching is an extension: turn on Subscription rotation in Settings → Extensions")

// AccountPolicy is the account policy that switches conversations of
// provider at a limit, if an enabled extension has one. The first such
// extension, by id, wins.
func (b *Bench) AccountPolicy(provider string) (accounts.Policy, bool) {
	if b.power.Extensions == nil {
		return accounts.Policy{}, false
	}
	for _, e := range b.power.Extensions.Snapshot().Extensions {
		if e.SwitchesFor(provider) {
			return accounts.Policy{Extension: e.ID, Accounts: slices.Clone(e.Manifest.AccountPolicy.Accounts)}, true
		}
	}
	return accounts.Policy{}, false
}

// AutomaticSwitchingProviders are the providers an account policy switches.
func (b *Bench) AutomaticSwitchingProviders() []string {
	out := []string{}
	for _, provider := range []string{"claude", "codex"} {
		if _, ok := b.AccountPolicy(provider); ok {
			out = append(out, provider)
		}
	}
	return out
}

// rotationPool resolves which subscriptions a new conversation may switch to
// by itself: none without an account policy for its provider. With one, an
// explicit opt-out wins, then an explicit pool, then the configured default
// (an explicit empty list there disables it), then the policy's own accounts.
func rotationPool(options accounts.Options, configured []string, profiles []accounts.Profile, selected accounts.Profile, excluded []string, policy accounts.Policy, switching bool) []string {
	switch {
	case !switching, options.NoRotation:
		return nil
	case options.RotationProfiles != nil:
		return options.RotationProfiles
	case configured != nil:
		return configured
	}
	return policy.Pool(profiles, selected, excluded)
}

// One-time notices (RunnerSettings.notices).
const (
	// NoticeSwitchingMoved: automatic switching was on by default and is now
	// an extension, off until the person turns it on.
	NoticeSwitchingMoved = "automatic-switching-moved"
	// NoticeClaudeSignInGated: Claude subscriptions saved in Lazybox no longer
	// start until the person turns Claude sign-in in Lazybox on.
	NoticeClaudeSignInGated = "claude-sign-in-gated"
)

// accountsMigration is the preferences migration that moved automatic
// switching out of the core and gated Claude sign-in (CLAUDE_COMPLIANCE.md).
const accountsMigration = 1

// migrateAccounts runs once per Runner state: a person for whom automatic
// switching was in effect (a signed-in subscription that was not excluded, or
// a configured pool) and a person with Claude subscriptions saved in Lazybox
// are told what changed, once. Nothing is turned back on for them.
func (b *Bench) migrateAccounts() error {
	data := b.Preferences.Snapshot()
	if data.Migration >= accountsMigration {
		return nil
	}
	var notices []string
	add := func(id string) {
		if !slices.Contains(notices, id) {
			notices = append(notices, id)
		}
	}
	if len(b.Config.Defaults.RotationProfiles) > 0 {
		add(NoticeSwitchingMoved)
	}
	profiles := b.Profiles()
	for _, p := range profiles {
		// It was in some conversation's default pool: a signed-in account
		// not excluded, beside another account of its provider.
		another := slices.ContainsFunc(profiles, func(q accounts.Profile) bool { return q.ID != p.ID && q.Provider == p.Provider })
		if p.Isolation == "environment" && another && !slices.Contains(data.RotationExcluded, p.ID) {
			add(NoticeSwitchingMoved)
		}
		if p.Provider == "claude" && p.Managed && (p.NativeLogin || p.TokenFile != "") {
			add(NoticeClaudeSignInGated)
		}
	}
	return b.Preferences.Migrate(accountsMigration, notices)
}
