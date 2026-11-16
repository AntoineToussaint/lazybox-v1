package transport

import (
	"context"
	"crypto/subtle"
	"strings"

	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// AgentCredentials verifies the scoped credentials the Runner hands out
// (runner.Bench implements it): one per execution, given to its agent, and one
// per workspace terminal, given to the person's shell. Neither is the owner's
// bearer, so nothing an agent runs, and nothing started in a terminal, can
// approve a request, answer a question, send a message or change a setting.
type AgentCredentials interface {
	// AgentSession returns the execution a scoped credential was issued to,
	// or an error for a forged or revoked one.
	AgentSession(ctx context.Context, token string) (string, error)
	// CommandSession returns the execution that owns a command or pipe.
	CommandSession(commandID string) (string, error)
	// TerminalScope returns the terminal a terminal credential was issued to
	// and its workspace, or an error for a forged or revoked one.
	TerminalScope(token string) (terminal, workspace string, err error)
	// CommandTerminal returns the terminal that registered a workspace run.
	CommandTerminal(commandID string) (string, error)
	// SessionWorkspace returns the workspace an execution works in, or "".
	SessionWorkspace(session string) (string, error)
	// RepositoryRequestSession returns the execution that asked for a repository.
	RepositoryRequestSession(request string) (string, error)
}

// agentRPCs is everything an agent credential may call: what `lazybox run`
// and `lazybox log` need to publish one console, only for its own execution;
// what `lazybox artifact` needs to list, read and publish the artifacts of
// its own execution's workspace; what `lazybox workspace` needs to list
// that workspace's repositories and ask the person to add one (never to add
// it); and what `lazybox review` needs for a reviewer to file and list its
// own review's findings (the Runner derives the review, its workspace and the
// author from the execution, and refuses one that reviews nothing). Every
// other RPC, including any added later, is the owner's.
var agentRPCs = map[string]func(agents AgentCredentials, who principal, req any) bool{
	pb.RunnerService_RegisterPipe_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.RegisterPipeRequest)
		return ok && r.SessionId == who.session && r.CollectionId == "" && r.ShareWith == ""
	},
	pb.RunnerService_Publish_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.PublishRequest)
		return ok && ownsCommand(agents, who.session, r.CommandId)
	},
	pb.RunnerService_FinishPipe_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.FinishPipeRequest)
		return ok && ownsCommand(agents, who.session, r.CommandId)
	},
	// A `lazybox run` follows its own pipe (stop, background); `lazybox ls`
	// and `lazybox stop` see and stop the execution's own commands only.
	pb.RunnerService_FollowPipe_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.FollowPipeRequest)
		return ok && ownsCommand(agents, who.session, r.CommandId)
	},
	pb.RunnerService_CancelCommand_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.CommandRequest)
		return ok && ownsCommand(agents, who.session, r.CommandId)
	},
	pb.RunnerService_ListCommands_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.ListCommandsRequest)
		return ok && r.SessionId != "" && r.SessionId == who.session
	},
	pb.RunnerService_ListArtifacts_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.ListArtifactsRequest)
		return ok && inOwnWorkspace(agents, who.session, r.CollectionId)
	},
	pb.RunnerService_GetArtifact_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.GetArtifactRequest)
		return ok && inOwnWorkspace(agents, who.session, r.CollectionId)
	},
	pb.RunnerService_PutArtifact_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.PutArtifactRequest)
		return ok && inOwnWorkspace(agents, who.session, r.CollectionId)
	},
	pb.RunnerService_ListWorkspaceRepositories_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.ListWorkspaceRepositoriesRequest)
		return ok && inOwnWorkspace(agents, who.session, r.CollectionId)
	},
	// The request is recorded on the asking execution's own conversation and
	// workspace, which the Runner derives from the execution, never the request.
	pb.RunnerService_RequestRepository_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.RequestRepositoryRequest)
		return ok && r.SessionId != "" && r.SessionId == who.session
	},
	pb.RunnerService_AddReviewFinding_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.AddReviewFindingRequest)
		return ok && r.SessionId != "" && r.SessionId == who.session
	},
	pb.RunnerService_ListReviewFindings_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.ListReviewFindingsRequest)
		return ok && r.SessionId != "" && r.SessionId == who.session
	},
	pb.RunnerService_WaitRepositoryRequest_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.WaitRepositoryRequestRequest)
		if !ok || r.RequestId == "" {
			return false
		}
		asker, err := agents.RepositoryRequestSession(r.RequestId)
		return err == nil && asker == who.session
	},
}

// inOwnWorkspace admits a workspace only when it is the one the execution
// works in; an execution outside any workspace has no artifacts.
func inOwnWorkspace(agents AgentCredentials, session, workspace string) bool {
	if workspace == "" {
		return false
	}
	own, err := agents.SessionWorkspace(session)
	return err == nil && own == workspace
}

