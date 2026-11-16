// Package version is the one version string a Lazybox release carries: the
// Runner, the `lazybox` CLI and the desktop app are built from the same tag
// and report the same value (Settings → About, `lazybox --version`, the
// Runner's Version RPC).
//
// A release build sets it with the linker:
//
//	go build -ldflags "-X github.com/AntoineToussaint/lazybox/v2/internal/version.Version=0.1.0"
//
// Anything else (Dev, Working, tests, `go run`) reports "dev".
package version

// Version is the release this binary was built as, or "dev".
var Version = "dev"

// Released reports whether this binary was built as a numbered release.
func Released() bool { return Version != "" && Version != "dev" }

// String is Version, never empty.
func String() string {
	if Version == "" {
		return "dev"
	}
	return Version
}
