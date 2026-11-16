package runner

import (
	"context"
	"os"
	"os/exec"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/runner/availability"
)

// claudeProgram is the Claude Code this Runner runs: the configured one, else
// the SDK's bundled build (named "" so the SDK resolves it itself), else one
// on the Runner's PATH, so a Claude Code installed by hand is used when the
// bundled build is missing.
func claudeProgram(cfg Config) string {
	if cfg.ClaudeBinary != "" || availability.BundledClaude(cfg.Worker) != "" {
		return cfg.ClaudeBinary
	}
	if found, err := exec.LookPath("claude"); err == nil {
		return found
	}
	return ""
}

// ProviderAvailability reports every provider's program (probed once, and
// again when refresh asks) and each saved subscription's state now: what
// Ask Lazybox picks its agent from and the welcome shows.
func (b *Bench) ProviderAvailability(ctx context.Context, refresh bool) (availability.Report, error) {
	if err := b.ReloadProfiles(); err != nil {
		return availability.Report{}, err
	}
	programs, checked := b.Availability.Programs(ctx, refresh)
	subscriptions := availability.Subscriptions(b.Profiles(), b.Accounts.Observation, os.Environ(), time.Now())
	return availability.Build(programs, subscriptions, checked, b.ACPAgents()...), nil
}
