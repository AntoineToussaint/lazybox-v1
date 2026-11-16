package codex

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
)

// AlwaysChoice is one "always allow" answer a native approval offers, in
// the provider-neutral shape clients render (`always` in the request data).
// ID is what the client sends back as the approval's Always.
type AlwaysChoice struct {
	ID string `json:"id"`
	// Scope is how far it reaches: "conversation", "prefix" (Codex saves an
	// exec-policy rule, which outlives this conversation) or "host".
	Scope string `json:"scope"`
	// Label says what stops being asked, e.g. "commands starting with `git status`".
	Label string `json:"label"`
	// Detail says where the provider keeps it.
	Detail string `json:"detail,omitempty"`
}

type approvalParams struct {
	Command                         json.RawMessage   `json:"command"`
	ProposedExecpolicyAmendment     []string          `json:"proposedExecpolicyAmendment"`
	ProposedNetworkPolicyAmendments []json.RawMessage `json:"proposedNetworkPolicyAmendments"`
	GrantRoot                       string            `json:"grantRoot"`
}

// alwaysChoices are the "always allow" answers Codex accepts for a request:
// acceptForSession, an exec-policy amendment it proposed, and a network
// rule per proposed host. Permission requests and Lazybox tools have none.
func alwaysChoices(method string, params json.RawMessage) []AlwaysChoice {
	var p approvalParams
	if json.Unmarshal(params, &p) != nil {
		return nil
	}
	switch method {
	case "item/commandExecution/requestApproval":
		var out []AlwaysChoice
		if prefix := strings.TrimSpace(strings.Join(p.ProposedExecpolicyAmendment, " ")); prefix != "" {
			out = append(out, AlwaysChoice{ID: "prefix", Scope: "prefix", Label: "commands starting with `" + prefix + "`", Detail: "Codex saves this rule to its exec policy, so later conversations follow it too."})
		}
		for i, raw := range p.ProposedNetworkPolicyAmendments {
			var rule struct{ Host, Action string }
			if json.Unmarshal(raw, &rule) == nil && rule.Host != "" && rule.Action == "allow" {
				out = append(out, AlwaysChoice{ID: "network:" + strconv.Itoa(i), Scope: "host", Label: "network access to " + rule.Host, Detail: "Codex saves this host to its network policy."})
			}
		}
		if !networkOnly(p) {
			out = append(out, AlwaysChoice{ID: "session", Scope: "conversation", Label: "this command", Detail: "Codex stops asking for this exact command until the conversation ends."})
		}
		return out
	case "item/fileChange/requestApproval":
		label := "changes to these files"
		if p.GrantRoot != "" {
			label = "changes under " + p.GrantRoot
		}
		return []AlwaysChoice{{ID: "session", Scope: "conversation", Label: label, Detail: "Codex stops asking for these files until the conversation ends."}}
	}
	return nil
}

// networkOnly: a request that is only about network access, with no
// command to remember for the session.
func networkOnly(p approvalParams) bool {
	return len(p.ProposedNetworkPolicyAmendments) > 0 && (len(p.Command) == 0 || string(p.Command) == "null")
}

// withAlways adds the request's choices to its data, as `always`.
func withAlways(method string, params json.RawMessage) json.RawMessage {
	choices := alwaysChoices(method, params)
	if len(choices) == 0 {
		return params
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(params, &data) != nil || data == nil {
		return params
	}
	data["always"], _ = json.Marshal(choices)
	out, err := json.Marshal(data)
	if err != nil {
		return params
	}
	return out
}

// approvalDecision is the native decision for an approval reply, including
// the native form of an "always allow" choice the request offered.
func approvalDecision(method string, params json.RawMessage, op agent.Operation) (any, error) {
	if op.Always == "" || op.Decision != "accept" {
		return op.Decision, nil
	}
	offered := false
	for _, choice := range alwaysChoices(method, params) {
		offered = offered || choice.ID == op.Always
	}
	if !offered {
		return nil, fmt.Errorf("%w: this request does not offer %q", agent.ErrUnsupported, op.Always)
	}
	var p approvalParams
	_ = json.Unmarshal(params, &p)
	switch {
	case op.Always == "session":
		return "acceptForSession", nil
	case op.Always == "prefix":
		return map[string]any{"acceptWithExecpolicyAmendment": map[string]any{"execpolicy_amendment": p.ProposedExecpolicyAmendment}}, nil
	case strings.HasPrefix(op.Always, "network:"):
		i, err := strconv.Atoi(strings.TrimPrefix(op.Always, "network:"))
		if err != nil || i < 0 || i >= len(p.ProposedNetworkPolicyAmendments) {
			return nil, fmt.Errorf("%w: unknown network rule", agent.ErrUnsupported)
		}
		return map[string]any{"applyNetworkPolicyAmendment": map[string]any{"network_policy_amendment": p.ProposedNetworkPolicyAmendments[i]}}, nil
	}
	return nil, fmt.Errorf("%w: unsupported always choice %q", agent.ErrUnsupported, op.Always)
}

// declineNote is what the agent is told when the user declined with a reason.
// The app-server's decline carries no text, so it goes to the turn as a steer.
func declineNote(method string, params json.RawMessage, reason string) string {
	what := "that request"
	var p struct {
		Command string `json:"command"`
	}
	_ = json.Unmarshal(params, &p)
	switch {
	case method == "item/commandExecution/requestApproval" && p.Command != "":
		what = "running `" + p.Command + "`"
	case method == "item/fileChange/requestApproval":
		what = "those file changes"
	}
	return "I declined " + what + ". " + strings.TrimSpace(reason)
}
