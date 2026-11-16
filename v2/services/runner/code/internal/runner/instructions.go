package runner

import (
	"context"
	"errors"
	"strings"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/sessionstore"
)

// sharedInstructions are the Runner-wide sections every new coding session
// starts with: the editable Settings → Agents text, its provider-specific
// part, and the built-in command briefing.
type sharedInstructions struct{ settings, provider, briefing string }

func (b *Bench) sharedInstructions(provider, purpose string) sharedInstructions {
	prefs := b.Preferences.Snapshot()
	s := sharedInstructions{settings: prefs.Context, provider: prefs.ClaudeContext}
	if provider == "codex" {
		s.provider = prefs.CodexContext
	}
	if b.Config.CLIDir != "" && !agent.IsAssistant(purpose) {
		s.briefing = commandBriefing
	}
	return s
}

func (s sharedInstructions) text() string {
	parts := []string{}
	for _, part := range []string{s.settings, s.provider, s.briefing} {
		if part = strings.TrimSpace(part); part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, "\n\n")
}

// A running Claude session keeps the system prompt it started with, so new
// instructions must arrive in the conversation. The wording says they replace
// the old ones, the way Codex announces its own instruction changes.
const instructionsPreamble = "[Lazybox] The shared instructions for this conversation were updated. They replace the Lazybox instructions you were given when it started:\n\n"

// InstructionsUpdate returns what a running coding session should receive with
// its next message, or "" when it already has the current shared instructions.
// A session is current when every current section appears in what it started
// with, or when it already received exactly this update. This also covers
// sessions started before updates were tracked.
func (b *Bench) InstructionsUpdate(e *Execution) string {
	if agent.IsAssistant(e.Purpose) || e.Saved.ID == "" {
		return ""
	}
	shared := b.sharedInstructions(e.Profile.Provider, e.Purpose)
	update := instructionsPreamble + shared.text()
	if shared.text() == "" || e.Saved.Instructions == update {
		return ""
	}
	for _, part := range []string{shared.settings, shared.provider, shared.briefing} {
		if part = strings.TrimSpace(part); part != "" && !strings.Contains(e.Saved.Context, part) {
			return update
		}
	}
	return ""
}

// InstructionsDelivered records that a session received update, so it is
// neither sent again nor reported as pending.
func (b *Bench) InstructionsDelivered(ctx context.Context, e *Execution, update string) error {
	if err := b.History.Amend(ctx, e.ID, func(r *sessionstore.Record) { r.Instructions = update }); err != nil {
		return err
	}
	e.activity.Lock()
	e.Saved.Instructions = update
	e.activity.Unlock()
	return nil
}

// SetPermission changes a running session's permission mode and remembers it,
// so a resume or a subscription rotation keeps the new mode.
func (b *Bench) SetPermission(ctx context.Context, e *Execution, operationID, mode string) (agent.Receipt, error) {
	if !agent.PermissionModes[mode] {
		return agent.Receipt{}, errors.New("permission must be ask, read-only or yolo")
	}
	if agent.IsAssistant(e.Purpose) {
		return agent.Receipt{}, errors.New("assistant conversations are read-only")
	}
	if mode == "yolo" && e.Options.Workflow == "plan" {
		return agent.Receipt{}, errors.New("YOLO is incompatible with plan mode")
	}
	r, err := e.Engine.Apply(ctx, agent.Operation{ID: operationID, Kind: agent.Permission, Permission: mode})
	if err != nil || r.Delivery == "failed" {
		return r, err
	}
	if err = b.History.Amend(ctx, e.ID, func(r *sessionstore.Record) { r.Options.Permission = mode }); err != nil {
		return r, err
	}
	e.activity.Lock()
	e.Options.Permission = mode
	e.Saved.Options.Permission = mode
	e.activity.Unlock()
	return r, nil
}
