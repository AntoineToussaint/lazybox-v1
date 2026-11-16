package transport

import (
	"slices"
	"strings"

	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// HookCredentials verifies the credential a running hook holds when the
// user's actions file grants it one (POWER.md). runner.Bench implements it;
// a verifier without it admits no hook.
type HookCredentials interface {
	// HookScope returns the run and grants of a live hook credential, or an
	// error for a forged one or one whose run has ended.
	HookScope(token string) (run string, grants []string, err error)
}

// hookTokenPrefix marks a hook credential (runner.hookTokenPrefix).
const hookTokenPrefix = "lbx-hook."

func authenticateHook(agents AgentCredentials, token string) (principal, bool) {
	verifier, ok := agents.(HookCredentials)
	if !ok || !strings.HasPrefix(token, hookTokenPrefix) {
		return principal{}, false
	}
	run, grants, err := verifier.HookScope(token)
	if err != nil || run == "" {
		return principal{}, false
	}
	return principal{hook: run, grants: grants}, true
}

// hookExcluded are device RPCs a hook does not get: Info carries account and
// sign-in details a phone receives only redacted.
var hookExcluded = map[string]bool{pb.RunnerService_Info_FullMethodName: true}

// authorizeHook admits a hook credential to exactly what a paired phone with
// the same grants may call (deviceRPCs, deviceStreams), less Info. Nothing
// else — settings, commands, files, terminals, processes, devices, the
// actions file and the window requests — and no RPC added later.
func authorizeHook(who principal, method string, req any) (principal, error) {
	denied := status.Error(codes.PermissionDenied, "this hook's credential does not allow that; grant it in the actions file (read, respond, start)")
	if hookExcluded[method] {
		return principal{}, denied
	}
	if req == nil {
		if grant, ok := deviceStreams[method]; ok && slices.Contains(who.grants, grant) {
			return who, nil
		}
		return principal{}, denied
	}
	rule, ok := deviceRPCs[method]
	if !ok || !slices.Contains(who.grants, rule.grant) || (rule.allow != nil && !rule.allow(req)) {
		return principal{}, denied
	}
	return who, nil
}
