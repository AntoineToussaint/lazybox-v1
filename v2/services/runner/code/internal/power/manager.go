package power

import (
	"crypto/sha256"
	_ "embed"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

//go:embed actions.schema.json
var Schema string

//go:embed starter.yaml
var starter string

// SchemaName is the schema's file name beside the actions file.
const SchemaName = "actions.schema.json"

// Snapshot is the file as last loaded.
type Snapshot struct {
	Path   string
	Exists bool
	// Err: the file as a whole does not load. File is then the last version
	// that did (Stale), or empty.
	Err      string
	Stale    bool
	Issues   []Issue
	File     File
	Revision uint64
	LoadedAt time.Time
}

// Manager keeps the actions file loaded and reloads it when it changes. A
// version that does not load leaves the last good one in force, so a typo
// mid-edit does not take a person's actions away.
type Manager struct {
	path string
	mu   sync.Mutex
	snap Snapshot
	// digest is the content last read; good the last file that loaded.
	digest  [32]byte
	read    bool
	good    *File
	changed chan struct{}
}

// NewManager loads path (which need not exist).
func NewManager(path string) *Manager {
	m := &Manager{path: path, changed: make(chan struct{})}
	m.Reload()
	return m
}

// Path is the actions file.
func (m *Manager) Path() string { return m.path }

// SchemaPath is where InitUserActions writes the JSON Schema.
func (m *Manager) SchemaPath() string { return filepath.Join(filepath.Dir(m.path), SchemaName) }

// Snapshot returns the file as last loaded.
func (m *Manager) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snap
}

// Changed is closed at the next change of what the file declares.
func (m *Manager) Changed() <-chan struct{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.changed
}

// Reload reads the file again and reports whether anything changed.
func (m *Manager) Reload() (Snapshot, bool) {
	data, err := readBounded(m.path)
	// What was read: the content, or why nothing was.
	digest := sha256.Sum256(data)
	if err != nil {
		digest = sha256.Sum256([]byte("\x00error\x00" + err.Error()))
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.read && digest == m.digest {
		return m.snap, false
	}
	m.read, m.digest = true, digest
	exists := err == nil || !errors.Is(err, fs.ErrNotExist)
	next := Snapshot{Path: m.path, Exists: exists, Revision: m.snap.Revision + 1, LoadedAt: time.Now()}
	switch {
	case errors.Is(err, fs.ErrNotExist):
		m.good = nil
	case err != nil:
		next.Err = "the file cannot be read: " + err.Error()
	default:
		file, issues, parseErr := Parse(data)
		if parseErr != nil {
			next.Err = parseErr.Error()
		} else {
			next.File, next.Issues = file, issues
			m.good = &file
		}
	}
	if next.Err != "" && m.good != nil {
		next.File, next.Stale = *m.good, true
	}
	m.snap = next
	close(m.changed)
	m.changed = make(chan struct{})
	return next, true
}

// Watch reloads the file every interval until stop is closed. Polling, not
// file events: editors replace files in ways watchers miss, and the file is small.
func (m *Manager) Watch(stop <-chan struct{}, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			m.Reload()
		}
	}
}

// Init creates the file with a commented starter, and writes the JSON Schema
// beside it, when the file does not exist. An existing file is never replaced.
func (m *Manager) Init() (Snapshot, error) {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o700); err != nil {
		return m.Snapshot(), err
	}
	if err := writeExclusive(m.path, []byte(starter)); err != nil && !errors.Is(err, fs.ErrExist) {
		return m.Snapshot(), err
	}
	// The schema is ours: keep it current with this Runner.
	if err := os.WriteFile(m.SchemaPath(), []byte(Schema), 0o600); err != nil {
		return m.Snapshot(), err
	}
	snap, _ := m.Reload()
	return snap, nil
}

func writeExclusive(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	return errors.Join(err, f.Close())
}

// readBounded reads at most one byte more than a file may hold, so Parse can
// say it is too large without reading all of it.
func readBounded(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
}
