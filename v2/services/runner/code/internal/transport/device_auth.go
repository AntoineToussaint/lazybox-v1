package transport

import (
	"context"
	"net/http"
	"strings"

	"connectrpc.com/vanguard"
	"connectrpc.com/vanguard/vanguardgrpc"

	"github.com/AntoineToussaint/lazybox/v2/internal/devices"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// DeviceVerifier resolves a paired device's access credential
// (devices.Manager implements it).
type DeviceVerifier interface {
	Authenticate(token string) (devices.Device, error)
}

// deviceRule admits one RPC to a device holding grant, for requests allow
// accepts (nil accepts any request of the RPC).
type deviceRule struct {
	grant string
	allow func(req any) bool
}

// deviceRPCs is everything a paired device may call (REMOTE.md). Reading
// covers what a phone shows: the inbox, a conversation and its output, a
// workspace's changes. Responding is what the person does in a conversation:
// send, answer, approve or decline, interrupt. Starting runs a new agent
// process, so it is a separate grant. Nothing else — settings, subscriptions,
// GitHub, terminals, commands, files, deletion, processes, restart, devices,
// and any RPC added later — is reachable with a device credential.
var deviceRPCs = map[string]deviceRule{
	pb.RunnerService_Info_FullMethodName:                 {grant: devices.GrantRead},
	pb.RunnerService_ListHistory_FullMethodName:          {grant: devices.GrantRead},
	pb.RunnerService_GetSession_FullMethodName:           {grant: devices.GrantRead},
	pb.RunnerService_ListCollections_FullMethodName:      {grant: devices.GrantRead},
	pb.RunnerService_GetCollection_FullMethodName:        {grant: devices.GrantRead},
	pb.RunnerService_ListWorkspaceChanges_FullMethodName: {grant: devices.GrantRead},
	pb.RunnerService_ReadWorkspaceDiff_FullMethodName:    {grant: devices.GrantRead},
	pb.RunnerService_ListCommands_FullMethodName:         {grant: devices.GrantRead},
	pb.RunnerService_ReadCommand_FullMethodName:          {grant: devices.GrantRead},
	// Images a sent message carried are part of reading its conversation; the
	// attachment store serves only retained message images, at most 20 MiB.
	pb.RunnerService_ReadAttachment_FullMethodName: {grant: devices.GrantRead},
	pb.RunnerService_Apply_FullMethodName: {grant: devices.GrantRespond, allow: func(req any) bool {
		r, ok := req.(*pb.ApplyRequest)
		if !ok {
			return false
		}
		// Changing a running agent's permission mode (to yolo, say) is a
		// setting, not a response.
		switch r.Operation.(type) {
		case *pb.ApplyRequest_Message, *pb.ApplyRequest_Steer, *pb.ApplyRequest_Interrupt, *pb.ApplyRequest_Answer, *pb.ApplyRequest_Approval:
			return true
		}
		return false
	}},
	pb.RunnerService_OpenSession_FullMethodName: {grant: devices.GrantStart, allow: func(req any) bool {
		r, ok := req.(*pb.OpenSessionRequest)
		// Only in an existing workspace, with the Runner's own defaults for
		// permission and gateway: a phone does not pick a directory, resume an
		// arbitrary provider thread or raise an agent's permissions.
		if !ok || r.CollectionId == "" || r.Cwd != "" || r.ResumeReference != "" || r.EmptyWorkspace {
			return false
		}
		o := r.Options
		return o == nil || (o.Permission == "" && o.GatewayId == "" && o.Instructions == "")
	}},
	pb.RunnerService_ResumeSession_FullMethodName: {grant: devices.GrantStart},
}

// deviceStreams are the server streams a device may follow.
var deviceStreams = map[string]string{
	pb.RunnerService_WatchEvents_FullMethodName: devices.GrantRead,
	pb.RunnerService_WatchOutput_FullMethodName: devices.GrantRead,
}

type deviceKey struct{}

// callerDevice is the paired device that made this call, or nil.
func callerDevice(ctx context.Context) *devices.Device {
	d, _ := ctx.Value(deviceKey{}).(*devices.Device)
	return d
}

// authorizeDevice admits a device credential, and only a device credential,
// to the RPCs its grants allow. The owner's bearer and agent or terminal
// credentials are refused: the device gateway is not another way in for them.
// req is nil for a stream.
func authorizeDevice(ctx context.Context, verifier DeviceVerifier, method string, req any) (*devices.Device, error) {
	unauthenticated := status.Error(codes.Unauthenticated, "a paired device's credential is required; sign in again from the phone")
	md, _ := metadata.FromIncomingContext(ctx)
	values := md.Get("authorization")
	if len(values) != 1 || verifier == nil {
		return nil, unauthenticated
	}
	token, ok := strings.CutPrefix(values[0], "Bearer ")
	if !ok || !strings.HasPrefix(token, devices.TokenPrefix) {
		return nil, unauthenticated
	}
	d, err := verifier.Authenticate(token)
	if err != nil {
		return nil, unauthenticated
	}
	denied := status.Error(codes.PermissionDenied, "this device is not allowed to do that; change what it may do by pairing it again from Settings → Devices")
	if req == nil {
		if grant, ok := deviceStreams[method]; ok && d.Has(grant) {
			return &d, nil
		}
		return nil, denied
	}
	rule, ok := deviceRPCs[method]
	if !ok || !d.Has(rule.grant) || (rule.allow != nil && !rule.allow(req)) {
		return nil, denied
	}
	return &d, nil
}

// DeviceAuthority protects the device gateway's RPC endpoint. It is a
// different server from the owner's loopback listener, with this interceptor
// alone, so a credential valid on one is refused on the other.
func DeviceAuthority(verifier DeviceVerifier) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			d, err := authorizeDevice(ctx, verifier, info.FullMethod, req)
			if err != nil {
				return nil, err
			}
			return handler(context.WithValue(ctx, deviceKey{}, d), req)
		}),
		grpc.ChainStreamInterceptor(func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			if _, err := authorizeDevice(stream.Context(), verifier, info.FullMethod, nil); err != nil {
				return err
			}
			return handler(srv, stream)
		}),
	}
}

