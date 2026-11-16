package runner

import (
	"context"
	"encoding/json"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/browser"
)

// The agent browser (BROWSER.md). The Runner gives each coding conversation a
// browser it drives through its browser_* tools; the browser package owns the
// policy and the service, and this file connects it to executions and
// workspaces: who calls, which conversation that is, and which of the
// workspace's previews its browser may reach.

// openBrowser creates the browser manager. The service itself starts with the
// first browser an agent opens.
func (b *Bench) openBrowser() error {
	blocked := []string{}
	if u, err := url.Parse(b.Config.Address); err == nil && u.Host != "" {
		blocked = append(blocked, u.Host)
	} else if _, _, err := net.SplitHostPort(b.Config.Address); err == nil {
		blocked = append(blocked, b.Config.Address)
	}
	m, err := browser.New(browser.Config{Node: b.Config.Node, Script: b.Config.BrowserWorker, Root: filepath.Join(b.Config.State, "browser"), BlockedHosts: blocked, LoopbackPorts: b.previewPorts})
	if err != nil {
		return err
	}
	b.Browser = m
	return nil
}

// previewPorts are the ports a workspace's running actions serve on: the only
// addresses on this computer its agent browser may reach.
func (b *Bench) previewPorts(ctx context.Context, workspace string) []int {
	if workspace == "" || b.runtime == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	view, err := b.WorkspaceRuntime(ctx, workspace)
	if err != nil {
		return nil
	}
	ports := []int{}
	for _, a := range view.Actions {
		if a.Port > 0 {
			ports = append(ports, a.Port)
		}
	}
	return ports
}

// browserOffered: the execution's agent gets the browser tools.
func (b *Bench) browserOffered(e *Execution) bool {
	return b.Browser != nil && !agent.IsAssistant(e.Purpose) && b.Browser.Enabled()
}

// BrowserCaller is the execution as the browser knows it: its conversation,
// workspace, permission and agent.
func (b *Bench) BrowserCaller(e *Execution) browser.Caller {
	name := e.Profile.Provider
	if name != "" {
		name = strings.ToUpper(name[:1]) + name[1:]
	}
	return browser.Caller{Session: e.ID, Conversation: conversationOf(e), Workspace: e.CollectionID, Permission: e.Options.Permission, Agent: name}
}

// browserTool runs one browser tool for e, on e's own conversation's browser.
func (b *Bench) browserTool(ctx context.Context, e *Execution, name string, args json.RawMessage) (string, error) {
	if b.Browser == nil || agent.IsAssistant(e.Purpose) {
		return "", agent.ErrUnsupported
	}
	caller := b.BrowserCaller(e)
	if e.Options.Workflow == "plan" {
		caller.Permission = "read-only"
	}
	return b.Browser.Tool(ctx, caller, name, args)
}
