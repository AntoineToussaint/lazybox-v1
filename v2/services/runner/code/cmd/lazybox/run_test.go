package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"github.com/codefly-dev/gortk"
)

type recordingConsole struct {
	pipeClient
	title     string
	published bytes.Buffer
}

func (c *recordingConsole) RegisterPipe(_ context.Context, r *connect.Request[pb.RegisterPipeRequest]) (*connect.Response[pb.CommandStatus], error) {
	c.title = r.Msg.Title
	return connect.NewResponse(&pb.CommandStatus{Id: "command"}), nil
}
func (c *recordingConsole) Publish(_ context.Context, r *connect.Request[pb.PublishRequest]) (*connect.Response[pb.CommandStatus], error) {
	if r.Msg.Offset != uint64(c.published.Len()) {
		return nil, errors.New("offset gap")
	}
	c.published.Write(r.Msg.Data)
	return connect.NewResponse(&pb.CommandStatus{}), nil
}

func TestRunStreamsEverythingToConsoleAndKeepsExitStatus(t *testing.T) {
	c := &recordingConsole{}
	var stdout, stderr bytes.Buffer
	err := runCommand(context.Background(), c, nil, runOptions{session: "execution", outputDir: t.TempDir()}, []string{"sh", "-c", "echo visible; echo broken >&2; exit 3"}, &stdout, &stderr)
	var exit processExit
	if !errors.As(err, &exit) || exit != 3 {
		t.Fatalf("exit status not preserved: %v", err)
	}
	if !strings.Contains(c.published.String(), "visible") || !strings.Contains(c.published.String(), "broken") {
		t.Fatalf("console missed output: %q", c.published.String())
	}
	if c.finished == nil || c.finished.CaptureError != "" {
		t.Fatalf("capture not closed cleanly: %+v", c.finished)
	}
	report := stdout.String()
	if !strings.HasPrefix(report, "[lazybox] sh -c echo visible; echo broken >&2; exit 3 → exit 3") || !strings.Contains(report, "broken") {
		t.Fatalf("agent report must lead with the outcome and keep the failure: %q", report)
	}
	path := report[strings.Index(report, "full output (")+len("full output ("):]
	path = strings.TrimSpace(path[strings.Index(path, ": ")+2:])
	saved, readErr := os.ReadFile(path)
	if readErr != nil || !strings.Contains(string(saved), "visible") || !strings.Contains(string(saved), "broken") {
		t.Fatalf("full output file incomplete: %v %q", readErr, saved)
	}
}

func TestRunWithoutRunnerStillRunsAndReports(t *testing.T) {
	var stdout bytes.Buffer
	err := runCommand(context.Background(), nil, errors.New("no Runner endpoint"), runOptions{outputDir: t.TempDir()}, []string{"sh", "-c", "echo hello"}, &stdout, &bytes.Buffer{})
	if err != nil || !strings.Contains(stdout.String(), "hello") || !strings.Contains(stdout.String(), "not shown in the Lazybox console: no Runner endpoint") {
		t.Fatalf("%v %q", err, stdout.String())
	}
}

func TestRunNeverWaitsForInput(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var stdout bytes.Buffer
	if err := runCommand(ctx, nil, errors.New("offline"), runOptions{outputDir: t.TempDir()}, []string{"sh", "-c", "read answer; echo got:$answer"}, &stdout, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout.String(), "got:") {
		t.Fatalf("%q", stdout.String())
	}
}

func TestRunReportsMissingCommandAsFailure(t *testing.T) {
	var stdout bytes.Buffer
	err := runCommand(context.Background(), nil, errors.New("offline"), runOptions{outputDir: t.TempDir()}, []string{"lazybox-definitely-missing"}, &stdout, &bytes.Buffer{})
	var exit processExit
	if !errors.As(err, &exit) || exit != 127 || !strings.Contains(stdout.String(), "could not start") {
		t.Fatalf("%v %q", err, stdout.String())
	}
}

func TestReportExplainsLossAndWhereToFindEverything(t *testing.T) {
	var out bytes.Buffer
	writeReport(&out, report{line: "go test ./...", code: 1, elapsed: 1500 * time.Millisecond, path: "/tmp/full.log", bytes: 3 << 20,
		result: gortk.Result{Text: "--- FAIL: TestX", Truncation: gortk.Truncation{Happened: true, DroppedLines: 412, Note: "kept 1 failing test, dropped 412 passing"}}})
	want := "[lazybox] go test ./... → exit 1 (1.5s)\n--- FAIL: TestX\n[lazybox] kept 1 failing test, dropped 412 passing\n[lazybox] full output (3.0 MiB): /tmp/full.log\n"
	if out.String() != want {
		t.Fatalf("got:\n%s\nwant:\n%s", out.String(), want)
	}
	out.Reset()
	writeReport(&out, report{line: "true", path: "/tmp/full.log", result: gortk.Result{Text: ""}})
	if strings.Contains(out.String(), "full output") {
		t.Fatalf("a clean, lossless run should not point at the file: %q", out.String())
	}
}