// deviceInfo is what Info tells a device: conversations and limits, and each
// account by name only. Usage, email addresses, sign-in flows and gateways
// stay on the owner's screen.
func deviceInfo(full *pb.InfoResponse) *pb.InfoResponse {
	out := &pb.InfoResponse{Sessions: full.Sessions, DefaultModel: full.DefaultModel, AttachmentLimits: full.AttachmentLimits, InstanceId: full.InstanceId}
	for _, p := range full.Profiles {
		out.Profiles = append(out.Profiles, &pb.Profile{Id: p.Id, Provider: p.Provider, Label: p.Label, Managed: p.Managed, Isolation: p.Isolation})
	}
	return out
}

// DeviceHandler serves the Runner's API to paired devices over Connect, on a
// gRPC server of its own whose only authority is DeviceAuthority. stop ends
// that server.
func DeviceHandler(service pb.RunnerServiceServer, verifier DeviceVerifier, maxMessageBytes int) (handler http.Handler, stop func(), err error) {
	server := grpc.NewServer(append([]grpc.ServerOption{grpc.MaxRecvMsgSize(maxMessageBytes)}, DeviceAuthority(verifier)...)...)
	pb.RegisterRunnerServiceServer(server, service)
	// The same omitted-default ProtoJSON profile as the owner's Connect listener.
	codec := vanguard.WithCodec(func(res vanguard.TypeResolver) vanguard.Codec {
		c := vanguard.NewJSONCodec(res)
		c.MarshalOptions.EmitUnpopulated = false
		c.MarshalOptions.EmitDefaultValues = false
		return c
	})
	transcoder, err := vanguardgrpc.NewTranscoder(server, codec, vanguard.WithDefaultServiceOptions(vanguard.WithTargetCodecs(vanguard.CodecProto), vanguard.WithMaxMessageBufferBytes(uint32(maxMessageBytes))))
	if err != nil {
		return nil, nil, err
	}
	return transcoder, server.Stop, nil
}
