package transport

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/runner"
	"github.com/AntoineToussaint/lazybox/v2/internal/work"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
)

// The Orchestrator verbs (`lazybox agents …`, runner/orchestrator.go). Each
// is on the agent allowlist for the caller's own execution only (auth.go);
// spawning also needs a grant in force, and every target must be in the
// caller's lineage. The Runner checks both again, and the mission log
// refuses what a grant does not allow.

// agentError says why an orchestration verb was refused, in words an agent acts on.
func agentError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, runner.ErrNoGrant), errors.Is(err, runner.ErrNoChild):
		return grpcError(codes.PermissionDenied, err)
	}
	return workError(err)
}

func (s *Service) SpawnAgent(ctx context.Context, r *pb.SpawnAgentRequest) (*pb.AgentLineage, error) {
	view, err := s.Bench.Spawn(ctx, runner.SpawnRequest{Session: r.SessionId, Operation: r.OperationId, Title: r.Title, Brief: r.Brief, Task: r.TaskId, Profile: r.ProfileId, Model: r.Model, Permission: r.Permission, Role: r.Role, Workspace: r.Workspace})
	if err != nil {
		return nil, agentError(err)
	}
	return wireLineage(view), nil
}

func (s *Service) ListAgentLineage(ctx context.Context, r *pb.AgentLineageRequest) (*pb.AgentLineage, error) {
	view, err := s.Bench.Lineage(ctx, r.SessionId)
	if err != nil {
		return nil, agentError(err)
	}
	return wireLineage(view), nil
}

func (s *Service) SendAgentMessage(ctx context.Context, r *pb.SendAgentMessageRequest) (*pb.AgentMessageReceipt, error) {
	if len(r.OperationId) > 128 {
		return nil, grpcError(codes.InvalidArgument, errors.New("operation id is longer than 128 bytes"))
	}
	receipt, err := s.Bench.SendAgentMessage(ctx, r.SessionId, r.To, r.Text, r.OperationId)
	if err != nil {
		return nil, agentError(err)
	}
	return &pb.AgentMessageReceipt{Id: receipt.ID, ToConversationId: receipt.To, ToLabel: receipt.ToLabel, Delivery: receipt.Delivery}, nil
}

func (s *Service) WaitAgents(ctx context.Context, r *pb.WaitAgentsRequest) (*pb.AgentLineage, error) {
	view, err := s.Bench.WaitAgents(ctx, runner.WaitRequest{Session: r.SessionId, Targets: r.Targets, Until: r.Until, Any: r.Any, Wait: time.Duration(r.TimeoutSeconds) * time.Second, After: r.AfterSeq})
	if err != nil && !errors.Is(err, context.Canceled) {
		return nil, agentError(err)
	}
	return wireLineage(view), nil
}

func (s *Service) StopChildAgent(ctx context.Context, r *pb.StopChildAgentRequest) (*pb.AgentLineage, error) {
	view, err := s.Bench.StopChild(ctx, r.SessionId, r.Target, r.End, r.Reason)
	if err != nil {
		return nil, agentError(err)
	}
	return wireLineage(view), nil
}

func (s *Service) ReportAgentTask(ctx context.Context, r *pb.ReportAgentTaskRequest) (*pb.AgentLineage, error) {
	view, err := s.Bench.ReportAgentTask(ctx, r.SessionId, r.Summary)
	if err != nil {
		return nil, agentError(err)
	}
	return wireLineage(view), nil
}

// grant and revoke are UpdateMission's grant changes: the person's alone.
func (s *Service) grant(ctx context.Context, mission, key string, g *pb.OrchestratorGrantChange) (*work.State, string, error) {
	if g == nil || g.SessionId == "" {
		return nil, "", errors.New("choose the conversation that orchestrates")
	}
	c := work.Ceiling{}
	if g.Ceiling != nil {
		c = work.Ceiling{Permission: g.Ceiling.Permission, Profiles: g.Ceiling.ProfileIds, MaxChildren: int(g.Ceiling.MaxChildren), Depth: int(g.Ceiling.Depth), BudgetUSD: g.Ceiling.BudgetUsd}
	}
	return s.Bench.Grant(ctx, runner.GrantRequest{Mission: mission, Session: g.SessionId, Operation: key, Ceiling: c})
}