// terminalRPCs is everything a terminal credential may call: open a run in
// the terminal's own workspace (optionally shared with one of its
// conversations, which the person still has to send), and publish to and
// finish the runs that terminal opened. Nothing else, including any RPC added
// later.
var terminalRPCs = map[string]func(agents AgentCredentials, who principal, req any) bool{
	pb.RunnerService_RegisterPipe_FullMethodName: func(_ AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.RegisterPipeRequest)
		return ok && r.SessionId == "" && r.CollectionId == who.workspace
	},
	pb.RunnerService_Publish_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.PublishRequest)
		return ok && openedBy(agents, who.terminal, r.CommandId)
	},
	pb.RunnerService_FinishPipe_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.FinishPipeRequest)
		return ok && openedBy(agents, who.terminal, r.CommandId)
	},
	pb.RunnerService_FollowPipe_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.FollowPipeRequest)
		return ok && openedBy(agents, who.terminal, r.CommandId)
	},
	pb.RunnerService_CancelCommand_FullMethodName: func(agents AgentCredentials, who principal, req any) bool {
		r, ok := req.(*pb.CommandRequest)
		return ok && openedBy(agents, who.terminal, r.CommandId)
	},
}

func ownsCommand(agents AgentCredentials, session, command string) bool {
	owner, err := agents.CommandSession(command)
	return err == nil && owner == session
}

func openedBy(agents AgentCredentials, terminal, command string) bool {
	opener, err := agents.CommandTerminal(command)
	return err == nil && terminal != "" && opener == terminal
}

// principal is who a bearer belongs to: the owner, one execution's agent, or
// one workspace terminal.
type principal struct {
	owner               bool
	session             string
	terminal, workspace string
	// hook is a running hook's run id, and grants what its file granted it
	// (hook_auth.go).
	hook   string
	grants []string
}

type principalKey struct{}

// callerTerminal is the terminal whose credential made this call, or "".
func callerTerminal(ctx context.Context) string {
	who, _ := ctx.Value(principalKey{}).(principal)
	return who.terminal
}

// authenticate resolves the bearer to the owner, one execution or one
// terminal. Neither the token nor anything derived from it is ever put in an
// error.
func authenticate(ctx context.Context, owner string, agents AgentCredentials) (principal, error) {
	unauthenticated := status.Error(codes.Unauthenticated, "local test bench bearer required")
	md, _ := metadata.FromIncomingContext(ctx)
	values := md.Get("authorization")
	if len(values) != 1 {
		return principal{}, unauthenticated
	}
	if owner != "" && subtle.ConstantTimeCompare([]byte(values[0]), []byte("Bearer "+owner)) == 1 {
		return principal{owner: true}, nil
	}
	token, ok := strings.CutPrefix(values[0], "Bearer ")
	if !ok || agents == nil {
		return principal{}, unauthenticated
	}
	if terminal, workspace, err := agents.TerminalScope(token); err == nil && terminal != "" && workspace != "" {
		return principal{terminal: terminal, workspace: workspace}, nil
	}
	if who, ok := authenticateHook(agents, token); ok {
		return who, nil
	}
	session, err := agents.AgentSession(ctx, token)
	if err != nil || session == "" {
		return principal{}, unauthenticated
	}
	return principal{session: session}, nil
}

// authorize admits the owner to everything, an execution's credential only to
// agentRPCs for that execution, and a terminal's credential only to
// terminalRPCs for its workspace. req is nil for a streaming RPC, which
// neither may call.
func authorize(ctx context.Context, owner string, agents AgentCredentials, method string, req any) (principal, error) {
	if strings.HasPrefix(method, "/grpc.health.v1.Health/") {
		return principal{}, nil
	}
	who, err := authenticate(ctx, owner, agents)
	if err != nil {
		return principal{}, err
	}
	if who.owner {
		return who, nil
	}
	if who.hook != "" {
		return authorizeHook(who, method, req)
	}
	if who.terminal != "" {
		if allowed := terminalRPCs[method]; req != nil && allowed != nil && allowed(agents, who, req) {
			return who, nil
		}
		return principal{}, status.Error(codes.PermissionDenied, "a terminal credential may only publish command output to its own workspace and stop the runs it started")
	}
	if allowed := agentRPCs[method]; req != nil && allowed != nil && allowed(agents, who, req) {
		return who, nil
	}
	return principal{}, status.Error(codes.PermissionDenied, "an agent credential may only publish and follow its own session's console output, list and stop its own commands, use its own workspace's artifacts, ask the person to add a repository to its own workspace, and file findings of a review it is the reviewer of")
}

// LocalAuthority protects the experimental Runner's execution authority on
// every protocol. Codefly's Connect listener invokes these same interceptors.
// owner is the bearer in the owner's endpoint file; agents verifies scoped
// execution and terminal credentials, and nil accepts the owner alone.
func LocalAuthority(owner string, agents AgentCredentials) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			who, err := authorize(ctx, owner, agents, info.FullMethod, req)
			if err != nil {
				return nil, err
			}
			return handler(context.WithValue(ctx, principalKey{}, who), req)
		}),
		grpc.ChainStreamInterceptor(func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			if _, err := authorize(stream.Context(), owner, agents, info.FullMethod, nil); err != nil {
				return err
			}
			return handler(srv, stream)
		}),
	}
}
