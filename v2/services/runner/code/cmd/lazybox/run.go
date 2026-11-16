package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	pb "github.com/AntoineToussaint/lazybox/v2/pkg/gen"
	"github.com/AntoineToussaint/lazybox/v2/pkg/gen/genconnect"
	"github.com/codefly-dev/gortk"
)

// `lazybox run -- COMMAND` is how an agent runs a noisy command. The human
// console receives every byte live, the full output is saved to a file, and
// the agent receives a compact, failure-first view plus that file's path.
// The command's exit status is returned unchanged.

// console is the part of the Runner API a run publishes to.
type console interface {
	RegisterPipe(context.Context, *connect.Request[pb.RegisterPipeRequest]) (*connect.Response[pb.CommandStatus], error)
	Publish(context.Context, *connect.Request[pb.PublishRequest]) (*connect.Response[pb.CommandStatus], error)
	FinishPipe(context.Context, *connect.Request[pb.FinishPipeRequest]) (*connect.Response[pb.CommandStatus], error)
}

// compressor is built once: gortk compiles its filters at construction.
var compressor = gortk.Default().WithRedaction()

// captureLimit bounds what each stream keeps in memory for compression. The
// console and the full-output file are not bounded by it.
const captureLimit = 32 << 20

type runOptions struct {
	session, title, outputDir string
	raw                       bool
}

// runVerb parses `run` flags and connects to the Runner when it can. An
// unreachable Runner never stops the command: the agent still gets its output.
func runVerb(ctx context.Context, endpointPath string, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(stderr)
	o := runOptions{}
	flags.StringVar(&o.session, "session", os.Getenv("LAZYBOX_V2_SESSION_ID"), "execution id whose console shows the output")
	flags.StringVar(&o.title, "title", "", "console title (default: the command line)")
	flags.StringVar(&o.outputDir, "output-dir", os.Getenv("LAZYBOX_V2_OUTPUT_DIR"), "directory for full-output files (default: system temp)")
	flags.BoolVar(&o.raw, "raw", false, "give the agent the full output instead of the compact view")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: lazybox run [--title T] [--raw] -- COMMAND [ARGS...]")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	var c console
	var unavailable error
	if address, err := readEndpoint(endpointPath); err != nil {
		unavailable = err
	} else {
		c = genconnect.NewRunnerServiceClient(newHTTPClient(address.Token), address.URL)
	}
	return runCommand(ctx, c, unavailable, o, flags.Args(), stdout, stderr)
}

func runCommand(ctx context.Context, c console, unavailable error, o runOptions, argv []string, stdout, stderr io.Writer) error {
	if len(argv) == 0 {
		return errors.New("usage: lazybox run [--title T] [--raw] -- COMMAND [ARGS...]")
	}
	line := strings.Join(argv, " ")
	title := o.title
	if title == "" {
		title = shorten(line, 120)
	}
	s := &sink{}
	if f, path, err := outputFile(o.outputDir, argv[0]); err == nil {
		s.file, s.path = f, path
		defer f.Close()
	} else {
		fmt.Fprintln(stderr, "lazybox: full output will not be saved:", err)
	}
	if c == nil {
		s.publishErr = unavailable
	} else if o.session == "" {
		s.publishErr = errors.New("no Lazybox session (run it from a Lazybox agent, or pass --session)")
	} else if r, err := c.RegisterPipe(ctx, connect.NewRequest(&pb.RegisterPipeRequest{SessionId: o.session, Title: title})); err != nil {
		s.publishErr = err
	} else {
		s.ctx, s.console, s.id = ctx, c, r.Msg.Id
	}

	started := time.Now()
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	// No stdin: a command waiting for input would hang the agent's turn.
	cmd.Stdout, cmd.Stderr = s.stream(&s.out), s.stream(&s.err)
	code := 0
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		} else {
			code = 127
			fmt.Fprintf(s.stream(&s.err), "lazybox: could not start %s: %v\n", argv[0], err)
		}
		if code < 0 { // killed by a signal
			code = 1
		}
	}
	elapsed := time.Since(started)
	s.finish()

	var result gortk.Result
	if o.raw {
		result = gortk.Result{Text: string(s.out.data) + string(s.err.data), Filter: "raw"}
	} else {
		result = compressor.Compress(gortk.CommandFromArgs(argv, s.out.data, s.err.data, code))
	}
	writeReport(stdout, report{line: line, code: code, elapsed: elapsed, result: result, path: s.path, bytes: s.total, clipped: s.out.clipped || s.err.clipped, console: s.id, publishErr: s.publishErr})
	if code != 0 {
		return processExit(code)
	}
	return nil
}

