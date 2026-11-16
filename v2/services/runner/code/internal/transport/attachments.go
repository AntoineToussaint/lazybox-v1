package transport

import (
	"context"
	"errors"

	"github.com/AntoineToussaint/lazybox/v2/internal/runner/attachments"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"google.golang.org/grpc/codes"
)

// ReadAttachment serves the bytes of an image a sent message carried, for the
// conversation's thumbnails. It is owner-only like every RPC off the agent and
// terminal allowlists (auth.go).
func (s *Service) ReadAttachment(_ context.Context, r *pb.ReadAttachmentRequest) (*pb.AttachmentContent, error) {
	file, data, err := s.Bench.Attachments.ReadImage(r.Path)
	switch {
	case errors.Is(err, attachments.ErrNotAttachment):
		return nil, grpcError(codes.InvalidArgument, err)
	case errors.Is(err, attachments.ErrTooLarge):
		return nil, grpcError(codes.ResourceExhausted, err)
	case err != nil:
		return nil, rpcError(err)
	}
	return &pb.AttachmentContent{Name: file.Name, MediaType: file.MediaType, Data: data}, nil
}
