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

// AgentCredentials verifies the scoped credential the Runner gives each
// execution (runner.Bench implements it). An agent never holds the owner's
// bearer, so nothing an agent runs can approve its own requests, answer its
// own questions, or reach any other execution or Runner setting.
type AgentCredentials interface {
	// AgentSession returns the execution a scoped credential was issued to,
	// or an error for a forged or revoked one.
	AgentSession(ctx context.Context, token string) (string, error)
	// CommandSession returns the execution that owns a command or pipe.
	CommandSession(commandID string) (string, error)
}

// agentRPCs is everything an agent credential may call: what `lazybox run`
// and `lazybox log` need to publish one console, and only for its own
// execution. Every other RPC, including any added later, is the owner's.
var agentRPCs = map[string]func(agents AgentCredentials, session string, req any) bool{
	pb.RunnerService_RegisterPipe_FullMethodName: func(_ AgentCredentials, session string, req any) bool {
		r, ok := req.(*pb.RegisterPipeRequest)
		return ok && r.SessionId == session
	},
	pb.RunnerService_Publish_FullMethodName: func(agents AgentCredentials, session string, req any) bool {
		r, ok := req.(*pb.PublishRequest)
		return ok && ownsCommand(agents, session, r.CommandId)
	},
	pb.RunnerService_FinishPipe_FullMethodName: func(agents AgentCredentials, session string, req any) bool {
		r, ok := req.(*pb.FinishPipeRequest)
		return ok && ownsCommand(agents, session, r.CommandId)
	},
}

func ownsCommand(agents AgentCredentials, session, command string) bool {
	owner, err := agents.CommandSession(command)
	return err == nil && owner == session
}

type principal struct {
	owner   bool
	session string
}

// authenticate resolves the bearer to the owner or to one execution. Neither
// the token nor anything derived from it is ever put in an error.
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
	session, err := agents.AgentSession(ctx, token)
	if err != nil || session == "" {
		return principal{}, unauthenticated
	}
	return principal{session: session}, nil
}

// authorize admits the owner to everything and an execution's credential only
// to agentRPCs for that execution. req is nil for a streaming RPC, which no
// agent may call.
func authorize(ctx context.Context, owner string, agents AgentCredentials, method string, req any) error {
	if strings.HasPrefix(method, "/grpc.health.v1.Health/") {
		return nil
	}
	who, err := authenticate(ctx, owner, agents)
	if err != nil {
		return err
	}
	if who.owner {
		return nil
	}
	if allowed := agentRPCs[method]; req != nil && allowed != nil && allowed(agents, who.session, req) {
		return nil
	}
	return status.Error(codes.PermissionDenied, "an agent credential may only publish its own session's console output")
}

// LocalAuthority protects the experimental Runner's execution authority on
// every protocol. Codefly's Connect listener invokes these same interceptors.
// owner is the bearer in the owner's endpoint file; agents verifies scoped
// execution credentials, and nil accepts the owner alone.
func LocalAuthority(owner string, agents AgentCredentials) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			if err := authorize(ctx, owner, agents, info.FullMethod, req); err != nil {
				return nil, err
			}
			return handler(ctx, req)
		}),
		grpc.ChainStreamInterceptor(func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			if err := authorize(stream.Context(), owner, agents, info.FullMethod, nil); err != nil {
				return err
			}
			return handler(srv, stream)
		}),
	}
}