type report struct {
	line       string
	code       int
	elapsed    time.Duration
	result     gortk.Result
	path       string
	bytes      int64
	clipped    bool
	console    string
	publishErr error
}

// writeReport puts the outcome first so an agent that reads only the top
// still sees whether the command failed, then the compact output, then how
// to get the rest. Agents rarely fetch more, so failures must survive here.
func writeReport(w io.Writer, r report) {
	fmt.Fprintf(w, "[lazybox] %s → exit %d (%s)\n", shorten(r.line, 200), r.code, r.elapsed.Round(100*time.Millisecond))
	text := r.result.Text
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	io.WriteString(w, text)
	t := r.result.Truncation
	lossy := !r.result.Lossless() || r.clipped
	if lossy {
		note := t.Note
		if note == "" {
			note = "some output was omitted"
		}
		if r.clipped {
			note += fmt.Sprintf("; the compact view covers the first %d MiB of each stream", captureLimit>>20)
		}
		fmt.Fprintf(w, "[lazybox] %s\n", note)
	}
	if r.path != "" && (lossy || r.code != 0) {
		fmt.Fprintf(w, "[lazybox] full output (%s): %s\n", size(r.bytes), r.path)
	}
	if r.publishErr != nil {
		fmt.Fprintf(w, "[lazybox] not shown in the Lazybox console: %v\n", r.publishErr)
	}
}

// sink fans one command's output out to the console, the full-output file and
// a bounded per-stream buffer. exec writes stdout and stderr from separate
// goroutines, so every write is serialized.
type sink struct {
	mu         sync.Mutex
	ctx        context.Context
	console    console
	id         string
	offset     uint64
	publishErr error
	file       *os.File
	path       string
	total      int64
	out, err   buffer
}

type buffer struct {
	data    []byte
	clipped bool
}

type streamWriter struct {
	s *sink
	b *buffer
}

func (s *sink) stream(b *buffer) io.Writer { return streamWriter{s, b} }

func (w streamWriter) Write(p []byte) (int, error) {
	s := w.s
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total += int64(len(p))
	if room := captureLimit - len(w.b.data); room >= len(p) {
		w.b.data = append(w.b.data, p...)
	} else {
		w.b.data = append(w.b.data, p[:max(room, 0)]...)
		w.b.clipped = true
	}
	if s.file != nil {
		if _, err := s.file.Write(p); err != nil {
			s.file, s.path = nil, ""
		}
	}
	if s.console != nil && s.publishErr == nil {
		if _, err := s.console.Publish(s.ctx, connect.NewRequest(&pb.PublishRequest{CommandId: s.id, Offset: s.offset, Data: p})); err != nil {
			s.publishErr = err
		} else {
			s.offset += uint64(len(p))
		}
	}
	// Never fail the command because a viewer or the disk failed.
	return len(p), nil
}

func (s *sink) finish() {
	if s.console == nil {
		return
	}
	cause := ""
	if s.publishErr != nil {
		cause = s.publishErr.Error()
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(s.ctx), 5*time.Second)
	defer cancel()
	if _, err := s.console.FinishPipe(ctx, connect.NewRequest(&pb.FinishPipeRequest{CommandId: s.id, CaptureError: cause})); err != nil && s.publishErr == nil {
		s.publishErr = err
	}
}

func readEndpoint(path string) (endpoint, error) {
	if path == "" {
		return endpoint{}, errors.New("no Runner endpoint (--endpoint or LAZYBOX_V2_ENDPOINT)")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return endpoint{}, err
	}
	var address endpoint
	if err = json.Unmarshal(data, &address); err != nil {
		return endpoint{}, err
	}
	return address, nil
}

func newHTTPClient(token string) *http.Client { return &http.Client{Transport: authTransport{token}} }

// outputFile is private to the user: it holds unredacted output.
func outputFile(dir, name string) (*os.File, string, error) {
	if dir == "" {
		dir = filepath.Join(os.TempDir(), "lazybox-output")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, "", err
	}
	f, err := os.CreateTemp(dir, safeName(filepath.Base(name))+"-*.log")
	if err != nil {
		return nil, "", err
	}
	return f, f.Name(), nil
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, s)
	if s == "" {
		return "command"
	}
	return shorten(s, 40)
}

func shorten(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func size(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MiB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KiB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
