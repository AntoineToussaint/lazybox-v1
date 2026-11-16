package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"connectrpc.com/connect"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"github.com/AntoineToussaint/lazybox/v2/pkg/gen/genconnect"
)

// `lazybox artifact` publishes and reads the workspace's artifacts: plans,
// reports and specs an agent writes for the person, kept by the Runner as
// versioned pages (v2/ARTIFACTS.md). An agent's credential reaches only its
// own workspace's artifacts.

// artifactAPI is the part of the Runner API the verb uses.
type artifactAPI interface {
	ListArtifacts(context.Context, *connect.Request[pb.ListArtifactsRequest]) (*connect.Response[pb.ListArtifactsResponse], error)
	GetArtifact(context.Context, *connect.Request[pb.GetArtifactRequest]) (*connect.Response[pb.Artifact], error)
	PutArtifact(context.Context, *connect.Request[pb.PutArtifactRequest]) (*connect.Response[pb.Artifact], error)
}

const artifactUsage = `Usage:
  lazybox artifact put <file|-> --title T [--id ID] [--kind plan|report|spec|notes|other]
  lazybox artifact get ID [--version N]
  lazybox artifact list`

const noWorkspace = "artifacts belong to a workspace; run this from a Lazybox agent working in one, or pass --collection"

func artifactVerb(ctx context.Context, endpointPath string, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	address, err := readEndpoint(endpointPath)
	if err != nil {
		return err
	}
	client := genconnect.NewRunnerServiceClient(newHTTPClient(address.Token), address.URL)
	return artifactCommand(ctx, client, os.Getenv("LAZYBOX_V2_COLLECTION_ID"), args, stdin, stdout, stderr)
}

// parseInterleaved parses flags wherever they appear among the positional
// arguments (`put plan.md --title T` as well as `put --title T plan.md`).
func parseInterleaved(flags *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for {
		if err := flags.Parse(args); err != nil {
			return nil, err
		}
		rest := flags.Args()
		if len(rest) == 0 {
			return positional, nil
		}
		positional = append(positional, rest[0])
		args = rest[1:]
	}
}

func artifactCommand(ctx context.Context, client artifactAPI, workspace string, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		fmt.Fprintln(stderr, artifactUsage)
		return errors.New("lazybox artifact needs put, get or list")
	}
	verb := args[0]
	flags := flag.NewFlagSet("artifact "+verb, flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() { fmt.Fprintln(stderr, artifactUsage); flags.PrintDefaults() }
	collection := flags.String("collection", workspace, "workspace whose artifacts to use (set for agents and workspace terminals)")
	title := flags.String("title", "", "put: the artifact's title (required to create one)")
	id := flags.String("id", "", "put: publish a new version of this artifact instead of creating one")
	kind := flags.String("kind", "", "put: plan, report, spec, notes or other")
	version := flags.Uint("version", 0, "get: this version instead of the latest")
	positional, err := parseInterleaved(flags, args[1:])
	if err != nil {
		return err
	}
	if *collection == "" {
		return errors.New(noWorkspace)
	}
	switch verb {
	case "put":
		if len(positional) != 1 {
			return errors.New("usage: lazybox artifact put <file|-> --title T [--id ID] [--kind plan]")
		}
		if *id == "" && strings.TrimSpace(*title) == "" {
			return errors.New("--title is required to create an artifact (or pass --id ID to publish a new version)")
		}
		var data []byte
		if positional[0] == "-" {
			data, err = io.ReadAll(io.LimitReader(stdin, 1<<20+1))
		} else {
			data, err = os.ReadFile(positional[0])
		}
		if err != nil {
			return err
		}
		previous := uint32(0)
		if *id != "" {
			current, err := client.GetArtifact(ctx, connect.NewRequest(&pb.GetArtifactRequest{CollectionId: *collection, ArtifactId: *id}))
			if err != nil {
				return err
			}
			previous = current.Msg.ContentVersion
		}
		r, err := client.PutArtifact(ctx, connect.NewRequest(&pb.PutArtifactRequest{CollectionId: *collection, ArtifactId: *id, Title: *title, Kind: *kind, Content: string(data)}))
		if err != nil {
			return err
		}
		a := r.Msg
		if previous != 0 && a.ContentVersion == previous {
			_, err = fmt.Fprintf(stdout, "Artifact %s “%s” unchanged at version %d (same content).\n", a.Id, a.Title, a.ContentVersion)
			return err
		}
		_, err = fmt.Fprintf(stdout, "Published “%s” as artifact %s, version %d (%s). The user sees it in Lazybox → Artifacts. Publish a new version with --id %s.\n", a.Title, a.Id, a.ContentVersion, a.Kind, a.Id)
		return err
	case "get":
		if len(positional) != 1 {
			return errors.New("usage: lazybox artifact get ID [--version N]")
		}
		r, err := client.GetArtifact(ctx, connect.NewRequest(&pb.GetArtifactRequest{CollectionId: *collection, ArtifactId: positional[0], Version: uint32(*version)}))
		if err != nil {
			return err
		}
		content := r.Msg.Content
		if !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		_, err = io.WriteString(stdout, content)
		return err
	case "list":
		if len(positional) != 0 {
			return errors.New("usage: lazybox artifact list")
		}
		r, err := client.ListArtifacts(ctx, connect.NewRequest(&pb.ListArtifactsRequest{CollectionId: *collection}))
		if err != nil {
			return err
		}
		if len(r.Msg.Artifacts) == 0 {
			_, err = fmt.Fprintln(stdout, "No artifacts in this workspace yet.")
			return err
		}
		for _, a := range r.Msg.Artifacts {
			latest := uint32(0)
			if n := len(a.Versions); n > 0 {
				latest = a.Versions[n-1].Number
			}
			if _, err = fmt.Fprintf(stdout, "%s\t%s\tv%d\t%s\n", a.Id, a.Kind, latest, a.Title); err != nil {
				return err
			}
		}
		return nil
	}
	fmt.Fprintln(stderr, artifactUsage)
	return fmt.Errorf("unknown artifact command %q", verb)
}
