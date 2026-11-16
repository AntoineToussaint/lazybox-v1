package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
)

// fakeArtifacts keeps artifacts like the Runner does, for one workspace.
type fakeArtifacts struct {
	workspace string
	items     map[string]*pb.Artifact
	contents  map[string][]string
	puts      []*pb.PutArtifactRequest
}

func (f *fakeArtifacts) check(ws string) error {
	if ws != f.workspace {
		return connect.NewError(connect.CodePermissionDenied, nil)
	}
	return nil
}

func (f *fakeArtifacts) ListArtifacts(_ context.Context, r *connect.Request[pb.ListArtifactsRequest]) (*connect.Response[pb.ListArtifactsResponse], error) {
	if err := f.check(r.Msg.CollectionId); err != nil {
		return nil, err
	}
	out := &pb.ListArtifactsResponse{}
	for _, a := range f.items {
		out.Artifacts = append(out.Artifacts, a)
	}
	return connect.NewResponse(out), nil
}

func (f *fakeArtifacts) GetArtifact(_ context.Context, r *connect.Request[pb.GetArtifactRequest]) (*connect.Response[pb.Artifact], error) {
	if err := f.check(r.Msg.CollectionId); err != nil {
		return nil, err
	}
	a := f.items[r.Msg.ArtifactId]
	if a == nil {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	n := r.Msg.Version
	if n == 0 {
		n = uint32(len(f.contents[a.Id]))
	}
	return connect.NewResponse(&pb.Artifact{Id: a.Id, Title: a.Title, Kind: a.Kind, Versions: a.Versions, Content: f.contents[a.Id][n-1], ContentVersion: n}), nil
}

func (f *fakeArtifacts) PutArtifact(_ context.Context, r *connect.Request[pb.PutArtifactRequest]) (*connect.Response[pb.Artifact], error) {
	if err := f.check(r.Msg.CollectionId); err != nil {
		return nil, err
	}
	f.puts = append(f.puts, r.Msg)
	id := r.Msg.ArtifactId
	if id == "" {
		id = "art" + string(rune('a'+len(f.items)))
		kind := r.Msg.Kind
		if kind == "" {
			kind = "other"
		}
		f.items[id] = &pb.Artifact{Id: id, Title: r.Msg.Title, Kind: kind}
	}
	a := f.items[id]
	if versions := f.contents[id]; len(versions) == 0 || versions[len(versions)-1] != r.Msg.Content {
		f.contents[id] = append(f.contents[id], r.Msg.Content)
		a.Versions = append(a.Versions, &pb.ArtifactVersion{Number: uint32(len(f.contents[id]))})
	}
	n := uint32(len(f.contents[id]))
	return connect.NewResponse(&pb.Artifact{Id: id, Title: a.Title, Kind: a.Kind, Versions: a.Versions, Content: f.contents[id][n-1], ContentVersion: n}), nil
}

func TestArtifactVerbPublishesReadsAndLists(t *testing.T) {
	ctx := context.Background()
	f := &fakeArtifacts{workspace: "ws", items: map[string]*pb.Artifact{}, contents: map[string][]string{}}
	run := func(stdin string, args ...string) (string, error) {
		var out, errs bytes.Buffer
		err := artifactCommand(ctx, f, "ws", args, strings.NewReader(stdin), &out, &errs)
		return out.String(), err
	}
	plan := filepath.Join(t.TempDir(), "PLAN.md")
	if err := os.WriteFile(plan, []byte("# Plan\nv1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Flags may follow the file.
	out, err := run("", "put", plan, "--title", "Rollout plan", "--kind", "plan")
	if err != nil || !strings.Contains(out, "Published “Rollout plan” as artifact arta, version 1 (plan)") || !strings.Contains(out, "--id arta") {
		t.Fatal(out, err)
	}
	if put := f.puts[0]; put.CollectionId != "ws" || put.Content != "# Plan\nv1\n" || put.ArtifactId != "" {
		t.Fatalf("%+v", put)
	}
	out, err = run("# Plan\nv2\n", "put", "--id", "arta", "-")
	if err != nil || !strings.Contains(out, "version 2") {
		t.Fatal(out, err)
	}
	out, err = run("# Plan\nv2\n", "put", "-", "--id", "arta")
	if err != nil || !strings.Contains(out, "unchanged at version 2") {
		t.Fatal(out, err)
	}
	out, err = run("", "get", "arta")
	if err != nil || out != "# Plan\nv2\n" {
		t.Fatalf("%q %v", out, err)
	}
	out, err = run("", "get", "arta", "--version", "1")
	if err != nil || out != "# Plan\nv1\n" {
		t.Fatalf("%q %v", out, err)
	}
	out, err = run("", "list")
	if err != nil || out != "arta\tplan\tv2\tRollout plan\n" {
		t.Fatalf("%q %v", out, err)
	}

	if _, err = run("x", "put", "-"); err == nil || !strings.Contains(err.Error(), "--title is required") {
		t.Fatal(err)
	}
	if _, err = run("", "put"); err == nil {
		t.Fatal("put without a file")
	}
	if _, err = run("", "frobnicate"); err == nil {
		t.Fatal("unknown command accepted")
	}
	var out2, errs bytes.Buffer
	if err = artifactCommand(ctx, f, "", []string{"list"}, strings.NewReader(""), &out2, &errs); err == nil || !strings.Contains(err.Error(), "artifacts belong to a workspace") {
		t.Fatal(err)
	}
	if err = artifactCommand(ctx, f, "", []string{"list", "--collection", "ws"}, strings.NewReader(""), &out2, &errs); err != nil {
		t.Fatal("--collection ignored", err)
	}
}