func wireCeiling(c work.Ceiling) *pb.OrchestratorCeiling {
	return &pb.OrchestratorCeiling{Permission: c.Permission, ProfileIds: c.Profiles, MaxChildren: uint32(c.MaxChildren), Depth: uint32(c.Depth), BudgetUsd: c.BudgetUSD}
}

func wireGrant(state *work.State, g *work.Grant, session string) *pb.MissionGrant {
	if g == nil {
		return nil
	}
	children := 0
	for _, t := range state.Tasks {
		for _, a := range t.Attempts {
			if a.Grant == g.Grant {
				children++
			}
		}
	}
	return &pb.MissionGrant{Id: g.Grant, ConversationId: g.Holder, SessionId: firstNonEmpty(session, g.Session), Title: g.Title, ParentGrantId: g.Parent, Ceiling: wireCeiling(g.Ceiling), Scopes: g.Scopes,
		IssuedAtUnixMillis: millis(g.Issued), RevokedAtUnixMillis: millis(g.RevokedAt), RevokeReason: g.Reason, IssuedBy: g.IssuedBy.Kind, RevokedBy: g.RevokedBy.Kind,
		Live: state.Live(g), LiveChildren: uint32(state.LiveChildren(g.Grant)), Children: uint32(children)}
}

func wireChild(v runner.ChildView) *pb.AgentChild {
	return &pb.AgentChild{ConversationId: v.Conversation, SessionId: v.Session, Title: v.Title, TaskId: v.Task, TaskTitle: v.TaskTitle, TaskStatus: v.TaskStatus, CollectionId: v.Workspace, WorkspaceName: v.WorkspaceName,
		ProfileId: v.Profile, Model: v.Model, Permission: v.Permission, Role: v.Role, Live: v.Live, LiveDetail: v.LiveDetail, Reported: v.Reported, Report: v.Report, LastMessage: v.LastMessage,
		StartedAtUnixMillis: millis(v.Started), Ended: v.Ended, Outcome: v.Outcome, Relation: v.Relation}
}

func wireLineage(v runner.LineageView) *pb.AgentLineage {
	out := &pb.AgentLineage{Seq: v.Seq, Matched: v.Matched, Reason: v.Reason}
	if v.Mission != nil {
		out.MissionId, out.MissionTitle = v.Mission.ID, v.Mission.Title
		out.Grant = wireGrant(v.Mission, v.Grant, "")
	}
	if v.Parent != nil {
		out.Parent = wireChild(*v.Parent)
	}
	for _, c := range v.Children {
		out.Children = append(out.Children, wireChild(c))
	}
	for _, e := range v.Events {
		out.Events = append(out.Events, &pb.AgentLineageEvent{Seq: e.Seq, AtUnixMillis: millis(e.At), Type: e.Type, ConversationId: e.Conversation, Summary: e.Summary})
	}
	if v.Spawned != nil {
		out.Spawned = wireChild(*v.Spawned)
	}
	return out
}

// sessionLineage is where a conversation sits in an agent tree, for the app.
func (s *Service) sessionLineage(ctx context.Context, e *runner.Execution) *pb.SessionLineage {
	l, ok := s.Bench.LineageOf(ctx, e)
	if !ok {
		return nil
	}
	return &pb.SessionLineage{ParentConversationId: l.Parent, ParentTitle: l.ParentTitle, MissionId: l.Mission, MissionTitle: l.MissionTitle, TaskId: l.Task, Role: l.Role, GrantId: l.Grant, LiveChildren: uint32(l.LiveChildren), MaxChildren: uint32(l.MaxChildren)}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
